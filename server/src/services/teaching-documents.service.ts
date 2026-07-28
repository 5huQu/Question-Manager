import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { dataDir } from '../config.js'
import * as repo from '../repositories/teaching-documents.repo.js'
import { RouteError } from '../utils/http-error.js'
import { createId, nowIso, safeName } from '../utils/ids.js'
import { assetPathFor } from '../utils/paths.js'
import { imageDimensions } from '../utils/image-operations.js'

const DOCUMENT_TYPES = new Set(['worksheet', 'exam', 'lecture'])
const KNOWN_BLOCK_TYPES = new Set([
  'heading', 'paragraph', 'blockMath', 'figure', 'question', 'box',
  'divider', 'spacer', 'pageBreak', 'rawMarkdown', 'unknown',
])
const MAX_ASSET_PIXELS = 60_000_000
const FATAL_ISSUE_CODES = new Set([
  'invalid-root', 'unsupported-version', 'invalid-document-type', 'invalid-title',
  'invalid-metadata', 'invalid-content', 'empty-id', 'duplicate-id', 'auto-id',
  'invalid-inline-content', 'invalid-box-children', 'absolute-legacy-path',
])
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
])

type JsonObject = Record<string, unknown>

export type TeachingDocumentIssue = {
  level: 'error' | 'warning'
  code: string
  message: string
  blockId?: string
}

export type TeachingDocumentRecord = {
  id: string
  title: string
  documentType: 'worksheet' | 'exam' | 'lecture'
  schemaVersion: number
  revision: number
  content: JsonObject
  blockCount: number
  issues: TeachingDocumentIssue[]
  assets: TeachingDocumentAsset[]
  createdAt: string
  updatedAt: string
}

export type TeachingDocumentAsset = {
  id: string
  documentId: string
  originalName: string
  mimeType: string
  byteSize: number
  width: number
  height: number
  url: string
  createdAt: string
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isObject(value)) return value === undefined ? 'null' : JSON.stringify(value)
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function blockCount(content: JsonObject) {
  return Array.isArray(content.content) ? content.content.length : 0
}

function validateInlines(value: unknown, blockId: string, issues: TeachingDocumentIssue[]) {
  if (!Array.isArray(value)) {
    issues.push({ level: 'error', code: 'invalid-inline-content', blockId, message: '文字块 content 必须是数组。' })
    return
  }
  for (const inline of value) {
    if (!isObject(inline)) {
      issues.push({ level: 'warning', code: 'unknown-inline-node', blockId, message: '异常行内节点将按原始数据保留。' })
      continue
    }
    if (!['text', 'inlineMath', 'hardBreak', 'unknown'].includes(String(inline.type || ''))) {
      issues.push({ level: 'warning', code: 'unknown-inline-node', blockId, message: `未知行内节点 "${String(inline.type || '')}" 将保留。` })
    }
    if (inline.type === 'unknown') {
      issues.push({ level: 'warning', code: 'unknown-inline-node', blockId, message: '未知行内节点将按原始数据保留。' })
    }
    if (inline.type === 'text' && Array.isArray(inline.unknownMarks) && inline.unknownMarks.length) {
      issues.push({ level: 'warning', code: 'unknown-inline-mark', blockId, message: '未知文字 mark 将保留。' })
    }
  }
}

export function inspectTeachingDocument(value: unknown) {
  const issues: TeachingDocumentIssue[] = []
  if (!isObject(value)) {
    return { fatal: true, issues: [{ level: 'error', code: 'invalid-root', message: '文档根节点必须是对象。' } satisfies TeachingDocumentIssue] }
  }
  if (value.version !== 1) issues.push({ level: 'error', code: 'unsupported-version', message: '仅支持 TeachingDocument version 1。' })
  if (!DOCUMENT_TYPES.has(String(value.documentType || ''))) {
    issues.push({ level: 'error', code: 'invalid-document-type', message: '文档类型无效。' })
  }
  if (typeof value.title !== 'string') issues.push({ level: 'error', code: 'invalid-title', message: '文档标题必须是字符串。' })
  if (!isObject(value.metadata)) issues.push({ level: 'error', code: 'invalid-metadata', message: '文档 metadata 必须是对象。' })
  if (!Array.isArray(value.content)) {
    issues.push({ level: 'error', code: 'invalid-content', message: '文档 content 必须是数组。' })
    return { fatal: true, issues }
  }

  const ids = new Set<string>()
  const visitBlock = (raw: unknown, insideBox: boolean) => {
    if (!isObject(raw)) {
      issues.push({ level: 'warning', code: insideBox ? 'illegal-box-child' : 'unknown-block-type', message: '异常块值将按原始数据保留。' })
      return
    }
    const type = String(raw.type || '')
    const id = typeof raw.id === 'string' ? raw.id : ''
    if (!id.trim()) issues.push({ level: 'error', code: 'empty-id', blockId: id, message: '块 ID 为空。' })
    else if (ids.has(id)) issues.push({ level: 'error', code: 'duplicate-id', blockId: id, message: `块 ID "${id}" 重复。` })
    else ids.add(id)
    if (/_auto_\d+$/.test(id)) issues.push({ level: 'error', code: 'auto-id', blockId: id, message: '保存前必须迁移自动占位 ID。' })
    if (!KNOWN_BLOCK_TYPES.has(type)) {
      issues.push({ level: 'warning', code: 'unknown-block-type', blockId: id, message: `未知块 "${type}" 将保留。` })
      return
    }
    if (type === 'unknown') {
      issues.push({ level: 'warning', code: 'unknown-block-type', blockId: id, message: `未知块 "${String(raw.originalType || '')}" 将保留。` })
    }
    if (insideBox && ['box', 'heading', 'pageBreak', 'rawMarkdown'].includes(type)) {
      issues.push({ level: 'warning', code: 'illegal-box-child', blockId: id, message: `盒子内非法块 "${type}" 将保留。` })
    }
    if (type === 'heading' || type === 'paragraph') validateInlines(raw.content, id, issues)
    if (type === 'question' && (typeof raw.questionId !== 'string' || !raw.questionId.trim())) {
      issues.push({ level: 'error', code: 'invalid-question-ref', blockId: id, message: '题目引用必须是字符串。' })
    }
    if (type === 'figure') {
      const asset = raw.asset
      if (!isObject(asset) || !['questionFigure', 'documentAsset', 'legacyPath'].includes(String(asset.type || ''))) {
        issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片资源引用无效。' })
      } else if (asset.type === 'legacyPath' && /^(?:[a-zA-Z]:[\\/]|\/|file:\/\/)/.test(String(asset.path || '').trim())) {
        issues.push({ level: 'error', code: 'absolute-legacy-path', blockId: id, message: '图片引用不得包含本地绝对路径。' })
      } else if (asset.type === 'legacyPath' && !String(asset.path || '').trim()) {
        issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片 legacyPath 不能为空。' })
      } else if (asset.type === 'documentAsset' && !String(asset.assetId || '').trim()) {
        issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片 documentAsset 引用不能为空。' })
      } else if (asset.type === 'questionFigure' && (!String(asset.questionId || '').trim() || !String(asset.figureId || '').trim())) {
        issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '题图引用必须包含 questionId 和 figureId。' })
      }
    }
    if (type === 'box') {
      if (!Array.isArray(raw.children)) issues.push({ level: 'error', code: 'invalid-box-children', blockId: id, message: '盒子 children 必须是数组。' })
      else raw.children.forEach((child) => visitBlock(child, true))
    }
  }
  value.content.forEach((block) => visitBlock(block, false))
  return { fatal: issues.some((issue) => issue.level === 'error' && FATAL_ISSUE_CODES.has(issue.code)), issues }
}

function assetFromRow(row: repo.TeachingDocumentAssetRow): TeachingDocumentAsset {
  return {
    id: row.id,
    documentId: row.document_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    width: Number(row.width),
    height: Number(row.height),
    url: `/assets/${row.storage_path.replace(/^\/+/, '')}`,
    createdAt: row.created_at,
  }
}

function recordFromRow(row: repo.TeachingDocumentRow): TeachingDocumentRecord {
  const content = migrateStoredTeachingDocument(Number(row.schema_version), JSON.parse(row.content_json))
  const assets = new Map(repo.listTeachingDocumentAssets(row.id).map((asset) => [asset.id, asset]))
  for (const assetId of referencedDocumentAssetIds(content)) {
    const asset = repo.getTeachingDocumentAsset(assetId)
    if (asset) assets.set(asset.id, asset)
  }
  return {
    id: row.id,
    title: row.title,
    documentType: row.document_type as TeachingDocumentRecord['documentType'],
    schemaVersion: Number(row.schema_version),
    revision: Number(row.revision),
    content,
    blockCount: blockCount(content),
    issues: inspectTeachingDocument(content).issues,
    assets: [...assets.values()].map(assetFromRow),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function migrateStoredTeachingDocument(schemaVersion: number, content: unknown): JsonObject {
  if (schemaVersion !== 1 || !isObject(content) || content.version !== 1) {
    throw new RouteError(409, `讲义文档 schemaVersion ${schemaVersion} 暂不支持，请先执行兼容迁移。`)
  }
  return content
}

function referencedDocumentAssetIds(content: JsonObject) {
  const ids = new Set<string>()
  const visit = (raw: unknown) => {
    if (!isObject(raw)) return
    if (raw.type === 'figure' && isObject(raw.asset) && raw.asset.type === 'documentAsset' && typeof raw.asset.assetId === 'string') {
      ids.add(raw.asset.assetId)
    }
    if (raw.type === 'box' && Array.isArray(raw.children)) raw.children.forEach(visit)
  }
  if (Array.isArray(content.content)) content.content.forEach(visit)
  return ids
}

/**
 * Read-only maintenance primitive for a future orphan cleaner.
 * Rendering and pagination never mutate assets; cleanup must call this check
 * before considering any file deletion.
 */
export function inspectTeachingDocumentAssetReferences(assetId: string) {
  const documentIds: string[] = []
  for (const row of repo.listTeachingDocuments()) {
    try {
      const content = JSON.parse(row.content_json) as JsonObject
      if (referencedDocumentAssetIds(content).has(assetId)) documentIds.push(row.id)
    } catch {
      // A malformed stored document is not rewritten here. Maintenance tools
      // must surface it separately instead of guessing that its assets are free.
    }
  }
  documentIds.sort()
  return {
    assetId,
    referenced: documentIds.length > 0,
    documentIds,
  }
}

function requireDocument(id: string) {
  const row = repo.getTeachingDocument(id)
  if (!row) throw new RouteError(404, '讲义文档不存在。')
  return row
}

function assertWritableDocument(content: unknown) {
  const inspection = inspectTeachingDocument(content)
  if (inspection.fatal) {
    throw new RouteError(422, '讲义文档包含阻止保存的错误。', inspection.issues, {
      error: 'teaching_document_validation_failed',
      message: '讲义文档包含阻止保存的错误。',
      issues: inspection.issues,
    })
  }
  return content as JsonObject
}

function emptyDocument(title: string, documentType: TeachingDocumentRecord['documentType']): JsonObject {
  return { version: 1, documentType, title, metadata: {}, content: [] }
}

export function listTeachingDocuments() {
  return {
    items: repo.listTeachingDocuments().map((row) => ({
      id: row.id,
      title: row.title,
      documentType: row.document_type,
      schemaVersion: Number(row.schema_version),
      revision: Number(row.revision),
      blockCount: blockCount(JSON.parse(row.content_json) as JsonObject),
      assetCount: Number(row.asset_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  }
}

export function getTeachingDocument(id: string) {
  return recordFromRow(requireDocument(id))
}

export function createTeachingDocument(body: Record<string, unknown>) {
  const documentType = String(body.documentType || 'lecture')
  if (!DOCUMENT_TYPES.has(documentType)) throw new RouteError(400, '文档类型无效。')
  const title = String(body.title || '未命名文档').trim() || '未命名文档'
  const rawContent = body.content === undefined ? emptyDocument(title, documentType as TeachingDocumentRecord['documentType']) : body.content
  if (isObject(rawContent)) {
    rawContent.title = title
    rawContent.documentType = documentType
  }
  const content = assertWritableDocument(rawContent)
  const now = nowIso()
  const row: repo.TeachingDocumentRow = {
    id: createId('tdoc'),
    title,
    document_type: documentType,
    schema_version: Number(content.version),
    revision: 1,
    content_json: stableJson(content),
    created_at: now,
    updated_at: now,
  }
  repo.insertTeachingDocument(row)
  return recordFromRow(row)
}

export function updateTeachingDocument(id: string, body: Record<string, unknown>) {
  const current = requireDocument(id)
  const expectedRevision = Number(body.expectedRevision)
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new RouteError(400, 'expectedRevision 必须是正整数。')
  if (expectedRevision !== Number(current.revision)) throwRevisionConflict(expectedRevision, current)
  const previousContent = JSON.parse(current.content_json) as JsonObject
  const title = body.title === undefined ? current.title : String(body.title).trim()
  if (!title) throw new RouteError(400, '文档标题不能为空。')
  const content = assertWritableDocument(body.content === undefined ? previousContent : body.content)
  content.title = title
  const documentType = String(content.documentType || current.document_type)
  if (!DOCUMENT_TYPES.has(documentType)) throw new RouteError(400, '文档类型无效。')
  const result = repo.updateTeachingDocument({
    id,
    expectedRevision,
    title,
    documentType,
    schemaVersion: Number(content.version),
    contentJson: stableJson(content),
    updatedAt: nowIso(),
  })
  if (!result.changes) throwRevisionConflict(expectedRevision, requireDocument(id))
  return getTeachingDocument(id)
}

function cloneBlockIds(raw: unknown): unknown {
  if (!isObject(raw)) return raw
  const next: JsonObject = { ...raw }
  if (typeof raw.id === 'string') next.id = createId(String(raw.type || 'block').slice(0, 8))
  if (raw.type === 'box' && Array.isArray(raw.children)) next.children = raw.children.map(cloneBlockIds)
  return next
}

export function duplicateTeachingDocument(id: string) {
  const source = getTeachingDocument(id)
  const content = {
    ...source.content,
    title: `${source.title} 副本`,
    content: Array.isArray(source.content.content) ? source.content.content.map(cloneBlockIds) : [],
  }
  return createTeachingDocument({ title: content.title, documentType: source.documentType, content })
}

export function deleteTeachingDocument(id: string) {
  requireDocument(id)
  repo.deleteTeachingDocument(id)
  return { deleted: true, retainedAssets: repo.listTeachingDocumentAssets(id).length }
}

function throwRevisionConflict(expectedRevision: number, current: repo.TeachingDocumentRow): never {
  const content = JSON.parse(current.content_json) as JsonObject
  throw new RouteError(409, '文档已在其他位置更新。', undefined, {
    error: 'revision_conflict',
    message: '文档已在其他位置更新。',
    expectedRevision,
    actualRevision: Number(current.revision),
    current: {
      id: current.id,
      title: current.title,
      documentType: current.document_type,
      revision: Number(current.revision),
      blockCount: blockCount(content),
      updatedAt: current.updated_at,
    },
  })
}

export function uploadTeachingDocumentAsset(documentId: string, file: Express.Multer.File | undefined) {
  requireDocument(documentId)
  if (!file) throw new RouteError(400, '请上传图片文件。')
  const extension = ALLOWED_IMAGE_TYPES.get(String(file.mimetype || '').toLowerCase())
  if (!extension) throw new RouteError(400, '仅支持 PNG、JPEG 或 WebP 图片。')
  const assetId = createId('tdasset')
  const target = path.join(dataDir, 'teaching-documents', safeName(documentId), 'assets', `${safeName(assetId)}${extension}`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, file.buffer)
  try {
    const dimensions = imageDimensions(target)
    if (
      !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height)
      || dimensions.width < 1 || dimensions.height < 1
      || dimensions.width * dimensions.height > MAX_ASSET_PIXELS
    ) {
      throw new RouteError(400, '图片尺寸无效或像素总量过大。')
    }
    const now = nowIso()
    const row: repo.TeachingDocumentAssetRow = {
      id: assetId,
      document_id: documentId,
      original_name: path.basename(file.originalname || 'image'),
      mime_type: String(file.mimetype).toLowerCase(),
      byte_size: file.size || file.buffer.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      storage_path: assetPathFor(target),
      created_at: now,
    }
    repo.insertTeachingDocumentAsset(row)
    return assetFromRow(row)
  } catch (error) {
    fs.rmSync(target, { force: true })
    if (error instanceof RouteError) throw error
    throw new RouteError(400, '上传文件不是有效图片。')
  }
}

export function getTeachingDocumentAsset(assetId: string) {
  const row = repo.getTeachingDocumentAsset(assetId)
  if (!row) throw new RouteError(404, '文档图片资源不存在。')
  return assetFromRow(row)
}
