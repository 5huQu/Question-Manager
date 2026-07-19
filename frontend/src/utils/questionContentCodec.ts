import type {
  EditorBlockNode,
  EditorChoiceOption,
  EditorCodecWarning,
  EditorDocumentV1,
  EditorInlineNode,
  EditorTableCell,
  EditorTableNode,
} from '@/types/questionContent'
import { normalizeLatexMathDelimiters } from '@/utils/mathMarkdown'

const CHOICE_MARKER = /^\s*([A-D])\s*[.．、:：]\s*(.*)$/
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/
const UNSUPPORTED_BLOCK = /^(?:\s{0,3}(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|```|~~~)|\s*<!--|\s*<\/?[A-Za-z]|\s*!\[[^\]]*\]\()/

export function sanitizePastedHtml(html: string): string {
  if (!html) return ''
  const template = document.createElement('template')
  template.innerHTML = html
  template.content
    .querySelectorAll('script, style, iframe, object, embed, link, meta, base, form, input, button, textarea, select, option')
    .forEach((node) => node.remove())
  template.content.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().replace(/[\u0000-\u0020]+/g, '')
      if (name.startsWith('on') || name === 'srcdoc' || ((name === 'href' || name === 'src' || name === 'xlink:href') && /^(?:javascript|vbscript|data:text\/html):/i.test(value))) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return template.innerHTML
}

function sanitizeMarkdown(markdown: string): { markdown: string; changed: boolean } {
  let sanitized = markdown
  sanitized = sanitized.replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  sanitized = sanitized.replace(/<(?:script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|option)\b[^>]*\/?\s*>/gi, '')
  sanitized = sanitized.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  sanitized = sanitized.replace(/\s+(href|src|xlink:href)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html):[\s\S]*?\2/gi, '')
  return { markdown: sanitized, changed: sanitized !== markdown }
}

function parseInline(value: string): EditorInlineNode[] {
  const nodes: EditorInlineNode[] = []
  let text = ''
  const flushText = () => {
    if (!text) return
    nodes.push({ type: 'text', text })
    text = ''
  }

  for (let index = 0; index < value.length;) {
    if (value[index] === '\n') {
      flushText()
      nodes.push({ type: 'hardBreak' })
      index += 1
      continue
    }
    if (value[index] === '$' && value[index - 1] !== '\\' && value[index + 1] !== '$') {
      let end = index + 1
      while (end < value.length) {
        if (value[end] === '$' && value[end - 1] !== '\\') break
        end += 1
      }
      if (end < value.length && end > index + 1) {
        flushText()
        nodes.push({ type: 'inlineMath', latex: value.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }
    text += value[index]
    index += 1
  }
  flushText()
  return nodes
}

function inlineToMarkdown(content: EditorInlineNode[]): string {
  return content.map((node) => {
    if (node.type === 'text') return node.text
    if (node.type === 'hardBreak') return '\n'
    return `$${node.latex}$`
  }).join('')
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character === '|' && body[index - 1] !== '\\') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell.trim())
  return cells.length >= 2 ? cells : null
}

function parseTable(lines: string[], start: number): { node: EditorTableNode; consumed: number } | null {
  if (start + 1 >= lines.length) return null
  const header = splitTableRow(lines[start])
  const separator = splitTableRow(lines[start + 1])
  if (!header || !separator || separator.length !== header.length || !separator.every((cell) => TABLE_SEPARATOR_CELL.test(cell))) return null
  const rows: EditorTableCell[][] = []
  let cursor = start + 2
  while (cursor < lines.length) {
    const cells = splitTableRow(lines[cursor])
    if (!cells || cells.length !== header.length) break
    rows.push(cells.map((cell) => ({ content: parseInline(cell) })))
    cursor += 1
  }
  return {
    node: {
      type: 'table',
      header: header.map((cell) => ({ content: parseInline(cell) })),
      rows,
      alignments: separator.map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null),
    },
    consumed: cursor - start,
  }
}

function parseChoices(lines: string[], start: number): { node: EditorBlockNode; consumed: number } | null {
  const options: EditorChoiceOption[] = []
  let cursor = start
  for (const label of ['A', 'B', 'C', 'D'] as const) {
    const match = lines[cursor]?.match(CHOICE_MARKER)
    if (!match || match[1] !== label) return null
    const contentLines = [match[2]]
    cursor += 1
    while (cursor < lines.length && lines[cursor].trim() && !CHOICE_MARKER.test(lines[cursor])) {
      contentLines.push(lines[cursor])
      cursor += 1
    }
    options.push({ label, content: parseInline(contentLines.join('\n')) })
  }
  return { node: { type: 'choices', options }, consumed: cursor - start }
}

function rawNode(markdown: string, reason: 'unsupported-markdown' | 'unsafe-html-removed', content: EditorBlockNode[], warnings: EditorCodecWarning[]) {
  content.push({ type: 'rawMarkdown', markdown, reason })
  warnings.push({
    code: reason,
    message: reason === 'unsafe-html-removed' ? '已移除不安全的 HTML；其余源码已保留。' : '此 Markdown 结构暂不支持可视化编辑，已原样保留。',
    blockIndex: content.length - 1,
  })
}

export function markdownToEditorDocument(source: string): EditorDocumentV1 {
  const normalized = normalizeLatexMathDelimiters(String(source ?? '').replace(/\r\n?/g, '\n'))
  const sanitized = sanitizeMarkdown(normalized)
  const lines = sanitized.markdown.split('\n')
  const content: EditorBlockNode[] = []
  const warnings: EditorCodecWarning[] = []
  let cursor = 0

  if (sanitized.changed && !sanitized.markdown.trim()) {
    rawNode('', 'unsafe-html-removed', content, warnings)
    return { version: 1, content, warnings }
  }

  while (cursor < lines.length) {
    if (!lines[cursor].trim()) {
      cursor += 1
      continue
    }
    if (lines[cursor].trim() === '$$') {
      const end = lines.indexOf('$$', cursor + 1)
      if (end >= 0) {
        content.push({ type: 'blockMath', latex: lines.slice(cursor + 1, end).join('\n') })
        cursor = end + 1
        continue
      }
    }
    const singleLineMath = lines[cursor].match(/^\s*\$\$(.+)\$\$\s*$/)
    if (singleLineMath) {
      content.push({ type: 'blockMath', latex: singleLineMath[1].trim() })
      cursor += 1
      continue
    }
    const table = parseTable(lines, cursor)
    if (table) {
      content.push(table.node)
      cursor += table.consumed
      continue
    }
    const choices = parseChoices(lines, cursor)
    if (choices) {
      content.push(choices.node)
      cursor += choices.consumed
      continue
    }

    const blockLines = [lines[cursor]]
    cursor += 1
    while (cursor < lines.length && lines[cursor].trim()) {
      if (parseTable(lines, cursor) || parseChoices(lines, cursor) || lines[cursor].trim() === '$$') break
      blockLines.push(lines[cursor])
      cursor += 1
    }
    const block = blockLines.join('\n')
    const reason = sanitized.changed && /<\/?[A-Za-z]|<!--/.test(block) ? 'unsafe-html-removed' : 'unsupported-markdown'
    if (UNSUPPORTED_BLOCK.test(block) || /(?:\*\*|__|~~|`)[^\n]+(?:\*\*|__|~~|`)/.test(block)) rawNode(block, reason, content, warnings)
    else content.push({ type: 'paragraph', content: parseInline(block) })
  }

  if (sanitized.changed && !warnings.some((warning) => warning.code === 'unsafe-html-removed')) {
    warnings.push({ code: 'unsafe-html-removed', message: '已移除不安全的 HTML；其余内容已保留。', blockIndex: Math.max(0, content.length - 1) })
  }
  return { version: 1, content, warnings }
}

function tableToMarkdown(node: EditorTableNode): string {
  const row = (cells: EditorTableCell[]) => `| ${cells.map((cell) => inlineToMarkdown(cell.content).replace(/\|/g, '\\|')).join(' | ')} |`
  const separators = node.header.map((_, index) => {
    const alignment = node.alignments[index]
    return alignment === 'center' ? ':---:' : alignment === 'right' ? '---:' : alignment === 'left' ? ':---' : '---'
  })
  return [row(node.header), `| ${separators.join(' | ')} |`, ...node.rows.map(row)].join('\n')
}

export function editorDocumentToMarkdown(document: EditorDocumentV1): string {
  if (document.version !== 1) throw new Error('不支持的编辑文档版本。')
  return document.content.map((node) => {
    if (node.type === 'paragraph') return inlineToMarkdown(node.content)
    if (node.type === 'blockMath') return `$$\n${node.latex}\n$$`
    if (node.type === 'choices') return node.options.map((option) => `${option.label}. ${inlineToMarkdown(option.content)}`).join('\n')
    if (node.type === 'table') return tableToMarkdown(node)
    return node.markdown
  }).join('\n\n')
}
