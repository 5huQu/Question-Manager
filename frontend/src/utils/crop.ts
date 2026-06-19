import type { BBox, CropCorner, QuestionFigure } from '@/types'

export function parseBBox(value: unknown): BBox | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const x = finiteNumber(raw.x ?? raw.x0)
  const y = finiteNumber(raw.y ?? raw.y0)
  const width = finiteNumber(raw.width ?? raw.w)
  const height = finiteNumber(raw.height ?? raw.h)
  const x1 = finiteNumber(raw.x1)
  const y1 = finiteNumber(raw.y1)
  const resolvedWidth = width ?? (x1 !== null && x !== null ? x1 - x : null)
  const resolvedHeight = height ?? (y1 !== null && y !== null ? y1 - y : null)
  if (x === null || y === null || resolvedWidth === null || resolvedHeight === null) return null
  if (resolvedWidth <= 0 || resolvedHeight <= 0) return null
  return { x, y, width: resolvedWidth, height: resolvedHeight }
}

export function expandedCropBBox(bbox: BBox): BBox {
  return {
    x: bbox.x - 4,
    y: bbox.y,
    width: bbox.width + 8,
    height: bbox.height + 10,
  }
}

export function rectsOverlap(left: BBox, right: BBox) {
  return !(left.x + left.width <= right.x || right.x + right.width <= left.x || left.y + left.height <= right.y || right.y + right.height <= left.y)
}

export function finiteNumber(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function figureOverlayStyle(figure: QuestionFigure, naturalSize: { width: number; height: number }) {
  const bbox = parseBBox(figure.bbox)
  if (!bbox || naturalSize.width <= 0 || naturalSize.height <= 0) return null
  return {
    left: `${clamp01(bbox.x / naturalSize.width) * 100}%`,
    top: `${clamp01(bbox.y / naturalSize.height) * 100}%`,
    width: `${clamp01(bbox.width / naturalSize.width) * 100}%`,
    height: `${clamp01(bbox.height / naturalSize.height) * 100}%`,
  }
}

export function displayRectFromFigure(figure: QuestionFigure, naturalSize: { width: number; height: number }, displaySize: { width: number; height: number }) {
  const bbox = parseBBox(figure.bbox)
  if (!bbox || naturalSize.width <= 0 || naturalSize.height <= 0 || displaySize.width <= 0 || displaySize.height <= 0) return null
  return normalizeDisplayRect({
    x: (bbox.x / naturalSize.width) * displaySize.width,
    y: (bbox.y / naturalSize.height) * displaySize.height,
    width: (bbox.width / naturalSize.width) * displaySize.width,
    height: (bbox.height / naturalSize.height) * displaySize.height,
  }, displaySize)
}

export const cropHandles: Array<{ corner: CropCorner; label: string; position: string; cursor: string }> = [
  { corner: 'nw', label: '拖拽左上角调整选区', position: '-left-2 -top-2', cursor: 'cursor-nwse-resize' },
  { corner: 'ne', label: '拖拽右上角调整选区', position: '-right-2 -top-2', cursor: 'cursor-nesw-resize' },
  { corner: 'sw', label: '拖拽左下角调整选区', position: '-bottom-2 -left-2', cursor: 'cursor-nesw-resize' },
  { corner: 'se', label: '拖拽右下角调整选区', position: '-bottom-2 -right-2', cursor: 'cursor-nwse-resize' },
]

export function normalizeDisplayRect(rect: BBox, size: { width: number; height: number }): BBox {
  const x = clampNumber(rect.x, 0, Math.max(0, size.width))
  const y = clampNumber(rect.y, 0, Math.max(0, size.height))
  return {
    x,
    y,
    width: clampNumber(rect.width, 0, Math.max(0, size.width - x)),
    height: clampNumber(rect.height, 0, Math.max(0, size.height - y)),
  }
}

export function resizeDisplayRect(start: BBox, corner: CropCorner, point: { x: number; y: number }, size: { width: number; height: number }): BBox {
  const minSize = 10
  const left = start.x
  const top = start.y
  const right = start.x + start.width
  const bottom = start.y + start.height

  if (corner === 'nw') {
    const nextLeft = clampNumber(point.x, 0, right - minSize)
    const nextTop = clampNumber(point.y, 0, bottom - minSize)
    return { x: nextLeft, y: nextTop, width: right - nextLeft, height: bottom - nextTop }
  }
  if (corner === 'ne') {
    const nextRight = clampNumber(point.x, left + minSize, size.width)
    const nextTop = clampNumber(point.y, 0, bottom - minSize)
    return { x: left, y: nextTop, width: nextRight - left, height: bottom - nextTop }
  }
  if (corner === 'sw') {
    const nextLeft = clampNumber(point.x, 0, right - minSize)
    const nextBottom = clampNumber(point.y, top + minSize, size.height)
    return { x: nextLeft, y: top, width: right - nextLeft, height: nextBottom - top }
  }
  const nextRight = clampNumber(point.x, left + minSize, size.width)
  const nextBottom = clampNumber(point.y, top + minSize, size.height)
  return { x: left, y: top, width: nextRight - left, height: nextBottom - top }
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
