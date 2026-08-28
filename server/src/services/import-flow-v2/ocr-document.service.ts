import path from 'node:path'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import type { OCRAsset, OCRDocument, OCRPage } from '../../types/ocr-document.js'
import { RouteError } from '../../utils/http-error.js'
import { nowIso } from '../../utils/ids.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import {
  ensureOcrDocumentFiguresAndPlaceholders,
  prepareOcrDocumentMarkdownForStorage,
} from '../ocr-providers/ocr-document.normalizer.js'
import { ensureDir, readJsonFile, readText, storedOcrDocumentDir, writeJson, writeText } from './import-flow-v2.paths.js'
import { localizeRemoteImages } from './figure-mapping.js'
import { applyWatermarkCleanup } from './watermark-cleanup.js'

export function normalizeProvider(value: unknown): 'doc2x' | 'glm' {
  return String(value || '').toLowerCase() === 'glm' ? 'glm' : 'doc2x'
}

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function ocrImportError(message: string): never {
  throw new RouteError(400, `OCRDocument JSON schema 错误：${message}`)
}

function ocrImportRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) ocrImportError(`${label}必须是对象。`)
  return value as Record<string, unknown>
}

const OCR_BLOCK_TYPES = new Set(['text', 'formula', 'image', 'table', 'unknown'])
const OCR_ASSET_TYPES = new Set(['image', 'table_image', 'page_image', 'crop'])

function validateOptionalOcrBBox(value: unknown, label: string) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length !== 4 || value.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) {
    ocrImportError(`${label} 必须是包含 4 个有限数字的数组。`)
  }
}

function validateOptionalOcrNumber(value: unknown, label: string) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) ocrImportError(`${label} 必须是数字。`)
}

function validateOptionalOcrString(value: unknown, label: string) {
  if (value !== undefined && typeof value !== 'string') ocrImportError(`${label} 必须是字符串。`)
}

/**
 * Validates only documents supplied through the JSON import endpoint. The
 * normalizer below intentionally remains tolerant for persisted historical
 * OCR records.
 */
export function validateImportedOCRDocumentJson(body: Record<string, unknown>) {
  const raw = ocrImportRecord(body.ocrDocument || body, 'OCRDocument')
  if (body.sourceDocumentId !== undefined && typeof body.sourceDocumentId !== 'string') ocrImportError('字段 sourceDocumentId 必须是字符串。')
  if (raw.provider !== 'doc2x' && raw.provider !== 'glm') ocrImportError('字段 provider 必须为 doc2x 或 glm。')
  if (typeof raw.markdown !== 'string') ocrImportError('字段 markdown 必须是字符串。')
  for (const field of ['id', 'sourceDocumentId', 'source_document_id', 'rawResultPath', 'raw_result_path', 'createdAt', 'created_at']) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') ocrImportError(`字段 ${field} 必须是字符串。`)
  }
  if (!Array.isArray(raw.pages)) ocrImportError('字段 pages 必须是数组。')
  if (!Array.isArray(raw.assets)) ocrImportError('字段 assets 必须是数组。')
  if (raw.metadata !== undefined && (!raw.metadata || typeof raw.metadata !== 'object' || Array.isArray(raw.metadata))) ocrImportError('字段 metadata 必须是对象。')
  for (const [index, rawPage] of raw.pages.entries()) {
    const page = ocrImportRecord(rawPage, `pages[${index}]`)
    for (const field of ['pageNo', 'width', 'height']) {
      if (typeof page[field] !== 'number' || !Number.isFinite(page[field])) ocrImportError(`pages[${index}].${field} 必须是数字。`)
    }
    if (!Array.isArray(page.blocks)) ocrImportError(`pages[${index}].blocks 必须是数组。`)
    for (const [blockIndex, rawBlock] of page.blocks.entries()) {
      const block = ocrImportRecord(rawBlock, `pages[${index}].blocks[${blockIndex}]`)
      for (const field of ['id', 'type', 'content']) if (typeof block[field] !== 'string') ocrImportError(`pages[${index}].blocks[${blockIndex}].${field} 必须是字符串。`)
      if (!OCR_BLOCK_TYPES.has(block.type as string)) ocrImportError(`pages[${index}].blocks[${blockIndex}].type 无效。`)
      if (typeof block.pageNo !== 'number' || !Number.isFinite(block.pageNo)) ocrImportError(`pages[${index}].blocks[${blockIndex}].pageNo 必须是数字。`)
      validateOptionalOcrBBox(block.bbox, `pages[${index}].blocks[${blockIndex}].bbox`)
      validateOptionalOcrNumber(block.markdownStart, `pages[${index}].blocks[${blockIndex}].markdownStart`)
      validateOptionalOcrNumber(block.markdownEnd, `pages[${index}].blocks[${blockIndex}].markdownEnd`)
      validateOptionalOcrNumber(block.confidence, `pages[${index}].blocks[${blockIndex}].confidence`)
      validateOptionalOcrString(block.assetId, `pages[${index}].blocks[${blockIndex}].assetId`)
    }
  }
  for (const [index, rawAsset] of raw.assets.entries()) {
    const asset = ocrImportRecord(rawAsset, `assets[${index}]`)
    for (const field of ['id', 'type', 'path']) if (typeof asset[field] !== 'string') ocrImportError(`assets[${index}].${field} 必须是字符串。`)
    if (!OCR_ASSET_TYPES.has(asset.type as string)) ocrImportError(`assets[${index}].type 无效。`)
    validateOptionalOcrNumber(asset.pageNo, `assets[${index}].pageNo`)
    validateOptionalOcrBBox(asset.bbox, `assets[${index}].bbox`)
    validateOptionalOcrString(asset.sourceBlockId, `assets[${index}].sourceBlockId`)
  }
  if (body.sourceDocument !== undefined) {
    const source = ocrImportRecord(body.sourceDocument, 'sourceDocument')
    if (source.title !== undefined && typeof source.title !== 'string') ocrImportError('sourceDocument.title 必须是字符串。')
    for (const field of ['id', 'originalFileName', 'original_file_name', 'filePath']) {
      if (source[field] !== undefined && typeof source[field] !== 'string') ocrImportError(`sourceDocument.${field} 必须是字符串。`)
    }
    if (source.metadata !== undefined && (!source.metadata || typeof source.metadata !== 'object' || Array.isArray(source.metadata))) ocrImportError('sourceDocument.metadata 必须是对象。')
  }
  return raw
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
  const raw = validateImportedOCRDocumentJson(body)
  const sourceBody = asRecord(body.sourceDocument)
  const sourceDocumentId = String(body.sourceDocumentId || raw.sourceDocumentId || raw.source_document_id || '')
  let source = sourceDocumentId ? sourceRepo.getSourceDocument(sourceDocumentId) : null
  if (!source) {
    source = sourceRepo.createSourceDocument({
      id: sourceDocumentId || undefined,
      title: String(sourceBody.title || asRecord(raw.metadata).title || raw.id || '模拟 OCRDocument'),
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
  normalized = prepareOcrDocumentMarkdownForStorage(
    applyWatermarkCleanup(normalized, source.metadata).document,
  )

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
