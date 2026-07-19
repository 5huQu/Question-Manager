import katex from 'katex'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'

function normalizeMarkdownForRender(value) {
  return normalizeMarkdownTables(normalizeLatexMathDelimiters(String(value || '')))
}

function isEscapedDelimiter(value, index) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function normalizeMathDelimiterLine(value) {
  let output = ''
  let codeTicks = 0
  for (let index = 0; index < value.length;) {
    if (value[index] === '`') {
      let end = index + 1
      while (value[end] === '`') end += 1
      const count = end - index
      if (!codeTicks) codeTicks = count
      else if (codeTicks === count) codeTicks = 0
      output += value.slice(index, end)
      index = end
      continue
    }
    if (!codeTicks && value[index] === '\\' && !isEscapedDelimiter(value, index)) {
      const delimiter = value[index + 1]
      if (delimiter === '(' || delimiter === ')') {
        output += '$'
        index += 2
        continue
      }
      if (delimiter === '[' || delimiter === ']') {
        output += '$$'
        index += 2
        continue
      }
    }
    output += value[index]
    index += 1
  }
  return output
}

function normalizeLatexMathDelimiters(value) {
  const lines = String(value || '').split('\n')
  let fence = null
  return lines.map((line) => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (match) {
      const marker = match[1][0]
      const length = match[1].length
      if (!fence) fence = { marker, length }
      else if (fence.marker === marker && length >= fence.length) fence = null
      return line
    }
    return fence ? line : normalizeMathDelimiterLine(line)
  }).join('\n')
}

function normalizeMarkdownTables(value) {
  const lines = value.split('\n')
  const output = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!isMarkdownTableRow(line)) {
      output.push(line)
      continue
    }
    const rows = []
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

function isMarkdownTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line) && splitTableRow(line).length >= 2
}

function isMarkdownSeparatorRow(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function normalizeTableRow(line, width) {
  const cells = splitTableRow(line)
  while (cells.length < width) cells.push('')
  return `| ${cells.slice(0, width).join(' | ')} |`
}

function normalizeTableSeparator(width) {
  return `| ${Array.from({ length: width }, () => '---').join(' | ')} |`
}

function isEscaped(value, index) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function delimiterAt(value, index) {
  if (value[index] !== '$' || isEscaped(value, index)) return null
  if (value[index + 1] === '$') return { mode: 'display', length: 2 }
  return { mode: 'inline', length: 1 }
}

function findNextMathDelimiter(value, start) {
  for (let index = start; index < value.length; index += 1) {
    const delimiter = delimiterAt(value, index)
    if (delimiter) return { ...delimiter, start: index }
  }
  return null
}

function findClosingMathDelimiter(value, start, mode) {
  for (let index = start; index < value.length; index += 1) {
    const delimiter = delimiterAt(value, index)
    if (!delimiter) continue
    if (mode === 'display' && delimiter.mode === 'display') return index
    if (mode === 'inline' && delimiter.mode === 'inline') return index
    if (mode === 'inline' && delimiter.mode === 'display') {
      index += 1
    }
  }
  return -1
}

function extractMathSpans(text) {
  const value = String(text || '')
  const spans = []
  let index = 0
  while (index < value.length) {
    const delimiter = findNextMathDelimiter(value, index)
    if (!delimiter) break
    const mathStart = delimiter.start + delimiter.length
    const close = findClosingMathDelimiter(value, mathStart, delimiter.mode)
    if (close < 0) {
      spans.push({
        mode: delimiter.mode,
        math: value.slice(mathStart),
        start: delimiter.start,
        end: value.length,
        mathStart,
        mathEnd: value.length,
        unclosed: true,
      })
      break
    }
    spans.push({
      mode: delimiter.mode,
      math: value.slice(mathStart, close),
      start: delimiter.start,
      end: close + delimiter.length,
      mathStart,
      mathEnd: close,
      unclosed: false,
    })
    index = close + delimiter.length
  }
  return spans
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function paragraphBounds(value, start, end) {
  const safeStart = Math.max(0, Math.min(value.length, start))
  const safeEnd = Math.max(safeStart, Math.min(value.length, end))
  const before = value.lastIndexOf('\n\n', safeStart)
  const after = value.indexOf('\n\n', safeEnd)
  return {
    from: before < 0 ? 0 : before + 2,
    to: after < 0 ? value.length : after,
  }
}

function mathStateAt(value, offset) {
  const spans = extractMathSpans(value)
  return spans.find((span) => span.start < offset && offset < span.end) || null
}

function truncateContextSafely(value, start, end, maxLength) {
  const full = compactText(value)
  if (full.length <= maxLength) return full

  let from = Math.max(0, start - 180)
  let to = Math.min(value.length, Math.max(end + 260, start + maxLength))
  const startSpan = mathStateAt(value, from)
  if (startSpan) from = startSpan.start
  const endSpan = mathStateAt(value, to)
  if (endSpan) {
    if (endSpan.end - from <= maxLength + 160) to = endSpan.end
    else to = endSpan.start
  }

  let snippet = compactText(value.slice(from, to))
  if (snippet.length > maxLength) {
    const hardCut = Math.max(0, maxLength - 1)
    const cutSpan = mathStateAt(snippet, hardCut)
    if (cutSpan && cutSpan.start > 0) snippet = snippet.slice(0, cutSpan.start).trim()
    else snippet = snippet.slice(0, hardCut).trim()
  }
  return `${from > 0 ? '…' : ''}${snippet}${to < value.length ? '…' : ''}`
}

function makeSnippet(text, start = 0, end = start, maxLength = 560) {
  const value = String(text || '')
  if (!value) return ''
  const bounds = paragraphBounds(value, start, end)
  const paragraph = value.slice(bounds.from, bounds.to)
  const compactParagraph = compactText(paragraph)
  if (compactParagraph.length <= maxLength) return compactParagraph
  return truncateContextSafely(value, start, end, maxLength)
}

function errorPayload(field, text, error) {
  const start = Math.max(0, Number(error.start) || 0)
  const end = Math.max(start, Number(error.end) || start)
  const context = makeSnippet(text, start, end)
  return {
    field,
    mode: error.mode || 'markdown',
    start,
    end,
    code: error.code || 'format_error',
    message: error.message || '',
    snippet: context,
    context,
  }
}

function validateField(field, text) {
  const value = String(text || '')
  const errors = []
  for (const span of extractMathSpans(value)) {
    if (span.unclosed) {
      errors.push(errorPayload(field, value, {
        mode: span.mode,
        start: span.start,
        end: span.end,
        code: 'math_delimiter_unclosed',
        message: `${span.mode} math delimiter is unclosed`,
      }))
      continue
    }
    try {
      katex.renderToString(span.math, {
        displayMode: span.mode === 'display',
        throwOnError: true,
        strict: 'ignore',
      })
    } catch (error) {
      const position = typeof error?.position === 'number' ? span.mathStart + error.position : span.start
      errors.push(errorPayload(field, value, {
        mode: span.mode,
        start: position,
        end: Math.min(value.length, Math.max(position + 1, span.end)),
        code: 'katex_parse_error',
        message: error instanceof Error ? error.message : String(error),
      }))
    }
  }
  return errors
}

function collectKatexErrors(node, field, fullText, errors) {
  if (!node || typeof node !== 'object') return
  const properties = node.properties || {}
  const className = Array.isArray(properties.className) ? properties.className.join(' ') : String(properties.className || '')
  if (className.includes('katex-error')) {
    const text = collectText(node)
    const start = node.position?.start?.offset ?? 0
    errors.push(errorPayload(field, fullText || text, {
      mode: 'markdown',
      start,
      end: Math.max(start + text.length, node.position?.end?.offset ?? start),
      code: 'frontend_katex_error',
      message: String(properties.title || 'frontend KaTeX render error'),
    }))
  }
  for (const child of node.children || []) collectKatexErrors(child, field, fullText, errors)
}

function collectRawMarkdownText(node, field, fullText, errors) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'text') {
    const value = String(node.value || '')
    const rawLatexPattern = /\\(?:frac|dfrac|sqrt|begin|end|triangle|perp|parallel|neq|geq|leq|cdot|times|binom|sum|int|lim|infty|mathbb|vec|overrightarrow|cup|cap|le|ge|because|therefore)\b/g
    const match = rawLatexPattern.exec(value)
    if (match) {
      const start = (node.position?.start?.offset ?? 0) + match.index
      errors.push(errorPayload(field, fullText, {
        mode: 'markdown',
        start,
        end: start + match[0].length,
        code: 'raw_latex_outside_math',
        message: 'Raw LaTeX-like content appears outside math delimiters',
      }))
    }
  }
  if (node.type === 'inlineMath' || node.type === 'math') return
  for (const child of node.children || []) collectRawMarkdownText(child, field, fullText, errors)
}

function collectText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return String(node.value || '')
  return (node.children || []).map(collectText).join('')
}

function validateFrontendMarkdown(field, text, options = {}) {
  const value = String(text || '')
  const renderKatex = options.renderKatex !== false
  const errors = []
  try {
    const processor = unified()
      .use(remarkParse)
      .use(remarkMath)
      .use(remarkRehype)
      .use(rehypeKatex, { throwOnError: false })
    const markdownTree = processor.parse(value)
    collectRawMarkdownText(markdownTree, field, value, errors)
    if (!renderKatex) return errors
    const tree = processor.runSync(markdownTree)
    collectKatexErrors(tree, field, value, errors)
  } catch (error) {
    errors.push(errorPayload(field, value, {
      mode: 'markdown',
      start: error?.position?.start?.offset ?? 0,
      end: error?.position?.end?.offset ?? 0,
      code: 'frontend_markdown_render_failed',
      message: error instanceof Error ? error.message : String(error),
    }))
  }
  return errors
}

function validateQuestionPayload(payload) {
  const errors = []
  for (const field of ['problem_text', 'answer', 'analysis']) {
    const rawText = String(payload[field] || '')
    const normalizedText = normalizeLatexMathDelimiters(rawText)
    const delimiterErrors = validateField(field, normalizedText)
      .filter((error) => error.code === 'math_delimiter_unclosed')
    if (delimiterErrors.length) {
      errors.push(...delimiterErrors)
      continue
    }
    const text = normalizeMarkdownForRender(normalizedText)
    const fieldErrors = validateField(field, text)
    errors.push(...fieldErrors)
    errors.push(...validateFrontendMarkdown(field, text, { renderKatex: fieldErrors.length === 0 }))
  }
  return dedupeErrors(errors)
}

function dedupeErrors(errors) {
  const seen = new Set()
  const output = []
  const codeRank = {
    math_delimiter_unclosed: 0,
    katex_parse_error: 1,
    raw_latex_outside_math: 2,
    frontend_katex_error: 3,
    frontend_markdown_render_failed: 4,
  }
  const sorted = [...errors].sort((a, b) => {
    const startDiff = (Number(a.start) || 0) - (Number(b.start) || 0)
    if (startDiff) return startDiff
    return (codeRank[a.code] ?? 9) - (codeRank[b.code] ?? 9)
  })
  for (const error of sorted) {
    const key = [error.field, error.code, error.start, error.message].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    output.push(error)
    if (output.length >= 12) break
  }
  return output
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}')
  if (Array.isArray(payload.items)) {
    const items = payload.items.map((item) => {
      const errors = validateQuestionPayload(item)
      return { id: String(item.id || ''), ok: errors.length === 0, errors }
    })
    process.stdout.write(JSON.stringify({ ok: items.every((item) => item.ok), items }))
    return
  }
  const errors = validateQuestionPayload(payload)
  process.stdout.write(JSON.stringify({ ok: errors.length === 0, errors }))
})
