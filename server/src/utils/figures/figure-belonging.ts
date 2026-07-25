import { parseJson } from '../json.js'
import { stripAssetPrefix } from '../paths.js'
import { db } from '../../db/connection.js'
import type { ReviewRow } from './review-bbox.js'

export function normalizedRectangle(value: Record<string, any>, sourceIsPdfPoints = false) {
  const x = Number(value.x ?? value.x0 ?? 0)
  const y = Number(value.y ?? value.y0 ?? 0)
  const width = Number(value.width ?? value.w ?? Number(value.x1 ?? 0) - x)
  const height = Number(value.height ?? value.h ?? Number(value.y1 ?? 0) - y)
  return sourceIsPdfPoints
    ? { x: x / 595.3, y: y / 841.9, width: width / 595.3, height: height / 841.9 }
    : { x, y, width, height }
}

export function rectanglesOverlap(left: ReturnType<typeof normalizedRectangle>, right: ReturnType<typeof normalizedRectangle>) {
  return left.x < right.x + right.width && right.x < left.x + left.width &&
    left.y < right.y + right.height && right.y < left.y + left.height
}

export function isFormulaSuspectFigure(figure: Record<string, any>) {
  return Boolean(figure.formula_suspect ?? figure.formulaSuspect)
}

export function isManualFigure(figure: Record<string, any>) {
  return String(figure.origin || '') === 'manual'
}

export function glmFigureMatchesConfirmedReviewFigure(reviewRow: ReviewRow, figure: Record<string, any>) {
  const figureId = String(figure.id || '')
  if (!figureId) return false
  const binding = parseJson<Record<string, any>>(reviewRow.glm_figure_bindings_json || '{}', {})
  const matchedReviewIds = new Set(
    (Array.isArray(binding.bindings) ? binding.bindings : [])
      .filter((entry) => String(entry?.glm_figure_id || '') === figureId && String(entry?.status || '') === 'matched')
      .map((entry) => String(entry.review_figure_id || ''))
      .filter(Boolean),
  )
  if (!matchedReviewIds.size) return false
  const reviewFigures = parseJson<Array<Record<string, any>>>(reviewRow.figures_json || '[]', [])
  return reviewFigures.some((reviewFigure) =>
    matchedReviewIds.has(String(reviewFigure.id || '')) &&
    (!isFormulaSuspectFigure(reviewFigure) || isManualFigure(reviewFigure)),
  )
}

export function glmFigureIsBoundToReviewFigure(reviewRow: ReviewRow, figure: Record<string, any>) {
  const figureId = String(figure.id || '')
  if (!figureId) return false
  const binding = parseJson<Record<string, any>>(reviewRow.glm_figure_bindings_json || '{}', {})
  return (Array.isArray(binding.bindings) ? binding.bindings : []).some((entry) =>
    String(entry?.glm_figure_id || '') === figureId && String(entry?.status || '') === 'matched',
  )
}

// GLM reports every image found on each parsed page.  A page can contain
// several questions, so page membership alone must not become figure binding.
export function figureBelongsToReview(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  if (isFormulaSuspectFigure(figure) && !isManualFigure(figure)) return false
  if (String(figure.origin || '') !== 'glm_ocr') return true
  if (!reviewRow) return false
  // A GLM block matched to a reviewer crop is evidence for that crop, not a
  // second diagram. Keep the binding in diagnostics but render only the
  // editable reviewer-owned image.
  if (glmFigureIsBoundToReviewFigure(reviewRow, figure)) return false
  const figureBox = normalizedRectangle(figure.bbox || {})
  if (figureBox.width <= 0 || figureBox.height <= 0) return false
  const figurePage = Number(figure.pageNumber ?? figure.page_number ?? 0)
  const segments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const candidates = segments.length
    ? segments
    : [{ page_number: reviewRow.page_start, bbox: parseJson<Record<string, any>>(reviewRow.bbox_json || '{}', {}) }]
  const overlapsReviewSegment = candidates.some((segment) =>
    Number(segment.page_number ?? segment.pageNumber ?? reviewRow.page_start) === figurePage &&
    rectanglesOverlap(figureBox, normalizedRectangle(segment.bbox || {}, true)),
  )
  return overlapsReviewSegment && glmFigureMatchesConfirmedReviewFigure(reviewRow, figure)
}

export function sliceImagePathForOcrResult(result: Record<string, any>, runId: string) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  return stripAssetPrefix(String(result.image_path || reviewRow?.auto_image_path || reviewRow?.page_image_path || ''))
}

export function sourceImagePathForOcrResult(result: Record<string, any>, reviewRow?: ReviewRow) {
  const isSolution = String(result.ocr_record_kind || '') === 'solution'
  return stripAssetPrefix(String(
    isSolution
      ? (result.solution_image_path || result.image_path || result.reviewed_image_path || result.auto_image_path)
      : (result.problem_image_path || result.image_path || result.reviewed_image_path || result.auto_image_path) ||
    reviewRow?.auto_image_path ||
    reviewRow?.page_image_path ||
    '',
  ))
}
