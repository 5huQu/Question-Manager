import { db } from './connection.js'
import type { ReviewRow, SolutionRow } from '../types/index.js'
import { parseJson } from '../utils/json.js'
import { nowIso } from '../utils/ids.js'
import { resolveStoragePath } from '../utils/paths.js'
import fs from 'node:fs'
import path from 'node:path'

export function normalizedReviewQuestionNo(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const compact = raw
    .replace(/[第题\s]/g, '')
    .replace(/[.．、:：）)]$/g, '')
    .replace(/^[（(]/, '')
  const numberMatch = compact.match(/\d{1,3}/)
  return numberMatch ? String(Number(numberMatch[0])) : compact.toUpperCase()
}

function questionOrderParts(value: string) {
  return (String(value || '').match(/\d+/g) || []).map(Number)
}

/**
 * Return review items in the paper's question-number order rather than by
 * their opaque result IDs.  Manual annotation result IDs contain random UUIDs,
 * so lexical ID order is not a meaningful reading order.
 */
export function compareReviewItems<T extends { questionLabel: string; pageStart: number; resultId: string }>(left: T, right: T) {
  const leftParts = questionOrderParts(left.questionLabel)
  const rightParts = questionOrderParts(right.questionLabel)
  if (leftParts.length && rightParts.length) {
    const max = Math.max(leftParts.length, rightParts.length)
    for (let index = 0; index < max; index += 1) {
      const diff = (leftParts[index] ?? -1) - (rightParts[index] ?? -1)
      if (diff) return diff
    }
  } else if (leftParts.length || rightParts.length) {
    return leftParts.length ? -1 : 1
  }
  return left.pageStart - right.pageStart || left.resultId.localeCompare(right.resultId)
}

function solutionCutRecords(runId: string) {
  const run = db.prepare('SELECT run_dir FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as { run_dir?: string } | undefined
  if (!run?.run_dir) return []
  const cutPath = path.join(resolveStoragePath(run.run_dir), 'output', 'cut_results.json')
  if (!fs.existsSync(cutPath)) return []
  const payload = parseJson<{ solution_results?: Array<Record<string, any>> }>(fs.readFileSync(cutPath, 'utf8'), { solution_results: [] })
  return payload.solution_results || []
}

export function mapReview(row: ReviewRow, solutionByNo: Map<string, SolutionRow> = new Map(), solutionCutByNo: Map<string, Record<string, any>> = new Map()) {
  const bbox = parseJson<Record<string, number>>(row.bbox_json, {})
  const segments = parseJson<Array<Record<string, any>>>(row.segments_json, [])
  const textRegions = parseJson<Array<Record<string, any>>>(row.text_regions_json, [])
  const figures = parseJson<Array<Record<string, any>>>(row.figures_json, [])
  const key = normalizedReviewQuestionNo(row.question_label)
  const solution = solutionByNo.get(key)
  const solutionCut = solutionCutByNo.get(key)
  const solutionFigures = parseJson<Array<Record<string, any>>>(solution?.figures_json || '[]', [])
  return {
    resultId: row.result_id,
    runId: row.run_id,
    questionLabel: row.question_label,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    pageImagePath: row.page_image_path,
    autoImagePath: row.auto_image_path,
    imageUrl: row.auto_image_path ? `/assets/${row.auto_image_path}` : '',
    solutionImagePath: solution?.source_image_path || '',
    solutionImageUrl: solution?.source_image_path ? `/assets/${solution.source_image_path}` : '',
    hasSolutionSlice: Boolean(solution?.source_image_path),
    solutionBbox: solutionCut?.bbox || {},
    solutionSegments: Array.isArray(solutionCut?.segments) ? solutionCut.segments : [],
    solutionFigures,
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
  const solutions = db.prepare('SELECT * FROM pdf_slicer_solution_items WHERE source_run_id = ? ORDER BY created_at ASC').all(runId) as SolutionRow[]
  const solutionByNo = new Map<string, SolutionRow>()
  for (const solution of solutions) {
    const key = normalizedReviewQuestionNo(solution.question_no)
    if (key && !solutionByNo.has(key)) solutionByNo.set(key, solution)
  }
  const solutionCutByNo = new Map<string, Record<string, any>>()
  for (const item of solutionCutRecords(runId)) {
    const key = normalizedReviewQuestionNo(String(item.question_no || ''))
    if (key && !solutionCutByNo.has(key)) solutionCutByNo.set(key, item)
  }
  return (db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ?').all(runId) as ReviewRow[])
    .map((row) => mapReview(row, solutionByNo, solutionCutByNo))
    .sort(compareReviewItems)
}

export function syncReviewRunCounts(runId: string) {
  const items = getReviewItems(runId)
  const approved = items.filter((item) => item.reviewStatus === 'ready_for_ocr').length
  const pending = items.filter((item) => item.reviewStatus === 'pending_review').length
  db.prepare('UPDATE pdf_slicer_runs SET total_questions = ?, approved_questions = ?, unreviewed_questions = ?, updated_at = ? WHERE run_id = ?')
    .run(items.length, approved, pending, nowIso(), runId)
  return { items, approved, pending }
}
