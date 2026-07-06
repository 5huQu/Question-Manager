import { db } from '../../db/connection.js'
import { getBasket } from '../../db/collections.js'
import { getQuestion, mapQuestion } from '../../db/questions.js'
import type { QuestionRow } from '../../types/index.js'
import { nowIso } from '../../utils/ids.js'

type SqlValue = string | number | bigint | null | Buffer

export function listQuestionBankItems(filters: {
  q: string
  stage: string
  questionType: string
  knowledgePoint: string
  solutionMethod: string
  difficulty: string
  page: number
  pageSize: number
}) {
  let whereSql = `
    WHERE (? = '' OR search_text LIKE ? OR source_title LIKE ? OR chapter LIKE ? OR knowledge_points_json LIKE ? OR solution_methods_json LIKE ?)
      AND (? = '' OR stage = ?)
      AND (? = '' OR question_type = ?)
      AND (? = '' OR difficulty_label = ?)
  `
  const filterParams: any[] = [
    filters.q,
    `%${filters.q}%`,
    `%${filters.q}%`,
    `%${filters.q}%`,
    `%${filters.q}%`,
    `%${filters.q}%`,
    filters.stage,
    filters.stage,
    filters.questionType,
    filters.questionType,
    filters.difficulty,
    filters.difficulty,
  ]

  // Dynamic knowledgePoint handling (split by comma and match using OR)
  const kpList = filters.knowledgePoint ? filters.knowledgePoint.split(',').map(s => s.trim()).filter(Boolean) : []
  if (kpList.length > 0) {
    const kpSql = kpList.map(() => `knowledge_points_json LIKE ?`).join(' OR ')
    whereSql += ` AND (${kpSql})`
    kpList.forEach(kp => {
      filterParams.push(`%${kp}%`)
    })
  }

  // Dynamic solutionMethod handling (split by comma and match using OR)
  const smList = filters.solutionMethod ? filters.solutionMethod.split(',').map(s => s.trim()).filter(Boolean) : []
  if (smList.length > 0) {
    const smSql = smList.map(() => `solution_methods_json LIKE ?`).join(' OR ')
    whereSql += ` AND (${smSql})`
    smList.forEach(sm => {
      filterParams.push(`%${sm}%`)
    })
  }

  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM question_bank_items ${whereSql}`).get(...filterParams) as { count: number }
  const totalItems = totalRow.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / filters.pageSize))
  const page = Math.min(totalPages, Math.max(1, filters.page))
  const offset = (page - 1) * filters.pageSize
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    ${whereSql}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...filterParams, filters.pageSize, offset) as QuestionRow[]
  return { items: rows.map(mapQuestion), totalItems, page, pageSize: filters.pageSize, totalPages, basket: getBasket() }
}

export function updateQuestionBankItem(id: string, values: SqlValue[]) {
  db.prepare(`
    UPDATE question_bank_items SET
      question_no = COALESCE(?, question_no),
      stage = COALESCE(?, stage),
      question_type = COALESCE(?, question_type),
      difficulty_score = COALESCE(?, difficulty_score),
      difficulty_score_10 = COALESCE(?, difficulty_score_10),
      difficulty_label = COALESCE(?, difficulty_label),
      chapter = COALESCE(?, chapter),
      knowledge_points_json = COALESCE(?, knowledge_points_json),
      solution_methods_json = COALESCE(?, solution_methods_json),
      source_title = COALESCE(?, source_title),
      stem_markdown = ?,
      answer_text = ?,
      analysis_markdown = ?,
      total_score = ?,
      scoring_rubric_json = ?,
      search_text = ?,
      format_review_required = ?,
      format_review_reasons_json = ?,
      bank_status = CASE WHEN ? AND bank_status = 'ready' THEN 'blocked' ELSE COALESCE(?, bank_status) END,
      updated_at = ?
    WHERE id = ?
  `).run(...values, id)
}

export function deleteQuestionBankItem(id: string) {
  try {
    db.exec('BEGIN')
    db.prepare('DELETE FROM question_bank_collection_items WHERE question_id = ?').run(id)
    db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function updateQuestionFigures(id: string, figures: Array<Record<string, unknown>>) {
  db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(figures), nowIso(), id)
}

export function updateQuestionAfterFigureBinding(id: string, values: SqlValue[]) {
  db.prepare('UPDATE question_bank_items SET stem_markdown = ?, answer_text = ?, analysis_markdown = ?, figures_json = ?, bank_status = ?, format_review_required = ?, format_review_reasons_json = ?, updated_at = ? WHERE id = ?')
    .run(...values, id)
}

export function markRerunRunning(runId: string) {
  const now = nowIso()
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
    .run(now, now, runId)
}

export function updateQuestionFormatReviewState(id: string, values: {
  bankStatus?: string | null
  formatReviewRequired: boolean
  formatReviewJson: string
  updatedAt: string
}) {
  db.prepare(`
    UPDATE question_bank_items SET
      bank_status = COALESCE(?, bank_status),
      format_review_required = ?,
      format_review_reasons_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    values.bankStatus ?? null,
    values.formatReviewRequired ? 1 : 0,
    values.formatReviewJson,
    values.updatedAt,
    id,
  )
}

export { getQuestion }
