import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir, storageRoot } from '../../config.js'
import { createQuestion, getQuestion } from '../../db/questions.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import type { OCRAsset, OCRDocument, OCRPage } from '../../types/ocr-document.js'
import type { CandidateFigure, QuestionCandidate, UpdateQuestionCandidateInput } from '../../types/question-candidate.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { parseJson } from '../../utils/json.js'
import { difficultyLabel10, normalizeDifficultyScore10 } from '../../utils/search.js'
import { inferQuestionType } from '../../utils/question-type.js'
import { parseQuestionCandidates } from '../question-parser/index.js'
import { normalizeGlmOCRDocument } from '../ocr-providers/glm.normalizer.js'
import { ensureOcrDocumentFiguresAndPlaceholders } from '../ocr-providers/ocr-document.normalizer.js'
import { assertGlmOcrConfigured, callGlmLayoutParsing, GlmOcrProviderError } from '../ocr-providers/glm.provider.js'
import { normalizeTags } from '../tags/tag-libraries.js'
import { normalizeUploadName } from '../../utils/ocr-helpers.js'

function importDataDir() {
  const dir = path.join(dataDir, 'import-flow-v2')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function writeText(filePath: string, value: string) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, value, 'utf8')
}

function readText(portablePath: string) {
  const target = resolveStoragePath(portablePath)
  if (!target || !fs.existsSync(target)) return ''
  return fs.readFileSync(target, 'utf8')
}

function readJsonFile<T>(portablePath: string, fallback: T): T {
  const target = resolveStoragePath(portablePath)
  if (!target || !fs.existsSync(target)) return fallback
  return parseJson<T>(fs.readFileSync(target, 'utf8'), fallback)
}

function normalizeProvider(value: unknown): 'doc2x' | 'glm' {
  return String(value || '').toLowerCase() === 'glm' ? 'glm' : 'doc2x'
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function normalizeOCRDocumentPayload(rawValue: unknown, fallbackSourceDocumentId: string): OCRDocument {
  const raw = asRecord(rawValue)
  const provider = normalizeProvider(raw.provider)
  return {
    id: String(raw.id || ''),
    sourceDocumentId: String(raw.sourceDocumentId || raw.source_document_id || fallbackSourceDocumentId),
    provider,
    rawResultPath: String(raw.rawResultPath || raw.raw_result_path || ''),
    markdown: String(raw.markdown || ''),
    pages: Array.isArray(raw.pages) ? raw.pages as OCRPage[] : [],
    assets: Array.isArray(raw.assets) ? raw.assets as OCRAsset[] : [],
    metadata: asRecord(raw.metadata),
    createdAt: String(raw.createdAt || raw.created_at || new Date().toISOString()),
  }
}

function candidateStatusCounts(candidates: QuestionCandidate[]) {
  return {
    candidateCount: candidates.length,
    readyCount: candidates.filter((item) => item.status === 'ready').length,
    needsReviewCount: candidates.filter((item) => item.status === 'needs_review').length,
    needsManualFixCount: candidates.filter((item) => item.status === 'needs_manual_fix').length,
    blockedCount: candidates.filter((item) => item.status === 'blocked' || item.status === 'needs_manual_fix').length,
  }
}

function bboxRecord(bbox: CandidateFigure['bbox']) {
  if (!bbox) return undefined
  return { x: bbox[0], y: bbox[1], width: bbox[2] - bbox[0], height: bbox[3] - bbox[1] }
}

export function figuresForQuestionBank(figures: CandidateFigure[]) {
  return figures.map((figure) => ({
    id: figure.id,
    blockId: figure.blockId || figure.sourceBlockId,
    origin: 'import_flow_v2',
    usage: figure.usage,
    category: figure.usage === 'analysis' ? 'analysis' : 'question',
    pageNumber: figure.pageNo,
    bbox: bboxRecord(figure.bbox),
    sourcePath: figure.path,
    path: figure.path,
  }))
}

export type OcrFigureDiagnostics = {
  placeholderCount: number
  assetsCount: number
  unmatchedPlaceholderCount: number
  unusedAssetsCount: number
  failedDownloadCount: number
}

export function getOcrFigureDiagnostics(ocrDocId: string, candidates: QuestionCandidate[]): OcrFigureDiagnostics | undefined {
  const record = ocrRepo.getOcrDocument(ocrDocId)
  if (!record) return undefined
  
  const markdown = readText(record.markdownPath)
  const assets = readJsonFile<OCRAsset[]>(record.assetsJsonPath, [])
  
  // 1. markdown 中 DOC2X_FIGURE 占位符数量
  const placeholderMatches = Array.from(markdown.matchAll(/<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/g))
  const placeholderCount = placeholderMatches.length
  const placeholderIds = new Set(placeholderMatches.map((m) => m[1]))
  
  // 2. assets 数量
  const assetsCount = assets.length
  
  // 3. 占位符未匹配 asset 的数量
  const unmatchedPlaceholderCount = Array.from(placeholderIds)
    .filter((id) => !assets.some((a) => a.id === id))
    .length
    
  // 4. asset 未被 candidate 使用的数量
  const usedAssetIds = new Set(candidates.flatMap((c) => c.figures.map((f) => f.id || f.blockId)))
  const unusedAssetsCount = assets.filter((a) => !usedAssetIds.has(a.id)).length
  
  // 5. 远程图片下载失败数量
  const failedDownloadCount = assets.filter((a) => a.path && /^https?:\/\//i.test(a.path)).length
  
  return {
    placeholderCount,
    assetsCount,
    unmatchedPlaceholderCount,
    unusedAssetsCount,
    failedDownloadCount,
  }
}

function storedOcrDocumentDir(id: string) {
  return path.join(importDataDir(), 'ocr-documents', id)
}

type SourceDocumentOcrTaskState = {
  sourceDocumentId: string
  provider: 'glm'
  status: 'ocr_running' | 'ocr_succeeded' | 'ocr_failed'
  ocrDocumentId?: string
  startedAt: string
  finishedAt?: string
  error?: string
}

const activeSourceDocumentOcrTasks = new Map<string, Promise<void>>()

function sourceDocumentDir(id: string) {
  return path.join(importDataDir(), 'source-documents', id)
}

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

function sourceTitle(sourceDocumentId: string) {
  const source = sourceRepo.getSourceDocument(sourceDocumentId)
  return source?.title || source?.originalFileName || '资料导入 v2'
}

type UploadedSourceDocumentFile = {
  originalname: string
  mimetype: string
  buffer: Buffer
  size: number
}

function uploadedSourceDocumentDetails(file: UploadedSourceDocumentFile) {
  const originalFileName = normalizeUploadName(path.basename(String(file.originalname || '')))
  const extension = path.extname(originalFileName).toLowerCase()
  const mimeType = String(file.mimetype || '').toLowerCase()
  const supported = {
    '.pdf': { fileType: 'pdf' as const, mimeTypes: ['application/pdf'] },
    '.jpg': { fileType: 'image' as const, mimeTypes: ['image/jpeg', 'image/jpg'] },
    '.jpeg': { fileType: 'image' as const, mimeTypes: ['image/jpeg', 'image/jpg'] },
    '.png': { fileType: 'image' as const, mimeTypes: ['image/png'] },
  }[extension]

  if (!originalFileName || !supported || !file.buffer?.length) {
    throw new RouteError(400, '请选择 PDF、JPG 或 PNG 文件。')
  }
  if (mimeType && mimeType !== 'application/octet-stream' && !supported.mimeTypes.includes(mimeType)) {
    throw new RouteError(400, '文件类型与扩展名不匹配，请上传 PDF、JPG 或 PNG 文件。')
  }

  return { originalFileName, extension, fileType: supported.fileType }
}

export function uploadSourceDocument(file: UploadedSourceDocumentFile | undefined) {
  if (!file) throw new RouteError(400, '请选择要上传的文件。')
  const { originalFileName, extension, fileType } = uploadedSourceDocumentDetails(file)
  const title = path.basename(originalFileName, extension) || originalFileName
  const sourceDocument = sourceRepo.createSourceDocument({
    title,
    originalFileName,
    fileType,
    status: 'uploaded',
  })
  if (!sourceDocument) throw new RouteError(500, '资料创建失败。')

  const targetPath = path.join(importDataDir(), 'source-documents', sourceDocument.id, `original${extension}`)
  try {
    ensureDir(path.dirname(targetPath))
    fs.writeFileSync(targetPath, file.buffer)
    const saved = sourceRepo.updateSourceDocument(sourceDocument.id, { filePath: assetPathFor(targetPath) })
    if (!saved) throw new Error('资料文件保存后未能读取记录。')
    return { sourceDocument: saved }
  } catch (error) {
    throw new RouteError(500, `资料文件保存失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function createSourceDocument(body: Record<string, unknown>) {
  const item = sourceRepo.createSourceDocument({
    id: body.id ? String(body.id) : undefined,
    title: String(body.title || body.originalFileName || '未命名资料'),
    originalFileName: String(body.originalFileName || ''),
    filePath: String(body.filePath || ''),
    fileType: ['pdf', 'image', 'markdown', 'json'].includes(String(body.fileType)) ? body.fileType as any : 'json',
    pageCount: Number(body.pageCount || 0),
    provider: ['doc2x', 'glm', 'manual', 'json'].includes(String(body.provider)) ? body.provider as any : undefined,
    status: 'uploaded',
  })
  if (!item) throw new RouteError(500, '资料创建失败。')
  return { sourceDocument: item }
}

export function listSourceDocuments(query: Record<string, unknown>) {
  return {
    items: sourceRepo.listSourceDocuments({
      status: query.status ? String(query.status) as any : undefined,
      provider: query.provider ? String(query.provider) as any : undefined,
      fileType: query.fileType ? String(query.fileType) as any : undefined,
      limit: Number(query.limit || 100),
      offset: Number(query.offset || 0),
    }),
  }
}

export function getSourceDocument(id: string) {
  const sourceDocument = sourceRepo.getSourceDocument(id)
  if (!sourceDocument) throw new RouteError(404, '资料不存在。')
  return { sourceDocument }
}

export async function localizeRemoteImages(doc: OCRDocument) {
  const sourceDocumentId = doc.sourceDocumentId
  const assets = doc.assets || []
  
  const localAssetsDir = path.join(importDataDir(), 'source-documents', sourceDocumentId, 'assets')
  ensureDir(localAssetsDir)
  
  const failedUrls: string[] = []
  
  for (const asset of assets) {
    if (asset.path && (/^https?:\/\//i.test(asset.path))) {
      const url = asset.path
      const hash = createHash('sha256').update(url).digest('hex').slice(0, 16)
      
      let ext = '.png'
      try {
        const parsedUrl = new URL(url)
        const pathnameExt = path.extname(parsedUrl.pathname).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(pathnameExt)) {
          ext = pathnameExt
        }
      } catch (e) {
        // ignore
      }
      
      const filename = `img_${hash}${ext}`
      const localFilePath = path.join(localAssetsDir, filename)
      const portablePath = assetPathFor(localFilePath)
      
      if (fs.existsSync(localFilePath)) {
        asset.path = portablePath
        continue
      }
      
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout
        const res = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)
        if (!res.ok) {
          throw new Error(`HTTP status ${res.status}`)
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        fs.writeFileSync(localFilePath, buffer)
        asset.path = portablePath
      } catch (err) {
        console.error(`Failed to download remote asset ${url}:`, err)
        failedUrls.push(url)
      }
    }
  }
  
  if (failedUrls.length > 0) {
    if (!doc.metadata) doc.metadata = {}
    doc.metadata.image_download_failed_urls = Array.from(new Set([
      ...(doc.metadata.image_download_failed_urls as string[] || []),
      ...failedUrls
    ]))
  }
}

async function runGlmSourceDocumentOcr(sourceDocumentId: string, initialState: SourceDocumentOcrTaskState) {
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

export async function importOCRDocumentJson(body: Record<string, unknown>) {
  const rawOCRDocument = body.ocrDocument || body
  const raw = asRecord(rawOCRDocument)
  const sourceBody = asRecord(body.sourceDocument)
  const sourceDocumentId = String(body.sourceDocumentId || raw.sourceDocumentId || raw.source_document_id || '')
  let source = sourceDocumentId ? sourceRepo.getSourceDocument(sourceDocumentId) : null
  if (!source) {
    source = sourceRepo.createSourceDocument({
      id: sourceDocumentId || undefined,
      title: String(sourceBody.title || raw.metadata?.title || raw.id || '模拟 OCRDocument'),
      originalFileName: String(sourceBody.originalFileName || sourceBody.original_file_name || ''),
      filePath: String(sourceBody.filePath || ''),
      fileType: 'json',
      provider: normalizeProvider(raw.provider),
      status: 'ocr_succeeded',
      pageCount: Array.isArray(raw.pages) ? raw.pages.length : 0,
    })
  }
  if (!source) throw new RouteError(500, '资料创建失败。')

  const normalized = normalizeOCRDocumentPayload(rawOCRDocument, source.id)
  
  ensureOcrDocumentFiguresAndPlaceholders(normalized)
  await localizeRemoteImages(normalized)

  const ocrId = normalized.id || ''
  const finalId = ocrId && !ocrRepo.getOcrDocument(ocrId) ? ocrId : ''
  const recordId = finalId || undefined
  const tempId = recordId || 'pending'
  const targetDir = storedOcrDocumentDir(recordId || String(raw.id || Date.now()))
  ensureDir(targetDir)
  const rawPath = path.join(targetDir, 'raw.json')
  const markdownPath = path.join(targetDir, 'markdown.md')
  const pagesPath = path.join(targetDir, 'pages.json')
  const assetsPath = path.join(targetDir, 'assets.json')
  const documentForStorage = { ...normalized, id: recordId || normalized.id, sourceDocumentId: source.id }
  writeJson(rawPath, documentForStorage)
  writeText(markdownPath, normalized.markdown)
  writeJson(pagesPath, normalized.pages)
  writeJson(assetsPath, normalized.assets)

  const rawResultPath = normalized.rawResultPath || assetPathFor(rawPath)
  const metadata = { ...normalized.metadata, storedRawJsonPath: assetPathFor(rawPath) }
  const created = ocrRepo.createOcrDocument({
    id: recordId,
    sourceDocumentId: source.id,
    provider: normalized.provider,
    rawResultPath,
    markdownPath: assetPathFor(markdownPath),
    blocksJsonPath: assetPathFor(pagesPath),
    assetsJsonPath: assetPathFor(assetsPath),
    metadata,
    createdAt: normalized.createdAt,
  })
  if (!created) throw new RouteError(500, 'OCRDocument 保存失败。')
  sourceRepo.updateSourceDocument(source.id, { status: 'ocr_succeeded', provider: normalized.provider, pageCount: normalized.pages.length })
  return { sourceDocument: sourceRepo.getSourceDocument(source.id), ocrDocument: created, tempId }
}

export function listOcrDocuments(query: Record<string, unknown>) {
  return {
    items: ocrRepo.listOcrDocuments({
      sourceDocumentId: query.sourceDocumentId ? String(query.sourceDocumentId) : undefined,
      provider: query.provider ? normalizeProvider(query.provider) : undefined,
      limit: Number(query.limit || 100),
      offset: Number(query.offset || 0),
    }),
  }
}

export function getOcrDocument(id: string) {
  const ocrDocument = ocrRepo.getOcrDocument(id)
  if (!ocrDocument) throw new RouteError(404, 'OCRDocument 不存在。')
  return { ocrDocument }
}

export function loadOcrDocument(id: string): OCRDocument {
  const record = ocrRepo.getOcrDocument(id)
  if (!record) throw new RouteError(404, 'OCRDocument 不存在。')
  const markdown = readText(record.markdownPath)
  const pagesValue = readJsonFile<OCRPage[] | { pages?: OCRPage[] }>(record.blocksJsonPath, [])
  const pages = Array.isArray(pagesValue) ? pagesValue : Array.isArray(pagesValue.pages) ? pagesValue.pages : []
  const assets = readJsonFile<OCRAsset[]>(record.assetsJsonPath, [])
  return {
    id: record.id,
    sourceDocumentId: record.sourceDocumentId,
    provider: record.provider,
    rawResultPath: record.rawResultPath,
    markdown,
    pages,
    assets,
    metadata: record.metadata,
    createdAt: record.createdAt,
  }
}

export function parseCandidatesForOcrDocument(id: string) {
  const document = loadOcrDocument(id)
  const candidates = parseQuestionCandidates(document)
  candidateRepo.deleteQuestionCandidatesForOcrDocument(id)
  const saved = candidates.map((candidate) => candidateRepo.createQuestionCandidate(candidate)).filter(Boolean) as QuestionCandidate[]
  sourceRepo.updateSourceDocument(document.sourceDocumentId, { status: saved.some((item) => item.status !== 'ready') ? 'partially_parsed' : 'parsed' })
  return { ...candidateStatusCounts(saved), items: saved, diagnostics: getOcrFigureDiagnostics(id, saved) }
}

export function listQuestionCandidatesForSource(sourceDocumentId: string, query: Record<string, unknown>) {
  if (!sourceRepo.getSourceDocument(sourceDocumentId)) throw new RouteError(404, '资料不存在。')
  const candidates = candidateRepo.listQuestionCandidates({
    sourceDocumentId,
    status: query.status ? String(query.status) as any : undefined,
    limit: Number(query.limit || 500),
    offset: Number(query.offset || 0),
  })
  const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId, limit: 1 })
  const diagnostics = ocrDocument ? getOcrFigureDiagnostics(ocrDocument.id, candidates) : undefined
  return {
    items: candidates,
    diagnostics,
  }
}

export function updateQuestionCandidate(id: string, body: Record<string, unknown>) {
  const patch = (body.candidate || body) as UpdateQuestionCandidateInput
  const updated = candidateRepo.updateQuestionCandidate(id, patch)
  if (!updated) throw new RouteError(404, '候选题不存在。')
  return { candidate: updated }
}

export function commitQuestionCandidate(id: string) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) throw new RouteError(404, '候选题不存在。')
  if (candidate.status === 'committed') {
    if (!candidate.committedQuestionId) {
      throw new RouteError(409, '候选题已标记为已入库，但缺少已入库题目 ID。')
    }
    const committedItem = getQuestion(candidate.committedQuestionId)
    if (!committedItem) {
      throw new RouteError(409, `候选题已标记为已入库，但题库中不存在对应题目（${candidate.committedQuestionId}）。`)
    }
    return { candidate, item: committedItem }
  }
  if (!candidate.stemMarkdown.trim()) throw new RouteError(400, '题干为空，不能入库。')
  const difficultyScore10 = normalizeDifficultyScore10(candidate.difficultyScore10)
  const item = createQuestion({
    questionNo: candidate.questionNo,
    questionType: candidate.questionType || inferQuestionType(candidate.stemMarkdown, candidate.answerText),
    difficultyScore: 0,
    difficultyScore10,
    difficultyLabel: candidate.difficultyLabel || difficultyLabel10(difficultyScore10),
    chapter: candidate.knowledgePoints[0] || '待整理',
    knowledgePoints: normalizeTags(candidate.knowledgePoints),
    solutionMethods: normalizeTags(candidate.solutionMethods),
    sourceTitle: sourceTitle(candidate.sourceDocumentId),
    bankStatus: 'ready',
    stemMarkdown: candidate.stemMarkdown,
    answerText: candidate.answerText,
    analysisMarkdown: candidate.analysisMarkdown,
    figures: figuresForQuestionBank(candidate.figures),
    sourceRunId: '',
  })
  if (!item) throw new RouteError(500, '入库失败。')
  const committedCandidate = candidateRepo.updateQuestionCandidate(id, {
    status: 'committed',
    committedQuestionId: item.id,
    committedAt: nowIso(),
  })
  if (!committedCandidate) throw new RouteError(500, '题目已创建，但候选题入库状态更新失败。')
  return { candidate: committedCandidate, item }
}

export function commitQuestionCandidates(body: Record<string, unknown>) {
  const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : []
  if (!ids.length) throw new RouteError(400, '请指定要入库的候选题。')
  const items = []
  const errors = []
  for (const id of ids) {
    try {
      items.push(commitQuestionCandidate(id).item)
    } catch (error) {
      errors.push({ id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { success: items.length, failed: errors.length, items, errors }
}
