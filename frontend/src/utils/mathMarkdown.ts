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

/** Convert standard LaTeX math delimiters into the Markdown form used internally. */
export function normalizeLatexMathDelimiters(value: string) {
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
    return fence ? line : normalizeLine(line)
  }).join('\n')
}
