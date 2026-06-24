import { db } from '../db/connection.js'
import type {
  CreateOCRDocumentInput,
  OCRDocumentProvider,
  OCRDocumentRow,
  StoredOCRDocument,
  UpdateOCRDocumentInput,
} from '../types/ocr-document.js'
import { createId, nowIso } from '../utils/ids.js'
import { parseJson } from '../utils/json.js'

type SqlValue = string | number | bigint | null | Buffer

export type ListOcrDocumentsFilters = {
  sourceDocumentId?: string
  provider?: OCRDocumentProvider
  limit?: number
  offset?: number
}

function normalizeLimit(value: number | undefined, fallback = 100) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(500, Math.floor(numeric)))
}

function normalizeOffset(value: number | undefined) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function stringifyObject(value: Record<string, unknown> | undefined) {
  return JSON.stringify(value || {})
}

export function mapOcrDocument(row: OCRDocumentRow): StoredOCRDocument {
  return {
    id: row.id,
    sourceDocumentId: row.source_document_id,
    provider: row.provider,
    rawResultPath: row.raw_result_path,
    markdownPath: row.markdown_path,
    blocksJsonPath: row.blocks_json_path,
    assetsJsonPath: row.assets_json_path,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json || '{}', {}),
    createdAt: row.created_at,
  }
}

export function createOcrDocument(input: CreateOCRDocumentInput) {
  const createdAt = input.createdAt || nowIso()
  const id = input.id || createId('ocrdoc', input.sourceDocumentId)
  db.prepare(`
    INSERT INTO ocr_documents (
      id, source_document_id, provider, raw_result_path, markdown_path, blocks_json_path, assets_json_path, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.sourceDocumentId,
    input.provider,
    input.rawResultPath || '',
    input.markdownPath || '',
    input.blocksJsonPath || '',
    input.assetsJsonPath || '',
    stringifyObject(input.metadata),
    createdAt,
  )
  return getOcrDocument(id)
}

export function getOcrDocument(id: string) {
  const row = db.prepare(`SELECT * FROM ocr_documents WHERE id = ?`).get(id) as OCRDocumentRow | undefined
  return row ? mapOcrDocument(row) : null
}

export function listOcrDocuments(filters: ListOcrDocumentsFilters = {}) {
  const where: string[] = []
  const values: SqlValue[] = []
  if (filters.sourceDocumentId) {
    where.push('source_document_id = ?')
    values.push(filters.sourceDocumentId)
  }
  if (filters.provider) {
    where.push('provider = ?')
    values.push(filters.provider)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = normalizeLimit(filters.limit)
  const offset = normalizeOffset(filters.offset)
  const rows = db.prepare(`
    SELECT * FROM ocr_documents
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as OCRDocumentRow[]
  return rows.map(mapOcrDocument)
}

export function updateOcrDocument(id: string, input: UpdateOCRDocumentInput) {
  const assignments: string[] = []
  const values: SqlValue[] = []
  const add = (column: string, value: SqlValue | undefined) => {
    if (value === undefined) return
    assignments.push(`${column} = ?`)
    values.push(value)
  }

  add('provider', input.provider)
  add('raw_result_path', input.rawResultPath)
  add('markdown_path', input.markdownPath)
  add('blocks_json_path', input.blocksJsonPath)
  add('assets_json_path', input.assetsJsonPath)
  add('metadata_json', input.metadata === undefined ? undefined : stringifyObject(input.metadata))

  if (!assignments.length) return getOcrDocument(id)
  db.prepare(`UPDATE ocr_documents SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id)
  return getOcrDocument(id)
}
