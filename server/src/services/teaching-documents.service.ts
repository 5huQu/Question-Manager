import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { dataDir } from '../config.js'
import * as repo from '../repositories/teaching-documents.repo.js'
import { RouteError } from '../utils/http-error.js'
import { createId, nowIso, safeName } from '../utils/ids.js'
import { assetPathFor } from '../utils/paths.js'
import { imageDimensions } from '../utils/image-operations.js'
import { sanitizeSvg } from './teaching-documents/svg-sanitizer.js'
import { compileTikz } from './teaching-documents/tikz-renderer.js'

const DOCUMENT_TYPES = new Set(['worksheet', 'exam', 'lecture', 'wrong-question-collection'])
const KNOWN_BLOCK_TYPES = new Set([
  'heading', 'paragraph', 'blockMath', 'figure', 'question', 'box',
  'divider', 'spacer', 'pageBreak', 'rawMarkdown', 'table', 'unknown',
  'tikz',
])
const MAX_ASSET_PIXELS = 60_000_000
const FATAL_ISSUE_CODES = new Set([
  'invalid-root', 'unsupported-version', 'invalid-document-type', 'invalid-title',
  'invalid-metadata', 'invalid-content', 'empty-id', 'duplicate-id', 'auto-id',
  'invalid-inline-content', 'invalid-box-children', 'absolute-legacy-path',
  'invalid-outline', 'invalid-heading-numbering', 'invalid-table',
  'invalid-inline-format', 'invalid-text-layout', 'invalid-box-appearance', 'invalid-teaching-skin',
])
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
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
  documentType: 'worksheet' | 'exam' | 'lecture' | 'wrong-question-collection'
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

export type PrintTemplate = { id: string; name: string; options: JsonObject; createdAt: string; updatedAt: string }

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function printTemplateFromRow(row: repo.PrintTemplateRow): PrintTemplate {
  let options: unknown
  try { options = JSON.parse(row.options_json) } catch { options = {} }
  return { id: row.id, name: row.name, options: isObject(options) ? options : {}, createdAt: row.created_at, updatedAt: row.updated_at }
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
    if (inline.type === 'text') {
      if (inline.fontSize !== undefined && ![12, 14, 16, 18, 20, 24].includes(Number(inline.fontSize))) {
        issues.push({ level: 'error', code: 'invalid-inline-format', blockId, message: '行内字号只能为 12、14、16、18、20 或 24。' })
      }
      if (inline.color !== undefined && (typeof inline.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(inline.color))) {
        issues.push({ level: 'error', code: 'invalid-inline-format', blockId, message: '行内文字颜色必须是 #RRGGBB。' })
      }
    }
  }
}

function validateTextLayout(raw: JsonObject, blockId: string, issues: TeachingDocumentIssue[], allowList = false) {
  if (raw.alignment !== undefined && !['left', 'center', 'right', 'justify'].includes(String(raw.alignment))) {
    issues.push({ level: 'error', code: 'invalid-text-layout', blockId, message: '文字对齐方式无效。' })
  }
  if (raw.indentLevel !== undefined && (![0, 1, 2, 3, 4].includes(Number(raw.indentLevel)) || !Number.isInteger(Number(raw.indentLevel)))) {
    issues.push({ level: 'error', code: 'invalid-text-layout', blockId, message: '文字缩进只能为 0 至 4 级。' })
  }
  if (raw.listStyle !== undefined && (!allowList || !['bullet', 'ordered'].includes(String(raw.listStyle)))) {
    issues.push({ level: 'error', code: 'invalid-text-layout', blockId, message: '列表样式无效。' })
  }
}

function validateBoxAppearance(value: unknown, blockId: string, issues: TeachingDocumentIssue[]) {
  if (value === undefined) return
  if (!isObject(value)) {
    issues.push({ level: 'error', code: 'invalid-box-appearance', blockId, message: '卡片样式必须是对象。' })
    return
  }
  if (value.background !== undefined && !['template', 'white', 'blue', 'gray', 'amber', 'green'].includes(String(value.background))) {
    issues.push({ level: 'error', code: 'invalid-box-appearance', blockId, message: '卡片背景色无效。' })
  }
  if (value.borderColor !== undefined && !['template', 'zinc', 'blue', 'amber', 'green'].includes(String(value.borderColor))) {
    issues.push({ level: 'error', code: 'invalid-box-appearance', blockId, message: '卡片边框颜色无效。' })
  }
  if (value.borderWidth !== undefined && ![0, 1, 2].includes(Number(value.borderWidth))) {
    issues.push({ level: 'error', code: 'invalid-box-appearance', blockId, message: '卡片边框宽度只能为 0、1 或 2。' })
  }
  if (value.cornerRadius !== undefined && ![0, 4, 8, 12].includes(Number(value.cornerRadius))) {
    issues.push({ level: 'error', code: 'invalid-box-appearance', blockId, message: '卡片圆角无效。' })
  }
  if (value.padding !== undefined) {
    if (!isObject(value.padding)) {
      issues.push({ level: 'error', code: 'invalid-box-appearance', blockId, message: '卡片内距必须是对象。' })
    } else {
      for (const [side, padding] of Object.entries(value.padding)) {
        if (!['top', 'right', 'bottom', 'left'].includes(side) || ![8, 12, 16, 20, 24].includes(Number(padding))) {
          issues.push({ level: 'error', code: 'invalid-box-appearance', blockId, message: '卡片内距只能使用预设值。' })
          break
        }
      }
    }
  }
}

const SKIN_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/
/** Keep this persisted grammar aligned with frontend's isTeachingSkinLocalDesignId. */
const SKIN_LOCAL_VARIANT_ID = /^[a-z][A-Za-z0-9]*$/
const TEACHING_SKIN_REF_KEYS = new Set(['id', 'version', 'variant', 'settings'])
const UNSAFE_SKIN_SETTING_KEY = /^(?:css|cssText|html|react|className|class|style|script|component)$/i

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isObject(value) && Object.entries(value).every(([, item]) => isJsonValue(item))
}

function isSafeSkinSettingValue(value: unknown): boolean {
  if (!isJsonValue(value)) return false
  if (Array.isArray(value)) return value.every(isSafeSkinSettingValue)
  return !isObject(value) || Object.entries(value).every(([key, item]) => !UNSAFE_SKIN_SETTING_KEY.test(key) && isSafeSkinSettingValue(item))
}

/** Server validates only the safe persisted ref contract; it never needs the frontend registry. */
function validateTeachingSkin(value: unknown, blockId: string, issues: TeachingDocumentIssue[]) {
  if (value === undefined) return
  if (!isObject(value) || !SKIN_ID.test(String(value.id || ''))) {
    issues.push({ level: 'error', code: 'invalid-teaching-skin', blockId, message: '皮肤引用必须包含有效的命名空间 ID。' })
    return
  }
  if (Object.keys(value).some((key) => !TEACHING_SKIN_REF_KEYS.has(key))) {
    issues.push({ level: 'error', code: 'invalid-teaching-skin', blockId, message: '皮肤引用只能包含 id、version、variant 和 settings。' })
    return
  }
  if (value.version !== undefined && (!Number.isInteger(value.version) || Number(value.version) < 1)) {
    issues.push({ level: 'error', code: 'invalid-teaching-skin', blockId, message: '皮肤版本必须是正整数。' })
  }
  if (value.variant !== undefined && (typeof value.variant !== 'string' || !SKIN_LOCAL_VARIANT_ID.test(value.variant))) {
    issues.push({ level: 'error', code: 'invalid-teaching-skin', blockId, message: '皮肤变体必须是有效的局部标识符。' })
  }
  if (value.settings !== undefined) {
    if (!isObject(value.settings) || Object.entries(value.settings).some(([key, item]) => UNSAFE_SKIN_SETTING_KEY.test(key) || !isSafeSkinSettingValue(item))) {
      issues.push({ level: 'error', code: 'invalid-teaching-skin', blockId, message: '皮肤设置只能包含安全的 JSON 数据，不能包含 CSS、HTML 或可执行配置。' })
    }
  }
}

function validateOutline(value: unknown, issues: TeachingDocumentIssue[]) {
  if (value === undefined) return
  if (!isObject(value)) { issues.push({ level: 'error', code: 'invalid-outline', message: '章节设置必须是对象。' }); return }
  if (value.numberingEnabled !== undefined && typeof value.numberingEnabled !== 'boolean') issues.push({ level: 'error', code: 'invalid-outline', message: '章节编号开关必须是布尔值。' })
  if (value.preset !== undefined && !['textbook', 'decimal', 'chinese', 'exam', 'chapter-chinese', 'chapter-decimal', 'chapter-section', 'roman', 'paren', 'none'].includes(String(value.preset))) issues.push({ level: 'error', code: 'invalid-outline', message: '章节编号方案无效。' })
  if (value.levels !== undefined && !isObject(value.levels)) issues.push({ level: 'error', code: 'invalid-outline', message: '章节分级设置必须是对象。' })
}

function validateHeadingNumbering(value: unknown, blockId: string, issues: TeachingDocumentIssue[]) {
  if (value === undefined) return
  if (!isObject(value)) { issues.push({ level: 'error', code: 'invalid-heading-numbering', blockId, message: '标题编号设置必须是对象。' }); return }
  if (value.mode !== undefined && !['inherit', 'none', 'manual'].includes(String(value.mode))) issues.push({ level: 'error', code: 'invalid-heading-numbering', blockId, message: '标题编号模式无效。' })
  if (value.manualLabel !== undefined && (typeof value.manualLabel !== 'string' || value.manualLabel.length > 40)) issues.push({ level: 'error', code: 'invalid-heading-numbering', blockId, message: '手动标题编号必须是不超过 40 个字符的文本。' })
  if (value.restartAt !== undefined && (typeof value.restartAt !== 'number' || !Number.isInteger(value.restartAt) || value.restartAt < 1 || value.restartAt > 999)) issues.push({ level: 'error', code: 'invalid-heading-numbering', blockId, message: '标题重新编号必须是 1 到 999 的整数。' })
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
  validateOutline(value.outline, issues)

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
    if (insideBox && ['box', 'heading', 'pageBreak'].includes(type)) {
      issues.push({ level: 'warning', code: 'illegal-box-child', blockId: id, message: `盒子内非法块 "${type}" 将保留。` })
    }
    if (type === 'heading' || type === 'paragraph') {
      validateInlines(raw.content, id, issues)
      validateTextLayout(raw, id, issues, type === 'paragraph')
    }
    if (type === 'table') {
      if (!Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > 20) {
        issues.push({ level: 'error', code: 'invalid-table', blockId: id, message: '表格必须包含 1 至 20 行。' })
      } else {
        const columnCount = Array.isArray(raw.rows[0]) ? raw.rows[0].length : 0
        if (columnCount < 1 || columnCount > 12 || raw.rows.some((row) => !Array.isArray(row) || row.length !== columnCount)) {
          issues.push({ level: 'error', code: 'invalid-table', blockId: id, message: '表格各行必须具有一致且合法的列数。' })
        } else {
          raw.rows.forEach((row: unknown, rowIndex: number) => {
            if (!Array.isArray(row)) return
            row.forEach((cell: unknown, cellIndex: number) => {
              validateInlines(isObject(cell) ? cell.content : undefined, `${id}-${rowIndex}-${cellIndex}`, issues)
            })
          })
        }
      }
    }
    if (type === 'heading') {
      validateHeadingNumbering(raw.numbering, id, issues)
      validateTeachingSkin(raw.skin, id, issues)
    }
    if (type === 'question' && (typeof raw.questionId !== 'string' || !raw.questionId.trim())) {
      issues.push({ level: 'error', code: 'invalid-question-ref', blockId: id, message: '题目引用必须是字符串。' })
    }
    if (type === 'question' && isObject(raw.display) && raw.display.choiceLayout !== undefined
      && !['auto', 'four', 'two', 'one'].includes(String(raw.display.choiceLayout))) {
      issues.push({ level: 'error', code: 'invalid-question-layout', blockId: id, message: '题目选项布局只能是 auto、four、two 或 one。' })
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
      if (raw.groupItems !== undefined) {
        if (!Array.isArray(raw.groupItems) || raw.groupItems.length < 1 || raw.groupItems.length > 12) {
          issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片组必须包含 1 至 12 张图片。' })
        } else {
          raw.groupItems.forEach((entry: unknown) => {
            const item = isObject(entry) ? entry : {}
            const itemAsset = item.asset
            if (!isObject(itemAsset) || !['questionFigure', 'documentAsset', 'legacyPath'].includes(String(itemAsset.type || ''))) {
              issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片组包含无效资源引用。' })
            } else if (itemAsset.type === 'legacyPath' && (/^(?:[a-zA-Z]:[\\/]|\/|file:\/\/)/.test(String(itemAsset.path || '').trim()) || !String(itemAsset.path || '').trim())) {
              issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片组 legacyPath 引用无效。' })
            } else if (itemAsset.type === 'documentAsset' && !String(itemAsset.assetId || '').trim()) {
              issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片组 documentAsset 引用不能为空。' })
            } else if (itemAsset.type === 'questionFigure' && (!String(itemAsset.questionId || '').trim() || !String(itemAsset.figureId || '').trim())) {
              issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片组题图引用必须完整。' })
            }
          })
        }
        if (![1, 2, 3].includes(Number(raw.groupColumns))) {
          issues.push({ level: 'error', code: 'invalid-figure-ref', blockId: id, message: '图片组列数只能为 1、2 或 3。' })
        }
      }
    }
    if (type === 'tikz') {
      if (typeof raw.source !== 'string' || raw.source.length > 50_000) issues.push({ level: 'error', code: 'invalid-tikz-source', blockId: id, message: 'TikZ 源码无效或过长。' })
      if (raw.svgAssetId !== undefined && typeof raw.svgAssetId !== 'string') issues.push({ level: 'error', code: 'invalid-tikz-asset', blockId: id, message: 'TikZ SVG 资源引用无效。' })
      if (raw.alignment !== undefined && !['left', 'center', 'right'].includes(String(raw.alignment))) issues.push({ level: 'error', code: 'invalid-tikz-layout', blockId: id, message: 'TikZ 对齐方式无效。' })
    }
    if (type === 'box') {
      validateBoxAppearance(raw.appearance, id, issues)
      validateTeachingSkin(raw.skin, id, issues)
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
    url: `/files/${row.storage_path.replace(/^\/+/, '')}`,
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
    if (raw.type === 'tikz' && typeof raw.svgAssetId === 'string') ids.add(raw.svgAssetId)
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

function defaultTypographyStyle(documentType: TeachingDocumentRecord['documentType']) {
  const preset = documentType === 'lecture' ? 'lecture' : 'exam'
  return preset === 'lecture'
    ? { typographyPreset: preset, bodyFont: 'songti', bodyLatinFont: 'georgia', bodyNumberFont: 'times', headingFont: 'heiti', headingLatinFont: 'arial', headingNumberFont: 'times', marginPreset: 'normal', questionSpacing: 'normal' }
    : { typographyPreset: preset, bodyFont: 'songti', bodyLatinFont: 'times', bodyNumberFont: 'times', headingFont: 'heiti', headingLatinFont: 'arial', headingNumberFont: 'times', marginPreset: 'compact', questionSpacing: 'compact' }
}

function emptyDocument(title: string, documentType: TeachingDocumentRecord['documentType']): JsonObject {
  return { version: 1, documentType, title, metadata: {}, content: [], style: defaultTypographyStyle(documentType) }
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
    const svg = extension === '.svg' ? sanitizeSvg(file.buffer) : undefined
    if (svg) fs.writeFileSync(target, svg.content)
    const dimensions = svg ? { width: svg.width, height: svg.height } : imageDimensions(target)
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
      byte_size: svg?.content.byteLength || file.size || file.buffer.byteLength,
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

export async function renderTeachingDocumentTikz(documentId: string, source: unknown) {
  requireDocument(documentId)
  const result = await compileTikz(source)
  const cached = repo.listTeachingDocumentAssets(documentId).find((asset) => asset.original_name === `tikz-${result.sourceHash.slice(7)}.svg`)
  if (cached) return { asset: assetFromRow(cached), sourceHash: result.sourceHash, cached: true, warnings: [] as string[] }
  const assetId = createId('tdasset')
  const target = path.join(dataDir, 'teaching-documents', safeName(documentId), 'assets', `${safeName(assetId)}.svg`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    fs.writeFileSync(target, result.content)
    const row: repo.TeachingDocumentAssetRow = { id: assetId, document_id: documentId, original_name: `tikz-${result.sourceHash.slice(7)}.svg`, mime_type: 'image/svg+xml', byte_size: result.content.byteLength, width: result.width, height: result.height, storage_path: assetPathFor(target), created_at: nowIso() }
    repo.insertTeachingDocumentAsset(row)
    return { asset: assetFromRow(row), sourceHash: result.sourceHash, cached: false, warnings: [] as string[] }
  } catch (error) { fs.rmSync(target, { force: true }); throw error }
}

export function getTeachingDocumentAsset(assetId: string) {
  const row = repo.getTeachingDocumentAsset(assetId)
  if (!row) throw new RouteError(404, '文档图片资源不存在。')
  return assetFromRow(row)
}

export function listPrintTemplates() { return { items: repo.listPrintTemplates().map(printTemplateFromRow) } }
export function createPrintTemplate(body: Record<string, unknown>) {
  const name = String(body.name || '').trim()
  if (!name) throw new RouteError(400, '模板名称不能为空。')
  if (name.length > 80) throw new RouteError(400, '模板名称不能超过 80 个字符。')
  if (!isObject(body.options)) throw new RouteError(400, '模板配置无效。')
  const now = nowIso(); const row = { id: createId('ptpl'), name, options_json: stableJson(body.options), created_at: now, updated_at: now }
  repo.insertPrintTemplate(row); return printTemplateFromRow(row)
}
export function updatePrintTemplate(id: string, body: Record<string, unknown>) {
  if (!repo.getPrintTemplate(id)) throw new RouteError(404, '模板不存在。')
  const name = String(body.name || '').trim()
  if (!name || name.length > 80) throw new RouteError(400, '模板名称无效。')
  if (!isObject(body.options)) throw new RouteError(400, '模板配置无效。')
  repo.updatePrintTemplate({ id, name, options_json: stableJson(body.options), updated_at: nowIso() })
  return printTemplateFromRow(repo.getPrintTemplate(id)!)
}
export function deletePrintTemplate(id: string) {
  if (!repo.getPrintTemplate(id)) throw new RouteError(404, '模板不存在。')
  repo.deletePrintTemplate(id); return { deleted: true }
}
