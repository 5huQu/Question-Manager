import fs from 'node:fs'
import path from 'node:path'
import { dataDir, storageRoot } from '../../config.js'
import { createQuestion } from '../../db/questions.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import type { OCRAsset, OCRDocument, OCRPage } from '../../types/ocr-document.js'
import type { CandidateFigure, QuestionCandidate, UpdateQuestionCandidateInput } from '../../types/question-candidate.js'
import { RouteError } from '../../utils/http-error.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { parseJson } from '../../utils/json.js'
import { difficultyLabel10, normalizeDifficultyScore10 } from '../../utils/search.js'
import { inferQuestionType } from '../../utils/question-type.js'
import { parseQuestionCandidates } from '../question-parser/index.js'
import { normalizeTags } from '../tags/tag-libraries.js'

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

function figuresForQuestionBank(figures: CandidateFigure[]) {
  return figures.map((figure) => ({
    id: figure.id,
    blockId: figure.sourceBlockId,
    origin: 'import_flow_v2',
    usage: figure.usage,
    category: figure.usage === 'analysis' ? 'analysis' : 'question',
    pageNumber: figure.pageNo,
    bbox: bboxRecord(figure.bbox),
    sourcePath: figure.path,
    path: figure.path,
  }))
}

function storedOcrDocumentDir(id: string) {
  return path.join(importDataDir(), 'ocr-documents', id)
}

function sourceTitle(sourceDocumentId: string) {
  const source = sourceRepo.getSourceDocument(sourceDocumentId)
  return source?.title || source?.originalFileName || '资料导入 v2'
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

export function importOCRDocumentJson(body: Record<string, unknown>) {
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
  return { ...candidateStatusCounts(saved), items: saved }
}

export function listQuestionCandidatesForSource(sourceDocumentId: string, query: Record<string, unknown>) {
  if (!sourceRepo.getSourceDocument(sourceDocumentId)) throw new RouteError(404, '资料不存在。')
  return {
    items: candidateRepo.listQuestionCandidates({
      sourceDocumentId,
      status: query.status ? String(query.status) as any : undefined,
      limit: Number(query.limit || 500),
      offset: Number(query.offset || 0),
    }),
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
  return { candidate, item }
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
