import { memo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

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
  // Arrays must be lifted to protected display-math blocks before the generic
  // inline-math repair runs; otherwise it can insert `$` inside array rows.
  return normalizeRawLatexOutsideMath(normalizeMarkdownTables(normalizeNestedInlineMath(normalizeLatexArrays(normalizeMathDelimiters(normalizeHtmlTables(stripDoc2xNoiseComments(String(value || ''))))))))
}

export function stripDoc2xNoiseComments(value: string) {
  return stripExamCarryoverNoise(String(value || '')
    .replace(/<!--\s*DOC2X_PAGE\s*:\s*\d+\s*-->/gi, '')
    .replace(/<!--\s*figureText\s*:[\s\S]*?-->/gi, ''))
}

function stripExamCarryoverNoise(value: string) {
  return String(value || '')
    .replace(/(?:^|\n)\s*(?:#{1,6}\s*)?[一二三四五六七八九十]+[、.．]\s*[^\n]{0,80}本大题[\s\S]*$/u, '')
    .replace(/(?:^|\n)\s*<table\b(?=[\s\S]*?<td>\s*题号\s*<\/td>)(?=[\s\S]*?<td>\s*答案\s*<\/td>)[\s\S]*?<\/table>/gi, '')
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

function normalizeAdjacentLogicMath(value: string) {
  return value.replace(/\$(\\(?:because|therefore))\s*\$\s*(\\(?:because|therefore))\b/g, (_, left: string, right: string) => {
    return `$${left} ${right}$`
  })
}

function normalizeMathDelimiters(value: string) {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
  return normalizeDisplayMathBlocks(normalized)
    .replace(/\$\$\s*\\begin\{cases\}([\s\S]*?)\\end\{cases\}\s*\$\$/g, (_, body) => `$$\n\\begin{cases}${body}\\end{cases}\n$$`)
    .replace(/\n\$\$[\t ]+([，。；：,.])/g, (_, mark) => `\n$$\n${mark}`)
    .replace(/\n\$\$([，。；：,.])([^\n])/g, (_, mark, next) => `\n$$\n${mark}\n\n${next}`)
}

function normalizeDisplayMathBlocks(value: string) {
  let output = ''
  let cursor = 0
  while (cursor < value.length) {
    const start = findNextDisplayDelimiter(value, cursor)
    if (start < 0) {
      output += value.slice(cursor)
      break
    }
    const end = findNextDisplayDelimiter(value, start + 2)
    if (end < 0) {
      output += value.slice(cursor)
      break
    }
    const body = value.slice(start + 2, end).trim()
    output += value.slice(cursor, start)
    output += body ? `\n\n$$\n${body}\n$$\n\n` : value.slice(start, end + 2)
    cursor = end + 2
  }
  return output.replace(/\n{4,}/g, '\n\n\n')
}

function findNextDisplayDelimiter(value: string, from: number) {
  let index = value.indexOf('$$', from)
  while (index >= 0 && value[index - 1] === '\\') {
    index = value.indexOf('$$', index + 2)
  }
  return index
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

function normalizeNestedInlineMath(value: string) {
  let next = normalizeAdjacentLogicMath(value)
  for (let index = 0; index < 4; index += 1) {
    const previous = next
    next = next.replace(
      /\$([^$\n]*\\(?:cup|cap|to|rightarrow|leftarrow|leftrightarrow|Rightarrow|Leftarrow|cdot|times|leq|geq|neq|in|notin|subset|supset|subseteq|supseteq)\s*)\$([A-Za-z0-9_{}\\^]+)\$/g,
      (_, left: string, right: string) => `$${left}${right}$`,
    )
    if (next === previous) break
  }
  return next
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

function normalizeLatexArrays(value: string) {
  const protectedMultilineArrays = value.replace(/\$([^$]*\\begin\{array\}\{[^{}]*\}[\s\S]*?\\end\{array\}[^$]*)\$/g, (_, body: string) => repairArrayMathBody(body))
  const normalizedBrokenInlineArrays = protectedMultilineArrays.replace(/\$\\begin\{array\}\{([^{}]*)\}\$([\s\S]*?)\$\\end\{array\}\$/g, (_, columns: string, body: string) => {
    const rows = normalizeLatexArrayBody(body)
    return `\n\n$$\n\\begin{array}{${columns}}\n${rows}\n\\end{array}\n$$\n\n`
  })
  const normalizedArrays = normalizedBrokenInlineArrays.replace(/\\begin\{array\}\{([^{}]*)\}([\s\S]*?)\\end\{array\}/g, (match, columns: string, body: string, offset: number) => {
    const previous = normalizedBrokenInlineArrays[offset - 1]
    const next = normalizedBrokenInlineArrays[offset + match.length]
    if (previous === '$' || next === '$') return match
    const rows = normalizeLatexArrayBody(body)
    const array = `\\begin{array}{${columns}}\n${rows}\n\\end{array}`
    return isInsideMathAt(normalizedBrokenInlineArrays, offset) ? array : `\n\n$$\n${array}\n$$\n\n`
  })
  return normalizeArrayMathSegments(normalizedArrays)
}

function normalizeArrayMathSegments(value: string) {
  return splitMathSegments(value).map((part) => {
    if (!part.math || !part.text.includes('\\begin{array}')) return part.text
    const display = part.text.startsWith('$$')
    const body = part.text.slice(display ? 2 : 1, display ? -2 : -1)
    return repairArrayMathBody(body)
  }).join('')
}

function repairArrayMathBody(value: string) {
  const body = value
    .replace(/\\left\{/g, '\\left\\{')
    .replace(/\\right\}/g, '\\right\\}')
    .trim()
    try {
      katex.renderToString(body, { displayMode: true, throwOnError: true, strict: 'ignore' })
      return `\n\n$$\n${body}\n$$\n\n`
    } catch {
      const arrays = Array.from(body.matchAll(/\\begin\{array\}\{([^{}]*)\}([\s\S]*?)\\end\{array\}/g))
        .map((match) => `\\begin{array}{${match[1]}}\n${normalizeLatexArrayBody(match[2])}\n\\end{array}`)
      return arrays.length ? `\n\n${arrays.map((array) => `$$\n${array}\n$$`).join('\n\n')}\n\n` : value
    }
}

function normalizeLatexArrayBody(body: string) {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => normalizeLatexArrayLine(line))
    .filter(Boolean)
    .join('\n')
}

function normalizeLatexArrayLine(line: string) {
  const trimmed = line.trim().replace(/\$([^$\n]+)\$/g, '$1')
  if (!trimmed) return ''
  if (/^\\hline\b/.test(trimmed)) return '\\hline'
  if (/\\\\\s*$/.test(trimmed)) return trimmed
  if (/\\\s*$/.test(trimmed)) return trimmed.replace(/\\\s*$/, '\\\\')
  return trimmed
}

function isInsideMathAt(value: string, offset: number) {
  let inlineOpen = false
  let displayOpen = false
  for (let index = 0; index < offset; index += 1) {
    if (value[index] !== '$' || value[index - 1] === '\\') continue
    if (value[index + 1] === '$') {
      displayOpen = !displayOpen
      index += 1
    } else if (!displayOpen) {
      inlineOpen = !inlineOpen
    }
  }
  return inlineOpen || displayOpen
}

function normalizeRawLatexOutsideMath(value: string) {
  const parts = splitMathSegments(value)
  return parts.map((part) => {
    if (part.math) return part.text
    return part.text
      .split('\n')
      .map((line) => wrapRawLatexLine(line))
      .join('\n')
  }).join('')
}

function splitMathSegments(value: string) {
  const pattern = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g
  const parts: Array<{ text: string; math: boolean }> = []
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > cursor) parts.push({ text: value.slice(cursor, match.index), math: false })
    parts.push({ text: match[0], math: true })
    cursor = match.index + match[0].length
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), math: false })
  return parts
}

function wrapRawLatexLine(line: string) {
  if (!hasRawLatex(line) || isMarkdownTableRow(line)) return line
  let next = line
  next = replaceRawLatexOutsideMath(next, /(^|[^\w\\$])(\\(?:because|therefore))(?=$|[^\w])/g)
  next = replaceRawLatexOutsideMath(next, /(^|[^\w\\$])([([{（][-+A-Za-z0-9_{}\\^*/=<>,.\s]+[)\]}）])(?=$|[^\w\\])/g)
  next = replaceRawLatexOutsideMath(next, /(^|[^\w\\$])([A-Za-z][A-Za-z0-9_{}\\^]*(?:\([^，。；：,.;\n（）]*\))?(?:\s*(?:=|<|>|\\leq|\\geq|\\neq)\s*[-+A-Za-z0-9_{}\\^*/().]+)+)/g)
  next = replaceRawLatexOutsideMath(next, /(^|[^\w\\$])(\d+(?:\.\d+)?(?:\s*(?:\\times|\\cdot|[+\-*/])\s*(?:\\[a-zA-Z]+(?:\{[^{}]*\})+|[A-Za-z0-9]+(?:\.\d+)?|\{[^{}]*\}))*\s*(?:=|<|>|\\leq|\\geq|\\neq)\s*[-+A-Za-z0-9_{}\\^*/().]+(?:\s*(?:=|<|>|\\leq|\\geq|\\neq)\s*[-+A-Za-z0-9_{}\\^*/().]+)*)/g)
  next = replaceRawLatexOutsideMath(next, /(^|[^\w\\$])((?:\\[a-zA-Z]+(?:\{[^{}]*\})*|[A-Za-z](?:\([^，。；：,.;\n（）]*\))?)(?:\s*(?:=|<|>|\\leq|\\geq|\\neq)\s*[-+A-Za-z0-9_{}\\^*/().]+)+)/g)
  return next
}

function replaceRawLatexOutsideMath(value: string, pattern: RegExp) {
  return splitMathSegments(value).map((part) => {
    if (part.math) return part.text
    return part.text.replace(pattern, wrapRawLatexMatch)
  }).join('')
}

function wrapRawLatexMatch(match: string, prefix: string, body: string) {
  const text = body.trim()
  if (!isSafeAutoMath(text)) return match
  return `${prefix}$${text}$`
}

function isSafeAutoMath(text: string) {
  if (!text || /^\$.*\$$/.test(text) || /_{2,}/.test(text) || !hasBalancedBraces(text)) return false
  if (/[\u4e00-\u9fff]/.test(text)) return false
  if (/\\frac/.test(text) && !/^([([{（]|\d|[A-Za-z][A-Za-z0-9_{}^]*(?:\([^)]*\))?\s*(?:[+\-*/=<>]|\\leq?|\\geq?)|\\(?:overline|hat|bar)\b)/.test(text)) return false
  return hasRawLatex(text) || /[A-Za-z]\([^)]*\)\s*(?:=|<|>|\\leq|\\geq|\\neq)/.test(text) || /[A-Za-z][A-Za-z0-9_{}\\^]*\s*(?:=|<|>|\\leq|\\geq|\\neq)/.test(text)
}

function hasRawLatex(value: string) {
  return /\\[a-zA-Z]+|[_^]\s*\{?[\w\\]+|\\frac|\\sqrt|\\sum|\\int|\\lim|\\cdot|\\times|\\leq|\\geq|\\infty|\\begin/.test(value)
}

function hasBalancedBraces(value: string) {
  let depth = 0
  for (const char of value) {
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth < 0) return false
  }
  return depth === 0
}
