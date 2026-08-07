export type ChoiceLayout = 'quad' | 'double' | 'single' | 'adaptive'
export type ResolvedChoiceLayout = Exclude<ChoiceLayout, 'adaptive'>
export type ChoiceLayoutOverrides = Readonly<Record<string, ResolvedChoiceLayout>>

export function choiceLayoutFromColumns(columns: number): ResolvedChoiceLayout {
  return columns >= 4 ? 'quad' : columns >= 2 ? 'double' : 'single'
}

export function choiceLayoutOverridesEqual(
  left: ChoiceLayoutOverrides,
  right: ChoiceLayoutOverrides,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left[key] === right[key])
}

function requiresSingleColumn(value: string) {
  const source = String(value || '').replace(/\r\n?/g, '\n')
  if (/\n\s*\n|\$\$|\\\[|\\begin\s*\{|!\[[^\]]*\]\(|<img\b|^\s*\|.*\|\s*$/im.test(source)) return true

  // KaTeX keeps expressions such as unions of intervals on a single line.
  // They are technically short in Markdown but cannot safely share a narrow
  // two-column cell without colliding with the neighbouring option.
  // 无穷符号本身通常很短，不应单独阻止四栏；区间并集、积分等结构化
  // 表达式才需要保守地退回单栏，避免窄栏中的公式碰撞。
  return /\\(?:cup|cap|sum|prod|int|lim)\b|[∪∩]/.test(source)
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
