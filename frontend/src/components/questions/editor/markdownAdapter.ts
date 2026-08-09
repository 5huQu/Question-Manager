import type { JSONContent } from '@tiptap/react'
import { normalizeLatexMathDelimiters } from '@/utils/mathMarkdown'
import { splitHtmlTableSegments, type HtmlTable, type HtmlTableAlignment } from '@/utils/htmlTables'

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
  const source = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\\' && source[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (source[index] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += source[index]
    }
  }
  cells.push(cell.trim())
  return cells
}

function markdownTableAlignment(value: string): HtmlTableAlignment {
  const normalized = value.trim()
  if (/^:?-{3,}:?$/.test(normalized)) {
    if (normalized.startsWith(':') && normalized.endsWith(':')) return 'center'
    if (normalized.startsWith(':')) return 'left'
    if (normalized.endsWith(':')) return 'right'
  }
  return null
}

function cellAlignAttribute(align: HtmlTableAlignment) {
  return align ? ` align="${align}"` : ''
}

function tableCellHtml(content: string) {
  return content.split('\n').map(inlineToHtml).join('<br>')
}

function htmlTableToEditorHtml(table: HtmlTable): string {
  const border = table.border ? ` data-question-table-border="${escapeHtml(table.border)}"` : ''
  return `<table data-question-table-format="html"${border}><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => {
    const tag = cell.header ? 'th' : 'td'
    const colspan = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''
    const rowspan = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''
    return `<${tag}${colspan}${rowspan}${cellAlignAttribute(cell.align)}>${tableCellHtml(cell.content)}</${tag}>`
  }).join('')}</tr>`).join('')}</tbody></table>`
}

function markdownSegmentToEditorHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
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
      const alignments = tableCells(lines[index + 1]).map(markdownTableAlignment)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      blocks.push(`<table><thead><tr>${header.map((cell, cellIndex) => `<th${cellAlignAttribute(alignments[cellIndex] || null)}>${tableCellHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, cellIndex) => `<td${cellAlignAttribute(alignments[cellIndex] || null)}>${tableCellHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
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

/** Converts the supported Markdown and HTML-table subset into Tiptap-safe HTML. */
export function markdownToEditorHtml(markdown: string): string {
  const normalized = normalizeLatexMathDelimiters(markdown)
  return splitHtmlTableSegments(normalized)
    .map((segment) => segment.type === 'html-table' ? htmlTableToEditorHtml(segment.table) : markdownSegmentToEditorHtml(segment.content))
    .join('') || '<p></p>'
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

function cellMarkdown(cell: JSONContent): string {
  return (cell.content || []).map((block) => {
    if (block.type === 'formulaBlock') return `$$\n${block.attrs?.latex || ''}\n$$`
    return (block.content || []).map(inlineJson).join('')
  }).join('\n')
}

function cellAlignment(cell: JSONContent): HtmlTableAlignment {
  const align = String(cell.attrs?.align || '').toLowerCase()
  return align === 'left' || align === 'center' || align === 'right' ? align : null
}

function hasMergedCells(node: JSONContent): boolean {
  return (node.content || []).some((row) => (row.content || []).some((cell) => Number(cell.attrs?.colspan || 1) > 1 || Number(cell.attrs?.rowspan || 1) > 1))
}

function escapeMarkdownTableCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function markdownAlignment(align: HtmlTableAlignment) {
  if (align === 'left') return ':---'
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  return '---'
}

function tableToMarkdown(node: JSONContent): string {
  const rows = (node.content || []).map((row) => (row.content || []).map((cell) => cellMarkdown(cell)))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ''))
  const header = normalized[0]
  const alignments = Array.from({ length: width }, (_, columnIndex) => {
    for (const row of node.content || []) {
      const align = cellAlignment((row.content || [])[columnIndex] || {})
      if (align) return align
    }
    return null
  })
  const markdownRow = (row: string[]) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`
  return [markdownRow(header), `| ${alignments.map(markdownAlignment).join(' | ')} |`, ...normalized.slice(1).map(markdownRow)].join('\n')
}

function tableToHtml(node: JSONContent): string {
  const border = String(node.attrs?.border || '').trim()
  const borderAttribute = border ? ` border="${escapeHtml(border)}"` : ''
  const rows = (node.content || []).map((row) => `<tr>${(row.content || []).map((cell) => {
    const tag = cell.type === 'tableHeader' ? 'th' : 'td'
    const colspan = Number(cell.attrs?.colspan || 1)
    const rowspan = Number(cell.attrs?.rowspan || 1)
    const spanAttributes = `${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`
    return `<${tag}${spanAttributes}${cellAlignAttribute(cellAlignment(cell))}>${escapeHtml(cellMarkdown(cell)).replace(/\n/g, '<br>')}</${tag}>`
  }).join('')}</tr>`).join('')
  return `<table${borderAttribute}>${rows}</table>`
}

export function editorJsonToMarkdown(doc: JSONContent): string {
  const blocks = (doc.content || []).map((node) => {
    if (node.type === 'formulaBlock') return `$$\n${node.attrs?.latex || ''}\n$$`
    if (node.type === 'table') return String(node.attrs?.sourceFormat || '') === 'html' || hasMergedCells(node) ? tableToHtml(node) : tableToMarkdown(node)
    if (node.type === 'bulletList') return (node.content || []).map((item) => `- ${(item.content || []).map(inlineJson).join('')}`).join('\n')
    if (node.type === 'orderedList') return (node.content || []).map((item, index) => `${index + 1}. ${(item.content || []).map(inlineJson).join('')}`).join('\n')
    return inlineJson(node)
  })
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}
