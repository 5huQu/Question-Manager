export const basketUpdatedEvent = 'question-basket-updated'
/** 全应用唯一的试题篮（默认集合），所有"加入试题篮"操作的固定目标。 */
export const DEFAULT_BASKET_ID = 'basket'

export const basketCardOutlineButtonClass = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 shadow-xs transition-all hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:opacity-30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
export const basketCardDangerButtonClass = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-red-200 bg-red-50/20 px-2.5 text-xs font-medium text-red-700 shadow-xs transition-all hover:bg-red-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-950 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/30'

export function notifyBasketUpdated() {
  window.dispatchEvent(new Event(basketUpdatedEvent))
}

export function stripLeadingQuestionNo(value: string, questionNo = '') {
  const text = String(value || '').trimStart()
  const escaped = String(questionNo || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (escaped) {
    const exactPattern = new RegExp(`^(?:第\\s*)?${escaped}\\s*(?:题)?\\s*[.．、:：）)]\\s*`)
    const exactCleaned = text.replace(exactPattern, '')
    if (exactCleaned !== text) return exactCleaned.trimStart()
  }
  return text
    .replace(/^第\s*\d{1,3}\s*题\s*/, '')
    .replace(/^\d{1,3}\s*(?:题)?\s*[.．、:：）)]\s*/, '')
    .trimStart()
}

export function getDefaultScore(questionType: string | null | undefined): number {
  if (!questionType) return 5
  const type = String(questionType)
  if (type.includes('单选') || type.includes('单项选择')) return 5
  if (type.includes('多选') || type.includes('多项选择')) return 6
  if (type.includes('填空')) return 5
  if (type.includes('解答') || type.includes('计算') || type.includes('证明') || type.includes('主观')) return 15
  return 5
}
