import path from 'node:path'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import type { OCRAsset, OCRDocument, OCRPage } from '../../types/ocr-document.js'
import { RouteError } from '../../utils/http-error.js'
import { nowIso } from '../../utils/ids.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { ensureOcrDocumentFiguresAndPlaceholders } from '../ocr-providers/ocr-document.normalizer.js'
import { ensureDir, readJsonFile, readText, storedOcrDocumentDir, writeJson, writeText } from './import-flow-v2.paths.js'
import { localizeRemoteImages } from './figure-mapping.js'
import { applyWatermarkCleanup } from './watermark-cleanup.js'

export function normalizeProvider(value: unknown): 'doc2x' | 'glm' {
  return String(value || '').toLowerCase() === 'glm' ? 'glm' : 'doc2x'
}

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

export function normalizeOCRDocumentPayload(rawValue: unknown, fallbackSourceDocumentId: string): OCRDocument {
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
      metadata: sourceBody.metadata && typeof sourceBody.metadata === 'object' && !Array.isArray(sourceBody.metadata) ? sourceBody.metadata as Record<string, unknown> : sourceBody,
    })
  }
  if (!source) throw new RouteError(500, '资料创建失败。')

  let normalized = normalizeOCRDocumentPayload(rawOCRDocument, source.id)
  
  ensureOcrDocumentFiguresAndPlaceholders(normalized)
  await localizeRemoteImages(normalized)
  normalized = applyWatermarkCleanup(normalized, source.metadata).document

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

export function updateOcrDocumentMarkdown(id: string, body: Record<string, unknown>) {
  const record = ocrRepo.getOcrDocument(id)
  if (!record) throw new RouteError(404, 'OCRDocument 不存在。')
  if (typeof body.markdown !== 'string') throw new RouteError(400, '请提供 markdown 文本。')
  const markdownPath = resolveStoragePath(record.markdownPath)
  if (!markdownPath) throw new RouteError(400, 'OCRDocument 缺少 markdown 文件路径。')
  writeText(markdownPath, body.markdown)
  const updated = ocrRepo.updateOcrDocument(id, {
    metadata: {
      ...record.metadata,
      manualMarkdownEditedAt: nowIso(),
      manualMarkdownEdited: true,
    },
  })
  if (!updated) throw new RouteError(500, 'OCRDocument 更新失败。')
  return { ocrDocument: updated }
}

export function loadOcrDocument(id: string): OCRDocument {
  const record = ocrRepo.getOcrDocument(id)
  if (!record) throw new RouteError(404, 'OCRDocument 不存在。')
  const markdown = readText(record.markdownPath)
  const pagesValue = readJsonFile<OCRPage[] | { pages?: OCRPage[] }>(record.blocksJsonPath, [])
  const pages = Array.isArray(pagesValue) ? pagesValue : Array.isArray(pagesValue.pages) ? pagesValue.pages : []
  const assets = readJsonFile<OCRAsset[]>(record.assetsJsonPath, [])
  const document = {
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
  return applyWatermarkCleanup(document, sourceRepo.getSourceDocument(record.sourceDocumentId)?.metadata).document
}
