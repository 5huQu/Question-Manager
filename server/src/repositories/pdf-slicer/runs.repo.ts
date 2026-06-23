import { db } from '../../db/connection.js'
import { getRun, removeRunOcrOutputs, mapRun } from '../../db/runs.js'
import { mapQuestion } from '../../db/questions.js'
import type { RunRow, QuestionRow } from '../../types/index.js'
import { nowIso } from '../../utils/ids.js'

export { getRun, removeRunOcrOutputs }

export function markRunQueued(runId: string) {
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'queued', ocr_error = '', updated_at = ? WHERE run_id = ?").run(nowIso(), runId)
}

export function markRunRunning(runId: string, resetFinished = false) {
  const now = nowIso()
  if (resetFinished) {
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = ?, ocr_finished_at = '', updated_at = ? WHERE run_id = ?").run(now, now, runId)
    return now
  }
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?").run(now, now, runId)
  return now
}

export function markRunFailed(runId: string, message: string) {
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?").run(message, nowIso(), nowIso(), runId)
}

export function markRunSucceeded(runId: string) {
  const now = nowIso()
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'succeeded', ocr_error = '', ocr_finished_at = ?, updated_at = ? WHERE run_id = ?").run(now, now, runId)
}

export function listOcrJobs() {
  return (db.prepare("SELECT * FROM pdf_slicer_runs WHERE ocr_status != 'idle' ORDER BY updated_at DESC").all() as RunRow[]).map(mapRun)
}

export function questionsForRun(runId: string) {
  const rows = db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
  return rows.map(mapQuestion)
}

export function sourceQuestionCount(runId: string) {
  return (db.prepare('SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ?').get(runId) as { count: number }).count
}

export function rawRun(runId: string) {
  return db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
}

export function updateProviderPhase(runId: string, phase: string) {
  db.prepare('UPDATE pdf_slicer_runs SET ocr_provider_phase = ?, updated_at = ? WHERE run_id = ?').run(phase, nowIso(), runId)
}

export function touchRun(runId: string) {
  db.prepare('UPDATE pdf_slicer_runs SET updated_at = ? WHERE run_id = ?').run(nowIso(), runId)
}
