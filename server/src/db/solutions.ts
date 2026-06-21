import { db } from './connection.js'
import type { SolutionRow } from '../types/index.js'
import { parseJson } from '../utils/json.js'

export function getSolutionItem(id: string): SolutionRow | undefined {
  return db.prepare('SELECT * FROM pdf_slicer_solution_items WHERE id = ?').get(id) as SolutionRow | undefined
}

export function listSolutionItems(batchId: string, runId?: string): SolutionRow[] {
  if (runId) {
    return db.prepare(`
      SELECT * FROM pdf_slicer_solution_items
      WHERE batch_id = ? AND source_run_id = ?
      ORDER BY created_at ASC
    `).all(batchId, runId) as SolutionRow[]
  }
  return db.prepare(`
    SELECT * FROM pdf_slicer_solution_items
    WHERE batch_id = ?
    ORDER BY created_at ASC
  `).all(batchId) as SolutionRow[]
}

export function mapSolutionItem(row: SolutionRow) {
  return {
    id: row.id,
    batchId: row.batch_id,
    sourceRunId: row.source_run_id,
    questionNo: row.question_no,
    answerText: row.answer_text,
    analysisMarkdown: row.analysis_markdown,
    figuresJson: parseJson<Record<string, unknown>[]>(row.figures_json || '[]', []),
    sourceImagePath: row.source_image_path,
    matchStatus: row.match_status,
    matchedQuestionId: row.matched_question_id,
    matchNote: row.match_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
