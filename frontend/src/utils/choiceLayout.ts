export type ChoiceLayout = 'quad' | 'double' | 'single'

function normalizedChoiceLength(value: string) {
  return String(value || '')
    .replace(/\$\$?([\s\S]*?)\$\$?/g, '$1')
    .replace(/[*_`~|\\{}]/g, '')
    .replace(/\s+/g, '')
    .length
}

export function choiceLayoutForTexts(values: string[], forceSingle = false): ChoiceLayout {
  if (forceSingle || values.length !== 4) return 'single'
  if (values.some((value) => /\n|\$\$|\|[^\n]*\||!\[[^\]]*\]\(/.test(String(value || '')))) return 'single'

  const lengths = values.map(normalizedChoiceLength)
  const maxLength = Math.max(...lengths, 0)
  const totalLength = lengths.reduce((sum, length) => sum + length, 0)
  if (maxLength <= 18 && totalLength <= 72) return 'quad'
  if (maxLength <= 38 && totalLength <= 152) return 'double'
  return 'single'
}
