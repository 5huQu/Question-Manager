import { renderKatexWithStatus, type MathRenderResult } from '@/utils/katexValidation'

/**
 * 教学文档会同时出现在编辑器、隐藏测量树和分页预览中。
 * KaTeX 输出只取决于 LaTeX 与 displayMode，因此复用编译结果可显著降低
 * 公式密集型长文档在全文重绘时的主线程开销。
 */
const MAX_CACHED_FORMULAS = 1_024
const formulaHtmlCache = new Map<string, MathRenderResult>()

function cacheKey(latex: string, displayMode: boolean) {
  return `${displayMode ? 'block' : 'inline'}\u0000${latex}`
}

export function renderTeachingDocumentKatex(latex: string, displayMode: boolean): string {
  const result = renderTeachingDocumentKatexWithStatus(latex, displayMode)
  return result.validation.valid ? result.html : ''
}

export function renderTeachingDocumentKatexWithStatus(latex: string, displayMode: boolean): MathRenderResult {
  if (!latex) return { html: '', validation: { valid: false, reason: 'latex', message: '公式为空' } }
  const key = cacheKey(latex, displayMode)
  const cached = formulaHtmlCache.get(key)
  if (cached !== undefined) {
    // Map 的插入顺序用作 LRU 队列；命中项移动到队尾。
    formulaHtmlCache.delete(key)
    formulaHtmlCache.set(key, cached)
    return cached
  }
  const result = renderKatexWithStatus(latex, displayMode)
  formulaHtmlCache.set(key, result)
  if (formulaHtmlCache.size > MAX_CACHED_FORMULAS) {
    const oldestKey = formulaHtmlCache.keys().next().value
    if (oldestKey) formulaHtmlCache.delete(oldestKey)
  }
  return result
}

/** 仅用于测试或在未来切换字体/主题渲染策略时显式清理。 */
export function clearTeachingDocumentKatexCache() {
  formulaHtmlCache.clear()
}
