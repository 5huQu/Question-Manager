import type { BBox, SliceReviewItem } from '@/types'
import { clamp01, clampNumber, expandedCropBBox, normalizeDisplayRect, parseBBox, rectsOverlap } from './crop'
export { formulaSuspectTitle, isFormulaSuspectFigure, reviewFigureUsage, reviewFigureUsageInfo } from './questionDisplay'

export function figureBoxesForReviewItem(item: SliceReviewItem): Array<BBox & { pageNumber: number }> {
  const figures = item.figures ?? []
  if (!figures.length) return []
  const layout = reviewCropLayout(item)
  if (!layout) return []

  return figures.flatMap((figure) => {
    const figureBBox = parseBBox(figure.bbox)
    if (!figureBBox) return []
    const pageNumber = Number(figure.page_number ?? figure.pageNumber ?? item.pageStart)
    const segment = layout.offsets.find((entry) => entry.pageNumber === pageNumber && rectsOverlap(entry.bbox, figureBBox))
    if (!segment) return []
    const x = clamp01((figureBBox.x - segment.bbox.x) / layout.maxWidth)
    const y = clamp01((figureBBox.y - segment.bbox.y + segment.yOffset) / Math.max(layout.totalHeight, 1))
    const right = clamp01((figureBBox.x + figureBBox.width - segment.bbox.x) / layout.maxWidth)
    const bottom = clamp01((figureBBox.y + figureBBox.height - segment.bbox.y + segment.yOffset) / Math.max(layout.totalHeight, 1))
    if (right <= x || bottom <= y) return []
    return [{ pageNumber, x, y, width: right - x, height: bottom - y }]
  })
}

export function reviewCropLayout(item: SliceReviewItem) {
  const rawSegments = item.segments?.length ? item.segments : [{ page_number: item.pageStart, bbox: item.bbox }]
  const segments = rawSegments.map((segment) => {
    const bbox = parseBBox(segment.bbox)
    return bbox ? { pageNumber: Number(segment.page_number ?? segment.pageNumber ?? item.pageStart), bbox } : null
  }).filter(Boolean) as Array<{ pageNumber: number; bbox: BBox }>
  if (!segments.length) return null

  const expandedSegments = segments.map(({ pageNumber, bbox }) => ({ pageNumber, bbox: expandedCropBBox(bbox) }))
  const totalHeight = expandedSegments.reduce((sum, segment) => sum + segment.bbox.height, 0)
  const maxWidth = Math.max(...expandedSegments.map((segment) => segment.bbox.width), 1)
  let yOffset = 0
  const offsets = expandedSegments.map((segment) => {
    const current = { ...segment, yOffset }
    yOffset += segment.bbox.height
    return current
  })
  return { offsets, totalHeight, maxWidth }
}

export function displayRectFromReviewFigure(item: SliceReviewItem, figure: Record<string, unknown>, displaySize: { width: number; height: number }) {
  if (displaySize.width <= 0 || displaySize.height <= 0) return null
  const box = figureBoxesForReviewItem({ ...item, figures: [figure] })[0]
  if (!box) return null
  return normalizeDisplayRect({
    x: box.x * displaySize.width,
    y: box.y * displaySize.height,
    width: box.width * displaySize.width,
    height: box.height * displaySize.height,
  }, displaySize)
}

export function reviewFigureFromDisplayRect(item: SliceReviewItem, rect: BBox, displaySize: { width: number; height: number }, existing?: Record<string, unknown>) {
  if (displaySize.width <= 0 || displaySize.height <= 0 || rect.width <= 0 || rect.height <= 0) return null
  const layout = reviewCropLayout(item)
  if (!layout) return null
  const normalized = {
    x: clamp01(rect.x / displaySize.width),
    y: clamp01(rect.y / displaySize.height),
    width: clamp01(rect.width / displaySize.width),
    height: clamp01(rect.height / displaySize.height),
  }
  const stackX = normalized.x * layout.maxWidth
  const stackY = normalized.y * layout.totalHeight
  const stackWidth = normalized.width * layout.maxWidth
  const stackHeight = normalized.height * layout.totalHeight
  const centerY = stackY + stackHeight / 2
  const segment = layout.offsets.find((entry) => centerY >= entry.yOffset && centerY <= entry.yOffset + entry.bbox.height) ?? layout.offsets[0]
  if (!segment) return null
  const localY = stackY - segment.yOffset
  const x = clampNumber(segment.bbox.x + stackX, segment.bbox.x, segment.bbox.x + segment.bbox.width)
  const y = clampNumber(segment.bbox.y + localY, segment.bbox.y, segment.bbox.y + segment.bbox.height)
  const right = clampNumber(x + stackWidth, segment.bbox.x, segment.bbox.x + segment.bbox.width)
  const bottom = clampNumber(y + stackHeight, segment.bbox.y, segment.bbox.y + segment.bbox.height)
  if (right <= x || bottom <= y) return null
  return {
    ...existing,
    id: String(existing?.id || `review_fig_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`),
    page_number: segment.pageNumber,
    bbox: {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      width: Math.round((right - x) * 100) / 100,
      height: Math.round((bottom - y) * 100) / 100,
    },
    kind: String(existing?.kind || 'image'),
  }
}
