import fs from 'node:fs'
import { db } from '../../db/connection.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import { resolveStoragePath } from '../../utils/paths.js'
import { hasActiveSourceDocumentOcrTask } from './ocr-task.service.js'

/**
 * Remove the original PDF once every candidate owned by an import job has
 * been committed. This deliberately does not delete the source-document row,
 * OCR documents, or question-bank figure assets: those records are still
 * useful for history and the latter are independent of the original PDF.
 *
 * The existing deleteSourceDocument() operation is intentionally not used
 * here because it also deletes committed question-bank items.
 */
export function cleanupOriginalPdfsForCompletedImportJob(importJobId: string) {
  const jobId = String(importJobId || '').trim()
  if (!jobId) return { cleaned: [], skipped: 'missing_job_id' as const }

  const documents = db.prepare(`
    SELECT source_document_id AS sourceDocumentId
    FROM import_job_documents
    WHERE job_id = ?
  `).all(jobId) as Array<{ sourceDocumentId: string }>
  const sourceDocumentIds = Array.from(new Set(documents.map((row) => String(row.sourceDocumentId || '').trim()).filter(Boolean)))
  if (!sourceDocumentIds.length) return { cleaned: [], skipped: 'no_documents' as const }

  const placeholders = sourceDocumentIds.map(() => '?').join(', ')
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS candidateCount,
      SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END) AS committedCount,
      SUM(CASE WHEN status IN ('ready', 'needs_review', 'needs_manual_fix', 'blocked') THEN 1 ELSE 0 END) AS uncommittedCount
    FROM question_candidates
    WHERE source_document_id IN (${placeholders})
  `).get(...sourceDocumentIds) as { candidateCount?: number; committedCount?: number; uncommittedCount?: number }
  const candidateCount = Number(stats?.candidateCount || 0)
  const committedCount = Number(stats?.committedCount || 0)
  const uncommittedCount = Number(stats?.uncommittedCount || 0)
  if (!candidateCount || uncommittedCount > 0 || committedCount !== candidateCount) {
    return { cleaned: [], skipped: 'candidates_not_all_committed' as const, candidateCount, committedCount, uncommittedCount }
  }

  const cleaned: string[] = []
  for (const sourceDocumentId of sourceDocumentIds) {
    const source = sourceRepo.getSourceDocument(sourceDocumentId)
    if (!source || source.fileType !== 'pdf' || !source.filePath) continue
    if (hasActiveSourceDocumentOcrTask(sourceDocumentId)) continue

    const filePath = resolveStoragePath(source.filePath)
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.rmSync(filePath, { force: true })
      } catch (error) {
        // Cleanup is best effort. Keeping the DB path allows a later retry.
        console.error(`Failed to remove completed import PDF ${sourceDocumentId}:`, error)
        continue
      }
    }

    sourceRepo.updateSourceDocument(sourceDocumentId, {
      filePath: '',
      metadata: {
        ...source.metadata,
        originalFileRemovedAt: new Date().toISOString(),
      },
    })
    cleaned.push(sourceDocumentId)
  }
  return { cleaned, candidateCount, committedCount, uncommittedCount }
}
