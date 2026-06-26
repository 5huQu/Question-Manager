import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { db } from '../../db/connection.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import type { OCRDocument } from '../../types/ocr-document.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { normalizeDoc2xOCRDocument } from '../ocr-providers/doc2x.normalizer.js'
import { assertDoc2xConfigured, assertDoc2xInputSupported, callDoc2xParsing, Doc2xProviderError } from '../ocr-providers/doc2x.provider.js'
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
  ocrDocumentId?: string
  startedAt: string
  finishedAt?: string
  error?: string
}

export const activeSourceDocumentOcrTasks = new Map<string, Promise<void>>()

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

function readSourceDocumentOcrTaskState(sourceDocumentId: string) {
  const statePath = sourceDocumentOcrTaskStatePath(sourceDocumentId)
  if (!fs.existsSync(statePath)) return null
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) as SourceDocumentOcrTaskState
  } catch {
    return null
  }
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

function providerErrorDetails(error: unknown) {
  return error instanceof GlmOcrProviderError || error instanceof Doc2xProviderError
    ? error.details
    : undefined
}

function deleteUncommittedCandidateDrafts(sourceDocumentId: string) {
  const rows = db.prepare(`
    SELECT id FROM question_candidates
    WHERE source_document_id = ?
      AND status != 'committed'
  `).all(sourceDocumentId) as Array<{ id: string }>
  for (const row of rows) {
    const sessionId = `sess_candidate_${row.id}`
    db.prepare('DELETE FROM pdf_slicer_annotation_regions WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM pdf_slicer_annotation_sessions WHERE id = ?').run(sessionId)
  }
  candidateRepo.deleteUncommittedQuestionCandidatesForSourceDocument(sourceDocumentId)
}

async function writeNormalizedOcrDocument(input: {
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
  const cleaned = applyWatermarkCleanup(normalized, sourceRepo.getSourceDocument(input.sourceDocumentId)?.metadata)
  const documentForStorage = cleaned.document

  writeText(markdownPath, documentForStorage.markdown)
  writeJson(pagesPath, documentForStorage.pages)
  writeJson(assetsPath, documentForStorage.assets)

  const created = ocrRepo.createOcrDocument({
    id: input.ocrDocumentId,
    sourceDocumentId: input.sourceDocumentId,
    provider: input.provider,
    rawResultPath: documentForStorage.rawResultPath,
    markdownPath: assetPathFor(markdownPath),
    blocksJsonPath: assetPathFor(pagesPath),
    assetsJsonPath: assetPathFor(assetsPath),
    metadata: documentForStorage.metadata,
    createdAt: documentForStorage.createdAt,
  })
  if (!created) throw new Error('OCRDocument 保存失败。')
  return { created, normalized: documentForStorage }
}

export async function runSourceDocumentOcr(sourceDocumentId: string, initialState: SourceDocumentOcrTaskState) {
  const sourceDocument = sourceRepo.getSourceDocument(sourceDocumentId)
  if (!sourceDocument) return

  const provider = initialState.provider
  const ocrDocumentId = createId('ocrdoc', sourceDocumentId)
  const artifactDir = sourceDocumentArtifactDir(sourceDocumentId, provider)
  const startedAt = initialState.startedAt

  try {
    const inputPath = resolveStoragePath(sourceDocument.filePath)
    const result = provider === 'doc2x'
      ? await callDoc2xParsing({ filePath: inputPath })
      : await callGlmLayoutParsing({
          filePath: inputPath,
          requestId: glmRequestId(sourceDocumentId),
        })

    const { created, normalized } = await writeNormalizedOcrDocument({
      provider,
      sourceDocumentId,
      ocrDocumentId,
      startedAt,
      artifactDir,
      payload: result.payload,
      metadata: result.metadata,
      sourceFilePath: sourceDocument.filePath,
    })

    const finishedAt = nowIso()
    sourceRepo.updateSourceDocument(sourceDocumentId, {
      provider,
      pageCount: normalized.pages.length,
      status: 'ocr_succeeded',
    })
    writeSourceDocumentOcrTaskState({
      ...initialState,
      status: 'ocr_succeeded',
      ocrDocumentId: created.id,
      finishedAt,
    })
  } catch (error) {
    const finishedAt = nowIso()
    const message = error instanceof Error ? error.message : String(error)
    writeJson(path.join(artifactDir, 'error.json'), {
      provider,
      failedAt: finishedAt,
      message,
      details: providerErrorDetails(error),
    })
    sourceRepo.updateSourceDocument(sourceDocumentId, { provider, status: 'ocr_failed' })
    writeSourceDocumentOcrTaskState({
      ...initialState,
      status: 'ocr_failed',
      finishedAt,
      error: message,
    })
  }
}

export async function runGlmSourceDocumentOcr(sourceDocumentId: string, initialState: SourceDocumentOcrTaskState) {
  return runSourceDocumentOcr(sourceDocumentId, { ...initialState, provider: 'glm' })
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
  if (activeSourceDocumentOcrTasks.has(id) || sourceDocument.status === 'ocr_running') {
    throw new RouteError(409, '该资料的 OCR 任务正在运行。')
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

  const startedAt = nowIso()
  const taskState: SourceDocumentOcrTaskState = {
    sourceDocumentId: id,
    provider,
    status: 'ocr_running',
    startedAt,
  }
  if (force) {
    deleteUncommittedCandidateDrafts(id)
  }
  const updated = sourceRepo.updateSourceDocument(id, { provider, status: 'ocr_running' })
  if (!updated) throw new RouteError(500, 'OCR 任务状态更新失败。')
  writeSourceDocumentOcrTaskState(taskState)

  const task = runSourceDocumentOcr(id, taskState)
    .finally(() => activeSourceDocumentOcrTasks.delete(id))
  activeSourceDocumentOcrTasks.set(id, task)
  void task

  return { sourceDocument: updated, task: taskState }
}

export function getSourceDocumentOcrStatus(id: string) {
  const sourceDocument = sourceRepo.getSourceDocument(id)
  if (!sourceDocument) throw new RouteError(404, '资料不存在。')
  const task = readSourceDocumentOcrTaskState(id)
  const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId: id, limit: 1 })
  return {
    sourceDocument,
    task: task || { status: sourceDocument.status, provider: sourceDocument.provider },
    ocrDocument: ocrDocument || undefined,
  }
}
