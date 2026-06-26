import { db } from '../db/connection.js'
import type {
  CreateSourceDocumentInput,
  SourceDocument,
  SourceDocumentFileType,
  SourceDocumentImportStats,
  SourceDocumentProvider,
  SourceDocumentRow,
  SourceDocumentStatus,
  UpdateSourceDocumentInput,
} from '../types/source-document.js'
import { createId, nowIso } from '../utils/ids.js'
import { normalizeImportMetadata, importMetadataPatch } from '../utils/import-metadata.js'
import { normalizeUploadName } from '../utils/ocr-helpers.js'
import { parseJson } from '../utils/json.js'

type SqlValue = string | number | bigint | null | Buffer

export type ListSourceDocumentsFilters = {
  status?: SourceDocumentStatus
  provider?: SourceDocumentProvider
  fileType?: SourceDocumentFileType
  limit?: number
  offset?: number
}

function normalizeLimit(value: number | undefined, fallback = 100) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(500, Math.floor(numeric)))
}

function normalizeOffset(value: number | undefined) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function normalizePageCount(value: number | undefined) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringifyMetadata(value: unknown) {
  return JSON.stringify(normalizeMetadata(value))
}

export function mapSourceDocument(row: SourceDocumentRow): SourceDocument {
  const metadata = normalizeImportMetadata({
    province: row.province,
    city: row.city,
    paper_title: row.paper_title,
    batch_name: row.batch_name,
    stage: row.stage,
    subject: row.subject,
    paper_kind: row.paper_kind,
    exam_year: row.exam_year,
    source_org: row.source_org,
  })
	  return {
    id: row.id,
    title: normalizeUploadName(row.title),
    originalFileName: normalizeUploadName(row.original_file_name),
    filePath: row.file_path,
    fileType: row.file_type,
    pageCount: Number(row.page_count || 0),
    provider: row.provider || undefined,
	    status: row.status,
	    ...metadata,
	    metadata: parseJson<Record<string, unknown>>(row.metadata_json || '{}', {}),
	    createdAt: row.created_at,
	    updatedAt: row.updated_at,
	  }
}

export function createSourceDocument(input: CreateSourceDocumentInput) {
  const now = nowIso()
  const title = String(input.title ?? input.originalFileName ?? '')
  const originalFileName = String(input.originalFileName ?? '')
  const id = input.id || createId('docimport')
  const metadata = normalizeImportMetadata(input as Record<string, unknown>)
	  db.prepare(`
	    INSERT INTO source_documents (
	      id, title, original_file_name, file_path, file_type, page_count, provider, status,
	      province, city, paper_title, batch_name, stage, subject, paper_kind, exam_year, source_org,
	      metadata_json, created_at, updated_at
	    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	  `).run(
    id,
    title,
    originalFileName,
    input.filePath || '',
    input.fileType || 'pdf',
    normalizePageCount(input.pageCount),
    input.provider || '',
    input.status || 'uploaded',
    metadata.province,
    metadata.city,
    metadata.paperTitle,
    metadata.batchName,
    metadata.stage,
    metadata.subject,
    metadata.paperKind,
	    metadata.examYear,
	    metadata.sourceOrg,
	    stringifyMetadata(input.metadata),
	    now,
	    now,
	  )
  return getSourceDocument(id)
}

export function getSourceDocument(id: string) {
  const row = db.prepare(`SELECT * FROM source_documents WHERE id = ?`).get(id) as SourceDocumentRow | undefined
  if (!row) return null
  const doc = mapSourceDocument(row)
  doc.importStats = getSourceDocumentImportStats(id)
  return doc
}

export function listSourceDocuments(filters: ListSourceDocumentsFilters = {}) {
  const where: string[] = []
  const values: SqlValue[] = []
  if (filters.status) {
    where.push('status = ?')
    values.push(filters.status)
  }
  if (filters.provider) {
    where.push('provider = ?')
    values.push(filters.provider)
  }
  if (filters.fileType) {
    where.push('file_type = ?')
    values.push(filters.fileType)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = normalizeLimit(filters.limit)
  const offset = normalizeOffset(filters.offset)
  const rows = db.prepare(`
    SELECT * FROM source_documents
    ${whereSql}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as SourceDocumentRow[]
  return rows.map(row => {
    const doc = mapSourceDocument(row)
    doc.importStats = getSourceDocumentImportStats(doc.id)
    return doc
  })
}

export function updateSourceDocument(id: string, input: UpdateSourceDocumentInput) {
  const assignments: string[] = []
  const values: SqlValue[] = []
  const add = (column: string, value: SqlValue | undefined) => {
    if (value === undefined) return
    assignments.push(`${column} = ?`)
    values.push(value)
  }

  add('title', input.title)
  add('original_file_name', input.originalFileName)
  add('file_path', input.filePath)
  add('file_type', input.fileType)
  add('page_count', input.pageCount === undefined ? undefined : normalizePageCount(input.pageCount))
  add('provider', input.provider)
  add('status', input.status)
  const metadata = importMetadataPatch(input as Record<string, unknown>)
  add('province', metadata.province)
  add('city', metadata.city)
  add('paper_title', metadata.paperTitle)
  add('batch_name', metadata.batchName)
  add('stage', metadata.stage)
  add('subject', metadata.subject)
  add('paper_kind', metadata.paperKind)
  add('exam_year', metadata.examYear)
	  add('source_org', metadata.sourceOrg)
	  add('metadata_json', input.metadata === undefined ? undefined : stringifyMetadata(input.metadata))

  if (!assignments.length) return getSourceDocument(id)
  add('updated_at', nowIso())
  db.prepare(`UPDATE source_documents SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id)
  return getSourceDocument(id)
}

export function getSourceDocumentImportStats(sourceDocumentId: string): SourceDocumentImportStats {
  const ocrRow = db.prepare(`
    SELECT COUNT(*) as count FROM ocr_documents WHERE source_document_id = ?
  `).get(sourceDocumentId) as { count: number } | undefined
  const ocrDocumentCount = ocrRow ? Number(ocrRow.count) : 0

  const candidateRows = db.prepare(`
    SELECT status, COUNT(*) as count FROM question_candidates WHERE source_document_id = ? GROUP BY status
  `).all(sourceDocumentId) as { status: string; count: number }[]

  let readyCount = 0
  let needsReviewCount = 0
  let needsManualFixCount = 0
  let blockedCount = 0
  let committedCount = 0

  for (const row of candidateRows) {
    const count = Number(row.count)
    if (row.status === 'ready') readyCount = count
    else if (row.status === 'needs_review') needsReviewCount = count
    else if (row.status === 'needs_manual_fix') needsManualFixCount = count
    else if (row.status === 'blocked') blockedCount = count
    else if (row.status === 'committed') committedCount = count
  }

  const candidateCount = readyCount + needsReviewCount + needsManualFixCount + blockedCount + committedCount
  const uncommittedCount = readyCount + needsReviewCount + needsManualFixCount + blockedCount
  const allCommitted = candidateCount > 0 && committedCount === candidateCount

  return {
    ocrDocumentCount,
    candidateCount,
    readyCount,
    needsReviewCount,
    needsManualFixCount,
    blockedCount,
    committedCount,
    uncommittedCount,
    allCommitted,
  }
}
