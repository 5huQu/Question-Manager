const MARK_OR_SELECTOR = /[\p{Mark}\uFE00-\uFE0F]/u
const EMOJI_MODIFIER = /[\u{1F3FB}-\u{1F3FF}]/u
const REGIONAL_INDICATOR = /[\u{1F1E6}-\u{1F1FF}]/u

export function fallbackGraphemeBoundaries(text: string): number[] {
  const boundaries = [0]
  let offset = 0
  let previousWasJoiner = false
  let previousSymbol = ''
  let regionalCount = 0
  for (const symbol of Array.from(text)) {
    const isJoiner = symbol === '\u200D'
    const isRegional = REGIONAL_INDICATOR.test(symbol)
    const joinsPrevious = offset > 0 && (
      MARK_OR_SELECTOR.test(symbol)
      || EMOJI_MODIFIER.test(symbol)
      || isJoiner
      || previousWasJoiner
      || (previousSymbol === '\r' && symbol === '\n')
      || (isRegional && regionalCount % 2 === 1)
    )
    if (!joinsPrevious) boundaries.push(offset)
    offset += symbol.length
    previousWasJoiner = isJoiner
    previousSymbol = symbol
    regionalCount = isRegional ? regionalCount + 1 : 0
  }
  if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length)
  return [...new Set(boundaries)].sort((left, right) => left - right)
}

export function graphemeBoundaries(text: string): number[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const boundaries = [0]
    for (const segment of segmenter.segment(text)) boundaries.push(segment.index + segment.segment.length)
    return [...new Set(boundaries)].sort((left, right) => left - right)
  }
  return fallbackGraphemeBoundaries(text)
}

export function isGraphemeBoundary(text: string, offset: number) {
  return Number.isInteger(offset) && graphemeBoundaries(text).includes(offset)
}

export function graphemeBefore(text: string, offset: number) {
  const boundaries = graphemeBoundaries(text)
  const endIndex = boundaries.findIndex((boundary) => boundary >= offset)
  if (endIndex <= 0) return ''
  return text.slice(boundaries[endIndex - 1], boundaries[endIndex])
}

export function graphemeAfter(text: string, offset: number) {
  const boundaries = graphemeBoundaries(text)
  const startIndex = boundaries.findIndex((boundary) => boundary >= offset)
  if (startIndex < 0 || startIndex >= boundaries.length - 1) return ''
  return text.slice(boundaries[startIndex], boundaries[startIndex + 1])
}
