import { db } from '../../db/connection.js'
import { getRun } from '../../db/runs.js'
import { getQuestion, mapQuestion, createQuestion, similarQuestionCandidates, attachSimilarQuestions } from '../../db/questions.js'
import { getReviewItems, syncReviewRunCounts } from '../../db/review.js'
import type { QuestionRow } from '../../types/index.js'
import { nowIso } from '../../utils/ids.js'

export { getRun, getQuestion, mapQuestion, createQuestion, similarQuestionCandidates, attachSimilarQuestions, getReviewItems, syncReviewRunCounts }

export function questionRowsForRun(runId: string) {
  return db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
}

export function confirmableQuestionIds(runId: string) {
  return (db.prepare("SELECT id FROM question_bank_items WHERE source_run_id = ? AND bank_status NOT IN ('banked', 'skipped') ORDER BY serial_no ASC").all(runId) as Array<{ id: string }>).map((row) => row.id)
}

export function questionRowForRun(id: string, runId: string) {
  return db.prepare('SELECT * FROM question_bank_items WHERE id = ? AND source_run_id = ?').get(id, runId) as QuestionRow | undefined
}

export function questionExistsInRun(id: string, runId: string) {
  return Boolean(db.prepare('SELECT 1 FROM question_bank_items WHERE id = ? AND source_run_id = ?').get(id, runId))
}

export function markQuestionBanked(id: string, questionNo: string) {
  db.prepare(`
    UPDATE question_bank_items SET
      question_no = ?,
      bank_status = 'banked',
      format_review_required = 0,
      format_review_reasons_json = '{}',
      updated_at = ?
    WHERE id = ?
  `).run(questionNo, nowIso(), id)
}

export function markQuestionsBanked(updates: Array<{ id: string; questionNo: string }>) {
  try {
    db.exec('BEGIN')
    for (const update of updates) markQuestionBanked(update.id, update.questionNo)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function markQuestionSkipped(id: string) {
  db.prepare("UPDATE question_bank_items SET bank_status = 'skipped', updated_at = ? WHERE id = ?").run(nowIso(), id)
}

export function markQuestionsSkipped(ids: string[]) {
  try {
    db.exec('BEGIN')
    for (const id of ids) markQuestionSkipped(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function deleteQuestions(runId: string, questionIds: string[], figureDirForId: (id: string) => void) {
  let success = 0
  let failed = 0
  try {
    db.exec('BEGIN')
    for (const id of questionIds) {
      if (!questionExistsInRun(id, runId)) { failed += 1; continue }
      db.prepare('DELETE FROM question_bank_collection_items WHERE question_id = ?').run(id)
      db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(id)
      db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').run(runId, id)
      figureDirForId(id)
      success += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { success, failed }
}

export function markRerunRunning(runId: string) {
  const now = nowIso()
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?").run(now, now, runId)
}
