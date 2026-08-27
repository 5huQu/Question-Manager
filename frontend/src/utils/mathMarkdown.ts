function isEscaped(value: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function normalizeLine(value: string) {
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
    if (!codeTicks && value[index] === '\\' && !isEscaped(value, index)) {
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

/**
 * Heuristic repair for delimiter patterns occasionally produced by OCR, such
 * as `$设 $$ p_n = 1 $ $`. This deliberately guesses at ambiguous dollar-sign
 * sequences, so it must only run at an explicit OCR-input boundary and never
 * as part of render-time Markdown normalization.
 */
function repairOcrInlineMathDelimitersInText(value: string) {
  const inline = (latex: string) => `$${latex.trim()}$`
  return value
    // `$说明 $$ 公式 $ $` → `说明 $公式$`
    .replace(/(?<!\\)\$([^$\n]*?\S[^$\n]*?)(?<!\\)\$\$\s*([^$\n]+?)\s*(?<!\\)\$\s+(?<!\\)\$/g, (_match, prefix: string, latex: string) => `${prefix.trimEnd()} ${inline(latex)}`)
    // `$$ 公式 $ $` → `$公式$`
    .replace(/(?<!\\)\$\$\s*([^$\n]+?)\s*(?<!\\)\$\s+(?<!\\)\$/g, (_match, latex: string) => inline(latex))
    // `$$ 公式 $` → `$公式$`, but retain valid `$$公式$$` display math.
    .replace(/(?<!\\)\$\$\s*([^$\n]+?)\s*(?<!\\)\$(?!\$)/g, (_match, latex: string) => inline(latex))
}

function repairOcrInlineMathDelimiters(value: string) {
  let output = ''
  let cursor = 0
  let codeTicks = 0
  for (let index = 0; index < value.length;) {
    if (value[index] !== '`') {
      index += 1
      continue
    }
    let end = index + 1
    while (value[end] === '`') end += 1
    const count = end - index
    if (!codeTicks) {
      output += repairOcrInlineMathDelimitersInText(value.slice(cursor, index))
      output += value.slice(index, end)
      cursor = end
      codeTicks = count
    } else if (codeTicks === count) {
      output += value.slice(cursor, end)
      cursor = end
      codeTicks = 0
    }
    index = end
  }
  return output + (codeTicks ? value.slice(cursor) : repairOcrInlineMathDelimitersInText(value.slice(cursor)))
}

function inlineCodeEnd(value: string, index: number) {
  let delimiterEnd = index + 1
  while (value[delimiterEnd] === '`') delimiterEnd += 1
  const delimiter = value.slice(index, delimiterEnd)
  const closing = value.indexOf(delimiter, delimiterEnd)
  return closing < 0 ? value.length : closing + delimiter.length
}

type CodeFence = {
  marker: string
  length: number
  lineEnd: number
}

function codeFenceAt(value: string, index: number): CodeFence | null {
  if (index > 0 && value[index - 1] !== '\n') return null
  const lineEnd = value.indexOf('\n', index)
  const end = lineEnd < 0 ? value.length : lineEnd
  const match = value.slice(index, end).match(/^\s{0,3}(`{3,}|~{3,})/)
  if (!match) return null
  return { marker: match[1][0], length: match[1].length, lineEnd: end }
}

function codeFenceEnd(value: string, opening: CodeFence) {
  let index = opening.lineEnd < value.length ? opening.lineEnd + 1 : value.length
  while (index < value.length) {
    const fence = codeFenceAt(value, index)
    if (fence && fence.marker === opening.marker && fence.length >= opening.length) {
      return fence.lineEnd < value.length ? fence.lineEnd + 1 : fence.lineEnd
    }
    const lineEnd = value.indexOf('\n', index)
    index = lineEnd < 0 ? value.length : lineEnd + 1
  }
  return value.length
}

function completeDisplayMathEnd(value: string, index: number) {
  const openingLineEnd = value.indexOf('\n', index)
  const sameLineEnd = openingLineEnd < 0 ? value.length : openingLineEnd
  for (let cursor = index + 2; cursor < sameLineEnd - 1; cursor += 1) {
    if (value[cursor] === '`') {
      cursor = inlineCodeEnd(value, cursor) - 1
      continue
    }
    if (value[cursor] === '$' && value[cursor + 1] === '$' && !isEscaped(value, cursor)) {
      return cursor + 2
    }
  }

  // A display block may span lines only when its opening delimiter is alone on
  // the line. Otherwise an incomplete OCR `$$...$` must not consume a later,
  // unrelated display block as its closing delimiter.
  if (value.slice(index + 2, sameLineEnd).trim()) return -1
  for (let lineStart = openingLineEnd < 0 ? value.length : openingLineEnd + 1; lineStart < value.length;) {
    const fence = codeFenceAt(value, lineStart)
    if (fence) return -1
    const lineEnd = value.indexOf('\n', lineStart)
    const end = lineEnd < 0 ? value.length : lineEnd
    const closing = /^\s*(\$\$)\s*$/.exec(value.slice(lineStart, end))
    if (closing && !isEscaped(value, lineStart + closing[0].indexOf('$$'))) {
      return lineStart + closing[0].indexOf('$$') + 2
    }
    lineStart = lineEnd < 0 ? value.length : lineEnd + 1
  }
  return -1
}

/**
 * Preserve fully closed display math before applying the legacy OCR regexes.
 * The regexes deliberately repair incomplete `$$...$` patterns, but must not
 * restart from the second dollar of a valid closing `$$` delimiter.
 */
function repairOcrMathOutsideCompleteDisplayMath(value: string) {
  let output = ''
  let segmentStart = 0
  for (let index = 0; index < value.length;) {
    const fence = codeFenceAt(value, index)
    if (fence) {
      output += repairOcrInlineMathDelimiters(value.slice(segmentStart, index))
      const end = codeFenceEnd(value, fence)
      output += value.slice(index, end)
      segmentStart = end
      index = end
      continue
    }
    if (value[index] === '`') {
      index = inlineCodeEnd(value, index)
      continue
    }
    if (value[index] === '$' && value[index + 1] === '$' && !isEscaped(value, index)) {
      const end = completeDisplayMathEnd(value, index)
      if (end >= 0) {
        output += repairOcrInlineMathDelimiters(value.slice(segmentStart, index))
        output += value.slice(index, end)
        segmentStart = end
        index = end
        continue
      }
    }
    index += 1
  }
  return output + repairOcrInlineMathDelimiters(value.slice(segmentStart))
}

function mapOutsideFencedCode(value: string, transformLine: (line: string) => string) {
  const lines = String(value || '').split('\n')
  let fence: { marker: string; length: number } | null = null
  return lines.map((line) => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (match) {
      const marker = match[1][0]
      const length = match[1].length
      if (!fence) fence = { marker, length }
      else if (fence.marker === marker && length >= fence.length) fence = null
      return line
    }
    return fence ? line : transformLine(line)
  }).join('\n')
}

/**
 * Convert standard LaTeX math delimiters into the Markdown form used
 * internally. This only performs deterministic delimiter conversion and never
 * guesses whether a dollar-sign sequence came from OCR.
 */
export function normalizeLatexMathDelimiters(value: string) {
  return mapOutsideFencedCode(value, normalizeLine)
}

/**
 * Explicit OCR-input repair for ambiguous math delimiters. Keep this separate
 * from render-time normalization because the repair may reinterpret `$` pairs.
 */
export function repairOcrMathMarkdown(value: string) {
  return repairOcrMathOutsideCompleteDisplayMath(String(value || ''))
}
