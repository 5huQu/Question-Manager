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
import type { SourceDocumentImportStats, SourceDocumentRow } from '../types/source-document.js'

type SqlValue = string | number | bigint | null | Buffer

const IMPORT_JOB_MODES: ImportJobMode[] = ['single_document', 'separated_documents']
const IMPORT_JOB_STATUSES: ImportJobStatus[] = ['draft', 'parsing', 'parsed', 'partially_parsed', 'failed', 'deleting']
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
  const owner = db.prepare(`
    SELECT job_id FROM import_job_documents
    WHERE source_document_id = ?
    LIMIT 1
  `).get(input.sourceDocumentId) as { job_id: string } | undefined
  if (owner) throw new Error(`Source document ${input.sourceDocumentId} already belongs to import job ${owner.job_id}`)
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

export function transferSourceDocumentOwnership(input: {
  sourceDocumentId: string
  fromJobId: string
  toJobId: string
  role?: ImportJobDocumentRole
}) {
  const now = nowIso()
  const result = db.prepare(`
    UPDATE import_job_documents
    SET job_id = ?, role = COALESCE(?, role), updated_at = ?
    WHERE source_document_id = ? AND job_id = ?
  `).run(
    input.toJobId,
    input.role === undefined ? null : normalizeImportJobDocumentRole(input.role),
    now,
    input.sourceDocumentId,
    input.fromJobId,
  )
  if (!result.changes) return null
  touchImportJob(input.fromJobId)
  touchImportJob(input.toJobId)
  const row = db.prepare('SELECT * FROM import_job_documents WHERE source_document_id = ?').get(input.sourceDocumentId) as ImportJobDocumentRow
  return mapImportJobDocument(row)
}

export type ImportJobDocumentStatsRow = SourceDocumentRow & {
  document_link_id: string
  document_job_id: string
  document_role: ImportJobDocumentRole
  document_sort_order: number
  document_created_at: string
  document_updated_at: string
  ocr_document_count: number
  candidate_count: number
  ready_count: number
  needs_review_count: number
  needs_manual_fix_count: number
  blocked_count: number
  committed_count: number
  parse_diagnostic_count: number
  metadata_like_answer_count: number
  missing_analysis_diagnostic_count: number
  unmatched_solution_diagnostic_count: number
}

export function listImportJobDocumentStats(jobIds: string[]) {
  if (!jobIds.length) return []
  const params = jobIds.map(() => '?').join(', ')
  return db.prepare(`
    WITH candidate_stats AS (
      SELECT
        source_document_id,
        SUM(CASE WHEN status IN ('ready', 'needs_review', 'needs_manual_fix', 'blocked', 'committed') THEN 1 ELSE 0 END) AS candidate_count,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
        SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review_count,
        SUM(CASE WHEN status = 'needs_manual_fix' THEN 1 ELSE 0 END) AS needs_manual_fix_count,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_count,
        SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END) AS committed_count,
        SUM(CASE WHEN parse_diagnostics_json != '' AND parse_diagnostics_json != '[]' THEN 1 ELSE 0 END) AS parse_diagnostic_count,
        SUM(CASE WHEN parse_diagnostics_json LIKE '%metadata_used_as_answer%' THEN 1 ELSE 0 END) AS metadata_like_answer_count,
        SUM(CASE WHEN parse_diagnostics_json LIKE '%missing_analysis%' THEN 1 ELSE 0 END) AS missing_analysis_diagnostic_count,
        SUM(CASE WHEN parse_diagnostics_json LIKE '%unmatched_solution%' OR parse_diagnostics_json LIKE '%solution_heading_without_following_question%' THEN 1 ELSE 0 END) AS unmatched_solution_diagnostic_count
      FROM question_candidates
      GROUP BY source_document_id
    ),
    ocr_stats AS (
      SELECT source_document_id, COUNT(*) AS ocr_document_count
      FROM ocr_documents
      GROUP BY source_document_id
    )
    SELECT
      sd.*,
      d.id AS document_link_id,
      d.job_id AS document_job_id,
      d.role AS document_role,
      d.sort_order AS document_sort_order,
      d.created_at AS document_created_at,
      d.updated_at AS document_updated_at,
      COALESCE(os.ocr_document_count, 0) AS ocr_document_count,
      COALESCE(cs.candidate_count, 0) AS candidate_count,
      COALESCE(cs.ready_count, 0) AS ready_count,
      COALESCE(cs.needs_review_count, 0) AS needs_review_count,
      COALESCE(cs.needs_manual_fix_count, 0) AS needs_manual_fix_count,
      COALESCE(cs.blocked_count, 0) AS blocked_count,
      COALESCE(cs.committed_count, 0) AS committed_count,
      COALESCE(cs.parse_diagnostic_count, 0) AS parse_diagnostic_count,
      COALESCE(cs.metadata_like_answer_count, 0) AS metadata_like_answer_count,
      COALESCE(cs.missing_analysis_diagnostic_count, 0) AS missing_analysis_diagnostic_count,
      COALESCE(cs.unmatched_solution_diagnostic_count, 0) AS unmatched_solution_diagnostic_count
    FROM import_job_documents d
    JOIN source_documents sd ON sd.id = d.source_document_id
    LEFT JOIN candidate_stats cs ON cs.source_document_id = sd.id
    LEFT JOIN ocr_stats os ON os.source_document_id = sd.id
    WHERE d.job_id IN (${params})
    ORDER BY d.job_id, d.sort_order ASC, d.created_at ASC
  `).all(...jobIds) as ImportJobDocumentStatsRow[]
}

export function sourceDocumentImportStatsFromRow(row: ImportJobDocumentStatsRow): SourceDocumentImportStats {
  const candidateCount = Number(row.candidate_count || 0)
  const committedCount = Number(row.committed_count || 0)
  const readyCount = Number(row.ready_count || 0)
  const needsReviewCount = Number(row.needs_review_count || 0)
  const needsManualFixCount = Number(row.needs_manual_fix_count || 0)
  const blockedCount = Number(row.blocked_count || 0)
  return {
    ocrDocumentCount: Number(row.ocr_document_count || 0),
    candidateCount,
    readyCount,
    needsReviewCount,
    needsManualFixCount,
    blockedCount,
    committedCount,
    uncommittedCount: readyCount + needsReviewCount + needsManualFixCount + blockedCount,
    allCommitted: candidateCount > 0 && committedCount === candidateCount,
    parseDiagnosticCount: Number(row.parse_diagnostic_count || 0),
    metadataLikeAnswerCount: Number(row.metadata_like_answer_count || 0),
    missingAnalysisDiagnosticCount: Number(row.missing_analysis_diagnostic_count || 0),
    unmatchedSolutionDiagnosticCount: Number(row.unmatched_solution_diagnostic_count || 0),
  }
}

export function countQuestionsForImportJobList(jobIds: string[], legacyImportSourceIds: string[]) {
  if (!jobIds.length) return { byJobId: new Map<string, number>(), byLegacyImportSourceId: new Map<string, number>() }
  const jobParams = jobIds.map(() => '?').join(', ')
  const sourceParams = legacyImportSourceIds.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT import_job_id, import_source_id, COUNT(*) AS count
    FROM question_bank_items
    WHERE bank_status != 'skipped'
      AND (import_job_id IN (${jobParams}) OR (import_job_id IS NULL AND import_source_id IN (${sourceParams})))
    GROUP BY import_job_id, import_source_id
  `).all(...jobIds, ...legacyImportSourceIds) as Array<{ import_job_id: string | null; import_source_id: string; count: number }>
  const byJobId = new Map<string, number>()
  const byLegacyImportSourceId = new Map<string, number>()
  for (const row of rows) {
    const count = Number(row.count || 0)
    if (row.import_job_id) byJobId.set(row.import_job_id, (byJobId.get(row.import_job_id) || 0) + count)
    else byLegacyImportSourceId.set(row.import_source_id, (byLegacyImportSourceId.get(row.import_source_id) || 0) + count)
  }
  return { byJobId, byLegacyImportSourceId }
}
