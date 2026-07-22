import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { db } from '../../db/connection.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import * as taskRepo from '../../repositories/source-document-ocr-tasks.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import * as candidateFixRepo from '../../repositories/candidate-fix-sessions.repo.js'
import type { OCRDocument } from '../../types/ocr-document.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { normalizeDoc2xOCRDocument } from '../ocr-providers/doc2x.normalizer.js'
import {
  assertDoc2xConfigured,
  assertDoc2xInputSupported,
  callDoc2xParsing,
  Doc2xProviderError,
  resumeDoc2xParsing,
} from '../ocr-providers/doc2x.provider.js'
import { normalizeGlmOCRDocument } from '../ocr-providers/glm.normalizer.js'
import { assertGlmOcrConfigured, callGlmLayoutParsing, GlmOcrProviderError } from '../ocr-providers/glm.provider.js'
import { normalizeOcrProvider, readOcrSettings } from '../settings/ocr-settings.js'
import { localizeRemoteImages } from './figure-mapping.js'
import { sourceDocumentDir, writeJson, writeText } from './import-flow-v2.paths.js'
import { applyWatermarkCleanup } from './watermark-cleanup.js'

export type SourceDocumentOcrProvider = 'doc2x' | 'glm'

export type SourceDocumentOcrTaskState = {
  sourceDocumentId: string
  provider: SourceDocumentOcrProvider
  status: 'ocr_running' | 'ocr_succeeded' | 'ocr_failed'
  taskId?: string
  attempt?: number
  lifecycleStatus?: taskRepo.SourceDocumentOcrTaskStatus
  providerTaskId?: string
  providerPhase?: string
  providerProgress?: number
  ocrDocumentId?: string
  startedAt: string
  finishedAt?: string
  error?: string
  errorCode?: string
}

const LEASE_DURATION_MS = 2 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 20 * 1000
const leaseOwner = `${os.hostname()}:${process.pid}:${randomUUID()}`
let recoveryTimer: NodeJS.Timeout | undefined

// This map only avoids duplicate scheduling inside one process. SQLite owns task consistency.
export const activeSourceDocumentOcrTasks = new Map<string, Promise<void>>()

function leaseExpiry() {
  return new Date(Date.now() + LEASE_DURATION_MS).toISOString()
}

function sourceDocumentOcrTaskStatePath(id: string) {
  return path.join(sourceDocumentDir(id), 'ocr-task.json')
}

function sourceDocumentArtifactDir(sourceDocumentId: string, provider: SourceDocumentOcrProvider) {
  return path.join(sourceDocumentDir(sourceDocumentId), 'ocr', provider)
}

function glmRequestId(sourceDocumentId: string) {
  return `ifv2-${createHash('sha256').update(sourceDocumentId).digest('hex').slice(0, 32)}`
}

function writeSourceDocumentOcrTaskState(state: SourceDocumentOcrTaskState) {
  writeJson(sourceDocumentOcrTaskStatePath(state.sourceDocumentId), state)
}

function normalizeSourceDocumentOcrProvider(value: unknown): SourceDocumentOcrProvider {
  const configured = value === undefined || value === null || String(value).trim() === ''
    ? normalizeOcrProvider(readOcrSettings().ocrProvider)
    : normalizeOcrProvider(value)
  if (configured === 'doc2x' || configured === 'glm') return configured
  throw new RouteError(400, 'import-flow-v2 真实 OCR 仅支持 provider=doc2x 或 provider=glm。')
}

function assertProviderConfigured(provider: SourceDocumentOcrProvider, inputPath: string) {
  if (provider === 'doc2x') {
    assertDoc2xConfigured()
    assertDoc2xInputSupported(inputPath)
    return
  }
  assertGlmOcrConfigured()
}

function errorCodeFor(error: unknown) {
  if (error instanceof Doc2xProviderError) return 'doc2x_provider_error'
  if (error instanceof GlmOcrProviderError) return 'glm_provider_error'
  if (error instanceof Error && (error.name === 'TimeoutError' || /timeout/i.test(error.message))) return 'provider_timeout'
  return 'ocr_execution_error'
}

function deleteUncommittedCandidateDrafts(sourceDocumentId: string) {
  const rows = db.prepare(`
    SELECT id FROM question_candidates
    WHERE source_document_id = ? AND status != 'committed'
  `).all(sourceDocumentId) as Array<{ id: string }>
  for (const row of rows) candidateFixRepo.deleteForCandidate(row.id)
  candidateRepo.deleteUncommittedQuestionCandidatesForSourceDocument(sourceDocumentId)
}

function legacyTaskState(task: taskRepo.SourceDocumentOcrTask): SourceDocumentOcrTaskState {
  const status = task.status === 'succeeded'
    ? 'ocr_succeeded'
    : task.status === 'queued' || task.status === 'running'
      ? 'ocr_running'
      : 'ocr_failed'
  return {
    sourceDocumentId: task.sourceDocumentId,
    provider: task.provider,
    status,
    taskId: task.id,
    attempt: task.attempt,
    lifecycleStatus: task.status,
    providerTaskId: task.providerTaskId || undefined,
    providerPhase: task.providerPhase || undefined,
    providerProgress: task.providerProgress,
    ocrDocumentId: task.ocrDocumentId,
    startedAt: task.startedAt || task.createdAt,
    finishedAt: task.finishedAt || undefined,
    error: task.errorMessage || undefined,
    errorCode: task.errorCode || undefined,
  }
}

async function prepareNormalizedOcrDocument(input: {
  provider: SourceDocumentOcrProvider
  sourceDocumentId: string
  ocrDocumentId: string
  startedAt: string
  artifactDir: string
  payload: unknown
  metadata: Record<string, unknown>
  sourceFilePath: string
}) {
  const rawPath = path.join(input.artifactDir, 'raw.json')
  const markdownPath = path.join(input.artifactDir, 'markdown.md')
  const pagesPath = path.join(input.artifactDir, 'pages.json')
  const assetsPath = path.join(input.artifactDir, 'assets.json')
  writeJson(rawPath, input.payload)

  const options = {
    id: input.ocrDocumentId,
    sourceDocumentId: input.sourceDocumentId,
    rawResultPath: assetPathFor(rawPath),
    createdAt: input.startedAt,
    metadata: {
      ...input.metadata,
      sourceFilePath: input.sourceFilePath,
      storedRawJsonPath: assetPathFor(rawPath),
    },
  }
  const normalized: OCRDocument = input.provider === 'doc2x'
    ? normalizeDoc2xOCRDocument(input.payload, options)
    : normalizeGlmOCRDocument(input.payload, options)

  await localizeRemoteImages(normalized)
  const documentForStorage = applyWatermarkCleanup(
    normalized,
    sourceRepo.getSourceDocument(input.sourceDocumentId)?.metadata,
  ).document
  writeText(markdownPath, documentForStorage.markdown)
  writeJson(pagesPath, documentForStorage.pages)
  writeJson(assetsPath, documentForStorage.assets)

  return {
    document: documentForStorage,
    paths: { rawPath, markdownPath, pagesPath, assetsPath },
    rawSha256: createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex'),
  }
}

function startHeartbeat(taskId: string) {
  const timer = setInterval(() => {
    taskRepo.heartbeatTask(taskId, leaseOwner, leaseExpiry())
  }, HEARTBEAT_INTERVAL_MS)
  timer.unref()
  return timer
}

async function executeTask(task: taskRepo.SourceDocumentOcrTask, options: { resumeProvider?: boolean } = {}) {
  const sourceDocument = sourceRepo.getSourceDocument(task.sourceDocumentId)
  if (!sourceDocument) return
  const artifactDir = sourceDocumentArtifactDir(task.sourceDocumentId, task.provider)
  const ocrDocumentId = createId('ocrdoc', task.sourceDocumentId)
  const heartbeat = startHeartbeat(task.id)

  try {
    const inputPath = resolveStoragePath(sourceDocument.filePath)
    const onDoc2xProgress = (progress: { uid: string; phase: string; progress: number }) => {
      taskRepo.heartbeatTask(task.id, leaseOwner, leaseExpiry(), {
        providerTaskId: progress.uid,
        providerPhase: progress.phase,
        providerProgress: progress.progress,
      })
    }
    const result = task.provider === 'doc2x'
      ? options.resumeProvider && task.providerTaskId
        ? await resumeDoc2xParsing({ uid: task.providerTaskId, onProgress: onDoc2xProgress })
        : await callDoc2xParsing({ filePath: inputPath, onProgress: onDoc2xProgress })
      : await callGlmLayoutParsing({ filePath: inputPath, requestId: glmRequestId(task.sourceDocumentId) })

    const prepared = await prepareNormalizedOcrDocument({
      provider: task.provider,
      sourceDocumentId: task.sourceDocumentId,
      ocrDocumentId,
      startedAt: task.startedAt || nowIso(),
      artifactDir,
      payload: result.payload,
      metadata: result.metadata,
      sourceFilePath: sourceDocument.filePath,
    })

    db.exec('BEGIN IMMEDIATE')
    try {
      const current = taskRepo.getTask(task.id)
      if (!current || current.status !== 'running' || current.leaseOwner !== leaseOwner) {
        throw new Error('OCR task lease was lost before completion.')
      }
      const created = ocrRepo.createOcrDocument({
        id: ocrDocumentId,
        sourceDocumentId: task.sourceDocumentId,
        provider: task.provider,
        rawResultPath: prepared.document.rawResultPath,
        markdownPath: assetPathFor(prepared.paths.markdownPath),
        blocksJsonPath: assetPathFor(prepared.paths.pagesPath),
        assetsJsonPath: assetPathFor(prepared.paths.assetsPath),
        metadata: prepared.document.metadata,
        createdAt: prepared.document.createdAt,
      })
      if (!created) throw new Error('OCRDocument 保存失败。')
      const updated = sourceRepo.updateSourceDocument(task.sourceDocumentId, {
        provider: task.provider,
        pageCount: prepared.document.pages.length,
        status: 'ocr_succeeded',
      })
      if (!updated) throw new Error('SourceDocument OCR 成功状态更新失败。')
      const completed = taskRepo.completeTask(task.id, leaseOwner, created.id, {
        artifactPaths: {
          raw: assetPathFor(prepared.paths.rawPath),
          markdown: assetPathFor(prepared.paths.markdownPath),
          pages: assetPathFor(prepared.paths.pagesPath),
          assets: assetPathFor(prepared.paths.assetsPath),
        },
        rawSha256: prepared.rawSha256,
      })
      if (!completed) throw new Error('OCR task completion state update failed.')
      db.exec('COMMIT')
      writeSourceDocumentOcrTaskState(legacyTaskState(completed))
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const errorCode = errorCodeFor(error)
    writeJson(path.join(artifactDir, 'error.json'), { provider: task.provider, failedAt: nowIso(), errorCode, message })
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = taskRepo.getTask(task.id)
      if (current?.status === 'running' && current.leaseOwner === leaseOwner) {
        const updated = sourceRepo.updateSourceDocument(task.sourceDocumentId, { provider: task.provider, status: 'ocr_failed' })
        if (!updated) throw new Error('SourceDocument OCR failure state update failed.')
        const failed = taskRepo.failTask(task.id, leaseOwner, errorCode, message)
        if (!failed) throw new Error('OCR task failure state update failed.')
        db.exec('COMMIT')
        writeSourceDocumentOcrTaskState(legacyTaskState(failed))
      } else {
        db.exec('COMMIT')
      }
    } catch (failureUpdateError) {
      if (db.isTransaction) db.exec('ROLLBACK')
      console.error('Failed to persist OCR task failure:', failureUpdateError)
    }
  } finally {
    clearInterval(heartbeat)
  }
}

function scheduleTask(task: taskRepo.SourceDocumentOcrTask, options: { resumeProvider?: boolean } = {}) {
  const promise = executeTask(task, options).finally(() => activeSourceDocumentOcrTasks.delete(task.sourceDocumentId))
  activeSourceDocumentOcrTasks.set(task.sourceDocumentId, promise)
  void promise
}

export async function runSourceDocumentOcr(sourceDocumentId: string, initialState: SourceDocumentOcrTaskState) {
  const task = initialState.taskId ? taskRepo.getTask(initialState.taskId) : taskRepo.getActiveTask(sourceDocumentId)
  if (task) await executeTask(task)
}

export async function runGlmSourceDocumentOcr(sourceDocumentId: string, initialState: SourceDocumentOcrTaskState) {
  return runSourceDocumentOcr(sourceDocumentId, { ...initialState, provider: 'glm' })
}

export function hasActiveSourceDocumentOcrTask(sourceDocumentId: string) {
  return Boolean(taskRepo.getActiveTask(sourceDocumentId))
}

export function startSourceDocumentOcr(id: string, body: Record<string, unknown>) {
  const sourceDocument = sourceRepo.getSourceDocument(id)
  if (!sourceDocument) throw new RouteError(404, '资料不存在。')
  if (!['pdf', 'image'].includes(sourceDocument.fileType)) {
    throw new RouteError(400, '只有已上传的 PDF、JPG 或 PNG 资料可以启动 OCR。')
  }
  const inputPath = resolveStoragePath(sourceDocument.filePath)
  if (!sourceDocument.filePath || !inputPath || !fs.existsSync(inputPath)) {
    throw new RouteError(400, '资料原文件不存在，无法启动 OCR。')
  }
  const force = body.force === true
  if (!force && !['uploaded', 'ocr_failed'].includes(sourceDocument.status)) {
    throw new RouteError(409, '该资料已完成 OCR；请直接生成待确认题目。')
  }
  if (force && (sourceDocument.importStats?.committedCount || 0) > 0) {
    throw new RouteError(409, '该批次已有题目入库，暂不支持重新识别。')
  }

  const provider = normalizeSourceDocumentOcrProvider(body.provider)
  try {
    assertProviderConfigured(provider, inputPath)
  } catch (error) {
    if (error instanceof Doc2xProviderError || error instanceof GlmOcrProviderError) {
      throw new RouteError(400, error.message)
    }
    throw error
  }

  let claimed: taskRepo.SourceDocumentOcrTask | null = null
  db.exec('BEGIN IMMEDIATE')
  try {
    if (taskRepo.getActiveTask(id)) throw new RouteError(409, '该资料的 OCR 任务正在运行。')
    if (force) deleteUncommittedCandidateDrafts(id)
    const queued = taskRepo.createQueuedTask({ sourceDocumentId: id, provider })
    claimed = taskRepo.claimTask(queued.id, leaseOwner, leaseExpiry())
    if (!claimed) throw new Error('OCR task claim failed.')
    const updated = sourceRepo.updateSourceDocument(id, { provider, status: 'ocr_running' })
    if (!updated) throw new Error('OCR 任务状态更新失败。')
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    if (error instanceof RouteError) throw error
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      throw new RouteError(409, '该资料的 OCR 任务正在运行。')
    }
    throw error
  }

  const taskState = legacyTaskState(claimed)
  writeSourceDocumentOcrTaskState(taskState)
  scheduleTask(claimed)
  return { sourceDocument: sourceRepo.getSourceDocument(id), task: taskState }
}

export function getSourceDocumentOcrStatus(id: string) {
  const sourceDocument = sourceRepo.getSourceDocument(id)
  if (!sourceDocument) throw new RouteError(404, '资料不存在。')
  const task = taskRepo.getLatestTask(id)
  const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId: id, limit: 1 })
  return {
    sourceDocument,
    task: task ? legacyTaskState(task) : { status: sourceDocument.status, provider: sourceDocument.provider },
    ocrDocument: ocrDocument || undefined,
  }
}

function scheduleRecoveryAt(iso: string) {
  const delay = Math.max(25, Date.parse(iso) - Date.now() + 25)
  if (recoveryTimer) clearTimeout(recoveryTimer)
  recoveryTimer = setTimeout(() => recoverInterruptedSourceDocumentOcrTasks(), delay)
  recoveryTimer.unref()
}

export function recoverInterruptedSourceDocumentOcrTasks() {
  const now = nowIso()
  let nextLeaseExpiry = ''
  for (const task of taskRepo.listActiveTasks()) {
    const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId: task.sourceDocumentId, limit: 10 })
      .filter((document) => document.createdAt >= (task.startedAt || task.createdAt))
    if (ocrDocument) {
      db.exec('BEGIN IMMEDIATE')
      try {
        taskRepo.repairTaskSucceeded(task.id, ocrDocument.id)
        sourceRepo.updateSourceDocument(task.sourceDocumentId, { provider: task.provider, status: 'ocr_succeeded' })
        db.exec('COMMIT')
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK')
        throw error
      }
      continue
    }
    if (task.status === 'running' && task.leaseExpiresAt > now) {
      if (!nextLeaseExpiry || task.leaseExpiresAt < nextLeaseExpiry) nextLeaseExpiry = task.leaseExpiresAt
      continue
    }
    if (task.status === 'running' && task.provider === 'doc2x' && task.providerTaskId) {
      const reclaimed = taskRepo.reclaimExpiredTask(task.id, leaseOwner, leaseExpiry(), now)
      if (reclaimed) scheduleTask(reclaimed, { resumeProvider: true })
      continue
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      const interrupted = taskRepo.interruptTask(task.id, 'process_interrupted', 'OCR task was interrupted before completion.')
      if (interrupted) {
        sourceRepo.updateSourceDocument(task.sourceDocumentId, { provider: task.provider, status: 'ocr_failed' })
        writeSourceDocumentOcrTaskState(legacyTaskState(interrupted))
      }
      db.exec('COMMIT')
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }
  if (nextLeaseExpiry) scheduleRecoveryAt(nextLeaseExpiry)
}

export function interruptOwnedSourceDocumentOcrTasks() {
  for (const task of taskRepo.listActiveTasks()) {
    if (task.leaseOwner !== leaseOwner) continue
    const interrupted = taskRepo.interruptTask(task.id, 'process_shutdown', 'OCR task interrupted during graceful shutdown.')
    if (interrupted) sourceRepo.updateSourceDocument(task.sourceDocumentId, { provider: task.provider, status: 'ocr_failed' })
  }
}
