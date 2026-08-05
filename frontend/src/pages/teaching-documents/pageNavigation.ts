export interface PageNavigationRect {
  page: number
  top: number
  bottom: number
}

/**
 * 根据滚动容器的视口中心，判断 A4 页面预览中当前正在阅读的页码。
 * 页面之间的间隙不属于任何一页时，取离视口中心最近的页面。
 */
export function activePageFromPageRects(
  rects: readonly PageNavigationRect[],
  viewportTop: number,
  viewportBottom: number,
): number {
  const validRects = rects
    .filter((rect) => Number.isFinite(rect.page) && rect.page > 0 && rect.bottom > rect.top)
    .sort((a, b) => a.page - b.page)
  if (!validRects.length) return 1

  const centerY = viewportTop + (viewportBottom - viewportTop) / 2
  const centered = validRects.find((rect) => rect.top <= centerY && rect.bottom >= centerY)
  if (centered) return centered.page

  return validRects.reduce((closest, rect) => {
    const closestCenter = (closest.top + closest.bottom) / 2
    const rectCenter = (rect.top + rect.bottom) / 2
    return Math.abs(rectCenter - centerY) < Math.abs(closestCenter - centerY) ? rect : closest
  }).page
}

/** 根据分页编辑模式中的分页分隔线，判断视口中心已经进入哪一页。 */
export function activePageFromPageTransitions(
  transitions: readonly Pick<PageNavigationRect, 'page' | 'top'>[],
  viewportTop: number,
  viewportBottom: number,
): number {
  const probeY = viewportTop + (viewportBottom - viewportTop) / 2
  return [...transitions].sort((a, b) => a.top - b.top).reduce((page, transition) => {
    if (!Number.isFinite(transition.page) || transition.page <= page || transition.top > probeY) return page
    return transition.page
  }, 1)
}
