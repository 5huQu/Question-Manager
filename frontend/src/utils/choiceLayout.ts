export type ChoiceLayout = 'quad' | 'double' | 'single'

function requiresSingleColumn(value: string) {
  const source = String(value || '').replace(/\r\n?/g, '\n')
  if (/\n\s*\n|\$\$|\\\[|\\begin\s*\{|!\[[^\]]*\]\(|<img\b|^\s*\|.*\|\s*$/im.test(source)) return true

  // KaTeX keeps expressions such as unions of intervals on a single line.
  // They are technically short in Markdown but cannot safely share a narrow
  // two-column cell without colliding with the neighbouring option.
  return /\\(?:left|right|frac|dfrac|tfrac|sqrt|overline|underline|vec|hat|bar|cup|cap|infty|sum|prod|int|lim)\b|[∪∩∞]/.test(source)
}

function visualChoiceWidth(value: string) {
  const plain = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\\(?:left|right|displaystyle|textstyle|quad|qquad)\b|\\[,;!]/g, '')
    .replace(/\\(?:frac|dfrac|tfrac|sqrt|overline|underline|vec|hat|bar)\b/g, '')
    .replace(/\\[a-zA-Z]+/g, 'α')
    .replace(/[\$*_`~{}]/g, '')
    .replace(/\s+/g, '')

  return Array.from(plain).reduce((width, character) => {
    if (/\p{Script=Han}/u.test(character)) return width + 1
    if (/[A-Z]/.test(character)) return width + 0.7
    if (/[a-z0-9]/.test(character)) return width + 0.55
    if (/[=+\-×÷<>≤≥]/.test(character)) return width + 0.7
    return width + 0.8
  }, 0)
}

export function choiceLayoutForTexts(values: string[], forceSingle = false): ChoiceLayout {
  if (forceSingle || values.length !== 4) return 'single'
  if (values.some(requiresSingleColumn)) return 'single'

  const lengths = values.map(visualChoiceWidth)
  const maxLength = Math.max(...lengths, 0)
  const totalLength = lengths.reduce((sum, length) => sum + length, 0)
  if (maxLength <= 18 && totalLength <= 72) return 'quad'
  if (maxLength <= 38 && totalLength <= 152) return 'double'
  return 'single'
}
