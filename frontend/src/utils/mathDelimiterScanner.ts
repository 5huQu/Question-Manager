/**
 * Canonical frontend math delimiter semantics:
 *
 * - `$...$` is inline math.
 * - `$$...$$` is display math, regardless of line placement.
 * - fenced and inline code are protected before either delimiter is considered.
 *
 * This deliberately recognizes only the lexical boundary needed by renderers;
 * it is not a Markdown parser and never repairs malformed input.
 */

export type MathDelimiterSegment =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string; fenced: boolean }
  | { type: 'math'; latex: string; displayMode: boolean }

type CodeRange = {
  start: number
  end: number
  fenced: boolean
}

type CodeFence = {
  marker: string
  length: number
  lineEnd: number
}

const BACKTICK = String.fromCharCode(96)

function isEscaped(value: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function backtickRunLength(value: string, start: number) {
  let end = start
  while (value[end] === BACKTICK) end += 1
  return end - start
}

function findInlineCodeClose(value: string, start: number, delimiterLength: number) {
  for (let cursor = start; cursor < value.length;) {
    if (value[cursor] !== BACKTICK) {
      cursor += 1
      continue
    }
    const runLength = backtickRunLength(value, cursor)
    if (runLength === delimiterLength) return cursor
    cursor += runLength
  }
  return -1
}

function codeFenceAt(value: string, index: number): CodeFence | null {
  if (index > 0 && value[index - 1] !== '\n') return null
  const lineEnd = value.indexOf('\n', index)
  const end = lineEnd < 0 ? value.length : lineEnd
  const match = value.slice(index, end).match(/^\s{0,3}(`{3,}|~{3,})/)
  if (!match) return null
  return { marker: match[1][0], length: match[1].length, lineEnd: end }
}

function findCodeFenceClose(value: string, opening: CodeFence) {
  let lineStart = opening.lineEnd < value.length ? opening.lineEnd + 1 : value.length
  while (lineStart < value.length) {
    const lineEnd = value.indexOf('\n', lineStart)
    const end = lineEnd < 0 ? value.length : lineEnd
    const line = value.slice(lineStart, end)
    const prefix = line.match(/^\s{0,3}/)?.[0].length || 0
    let markerEnd = prefix
    while (line[markerEnd] === opening.marker) markerEnd += 1
    if (markerEnd - prefix >= opening.length && /^[\t ]*\r?$/.test(line.slice(markerEnd))) {
      return lineEnd < 0 ? value.length : lineEnd + 1
    }
    lineStart = lineEnd < 0 ? value.length : lineEnd + 1
  }
  return value.length
}

function protectedCodeRanges(value: string): CodeRange[] {
  const ranges: CodeRange[] = []
  for (let cursor = 0; cursor < value.length;) {
    const fence = codeFenceAt(value, cursor)
    if (fence) {
      const end = findCodeFenceClose(value, fence)
      ranges.push({ start: cursor, end, fenced: true })
      cursor = end
      continue
    }
    if (value[cursor] !== BACKTICK || isEscaped(value, cursor)) {
      cursor += 1
      continue
    }
    const delimiterLength = backtickRunLength(value, cursor)
    const close = findInlineCodeClose(value, cursor + delimiterLength, delimiterLength)
    if (close < 0) {
      cursor += delimiterLength
      continue
    }
    const end = close + delimiterLength
    ranges.push({ start: cursor, end, fenced: false })
    cursor = end
  }
  return ranges
}

function displayLatex(value: string, start: number, end: number) {
  let latex = value.slice(start + 2, end)
  if (latex.startsWith('\r\n')) latex = latex.slice(2)
  else if (latex.startsWith('\n')) latex = latex.slice(1)
  if (latex.endsWith('\r\n')) latex = latex.slice(0, -2)
  else if (latex.endsWith('\n')) latex = latex.slice(0, -1)
  return latex
}

function findDisplayClose(value: string, start: number, end: number) {
  for (let cursor = start + 2; cursor + 1 < end; cursor += 1) {
    if (value[cursor] === '$' && value[cursor + 1] === '$' && !isEscaped(value, cursor)) return cursor
  }
  return -1
}

function findInlineClose(value: string, start: number, end: number) {
  for (let cursor = start + 1; cursor < end; cursor += 1) {
    if (value[cursor] === '\n' || value[cursor] === '\r') return -1
    if (value[cursor] !== '$' || isEscaped(value, cursor)) continue
    // A double-dollar delimiter cannot close inline math. This also prevents
    // `$...$` matching from restarting inside a display delimiter.
    if (value[cursor + 1] === '$') return -1
    return cursor
  }
  return -1
}

function appendText(output: MathDelimiterSegment[], value: string) {
  if (!value) return
  const previous = output.at(-1)
  if (previous?.type === 'text') {
    previous.value += value
    return
  }
  output.push({ type: 'text', value })
}

/**
 * Scans canonical Markdown into text/code/math regions without changing any
 * non-math source. Incomplete delimiters remain text so OCR repair stays at
 * its dedicated ingestion boundary.
 */
export function scanMathDelimiters(markdown: string): MathDelimiterSegment[] {
  const value = String(markdown || '')
  const codeRanges = protectedCodeRanges(value)
  const output: MathDelimiterSegment[] = []
  let codeIndex = 0
  let cursor = 0
  let textStart = 0

  while (cursor < value.length) {
    const codeRange = codeRanges[codeIndex]
    if (codeRange?.start === cursor) {
      appendText(output, value.slice(textStart, cursor))
      output.push({ type: 'code', value: value.slice(codeRange.start, codeRange.end), fenced: codeRange.fenced })
      cursor = codeRange.end
      textStart = cursor
      codeIndex += 1
      continue
    }

    const textEnd = codeRange?.start ?? value.length
    if (value[cursor] !== '$' || isEscaped(value, cursor)) {
      cursor += 1
      continue
    }

    if (value[cursor + 1] === '$') {
      const close = findDisplayClose(value, cursor, textEnd)
      if (close >= 0) {
        appendText(output, value.slice(textStart, cursor))
        output.push({ type: 'math', latex: displayLatex(value, cursor, close), displayMode: true })
        cursor = close + 2
        textStart = cursor
        continue
      }
      // Treat an incomplete display opener as ordinary text as a whole. In
      // particular, do not reinterpret its second `$` as an inline opener.
      cursor += 2
      continue
    }

    const close = findInlineClose(value, cursor, textEnd)
    if (close >= 0) {
      appendText(output, value.slice(textStart, cursor))
      output.push({ type: 'math', latex: value.slice(cursor + 1, close), displayMode: false })
      cursor = close + 1
      textStart = cursor
      continue
    }
    cursor += 1
  }

  appendText(output, value.slice(textStart))
  return output
}
