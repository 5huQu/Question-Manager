import { db } from '../../../db/connection.js'
import * as sourceRepo from '../../../repositories/source-documents.repo.js'
import type { QuestionCandidate } from '../../../types/question-candidate.js'
import { readOcrSettings } from '../../settings/ocr-settings.js'
import { runQuestionBatchClassification, type QuestionBatchClassificationReport } from '../../question-bank/batch-classification.js'

export function sourceTitle(sourceDocumentId: string) {
  const source = sourceRepo.getSourceDocument(sourceDocumentId)
  return source?.paperTitle || source?.title || source?.originalFileName || '资料导入 v2'
}

export function importJobContextForSource(sourceDocumentId: string) {
  const row = db.prepare(`
    SELECT j.id, j.title, j.paper_title
    FROM import_jobs j
    JOIN import_job_documents d ON d.job_id = j.id
    WHERE d.source_document_id = ?
      AND j.status IN ('parsed', 'partially_parsed')
    ORDER BY j.updated_at DESC, j.created_at DESC
    LIMIT 1
  `).get(sourceDocumentId) as { id: string; title: string; paper_title: string } | undefined
  if (!row) return null
  return {
    importSourceId: row.id,
    importJobId: row.id,
    sourceTitle: row.paper_title || row.title || sourceTitle(sourceDocumentId),
  }
}

export async function maybeClassifyCommittedImportJobs(items: Array<{ importSourceId?: string }>) {
  if (readOcrSettings().classificationEnabled === 'false') return null
  const importJobIds = Array.from(new Set(items.map((item) => String(item.importSourceId || '').trim()).filter(Boolean)))
    .filter((id) => Boolean(db.prepare('SELECT id FROM import_jobs WHERE id = ?').get(id)))
  const reports: QuestionBatchClassificationReport[] = []
  for (const importJobId of importJobIds) {
    reports.push(await runQuestionBatchClassification({ type: 'import_job', id: importJobId }))
  }
  return reports.length ? reports : null
}

export function sourceMetadata(sourceDocumentId: string): Partial<Pick<QuestionCandidate,
  'province' | 'city' | 'paperTitle' | 'batchName' | 'stage' | 'subject' | 'paperKind' | 'examYear' | 'sourceOrg'
>> {
  const source = sourceRepo.getSourceDocument(sourceDocumentId)
  if (!source) return {}
  const importJob = db.prepare(`
    SELECT j.province, j.city, j.paper_title, j.batch_name, j.stage, j.subject,
           j.paper_kind, j.exam_year, j.source_org
    FROM import_jobs j
    JOIN import_job_documents d ON d.job_id = j.id
    WHERE d.source_document_id = ?
    ORDER BY j.updated_at DESC, j.created_at DESC
    LIMIT 1
  `).get(sourceDocumentId) as {
    province: string
    city: string
    paper_title: string
    batch_name: string
    stage: string
    subject: string
    paper_kind: QuestionCandidate['paperKind']
    exam_year: number
    source_org: string
  } | undefined
  return importJob ? {
    province: importJob.province || source.province,
    city: importJob.city || source.city,
    paperTitle: importJob.paper_title || source.paperTitle,
    batchName: importJob.batch_name || source.batchName,
    stage: importJob.stage || source.stage,
    subject: importJob.subject || source.subject,
    paperKind: importJob.paper_kind !== 'unknown' ? importJob.paper_kind : source.paperKind,
    examYear: importJob.exam_year || source.examYear,
    sourceOrg: importJob.source_org || source.sourceOrg,
  } : {
    province: source.province,
    city: source.city,
    paperTitle: source.paperTitle,
    batchName: source.batchName,
    stage: source.stage,
    subject: source.subject,
    paperKind: source.paperKind,
    examYear: source.examYear,
    sourceOrg: source.sourceOrg,
  }
}
