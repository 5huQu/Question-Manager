import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { normalizeGlmOCRDocument } from '../ocr-providers/glm.normalizer.js'
import { assertGlmOcrConfigured, callGlmLayoutParsing, GlmOcrProviderError } from '../ocr-providers/glm.provider.js'
import { localizeRemoteImages } from './figure-mapping.js'
import { sourceDocumentDir, writeJson, readJsonFile, writeText } from './import-flow-v2.paths.js'

export type SourceDocumentOcrTaskState = {
  sourceDocumentId: string
  provider: 'glm'
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

function sourceDocumentGlmArtifactDir(sourceDocumentId: string) {
  return path.join(sourceDocumentDir(sourceDocumentId), 'ocr', 'glm')
}

function glmRequestId(sourceDocumentId: string) {
  return `ifv2-${createHash('sha256').update(sourceDocumentId).digest('hex').slice(0, 32)}`
}

function writeSourceDocumentOcrTaskState(state: SourceDocumentOcrTaskState) {
  writeJson(sourceDocumentOcrTaskStatePath(state.sourceDocumentId), state)
}

function readSourceDocumentOcrTaskState(sourceDocumentId: string) {
  return readJsonFile<SourceDocumentOcrTaskState | null>(sourceDocumentOcrTaskStatePath(sourceDocumentId), null)
}

export async function runGlmSourceDocumentOcr(sourceDocumentId: string, initialState: SourceDocumentOcrTaskState) {
  const sourceDocument = sourceRepo.getSourceDocument(sourceDocumentId)
  if (!sourceDocument) return

  const ocrDocumentId = createId('ocrdoc', sourceDocumentId)
  const artifactDir = sourceDocumentGlmArtifactDir(sourceDocumentId)
  const startedAt = initialState.startedAt
  try {
    const inputPath = resolveStoragePath(sourceDocument.filePath)
    const result = await callGlmLayoutParsing({
      filePath: inputPath,
      requestId: glmRequestId(sourceDocumentId),
    })
    const rawPath = path.join(artifactDir, 'raw.json')
    const markdownPath = path.join(artifactDir, 'markdown.md')
    const pagesPath = path.join(artifactDir, 'pages.json')
    const assetsPath = path.join(artifactDir, 'assets.json')
    writeJson(rawPath, result.payload)

    const normalized = normalizeGlmOCRDocument(result.payload, {
      id: ocrDocumentId,
      sourceDocumentId,
      rawResultPath: assetPathFor(rawPath),
      createdAt: startedAt,
      metadata: {
        ...result.metadata,
        sourceFilePath: sourceDocument.filePath,
        storedRawJsonPath: assetPathFor(rawPath),
      },
    })
    
    await localizeRemoteImages(normalized)

    writeText(markdownPath, normalized.markdown)
    writeJson(pagesPath, normalized.pages)
    writeJson(assetsPath, normalized.assets)

    const created = ocrRepo.createOcrDocument({
      id: ocrDocumentId,
      sourceDocumentId,
      provider: 'glm',
      rawResultPath: normalized.rawResultPath,
      markdownPath: assetPathFor(markdownPath),
      blocksJsonPath: assetPathFor(pagesPath),
      assetsJsonPath: assetPathFor(assetsPath),
      metadata: normalized.metadata,
      createdAt: normalized.createdAt,
    })
    if (!created) throw new Error('OCRDocument 保存失败。')

    const finishedAt = nowIso()
    sourceRepo.updateSourceDocument(sourceDocumentId, {
      provider: 'glm',
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
      provider: 'glm',
      failedAt: finishedAt,
      message,
      details: error instanceof GlmOcrProviderError ? error.details : undefined,
    })
    sourceRepo.updateSourceDocument(sourceDocumentId, { provider: 'glm', status: 'ocr_failed' })
    writeSourceDocumentOcrTaskState({
      ...initialState,
      status: 'ocr_failed',
      finishedAt,
      error: message,
    })
  }
}

export function startSourceDocumentOcr(id: string, body: Record<string, unknown>) {
  const sourceDocument = sourceRepo.getSourceDocument(id)
  if (!sourceDocument) throw new RouteError(404, '资料不存在。')
  if (!['pdf', 'image'].includes(sourceDocument.fileType)) {
    throw new RouteError(400, '只有已上传的 PDF、JPG 或 PNG 资料可以启动 OCR。')
  }
  if (!sourceDocument.filePath || !resolveStoragePath(sourceDocument.filePath) || !fs.existsSync(resolveStoragePath(sourceDocument.filePath))) {
    throw new RouteError(400, '资料原文件不存在，无法启动 OCR。')
  }
  if (activeSourceDocumentOcrTasks.has(id) || sourceDocument.status === 'ocr_running') {
    throw new RouteError(409, '该资料的 OCR 任务正在运行。')
  }
  if (!['uploaded', 'ocr_failed'].includes(sourceDocument.status)) {
    throw new RouteError(409, '该资料已完成 OCR；请直接生成待确认题目。')
  }
  if (body.provider !== undefined && String(body.provider).toLowerCase() !== 'glm') {
    throw new RouteError(400, 'import-flow-v2 真实 OCR 当前仅支持 provider=glm。')
  }
  assertGlmOcrConfigured()

  const startedAt = nowIso()
  const taskState: SourceDocumentOcrTaskState = {
    sourceDocumentId: id,
    provider: 'glm',
    status: 'ocr_running',
    startedAt,
  }
  const updated = sourceRepo.updateSourceDocument(id, { provider: 'glm', status: 'ocr_running' })
  if (!updated) throw new RouteError(500, 'OCR 任务状态更新失败。')
  writeSourceDocumentOcrTaskState(taskState)

  const task = runGlmSourceDocumentOcr(id, taskState)
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
    task: task ? { ...task, status: sourceDocument.status } : { status: sourceDocument.status },
    ocrDocument: ocrDocument || undefined,
  }
}
