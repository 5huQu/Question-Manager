import type { TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import type { TeachingDocumentPrintVariant } from '../printVariant'
import type { PrintLayoutSpec } from './printLayout'
import type { PaperSpec } from './types'

const blockContentCache = new WeakMap<object, string>()
const blockResourceCache = new WeakMap<object, string>()

function hashText(text: string) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function stableValueText(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `s:${value.length}:${value}`
  if (typeof value === 'number') return `n:${Number.isNaN(value) ? 'nan' : value}`
  if (typeof value === 'boolean') return value ? 'b:1' : 'b:0'
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`
  if (seen.has(value)) return 'circular'
  seen.add(value)
  if (Array.isArray(value)) {
    const result = `a:${value.length}:[${value.map((item) => stableValueText(item, seen)).join('|')}]`
    seen.delete(value)
    return result
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const result = `o:{${keys.map((key) => `${key}=${stableValueText(record[key], seen)}`).join('|')}}`
  seen.delete(value)
  return result
}

function stableValueSignature(value: unknown) {
  const text = stableValueText(value)
  return `${text.length.toString(36)}-${hashText(text)}`
}

function blockContentSignature(block: TeachingBlock) {
  const cached = blockContentCache.get(block)
  if (cached) return cached
  const signature = stableValueSignature(block)
  blockContentCache.set(block, signature)
  return signature
}

export function teachingBlockContentSignature(block: TeachingBlock) {
  return blockContentSignature(block)
}

function collectResourceShape(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return undefined
  if (['questionId', 'asset', 'assetId', 'figureId', 'insertedFigures', 'font', 'path', 'src', 'url'].includes(key)) {
    return value
  }
  if (typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    const items = value.map((item) => collectResourceShape(item)).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  const record = value as Record<string, unknown>
  if (record.type === 'rawMarkdown') return { type: 'rawMarkdown', markdown: record.markdown }
  const shape = Object.fromEntries(Object.keys(record).sort().flatMap((childKey) => {
    const child = collectResourceShape(record[childKey], childKey)
    return child === undefined ? [] : [[childKey, child]]
  }))
  return Object.keys(shape).length ? shape : undefined
}

function blockResourceSignature(block: TeachingBlock) {
  const cached = blockResourceCache.get(block)
  if (cached !== undefined) return cached
  const shape = collectResourceShape(block)
  const signature = shape === undefined ? '' : stableValueSignature(shape)
  blockResourceCache.set(block, signature)
  return signature
}

function combineSignatures(label: string, parts: Array<string | number | boolean | undefined>) {
  return `${label}-${hashText(parts.map((part) => String(part ?? '')).join('|'))}`
}

export function teachingDocumentBlockContentSignature(document: TeachingDocumentV1) {
  return combineSignatures('content', [
    document.version,
    document.documentType,
    stableValueSignature(document.title),
    stableValueSignature(document.outline),
    ...document.content.map(blockContentSignature),
  ])
}

export function teachingDocumentResourceRevision(input: {
  document: TeachingDocumentV1
  renderVersion?: string
  fontVars?: Record<string, string>
}) {
  return combineSignatures('resources', [
    input.renderVersion,
    stableValueSignature(input.fontVars),
    ...input.document.content.map(blockResourceSignature).filter(Boolean),
  ])
}

export function teachingDocumentLayoutStyleSignature(input: {
  document: TeachingDocumentV1
  paper: PaperSpec
  printLayout: PrintLayoutSpec
  fontVars?: Record<string, string>
  spread: boolean
}) {
  return combineSignatures('style', [
    stableValueSignature(input.document.style),
    stableValueSignature(input.paper),
    stableValueSignature(input.printLayout),
    stableValueSignature(input.fontVars),
    input.spread,
  ])
}

export interface TeachingDocumentLayoutSignatures {
  documentRevision: string
  resourceRevision: string
  layoutStyleSignature: string
  blockContentSignature: string
  variant: TeachingDocumentPrintVariant | 'source'
  geometrySignature: string
  paginationSignature: string
}

export function createTeachingDocumentLayoutSignatures(input: {
  document: TeachingDocumentV1
  paper: PaperSpec
  printLayout: PrintLayoutSpec
  fontVars?: Record<string, string>
  renderVersion?: string
  spread: boolean
  variant?: TeachingDocumentPrintVariant
}): TeachingDocumentLayoutSignatures {
  const blockSignature = teachingDocumentBlockContentSignature(input.document)
  const resourceRevision = teachingDocumentResourceRevision(input)
  const layoutStyleSignature = teachingDocumentLayoutStyleSignature(input)
  const variant = input.variant ?? 'source'
  const documentRevision = combineSignatures('document', [blockSignature, layoutStyleSignature])
  const geometrySignature = combineSignatures('geometry', [
    blockSignature,
    resourceRevision,
    layoutStyleSignature,
    variant,
  ])
  return {
    documentRevision,
    resourceRevision,
    layoutStyleSignature,
    blockContentSignature: blockSignature,
    variant,
    geometrySignature,
    paginationSignature: combineSignatures('pagination', [geometrySignature, variant]),
  }
}
