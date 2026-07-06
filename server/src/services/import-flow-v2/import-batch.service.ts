import path from 'node:path'
import { db } from '../../db/connection.js'
import { mapQuestion } from '../../db/questions.js'
import { createExportRecord, exportRecordFileSize, listExportRecords, mapExportRecord } from '../../db/export-records.js'
import * as importJobRepo from '../../repositories/import-jobs.repo.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import type { ImportJob, ImportJobDocument, ImportJobDocumentRow, ImportJobRow } from '../../types/import-job.js'
import type { QuestionRow } from '../../types/index.js'
import type { SourceDocument } from '../../types/source-document.js'
import { assetPathFor } from '../../utils/paths.js'
import { RouteError } from '../../utils/http-error.js'
import { formatReviewPayload, validateQuestionMarkdown } from '../../utils/validation.js'
import { nowIso } from '../../utils/ids.js'
import { updateQuestionFormatReviewState } from '../../repositories/question-bank/items.repo.js'
import { normalizeExportVariant } from '../question-bank/export-records.js'
import { exportQuestionSetPdf } from '../question-bank/export.js'
import { runQuestionBatchClassification } from '../question-bank/batch-classification.js'

export type ImportJobDocumentDetail = ImportJobDocument & {
  sourceDocument: SourceDocument
}

export type ImportJobDetailResponse = {
  importJob: ImportJob
  documents: ImportJobDocumentDetail[]
  stats: {
    sourceDocumentCount: number
    ocrSucceededCount: number
    candidateCount: number
    committedCandidateCount: number
    questionCount: number
    needsReviewCount: number
    blockedCount: number
  }
}

type SqlValue = string | number | bigint | null | Buffer

function requireImportJob(jobId: string) {
  const importJob = importJobRepo.getImportJob(jobId)
  if (!importJob) throw new RouteError(404, '导入批次不存在。')
  return importJob
}

function requireSourceDocument(sourceDocumentId: string) {
  const sourceDocument = sourceRepo.getSourceDocument(sourceDocumentId)
  if (!sourceDocument) throw new RouteError(404, '资料不存在。')
  return sourceDocument
}

function hydrateImportJobDocuments(jobId: string): ImportJobDocumentDetail[] {
  return importJobRepo.listImportJobDocuments(jobId).map((document) => {
    const sourceDocument = sourceRepo.getSourceDocument(document.sourceDocumentId)
    if (!sourceDocument) throw new RouteError(409, `导入批次关联的资料不存在：${document.sourceDocumentId}`)
    return { ...document, sourceDocument }
  })
}

function sourceDocumentIds(documents: Array<Pick<ImportJobDocument, 'sourceDocumentId'>>) {
  return documents.map((document) => document.sourceDocumentId).filter(Boolean)
}

function placeholders(values: unknown[]) {
  return values.map(() => '?').join(', ')
}

function importJobQuestionWhere(jobId: string, documents: Array<Pick<ImportJobDocument, 'sourceDocumentId'>>) {
  const sourceIds = sourceDocumentIds(documents)
  const importSourceIds = [jobId, `ifv2-job:${jobId}`, ...sourceIds]
  return {
    sql: `import_source_id IN (${placeholders(importSourceIds)})`,
    values: importSourceIds as SqlValue[],
  }
}

function importJobStats(importJob: ImportJob, documents: ImportJobDocumentDetail[]) {
  const sourceIds = sourceDocumentIds(documents)
  const sourceDocumentCount = documents.length
  const ocrSucceededCount = documents.filter((document) =>
    ['ocr_succeeded', 'parsed', 'partially_parsed'].includes(document.sourceDocument.status),
  ).length

  let candidateCount = 0
  let committedCandidateCount = 0
  let needsReviewCount = 0
  let blockedCount = 0
  for (const sourceDocumentId of sourceIds) {
    const stats = sourceRepo.getSourceDocumentImportStats(sourceDocumentId)
    candidateCount += stats.candidateCount
    committedCandidateCount += stats.committedCount
    needsReviewCount += stats.needsReviewCount + stats.needsManualFixCount
    blockedCount += stats.blockedCount
  }

  return {
    sourceDocumentCount,
    ocrSucceededCount,
    candidateCount,
    committedCandidateCount,
    questionCount: importJobQuestionRows(importJob.id, { includeSkipped: false }).length,
    needsReviewCount,
    blockedCount,
  }
}

export function getImportJobDetail(jobId: string): ImportJobDetailResponse {
  const importJob = requireImportJob(jobId)
  const documents = hydrateImportJobDocuments(importJob.id)
  return {
    importJob,
    documents,
    stats: importJobStats(importJob, documents),
  }
}

export function listImportJobsWithStats(query: Record<string, unknown> = {}) {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(query.limit || 100))))
  const offset = Math.max(0, Math.floor(Number(query.offset || 0)))
  const rows = db.prepare(`
    SELECT *
    FROM import_jobs
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as ImportJobRow[]
  return {
    items: rows.map((row) => getImportJobDetail(importJobRepo.mapImportJob(row).id)),
  }
}

export function resolveImportJobForSourceDocument(sourceDocumentId: string) {
  requireSourceDocument(sourceDocumentId)
  const row = db.prepare(`
    SELECT j.*
    FROM import_jobs j
    JOIN import_job_documents d ON d.job_id = j.id
    WHERE d.source_document_id = ?
    ORDER BY j.updated_at DESC, j.created_at DESC
    LIMIT 1
  `).get(sourceDocumentId) as ImportJobRow | undefined
  return row ? getImportJobDetail(row.id) : null
}

export function ensureSingleDocumentImportJob(sourceDocumentId: string) {
  const existing = resolveImportJobForSourceDocument(sourceDocumentId)
  if (existing) return existing

  const sourceDocument = requireSourceDocument(sourceDocumentId)
  const title = sourceDocument.paperTitle || sourceDocument.title || sourceDocument.originalFileName || '资料导入'
  const importJob = importJobRepo.createImportJob({
    title,
    mode: 'single_document',
    status: sourceDocument.status === 'parsed' || sourceDocument.status === 'partially_parsed' ? sourceDocument.status : 'draft',
    province: sourceDocument.province,
    city: sourceDocument.city,
    paperTitle: sourceDocument.paperTitle || title,
    batchName: sourceDocument.batchName || title,
    stage: sourceDocument.stage,
    subject: sourceDocument.subject,
    paperKind: sourceDocument.paperKind,
    examYear: sourceDocument.examYear,
    sourceOrg: sourceDocument.sourceOrg,
  })
  if (!importJob) throw new RouteError(500, '导入批次创建失败。')
  const document = importJobRepo.addSourceDocumentToImportJob({
    jobId: importJob.id,
    sourceDocumentId: sourceDocument.id,
    role: 'full',
    sortOrder: 0,
  })
  if (!document) throw new RouteError(500, '导入批次文档挂载失败。')
  return getImportJobDetail(importJob.id)
}

export function resolveImportJobForLegacyRunId(runId: string) {
  const decodedRunId = decodeURIComponent(String(runId || ''))
  if (decodedRunId.startsWith('ifv2-job:')) {
    return getImportJobDetail(decodedRunId.slice('ifv2-job:'.length))
  }
  if (decodedRunId.startsWith('ifv2:')) {
    return ensureSingleDocumentImportJob(decodedRunId.slice('ifv2:'.length))
  }
  throw new RouteError(400, '不是 V2 导入批次兼容地址。')
}

export function listImportJobCandidates(jobId: string) {
  const detail = getImportJobDetail(jobId)
  const items = sourceDocumentIds(detail.documents)
    .flatMap((sourceDocumentId) => candidateRepo.listQuestionCandidates({ sourceDocumentId, limit: 1000 }))
    .sort((left, right) => {
      const leftNo = Number(left.questionNo)
      const rightNo = Number(right.questionNo)
      if (Number.isFinite(leftNo) && Number.isFinite(rightNo) && leftNo !== rightNo) return leftNo - rightNo
      return left.questionNo.localeCompare(right.questionNo) || left.createdAt.localeCompare(right.createdAt)
    })
  return { ...detail, items }
}

export function importJobQuestionRows(jobId: string, options: { includeSkipped?: boolean } = {}) {
  const importJob = requireImportJob(jobId)
  const documents = importJobRepo.listImportJobDocuments(importJob.id)
  const where = importJobQuestionWhere(importJob.id, documents)
  const statusSql = options.includeSkipped ? '' : "AND bank_status != 'skipped'"
  return db.prepare(`
    SELECT *
    FROM question_bank_items
    WHERE ${where.sql}
      ${statusSql}
    ORDER BY
      CASE WHEN TRIM(question_no) GLOB '[0-9]*' THEN CAST(question_no AS INTEGER) ELSE 999999 END ASC,
      serial_no ASC,
      created_at ASC
  `).all(...where.values) as QuestionRow[]
}

export function listImportJobQuestions(jobId: string) {
  const detail = getImportJobDetail(jobId)
  const rows = importJobQuestionRows(jobId, { includeSkipped: false })
  return {
    ...detail,
    items: rows.map(mapQuestion),
    stats: {
      ...detail.stats,
      totalItems: rows.length,
      readyCount: rows.filter((row) => row.bank_status === 'ready' || row.bank_status === 'banked').length,
      blockedCount: rows.filter((row) => row.bank_status === 'blocked').length,
    },
  }
}

export async function classifyImportJobQuestions(jobId: string) {
  requireImportJob(jobId)
  const report = await runQuestionBatchClassification({ type: 'import_job', id: jobId })
  return {
    ...listImportJobQuestions(jobId),
    report,
  }
}

export function listImportJobExportRecords(jobId: string, query: Record<string, unknown> = {}) {
  requireImportJob(jobId)
  const limit = Math.max(1, Math.min(500, Math.floor(Number(query.limit || 100))))
  return {
    items: listExportRecords({ sourceType: 'import_job', importJobId: jobId, limit })
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, limit),
  }
}

export function refreshQuestionFormatStateForExport(rows: QuestionRow[]) {
  for (const row of rows) {
    if (row.bank_status !== 'blocked' && !row.format_review_required) continue
    const issues = validateQuestionMarkdown({
      problem_text: row.stem_markdown,
      answer: row.answer_text,
      analysis: row.analysis_markdown,
    })
    const updatedAt = nowIso()
    if (issues.length) {
      updateQuestionFormatReviewState(row.id, {
        bankStatus: 'blocked',
        formatReviewRequired: true,
        formatReviewJson: JSON.stringify(formatReviewPayload(issues, updatedAt)),
        updatedAt,
      })
    } else {
      updateQuestionFormatReviewState(row.id, {
        bankStatus: row.bank_status === 'blocked' ? 'ready' : null,
        formatReviewRequired: false,
        formatReviewJson: '{}',
        updatedAt,
      })
    }
  }
}

export function exportImportJob(jobId: string, body: Record<string, unknown> = {}) {
  const detail = getImportJobDetail(jobId)
  let rows = importJobQuestionRows(jobId, { includeSkipped: false })
  if (!rows.length) throw new RouteError(400, '当前导入批次暂无已入库题目，无法导出。')
  refreshQuestionFormatStateForExport(rows)
  rows = importJobQuestionRows(jobId, { includeSkipped: false })
  const blockedRows = rows.filter((row) => row.bank_status === 'blocked')
  if (blockedRows.length) {
    const labels = blockedRows
      .map((row) => row.question_no || String(row.serial_no || ''))
      .filter(Boolean)
      .slice(0, 10)
      .join('、')
    throw new RouteError(409, `当前批次有 ${blockedRows.length} 道题需要修正，暂不能导出${labels ? `：${labels}` : ''}。`)
  }

  const template = body.template === 'worksheet' ? 'worksheet' : 'exam'
  const variant = normalizeExportVariant(body.variant)
  const title = String(body.title || '').trim()
    || detail.importJob.paperTitle
    || detail.importJob.title
    || detail.documents[0]?.sourceDocument.paperTitle
    || detail.documents[0]?.sourceDocument.title
    || '资料导入批次'
  const result = exportQuestionSetPdf({
    id: `import-job-${detail.importJob.id}`,
    title,
    rows,
    template,
    variant,
    createdAt: detail.importJob.createdAt,
    updatedAt: detail.importJob.updatedAt,
  })
  const rel = assetPathFor(result.path)
  const record = createExportRecord({
    sourceType: 'import_job',
    importJobId: detail.importJob.id,
    title,
    format: result.format,
    variant: `${template}-${variant}`,
    filename: path.basename(result.path),
    path: rel,
    url: `/assets/${rel}`,
    items: rows.map((row, index) => ({ questionId: row.id, exportOrder: index + 1 })),
    contentLength: exportRecordFileSize(rel),
    questionCount: rows.length,
  })
  return {
    filename: path.basename(result.path),
    format: result.format,
    url: `/assets/${rel}`,
    path: rel,
    exportRecord: mapExportRecord(record),
  }
}
