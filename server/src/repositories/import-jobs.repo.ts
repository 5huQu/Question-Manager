import { db } from '../db/connection.js'
import type {
  CreateImportJobDocumentInput,
  CreateImportJobInput,
  ImportJob,
  ImportJobDocument,
  ImportJobDocumentRow,
  ImportJobDocumentRole,
  ImportJobMode,
  ImportJobRow,
  ImportJobStatus,
  UpdateImportJobInput,
} from '../types/import-job.js'
import { createId, nowIso } from '../utils/ids.js'
import { importMetadataPatch, normalizeImportMetadata } from '../utils/import-metadata.js'

type SqlValue = string | number | bigint | null | Buffer

const IMPORT_JOB_MODES: ImportJobMode[] = ['single_document', 'separated_documents']
const IMPORT_JOB_STATUSES: ImportJobStatus[] = ['draft', 'parsing', 'parsed', 'partially_parsed', 'failed']
const IMPORT_JOB_DOCUMENT_ROLES: ImportJobDocumentRole[] = ['full', 'questions', 'solutions']

export function normalizeImportJobMode(value: unknown): ImportJobMode {
  const text = String(value || '').trim()
  return IMPORT_JOB_MODES.includes(text as ImportJobMode) ? text as ImportJobMode : 'single_document'
}

export function normalizeImportJobStatus(value: unknown): ImportJobStatus {
  const text = String(value || '').trim()
  return IMPORT_JOB_STATUSES.includes(text as ImportJobStatus) ? text as ImportJobStatus : 'draft'
}

export function normalizeImportJobDocumentRole(value: unknown): ImportJobDocumentRole {
  const text = String(value || '').trim()
  return IMPORT_JOB_DOCUMENT_ROLES.includes(text as ImportJobDocumentRole) ? text as ImportJobDocumentRole : 'full'
}

function normalizeSortOrder(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

export function mapImportJob(row: ImportJobRow): ImportJob {
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
    title: row.title,
    mode: normalizeImportJobMode(row.mode),
    status: normalizeImportJobStatus(row.status),
    ...metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapImportJobDocument(row: ImportJobDocumentRow): ImportJobDocument {
  return {
    id: row.id,
    jobId: row.job_id,
    sourceDocumentId: row.source_document_id,
    role: normalizeImportJobDocumentRole(row.role),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createImportJob(input: CreateImportJobInput) {
  const now = nowIso()
  const id = input.id || createId('ifv2job')
  const metadata = normalizeImportMetadata(input as Record<string, unknown>)
  db.prepare(`
    INSERT INTO import_jobs (
      id, title, mode, status, province, city, paper_title, batch_name, stage, subject, paper_kind, exam_year, source_org, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(input.title || ''),
    normalizeImportJobMode(input.mode),
    normalizeImportJobStatus(input.status),
    metadata.province,
    metadata.city,
    metadata.paperTitle,
    metadata.batchName,
    metadata.stage,
    metadata.subject,
    metadata.paperKind,
    metadata.examYear,
    metadata.sourceOrg,
    now,
    now,
  )
  return getImportJob(id)
}

export function getImportJob(id: string) {
  const row = db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id) as ImportJobRow | undefined
  return row ? mapImportJob(row) : null
}

export function updateImportJob(id: string, input: UpdateImportJobInput) {
  const assignments: string[] = []
  const values: SqlValue[] = []
  const add = (column: string, value: SqlValue | undefined) => {
    if (value === undefined) return
    assignments.push(`${column} = ?`)
    values.push(value)
  }

  add('title', input.title)
  add('mode', input.mode === undefined ? undefined : normalizeImportJobMode(input.mode))
  add('status', input.status === undefined ? undefined : normalizeImportJobStatus(input.status))
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

  if (!assignments.length) return getImportJob(id)
  add('updated_at', nowIso())
  db.prepare(`UPDATE import_jobs SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id)
  return getImportJob(id)
}

export function touchImportJob(id: string) {
  db.prepare('UPDATE import_jobs SET updated_at = ? WHERE id = ?').run(nowIso(), id)
  return getImportJob(id)
}

export function addSourceDocumentToImportJob(input: CreateImportJobDocumentInput) {
  const now = nowIso()
  const id = input.id || createId('ifv2jobdoc')
  db.prepare(`
    INSERT INTO import_job_documents (
      id, job_id, source_document_id, role, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.jobId,
    input.sourceDocumentId,
    normalizeImportJobDocumentRole(input.role),
    normalizeSortOrder(input.sortOrder),
    now,
    now,
  )
  touchImportJob(input.jobId)
  return getImportJobDocument(id)
}

export function getImportJobDocument(id: string) {
  const row = db.prepare('SELECT * FROM import_job_documents WHERE id = ?').get(id) as ImportJobDocumentRow | undefined
  return row ? mapImportJobDocument(row) : null
}

export function listImportJobDocuments(jobId: string) {
  const rows = db.prepare(`
    SELECT * FROM import_job_documents
    WHERE job_id = ?
    ORDER BY sort_order ASC, created_at ASC
  `).all(jobId) as ImportJobDocumentRow[]
  return rows.map(mapImportJobDocument)
}
