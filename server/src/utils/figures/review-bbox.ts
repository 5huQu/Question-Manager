import fs from 'node:fs'
import { parseJson } from '../json.js'
import { imageDimensions } from './image-basics.js'

export function normalizedFigureId(value: unknown, index: number) {
  return String(value || `review_fig_${index + 1}`).replace(/[^\w.-]+/g, '_')
}

export function expandedReviewBBox(bbox: Record<string, any>) {
  const x = Number(bbox.x ?? bbox.x0 ?? 0)
  const y = Number(bbox.y ?? bbox.y0 ?? 0)
  const width = Number(bbox.width ?? bbox.w ?? Number(bbox.x1 ?? 0) - Number(bbox.x0 ?? 0))
  const height = Number(bbox.height ?? bbox.h ?? Number(bbox.y1 ?? 0) - Number(bbox.y0 ?? 0))
  return { x: x - 4, y, width: width + 8, height: height + 10 }
}

export function rawReviewBBox(value: any): { x: number; y: number; width: number; height: number } | null {
  if (!value) return null
  if (Array.isArray(value) && value.length === 4) {
    const x0 = Number(value[0])
    const y0 = Number(value[1])
    const x1 = Number(value[2])
    const y1 = Number(value[3])
    const width = x1 - x0
    const height = y1 - y0
    return Number.isFinite(x0) && Number.isFinite(y0) && width > 0 && height > 0
      ? { x: x0, y: y0, width, height }
      : null
  }
  if (typeof value !== 'object') return null
  const x = Number(value.x ?? value.x0)
  const y = Number(value.y ?? value.y0)
  const width = Number(value.width ?? value.w ?? Number(value.x1 ?? 0) - Number(value.x0 ?? 0))
  const height = Number(value.height ?? value.h ?? Number(value.y1 ?? 0) - Number(value.y0 ?? 0))
  return Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0
    ? { x, y, width, height }
    : null
}

function isNormalizedReviewBBox(bbox: { x: number; y: number; width: number; height: number }) {
  return bbox.x >= 0 && bbox.y >= 0 && bbox.width > 0 && bbox.height > 0 &&
    bbox.x <= 1 && bbox.y <= 1 && bbox.width <= 1 && bbox.height <= 1
}

export function reviewSegmentBBox(segment: Record<string, any>, fallbackBBox?: { x: number; y: number; width: number; height: number }) {
  const explicit = rawReviewBBox(segment.bbox)
  if (explicit) return explicit
  const flat = rawReviewBBox(segment)
  if (!flat) return null
  return isNormalizedReviewBBox(flat) && fallbackBBox ? fallbackBBox : flat
}

export type ReviewRow = {
  result_id: string
  run_id: string
  question_label: string
  page_start: number
  page_end: number
  page_image_path: string
  auto_image_path: string
  bbox_json: string
  segments_json: string
  text_regions_json: string
  figures_json: string
  glm_figure_bindings_json: string
  review_status: string
  note: string
  created_at: string
  updated_at: string
}

export function figurePixelBBoxForSegments(sourceSegments: Array<Record<string, any>>, fallbackPage: number, figure: Record<string, any>, imagePath: string) {
  if (!fs.existsSync(imagePath)) return figure.bbox || {}
  const segments = sourceSegments
    .map((segment) => {
      const rawBBox = reviewSegmentBBox(segment)
      const bbox = rawBBox ? expandedReviewBBox(rawBBox) : null
      return bbox && bbox.width > 0 && bbox.height > 0
        ? { pageNumber: Number(segment.page_number ?? segment.pageNumber ?? segment.page ?? fallbackPage), bbox }
        : null
    })
    .filter(Boolean) as Array<{ pageNumber: number; bbox: { x: number; y: number; width: number; height: number } }>
  if (!segments.length || !figure.bbox) return figure.bbox || {}

  const totalHeight = segments.reduce((sum, segment) => sum + segment.bbox.height, 0)
  const maxWidth = Math.max(...segments.map((segment) => segment.bbox.width), 1)
  let yOffset = 0
  const offsets = segments.map((segment) => {
    const current = { ...segment, yOffset }
    yOffset += segment.bbox.height
    return current
  })
  const figureBBox = figure.bbox
  const pageNumber = Number(figure.page_number ?? figure.pageNumber ?? fallbackPage)
  const segment = offsets.find((entry) => {
    const left = entry.bbox
    const right = figureBBox
    return entry.pageNumber === pageNumber &&
      !(left.x + left.width <= right.x || right.x + right.width <= left.x || left.y + left.height <= right.y || right.y + right.height <= left.y)
  })
  if (!segment) return figure.bbox || {}

  const size = imageDimensions(imagePath)
  return {
    x: ((Number(figureBBox.x || 0) - segment.bbox.x) / maxWidth) * size.width,
    y: ((Number(figureBBox.y || 0) - segment.bbox.y + segment.yOffset) / Math.max(totalHeight, 1)) * size.height,
    width: (Number(figureBBox.width || 0) / maxWidth) * size.width,
    height: (Number(figureBBox.height || 0) / Math.max(totalHeight, 1)) * size.height,
  }
}

export function reviewFigurePixelBBox(reviewRow: ReviewRow | undefined, figure: Record<string, any>, imagePath: string) {
  if (!reviewRow) return figure.bbox || {}
  const rawSegments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const fallbackBBox = rawReviewBBox(parseJson<any>(reviewRow.bbox_json || '{}', {})) || undefined
  const sourceSegments = rawSegments.length
    ? rawSegments.map((segment) => ({ ...segment, bbox: reviewSegmentBBox(segment, fallbackBBox) || segment.bbox }))
    : [{ page_number: reviewRow.page_start, bbox: fallbackBBox }]
  return figurePixelBBoxForSegments(sourceSegments, reviewRow.page_start, figure, imagePath)
}

export function reviewFigureDefaultUsage(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  const boundary = answerOrAnalysisBoundary(reviewRow)
  const figureKey = reviewFigureReadingKey(reviewRow, figure)
  if (!boundary || !figureKey) return 'stem'
  if (figureKey.segmentIndex > boundary.segmentIndex) return 'analysis'
  if (figureKey.segmentIndex < boundary.segmentIndex) return 'stem'
  return figureKey.y >= boundary.y ? 'analysis' : 'stem'
}

export function answerOrAnalysisBoundary(reviewRow: ReviewRow | undefined) {
  if (!reviewRow) return null
  const regions = parseJson<Array<Record<string, any>>>(reviewRow.text_regions_json || '[]', [])
  const candidates = regions
    .filter((region) => region.kind === 'answer' || region.kind === 'analysis')
    .flatMap((region) => Array.isArray(region.segments) ? region.segments.slice(0, 1) : [])
    .map((segment) => reviewSegmentReadingKey(reviewRow, segment, false))
    .filter(Boolean) as Array<{ segmentIndex: number; y: number }>
  if (!candidates.length) return null
  candidates.sort((left, right) => left.segmentIndex - right.segmentIndex || left.y - right.y)
  return candidates[0]
}

export function reviewFigureReadingKey(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  if (!reviewRow || !figure?.bbox) return null
  return reviewSegmentReadingKey(reviewRow, {
    page_number: figure.page_number ?? figure.pageNumber,
    bbox: figure.bbox,
  }, true)
}

export function reviewSegmentReadingKey(reviewRow: ReviewRow, segment: Record<string, any>, useCenter: boolean) {
  const bbox = segment.bbox && typeof segment.bbox === 'object' ? segment.bbox : {}
  const pageNumber = Number(segment.page_number ?? segment.pageNumber ?? 0)
  let y = Number(bbox.y ?? bbox.y0 ?? 0)
  if (useCenter) {
    y += Number(bbox.height ?? bbox.h ?? Number(bbox.y1 ?? 0) - Number(bbox.y0 ?? 0)) / 2
  }
  if (!Number.isFinite(pageNumber) || !Number.isFinite(y)) return null

  const rawSegments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const fallbackBBox = parseJson<Record<string, any>>(reviewRow.bbox_json || '{}', {})
  const sourceSegments = rawSegments.length ? rawSegments : [{ page_number: reviewRow.page_start, bbox: fallbackBBox }]
  const indexes = sourceSegments
    .map((sourceSegment, index) => ({ sourceSegment, index }))
    .filter(({ sourceSegment }) => Number(sourceSegment.page_number ?? sourceSegment.pageNumber ?? reviewRow.page_start) === pageNumber)
  if (!indexes.length) return null

  const containing = indexes.find(({ sourceSegment }) => {
    const sourceBBox = sourceSegment.bbox && typeof sourceSegment.bbox === 'object' ? sourceSegment.bbox : {}
    const top = Number(sourceBBox.y ?? sourceBBox.y0 ?? 0)
    const height = Number(sourceBBox.height ?? sourceBBox.h ?? Number(sourceBBox.y1 ?? 0) - Number(sourceBBox.y0 ?? 0))
    return y >= top - 2 && y <= top + height + 2
  })
  return { segmentIndex: (containing || indexes[0]).index, y }
}
