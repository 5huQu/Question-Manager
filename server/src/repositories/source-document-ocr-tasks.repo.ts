import { db } from '../db/connection.js'
import { createId, nowIso } from '../utils/ids.js'
import { parseJson } from '../utils/json.js'

export type SourceDocumentOcrTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

export type SourceDocumentOcrTask = {
  id: string
  sourceDocumentId: string
  provider: 'doc2x' | 'glm'
  status: SourceDocumentOcrTaskStatus
  attempt: number
  providerTaskId: string
  providerPhase: string
  providerProgress: number
  startedAt: string
  finishedAt: string
  heartbeatAt: string
  leaseOwner: string
  leaseExpiresAt: string
  ocrDocumentId?: string
  errorCode: string
  errorMessage: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type TaskRow = {
  id: string
  source_document_id: string
  provider: 'doc2x' | 'glm'
  status: SourceDocumentOcrTaskStatus
  attempt: number
  provider_task_id: string
  provider_phase: string
  provider_progress: number
  started_at: string
  finished_at: string
  heartbeat_at: string
  lease_owner: string
  lease_expires_at: string
  ocr_document_id: string | null
  error_code: string
  error_message: string
  metadata_json: string
  created_at: string
  updated_at: string
}

function mapTask(row: TaskRow): SourceDocumentOcrTask {
  return {
    id: row.id,
    sourceDocumentId: row.source_document_id,
    provider: row.provider,
    status: row.status,
    attempt: Number(row.attempt),
    providerTaskId: row.provider_task_id,
    providerPhase: row.provider_phase,
    providerProgress: Number(row.provider_progress || 0),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    heartbeatAt: row.heartbeat_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    ocrDocumentId: row.ocr_document_id || undefined,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json || '{}', {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getTask(id: string) {
  const row = db.prepare('SELECT * FROM source_document_ocr_tasks WHERE id = ?').get(id) as TaskRow | undefined
  return row ? mapTask(row) : null
}

export function getLatestTask(sourceDocumentId: string) {
  const row = db.prepare(`
    SELECT * FROM source_document_ocr_tasks
    WHERE source_document_id = ?
    ORDER BY attempt DESC
    LIMIT 1
  `).get(sourceDocumentId) as TaskRow | undefined
  return row ? mapTask(row) : null
}

export function getActiveTask(sourceDocumentId: string) {
  const row = db.prepare(`
    SELECT * FROM source_document_ocr_tasks
    WHERE source_document_id = ? AND status IN ('queued', 'running')
    ORDER BY attempt DESC
    LIMIT 1
  `).get(sourceDocumentId) as TaskRow | undefined
  return row ? mapTask(row) : null
}

export function createQueuedTask(input: {
  sourceDocumentId: string
  provider: 'doc2x' | 'glm'
  metadata?: Record<string, unknown>
}) {
  const now = nowIso()
  const attemptRow = db.prepare(`
    SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt
    FROM source_document_ocr_tasks WHERE source_document_id = ?
  `).get(input.sourceDocumentId) as { attempt: number }
  const id = createId('ocrtask', input.sourceDocumentId)
  db.prepare(`
    INSERT INTO source_document_ocr_tasks (
      id, source_document_id, provider, status, attempt, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)
  `).run(id, input.sourceDocumentId, input.provider, Number(attemptRow.attempt), JSON.stringify(input.metadata || {}), now, now)
  return getTask(id)!
}

export function claimTask(id: string, leaseOwner: string, leaseExpiresAt: string) {
  const now = nowIso()
  const result = db.prepare(`
    UPDATE source_document_ocr_tasks
    SET status = 'running', started_at = CASE WHEN started_at = '' THEN ? ELSE started_at END,
        heartbeat_at = ?, lease_owner = ?, lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'queued'
  `).run(now, now, leaseOwner, leaseExpiresAt, now, id)
  return Number(result.changes) === 1 ? getTask(id) : null
}

export function reclaimExpiredTask(id: string, leaseOwner: string, leaseExpiresAt: string, now = nowIso()) {
  const result = db.prepare(`
    UPDATE source_document_ocr_tasks
    SET heartbeat_at = ?, lease_owner = ?, lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running' AND lease_expires_at != '' AND lease_expires_at <= ?
  `).run(now, leaseOwner, leaseExpiresAt, now, id, now)
  return Number(result.changes) === 1 ? getTask(id) : null
}

export function heartbeatTask(id: string, leaseOwner: string, leaseExpiresAt: string, progress?: {
  providerTaskId?: string
  providerPhase?: string
  providerProgress?: number
}) {
  const now = nowIso()
  const result = db.prepare(`
    UPDATE source_document_ocr_tasks
    SET heartbeat_at = ?, lease_expires_at = ?,
        provider_task_id = COALESCE(?, provider_task_id),
        provider_phase = COALESCE(?, provider_phase),
        provider_progress = COALESCE(?, provider_progress),
        updated_at = ?
    WHERE id = ? AND status = 'running' AND lease_owner = ?
  `).run(
    now,
    leaseExpiresAt,
    progress?.providerTaskId ?? null,
    progress?.providerPhase ?? null,
    progress?.providerProgress ?? null,
    now,
    id,
    leaseOwner,
  )
  return Number(result.changes) === 1
}

export function completeTask(id: string, leaseOwner: string, ocrDocumentId: string, metadata: Record<string, unknown>) {
  const now = nowIso()
  const result = db.prepare(`
    UPDATE source_document_ocr_tasks
    SET status = 'succeeded', ocr_document_id = ?, provider_phase = 'succeeded', provider_progress = 100,
        metadata_json = ?, finished_at = ?, heartbeat_at = ?, lease_owner = '', lease_expires_at = '', updated_at = ?
    WHERE id = ? AND status = 'running' AND lease_owner = ?
  `).run(ocrDocumentId, JSON.stringify(metadata), now, now, now, id, leaseOwner)
  return Number(result.changes) === 1 ? getTask(id) : null
}

export function failTask(id: string, leaseOwner: string, errorCode: string, errorMessage: string, metadata: Record<string, unknown> = {}) {
  const now = nowIso()
  const result = db.prepare(`
    UPDATE source_document_ocr_tasks
    SET status = 'failed', error_code = ?, error_message = ?, metadata_json = ?,
        finished_at = ?, heartbeat_at = ?, lease_owner = '', lease_expires_at = '', updated_at = ?
    WHERE id = ? AND status = 'running' AND lease_owner = ?
  `).run(errorCode, errorMessage, JSON.stringify(metadata), now, now, now, id, leaseOwner)
  return Number(result.changes) === 1 ? getTask(id) : null
}

export function interruptTask(id: string, errorCode: string, errorMessage: string) {
  const now = nowIso()
  const result = db.prepare(`
    UPDATE source_document_ocr_tasks
    SET status = 'interrupted', error_code = ?, error_message = ?, finished_at = ?,
        lease_owner = '', lease_expires_at = '', updated_at = ?
    WHERE id = ? AND status IN ('queued', 'running')
  `).run(errorCode, errorMessage, now, now, id)
  return Number(result.changes) === 1 ? getTask(id) : null
}

export function repairTaskSucceeded(id: string, ocrDocumentId: string) {
  const now = nowIso()
  db.prepare(`
    UPDATE source_document_ocr_tasks
    SET status = 'succeeded', ocr_document_id = ?, provider_phase = 'succeeded', provider_progress = 100,
        error_code = '', error_message = '', finished_at = CASE WHEN finished_at = '' THEN ? ELSE finished_at END,
        lease_owner = '', lease_expires_at = '', updated_at = ?
    WHERE id = ? AND status IN ('queued', 'running')
  `).run(ocrDocumentId, now, now, id)
  return getTask(id)
}

export function listActiveTasks() {
  return (db.prepare(`
    SELECT * FROM source_document_ocr_tasks
    WHERE status IN ('queued', 'running')
    ORDER BY created_at
  `).all() as TaskRow[]).map(mapTask)
}
