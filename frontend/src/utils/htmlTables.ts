export type HtmlTableAlignment = 'left' | 'center' | 'right' | null

export interface HtmlTableCell {
  content: string
  colspan: number
  rowspan: number
  align: HtmlTableAlignment
  header: boolean
}

export interface HtmlTable {
  border?: string
  rows: HtmlTableCell[][]
}

export type HtmlTableSegment =
  | { type: 'markdown'; content: string }
  | { type: 'html-table'; source: string; table: HtmlTable }

const HTML_TABLE_PATTERN = /<table\b[^>]*>[\s\S]*?<\/table\s*>/gi

function positiveInteger(value: string | null, fallback = 1) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback
}

function alignment(value: string | null | undefined): HtmlTableAlignment {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'left' || normalized === 'center' || normalized === 'right' ? normalized : null
}

function cellText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const element = node as HTMLElement
  if (element.tagName === 'BR') return '\n'
  return Array.from(element.childNodes).map(cellText).join('')
}

/**
 * Only extracts the table semantics we can safely render and edit. Cell markup
 * is intentionally reduced to text/line breaks; arbitrary HTML never reaches
 * the editor or preview DOM.
 */
export function parseHtmlTable(source: string): HtmlTable | null {
  if (typeof document === 'undefined') return null
  const template = document.createElement('template')
  template.innerHTML = source
  const table = template.content.querySelector('table')
  if (!table) return null

  const rows = Array.from(table.querySelectorAll('tr'))
    .filter((row) => row.closest('table') === table)
    .map((row) => Array.from(row.children)
      .filter((cell): cell is HTMLTableCellElement => cell.tagName === 'TD' || cell.tagName === 'TH')
      .map((cell) => ({
        content: Array.from(cell.childNodes).map(cellText).join('').replace(/\r\n?/g, '\n').trim(),
        colspan: positiveInteger(cell.getAttribute('colspan')),
        rowspan: positiveInteger(cell.getAttribute('rowspan')),
        align: alignment(cell.style.textAlign || cell.getAttribute('align')),
        header: cell.tagName === 'TH',
      })))
    .filter((row) => row.length)

  if (!rows.length) return null
  const border = table.getAttribute('border')?.trim()
  return { rows, ...(border ? { border } : {}) }
}

/** Splits Markdown around complete HTML tables, retaining their original order. */
export function splitHtmlTableSegments(value: string): HtmlTableSegment[] {
  const source = String(value || '')
  const segments: HtmlTableSegment[] = []
  let cursor = 0
  for (const match of source.matchAll(HTML_TABLE_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ type: 'markdown', content: source.slice(cursor, index) })
    const tableSource = match[0]
    const table = parseHtmlTable(tableSource)
    if (table) segments.push({ type: 'html-table', source: tableSource, table })
    else segments.push({ type: 'markdown', content: tableSource })
    cursor = index + tableSource.length
  }
  if (cursor < source.length || !segments.length) segments.push({ type: 'markdown', content: source.slice(cursor) })
  return segments
}

/** Removes only tables that parsed successfully, leaving malformed HTML protected as raw source. */
export function withoutHtmlTableSegments(value: string): string {
  return splitHtmlTableSegments(value)
    .filter((segment): segment is Extract<HtmlTableSegment, { type: 'markdown' }> => segment.type === 'markdown')
    .map((segment) => segment.content)
    .join('')
}
