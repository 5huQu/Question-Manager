export interface ManualFixSegment {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface ManualFixRegion {
  kind: 'question' | 'solution' | 'shared_answer_key'
  questionKeys?: string[]
  segments: ManualFixSegment[]
}

export interface ManualFixFigure {
  id?: string
  blockId?: string
  sourceBlockId?: string
  pageNo?: number
  bbox?: unknown
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function displayRectToSegment(rect: Rect, imageSize: Size, page: number): ManualFixSegment | null {
  if (![rect.x, rect.y, rect.width, rect.height, imageSize.width, imageSize.height, page].every(Number.isFinite)) return null
  if (page < 1 || imageSize.width <= 0 || imageSize.height <= 0 || rect.width <= 3 || rect.height <= 3) return null

  return {
    page,
    x: rect.x / imageSize.width,
    y: rect.y / imageSize.height,
    width: rect.width / imageSize.width,
    height: rect.height / imageSize.height,
  }
}

export function segmentToDisplayRect(segment: ManualFixSegment, imageSize: Size): Rect | null {
  if (![segment.x, segment.y, segment.width, segment.height, imageSize.width, imageSize.height].every(Number.isFinite)) return null
  if (imageSize.width <= 0 || imageSize.height <= 0) return null

  return {
    x: segment.x * imageSize.width,
    y: segment.y * imageSize.height,
    width: segment.width * imageSize.width,
    height: segment.height * imageSize.height,
  }
}

export function normalizeSegmentForSave(segment: ManualFixSegment, naturalSize: Size): ManualFixSegment | null {
  const values = [segment.page, segment.x, segment.y, segment.width, segment.height]
  if (!values.every(Number.isFinite) || segment.page < 1 || segment.width <= 0 || segment.height <= 0) return null
  if (segment.x >= 0 && segment.y >= 0 && segment.x + segment.width <= 1 && segment.y + segment.height <= 1) return segment
  if (naturalSize.width <= 0 || naturalSize.height <= 0) return null

  const normalized = {
    page: segment.page,
    x: segment.x / naturalSize.width,
    y: segment.y / naturalSize.height,
    width: segment.width / naturalSize.width,
    height: segment.height / naturalSize.height,
  }
  return normalized.x >= 0 && normalized.y >= 0 && normalized.width > 0 && normalized.height > 0
    && normalized.x + normalized.width <= 1 && normalized.y + normalized.height <= 1
    ? normalized
    : null
}

export function figureIds(figure: ManualFixFigure): string[] {
  return [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).map(String)
}

function numericBbox(figure: ManualFixFigure): number[] | null {
  if (!Array.isArray(figure.bbox) || figure.bbox.length < 4) return null
  const bbox = figure.bbox.slice(0, 4).map(Number)
  return bbox.every(Number.isFinite) ? bbox : null
}

export function regionMatchesFigure(region: ManualFixRegion, figure: ManualFixFigure, tolerance = 0.01): boolean {
  if (region.kind !== 'shared_answer_key') return false
  const ids = figureIds(figure)
  const regionFigureIds = (region.questionKeys || []).map(String)
  if (ids.some((id) => regionFigureIds.includes(id))) return true

  const bbox = numericBbox(figure)
  const segment = region.segments[0]
  if (!bbox || !segment || Number(segment.page) !== Number(figure.pageNo || 0)) return false
  const regionBbox = [segment.x, segment.y, segment.x + segment.width, segment.y + segment.height]
  return regionBbox.every((value, index) => Math.abs(value - bbox[index]) < tolerance)
}

export function isHeaderFooterSegment(segment: ManualFixSegment): boolean {
  const bottom = segment.y + segment.height
  const inTopBand = segment.y < 0.12 && bottom <= 0.13 && segment.height <= 0.06
  const inBottomBand = (segment.y >= 0.9 || bottom >= 0.97) && segment.height <= 0.08
  return inTopBand || inBottomBand
}

export function isHeaderFooterBbox(bboxValue: unknown): boolean {
  if (!Array.isArray(bboxValue) || bboxValue.length < 4) return false
  const bbox = bboxValue.slice(0, 4).map(Number)
  if (!bbox.every(Number.isFinite) || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return false
  const height = bbox[3] - bbox[1]
  if (bbox.every((value) => value >= 0 && value <= 1)) {
    return (bbox[1] < 0.12 && bbox[3] <= 0.13 && height <= 0.06)
      || ((bbox[1] >= 0.9 || bbox[3] >= 0.97) && height <= 0.08)
  }
  return (bbox[1] < 260 && bbox[3] <= 300 && height <= 180) || (height <= 180 && bbox[1] >= 2500)
}

export function removeFigureMarkersByIds(markdown: string, ids: Iterable<string>): string {
  let next = String(markdown || '')
  for (const id of ids) {
    const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    next = next.replace(new RegExp(`\\n?\\s*<!--\\s*DOC2X_FIGURE:${escaped}\\s*-->\\s*\\n?`, 'g'), '\n')
  }
  return next.replace(/\n{3,}/g, '\n\n').trim()
}

export function removeFigureMarkers(markdown: string, figure: ManualFixFigure): string {
  return removeFigureMarkersByIds(markdown, figureIds(figure))
}
