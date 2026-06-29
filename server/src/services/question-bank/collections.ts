import { db } from '../../db/connection.js'
import type { ExportRecordItemSnapshot } from '../../types/index.js'
import { parseJson } from '../../utils/json.js'
import { mapQuestion } from '../../db/questions.js'

/**
 * Default score for an item in a collection based on its question type.
 */
export function defaultCollectionItemScore(questionType: string) {
  if (questionType === '多选题') return 6
  if (questionType === '解答题') return 15
  return 5
}

export function normalizeCollectionKind(value: unknown) {
  return value === 'basket' ? 'basket' : 'paper'
}

export function normalizeCollectionStatus(value: unknown) {
  return value === 'finalized' ? 'finalized' : 'draft'
}

export function normalizeExportFormat(value: unknown) {
  return value === 'latex' ? 'latex' : 'markdown'
}

/**
 * Build the item-snapshot list for an export record from a collection.
 */
export function collectionExportItems(collection: { questions: Array<{ item: { id?: string } }> }): ExportRecordItemSnapshot[] {
  return collection.questions.map((entry, index) => ({
    questionId: String(entry.item.id || ''),
    exportOrder: index + 1,
  })).filter((item) => item.questionId)
}

/**
 * Build the item-snapshot list for an export record from a run.
 */
export function runExportItems(runId: string): ExportRecordItemSnapshot[] {
  return (db.prepare(`
    SELECT id
    FROM question_bank_items
    WHERE source_run_id = ?
    ORDER BY serial_no ASC, created_at ASC
  `).all(runId) as Array<{ id: string }>).map((row, index) => ({
    questionId: row.id,
    exportOrder: index + 1,
  }))
}

/**
 * Build the item-snapshot list for an import-flow-v2 job export.
 */
export function importJobExportItems(importJobId: string): ExportRecordItemSnapshot[] {
  const sourceIds = (db.prepare('SELECT source_document_id FROM import_job_documents WHERE job_id = ?')
    .all(importJobId) as Array<{ source_document_id: string }>).map((row) => row.source_document_id)
  const importSourceIds = [importJobId, `ifv2-job:${importJobId}`, ...sourceIds]
  return (db.prepare(`
    SELECT id
    FROM question_bank_items
    WHERE import_source_id IN (${importSourceIds.map(() => '?').join(', ')})
    ORDER BY serial_no ASC, created_at ASC
  `).all(...importSourceIds) as Array<{ id: string }>).map((row, index) => ({
    questionId: row.id,
    exportOrder: index + 1,
  }))
}
