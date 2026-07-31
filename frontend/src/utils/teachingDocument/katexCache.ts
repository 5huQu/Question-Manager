import katex from 'katex'

/**
 * 教学文档会同时出现在编辑器、隐藏测量树和分页预览中。
 * KaTeX 输出只取决于 LaTeX 与 displayMode，因此复用编译结果可显著降低
 * 公式密集型长文档在全文重绘时的主线程开销。
 */
const MAX_CACHED_FORMULAS = 1_024
const formulaHtmlCache = new Map<string, string>()

function cacheKey(latex: string, displayMode: boolean) {
  return `${displayMode ? 'block' : 'inline'}\u0000${latex}`
}

export function renderTeachingDocumentKatex(latex: string, displayMode: boolean): string {
  if (!latex) return ''
  const key = cacheKey(latex, displayMode)
  const cached = formulaHtmlCache.get(key)
  if (cached !== undefined) {
    // Map 的插入顺序用作 LRU 队列；命中项移动到队尾。
    formulaHtmlCache.delete(key)
    formulaHtmlCache.set(key, cached)
    return cached
  }
  try {
    const html = katex.renderToString(latex, { displayMode, throwOnError: true, strict: false })
    formulaHtmlCache.set(key, html)
    if (formulaHtmlCache.size > MAX_CACHED_FORMULAS) {
      const oldestKey = formulaHtmlCache.keys().next().value
      if (oldestKey) formulaHtmlCache.delete(oldestKey)
    }
    return html
  } catch {
    return ''
  }
}

/** 仅用于测试或在未来切换字体/主题渲染策略时显式清理。 */
export function clearTeachingDocumentKatexCache() {
  formulaHtmlCache.clear()
}
