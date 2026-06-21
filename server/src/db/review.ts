import { db } from './connection.js'
import type { ReviewRow } from '../types/index.js'
import { parseJson } from '../utils/json.js'
import { nowIso } from '../utils/ids.js'

export function mapReview(row: ReviewRow) {
  const bbox = parseJson<Record<string, number>>(row.bbox_json, {})
  const segments = parseJson<Array<Record<string, any>>>(row.segments_json, [])
  const textRegions = parseJson<Array<Record<string, any>>>(row.text_regions_json, [])
  const figures = parseJson<Array<Record<string, any>>>(row.figures_json, [])
  return {
    resultId: row.result_id,
    runId: row.run_id,
    questionLabel: row.question_label,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    pageImagePath: row.page_image_path,
    autoImagePath: row.auto_image_path,
    imageUrl: row.auto_image_path ? `/assets/${row.auto_image_path}` : '',
    bbox,
    segments,
    textRegions,
    figures,
    reviewStatus: row.review_status,
    note: row.note,
    isManualSupplement: false,
  }
}

export function getReviewItems(runId: string) {
  return (db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? ORDER BY result_id ASC').all(runId) as ReviewRow[]).map(mapReview)
}

export function syncReviewRunCounts(runId: string) {
  const items = getReviewItems(runId)
  const approved = items.filter((item) => item.reviewStatus === 'ready_for_ocr').length
  const pending = items.filter((item) => item.reviewStatus === 'pending_review').length
  db.prepare('UPDATE pdf_slicer_runs SET total_questions = ?, approved_questions = ?, unreviewed_questions = ?, updated_at = ? WHERE run_id = ?')
    .run(items.length, approved, pending, nowIso(), runId)
  return { items, approved, pending }
}
