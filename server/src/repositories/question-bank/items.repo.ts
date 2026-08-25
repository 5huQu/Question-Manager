import { db } from '../../db/connection.js'
import { getBasket, refreshCollectionScore } from '../../db/collections.js'
import { getQuestion, mapQuestion } from '../../db/questions.js'
import type { QuestionRow } from '../../types/index.js'
import { nowIso } from '../../utils/ids.js'

type SqlValue = string | number | bigint | null | Buffer

const classificationPendingSql = `
  COALESCE(TRIM(knowledge_points_json), '') IN ('', '[]')
  OR COALESCE(TRIM(solution_methods_json), '') IN ('', '[]')
  OR COALESCE(difficulty_score_10, 0) <= 0
  OR COALESCE(TRIM(difficulty_label), '') = ''
`

export function listQuestionBankItems(filters: {
  q: string
  stage: string
  questionType: string
  knowledgePoint: string
  solutionMethod: string
  difficulty: string
  page: number
  pageSize: number
  excludeIds: string[]
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

  // Exclude questions already present in the target document (picker use case).
  // Split into several NOT IN groups so the statement stays far below SQLite's
  // per-statement variable limit even for very large documents.
  const EXCLUDE_CHUNK_SIZE = 500
  for (let i = 0; i < filters.excludeIds.length; i += EXCLUDE_CHUNK_SIZE) {
    const chunk = filters.excludeIds.slice(i, i + EXCLUDE_CHUNK_SIZE)
    whereSql += ` AND id NOT IN (${chunk.map(() => '?').join(', ')})`
    filterParams.push(...chunk)
  }

  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM question_bank_items ${whereSql}`).get(...filterParams) as { count: number }
  const totalItems = totalRow.count ?? 0
  const classificationPendingRow = db.prepare(`SELECT COUNT(*) AS count FROM question_bank_items WHERE ${classificationPendingSql}`).get() as { count: number }
  const classificationPendingCount = classificationPendingRow.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / filters.pageSize))
  const page = Math.min(totalPages, Math.max(1, filters.page))
  const offset = (page - 1) * filters.pageSize
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    ${whereSql}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...filterParams, filters.pageSize, offset) as QuestionRow[]
  return { items: rows.map(mapQuestion), totalItems, classificationPendingCount, page, pageSize: filters.pageSize, totalPages, basket: getBasket() }
}

export function updateQuestionBankItem(id: string, values: SqlValue[], options: {
  expectedContentRevision?: number
  contentChanged?: boolean
  figures?: Array<Record<string, unknown>>
} = {}) {
  const statement = db.prepare(`
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
      content_revision = content_revision + ?,
      updated_at = ?
    WHERE id = ?${options.expectedContentRevision === undefined ? '' : ' AND content_revision = ?'}
  `)
  try {
    db.exec('BEGIN IMMEDIATE')
    const result = statement.run(
      ...values.slice(0, -1),
      options.contentChanged ? 1 : 0,
      values.at(-1)!,
      id,
      ...(options.expectedContentRevision === undefined ? [] : [options.expectedContentRevision]),
    )
    if (result.changes && options.figures) {
      db.prepare('UPDATE question_bank_items SET figures_json = ? WHERE id = ?').run(JSON.stringify(options.figures), id)
    }
    db.exec('COMMIT')
    return result
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

export function deleteQuestionBankItem(id: string) {
  deleteQuestionBankItems([id])
}

export function deleteQuestionBankItems(ids: string[]) {
  const questionIds = [...new Set(ids.map(String).map((id) => id.trim()).filter(Boolean))]
  if (!questionIds.length) return { deletedIds: [], missingIds: [] }

  const placeholders = questionIds.map(() => '?').join(', ')
  const ownsTransaction = !db.isTransaction
  try {
    if (ownsTransaction) db.exec('BEGIN IMMEDIATE')
    const existingIds = new Set((db.prepare(`SELECT id FROM question_bank_items WHERE id IN (${placeholders})`).all(...questionIds) as Array<{ id: string }>)
      .map((row) => row.id))
    const missingIds = questionIds.filter((id) => !existingIds.has(id))
    if (missingIds.length) {
      if (ownsTransaction) db.exec('ROLLBACK')
      return { deletedIds: [], missingIds }
    }

    const collectionIds = (db.prepare(`SELECT DISTINCT collection_id FROM question_bank_collection_items WHERE question_id IN (${placeholders})`).all(...questionIds) as Array<{ collection_id: string }>)
      .map((row) => row.collection_id)
    db.prepare(`DELETE FROM question_bank_collection_items WHERE question_id IN (${placeholders})`).run(...questionIds)
    db.prepare(`DELETE FROM question_bank_items WHERE id IN (${placeholders})`).run(...questionIds)
    for (const collectionId of collectionIds) refreshCollectionScore(collectionId)
    if (ownsTransaction) db.exec('COMMIT')
    return { deletedIds: questionIds, missingIds: [] }
  } catch (error) {
    if (ownsTransaction && db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Remove committed questions that came from an import source or job.
 * The import metadata predates foreign-key enforcement, so both fields are
 * matched to cover current and legacy committed rows.
 */
export function deleteQuestionBankItemsForImportSources(sourceDocumentIds: string[] = [], importJobId?: string) {
  const sourceIds = sourceDocumentIds.map(String).map((id) => id.trim()).filter(Boolean)
  const jobId = String(importJobId || '').trim()
  if (!sourceIds.length && !jobId) return []

  const clauses: string[] = []
  const params: string[] = []
  if (jobId) {
    clauses.push('import_job_id = ?')
    params.push(jobId)
  }
  if (sourceIds.length) {
    clauses.push(`import_source_id IN (${sourceIds.map(() => '?').join(', ')})`)
    params.push(...sourceIds)
  }

  const rows = db.prepare(`SELECT id FROM question_bank_items WHERE ${clauses.join(' OR ')}`).all(...params) as Array<{ id: string }>
  if (!rows.length) return []
  const ownsTransaction = !db.isTransaction
  try {
    if (ownsTransaction) db.exec('BEGIN IMMEDIATE')
    const deleteCollections = db.prepare('DELETE FROM question_bank_collection_items WHERE question_id = ?')
    const deleteItems = db.prepare('DELETE FROM question_bank_items WHERE id = ?')
    for (const row of rows) {
      deleteCollections.run(row.id)
      deleteItems.run(row.id)
    }
    if (ownsTransaction) db.exec('COMMIT')
    return rows.map((row) => row.id)
  } catch (error) {
    if (ownsTransaction && db.isTransaction) db.exec('ROLLBACK')
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
