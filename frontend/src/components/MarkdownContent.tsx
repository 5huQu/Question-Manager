import { memo } from 'react'
import 'katex/dist/katex.min.css'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { normalizeLatexMathDelimiters } from '@/utils/mathMarkdown'

export const MarkdownContent = memo(function MarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  return (
    <div className={`markdown-content min-w-0 max-w-none text-zinc-950 dark:text-zinc-50 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        urlTransform={markdownUrlTransform}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 text-zinc-600">{children}</blockquote>,
          code: ({ children }) => <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.92em]">{children}</code>,
          span: ({ className, children, node: _node, ...props }) => String(className || '').includes('katex-error')
            ? <span {...props} className="inline-flex items-baseline gap-1 rounded bg-amber-50 px-1 text-amber-900"><code>{children}</code><span className="text-[10px] text-amber-700">公式未规范化</span></span>
            : <span {...props} className={className}>{children}</span>,
          pre: ({ children }) => <pre className="my-2 overflow-auto rounded-lg border bg-zinc-50 p-3 text-xs leading-5">{children}</pre>,
          table: ({ children }) => <div className="question-table-wrap"><table className="question-table">{children}</table></div>,
          th: ({ children }) => <th>{children}</th>,
          td: ({ children }) => <td>{children}</td>,
        }}
      >
        {normalizeMarkdownForRender(content)}
      </ReactMarkdown>
    </div>
  )
})

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
