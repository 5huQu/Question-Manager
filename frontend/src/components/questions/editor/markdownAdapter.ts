import type { JSONContent } from '@tiptap/react'
import { normalizeLatexMathDelimiters } from '@/utils/mathMarkdown'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineToHtml(value: string): string {
  const output: string[] = []
  let cursor = 0
  const formula = /(?<!\\)\$([^\n$]+?)(?<!\\)\$/g
  for (const match of value.matchAll(formula)) {
    const index = match.index ?? 0
    output.push(escapeHtml(value.slice(cursor, index)))
    output.push(`<span data-formula="inline" data-latex="${escapeHtml(match[1])}"></span>`)
    cursor = index + match[0].length
  }
  output.push(escapeHtml(value.slice(cursor)))
  return output.join('')
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
}

export function markdownToEditorHtml(markdown: string): string {
  const lines = normalizeLatexMathDelimiters(markdown).replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  for (let index = 0; index < lines.length;) {
    if (lines[index].trim() === '$$') {
      const end = lines.indexOf('$$', index + 1)
      if (end > index) {
        const latex = lines.slice(index + 1, end).join('\n')
        blocks.push(`<div data-formula="block" data-latex="${escapeHtml(latex)}"></div>`)
        index = end + 1
        continue
      }
    }
    if (lines[index].trim().startsWith('$$') && lines[index].trim().endsWith('$$') && lines[index].trim().length > 4) {
      const latex = lines[index].trim().slice(2, -2)
      blocks.push(`<div data-formula="block" data-latex="${escapeHtml(latex)}"></div>`)
      index += 1
      continue
    }
    if (index + 1 < lines.length && lines[index].includes('|') && isTableSeparator(lines[index + 1])) {
      const header = tableCells(lines[index])
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      blocks.push(`<table><thead><tr>${header.map((cell) => `<th>${inlineToHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineToHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (!lines[index].trim()) {
      index += 1
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim()) {
      paragraph.push(inlineToHtml(lines[index]))
      index += 1
    }
    blocks.push(`<p>${paragraph.join('<br>')}</p>`)
  }
  return blocks.join('') || '<p></p>'
}

function inlineJson(node: JSONContent): string {
  if (node.type === 'text') {
    let text = node.text || ''
    for (const mark of node.marks || []) {
      if (mark.type === 'bold') text = `**${text}**`
      if (mark.type === 'italic') text = `*${text}*`
      if (mark.type === 'strike') text = `~~${text}~~`
      if (mark.type === 'code') text = `\`${text}\``
    }
    return text
  }
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'formulaInline') return `$${node.attrs?.latex || ''}$`
  return (node.content || []).map(inlineJson).join('')
}

function tableToMarkdown(node: JSONContent): string {
  const rows = (node.content || []).map((row) => (row.content || []).map((cell) => (cell.content || []).map(inlineJson).join('')))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ''))
  const header = normalized[0]
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`)].join('\n')
}

export function editorJsonToMarkdown(doc: JSONContent): string {
  const blocks = (doc.content || []).map((node) => {
    if (node.type === 'formulaBlock') return `$$\n${node.attrs?.latex || ''}\n$$`
    if (node.type === 'table') return tableToMarkdown(node)
    if (node.type === 'bulletList') return (node.content || []).map((item) => `- ${(item.content || []).map(inlineJson).join('')}`).join('\n')
    if (node.type === 'orderedList') return (node.content || []).map((item, index) => `${index + 1}. ${(item.content || []).map(inlineJson).join('')}`).join('\n')
    return inlineJson(node)
  })
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}
