import { memo, useMemo } from 'react'
import 'katex/dist/katex.min.css'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { normalizeLatexMathDelimiters } from '@/utils/mathMarkdown'
import { scanMathDelimiters } from '@/utils/mathDelimiterScanner'
import { blankNodeToHast, remarkFillBlank } from '@/utils/fillBlankMarkdown'
import { splitHtmlTableSegments, type HtmlTable } from '@/utils/htmlTables'
import { KATEX_STRICT } from '@/utils/katexPolicy'
import { rehypeApplyMathValidation, rehypeCollectMathValidation } from '@/utils/katexValidation'

export const MarkdownContent = memo(function MarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  const segments = useMemo(() => splitHtmlTableSegments(content), [content])
  return (
    <div className={`markdown-content min-w-0 max-w-none text-zinc-950 dark:text-zinc-50 ${className}`}>
      {segments.map((segment, index) => segment.type === 'html-table'
        ? <HtmlTablePreview key={`html-table-${index}`} table={segment.table} />
        : <MarkdownSegment key={`markdown-${index}`} content={segment.content} />)}
    </div>
  )
})

function MarkdownSegment({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm, remarkBreaks, remarkFillBlank]}
      remarkRehypeOptions={{ handlers: { blank: blankNodeToHast } as any }}
      rehypePlugins={[rehypeCollectMathValidation, [rehypeKatex, { strict: KATEX_STRICT }], rehypeApplyMathValidation]}
      urlTransform={markdownUrlTransform}
      components={markdownComponents}
    >
      {canonicalizeMathDelimitersForRemark(normalizeMarkdownForRender(content))}
    </ReactMarkdown>
  )
}

function HtmlTableCellContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm, remarkBreaks, remarkFillBlank]}
      remarkRehypeOptions={{ handlers: { blank: blankNodeToHast } as any }}
      rehypePlugins={[rehypeCollectMathValidation, [rehypeKatex, { strict: KATEX_STRICT }], rehypeApplyMathValidation]}
      urlTransform={markdownUrlTransform}
      components={{ ...markdownComponents, p: ({ children }) => <>{children}</> }}
    >
      {canonicalizeMathDelimitersForRemark(normalizeLatexMathDelimiters(stripDoc2xNoiseComments(content)))}
    </ReactMarkdown>
  )
}

function HtmlTablePreview({ table }: { table: HtmlTable }) {
  return (
    <div className="question-table-wrap">
      <table className="question-table">
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const Cell = cell.header ? 'th' : 'td'
                return <Cell key={cellIndex} colSpan={cell.colspan} rowSpan={cell.rowspan} style={cell.align ? { textAlign: cell.align } : undefined}><HtmlTableCellContent content={cell.content} /></Cell>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="pl-1">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 text-zinc-600">{children}</blockquote>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.92em]">{children}</code>,
  span: ({ className, children, node: rawNode, ...props }: { className?: string; children?: React.ReactNode; node?: unknown }) => {
    const properties = (rawNode as { properties?: Record<string, unknown> } | undefined)?.properties
    const invalid = String(properties?.['data-math-invalid'] || '') === 'true' || String(className || '').includes('katex-error')
    if (!invalid) return <span {...props} className={className}>{children}</span>
    const source = String(properties?.['data-math-source'] || '')
    return (
      <span {...props} aria-invalid="true" className="inline-flex items-baseline gap-1 rounded bg-amber-50 px-1 text-amber-900">
        <code>{source || children}</code>
        <span className="text-[10px] text-amber-700">公式格式有误</span>
      </span>
    )
  },
  ['blank' as any]: ({ node }: any) => {
    const count = Number((node?.properties as { dataBlank?: string } | undefined)?.dataBlank) || 3
    const width = `${Math.min(2 + count * 0.35, 8)}em`
    return <span aria-label="填空" className="mx-0.5 inline-block h-[1.15em] translate-y-[0.18em] border-b border-zinc-500 align-baseline dark:border-zinc-400" style={{ width }} />
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="my-2 overflow-auto rounded-lg border bg-zinc-50 p-3 text-xs leading-5">{children}</pre>,
  table: ({ children }: { children?: React.ReactNode }) => <div className="question-table-wrap"><table className="question-table">{children}</table></div>,
  th: ({ children }: { children?: React.ReactNode }) => <th>{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td>{children}</td>,
}

function markdownUrlTransform(value: string) {
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value
  return defaultUrlTransform(value)
}

export function plainTextLength(value: string) {
  return normalizeMarkdownForRender(value)
    .replace(/\$\$?([\s\S]*?)\$\$?/g, '$1')
    .replace(/[*_`~|\\{}]/g, '')
    .replace(/\s+/g, '')
    .length
}

export function normalizeMarkdownForRender(value: string) {
  return normalizeMarkdownTables(normalizeHtmlTables(normalizeLatexMathDelimiters(stripDoc2xNoiseComments(String(value || '')))))
}

/**
 * remark-math treats same-line `$$...$$` as inline math. Reformat only the
 * display tokens already identified by the shared scanner. Protected code and
 * ordinary Markdown are preserved, apart from escaping ambiguous unpaired
 * double-dollar runs below.
 */
export function canonicalizeMathDelimitersForRemark(value: string) {
  return scanMathDelimiters(value).map((segment) => {
    if (segment.type === 'code') return segment.value
    if (segment.type === 'text') return escapeUnparsedDoubleDollarRuns(segment.value)
    if (!segment.displayMode) return `$${segment.latex}$`
    return `\n\n$$\n${segment.latex}\n$$\n\n`
  }).join('')
}

/**
 * remark-math accepts an otherwise-unpaired double-dollar run as an empty
 * display token (notably an isolated `$$`). The shared scanner has already
 * established that these signs are ordinary text, so escape only unescaped
 * double-dollar runs in text segments before handing the source to remark.
 */
function escapeUnparsedDoubleDollarRuns(value: string) {
  let hasUnparsedDoubleDollar = false
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '$' || isEscapedDollar(value, index)) continue
    let end = index
    while (value[end] === '$') end += 1
    if (end - index >= 2) {
      hasUnparsedDoubleDollar = true
      break
    }
    index = end - 1
  }
  if (hasUnparsedDoubleDollar) return escapeAllUnescapedDollars(value)

  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '$') {
      output += value[index]
      continue
    }
    const runStart = index
    let runEnd = runStart
    while (value[runEnd] === '$') runEnd += 1
    const run = value.slice(runStart, runEnd)
    if (run.length < 2) {
      output += run
      index = runEnd - 1
      continue
    }
    for (let offset = 0; offset < run.length; offset += 1) {
      output += isEscapedDollar(value, runStart + offset) ? '$' : '\\$'
    }
    index = runEnd - 1
  }
  return output
}

function isEscapedDollar(value: string, index: number) {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function escapeAllUnescapedDollars(value: string) {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '$' && !isEscapedDollar(value, index)) output += '\\$'
    else output += value[index]
  }
  return output
}

export function stripDoc2xNoiseComments(value: string) {
  return String(value || '')
    .replace(/<!--\s*DOC2X_PAGE\s*:\s*\d+\s*-->/gi, '')
    .replace(/<!--\s*Media\s*-->/gi, '')
    .replace(/<!--\s*figureText\s*:[\s\S]*?-->/gi, '')
}

function normalizeHtmlTables(value: string) {
  return value.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (source, body: string) => {
    const rows = Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
      .map((row) => Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
        .map((cell) => cell[1]
          .replace(/<br\s*\/?>/gi, '<br>')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/\|/g, '\\|')
          .trim()))
      .filter((row) => row.length)
    if (!rows.length) return source
    const width = Math.max(...rows.map((row) => row.length))
    const markdownRow = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] || '').join(' | ')} |`
    return `\n\n${markdownRow(rows[0])}\n${normalizeTableSeparator(width)}\n${rows.slice(1).map(markdownRow).join('\n')}\n\n`
  })
}

function normalizeMarkdownTables(value: string) {
  const lines = value.split('\n')
  const output: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!isMarkdownTableRow(line)) {
      output.push(line)
      continue
    }
    const rows: string[] = []
    while (index < lines.length && isMarkdownTableRow(lines[index])) {
      rows.push(lines[index])
      index += 1
    }
    index -= 1
    if (rows.some(isMarkdownSeparatorRow)) {
      output.push(...rows)
      continue
    }
    const widths = rows.map((row) => splitTableRow(row).length)
    const width = Math.max(...widths)
    if (rows.length >= 2 && width >= 2) {
      output.push(normalizeTableRow(rows[0], width), normalizeTableSeparator(width), ...rows.slice(1).map((row) => normalizeTableRow(row, width)))
    } else {
      output.push(...rows)
    }
  }
  return output.join('\n')
}

function isMarkdownTableRow(line: string) {
  return /^\s*\|.*\|\s*$/.test(line) && splitTableRow(line).length >= 2
}

function isMarkdownSeparatorRow(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function normalizeTableRow(line: string, width: number) {
  const cells = splitTableRow(line)
  while (cells.length < width) cells.push('')
  return `| ${cells.slice(0, width).join(' | ')} |`
}

function normalizeTableSeparator(width: number) {
  return `| ${Array.from({ length: width }, () => '---').join(' | ')} |`
}
