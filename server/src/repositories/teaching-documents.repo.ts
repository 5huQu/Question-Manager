import { db } from '../db/connection.js'

export type TeachingDocumentRow = {
  id: string
  title: string
  document_type: string
  schema_version: number
  revision: number
  content_json: string
  created_at: string
  updated_at: string
}

export type TeachingDocumentAssetRow = {
  id: string
  document_id: string
  original_name: string
  mime_type: string
  byte_size: number
  width: number
  height: number
  storage_path: string
  created_at: string
}

export function listTeachingDocuments() {
  return db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM teaching_document_assets a WHERE a.document_id = d.id) AS asset_count
    FROM teaching_documents d
    ORDER BY d.updated_at DESC, d.id ASC
  `).all() as Array<TeachingDocumentRow & { asset_count: number }>
}

export function getTeachingDocument(id: string) {
  return db.prepare('SELECT * FROM teaching_documents WHERE id = ?').get(id) as TeachingDocumentRow | undefined
}

export function insertTeachingDocument(row: TeachingDocumentRow) {
  return db.prepare(`
    INSERT INTO teaching_documents
      (id, title, document_type, schema_version, revision, content_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.title, row.document_type, row.schema_version, row.revision, row.content_json, row.created_at, row.updated_at)
}

export function updateTeachingDocument(input: {
  id: string
  expectedRevision: number
  title: string
  documentType: string
  schemaVersion: number
  contentJson: string
  updatedAt: string
}) {
  return db.prepare(`
    UPDATE teaching_documents
    SET title = ?, document_type = ?, schema_version = ?, content_json = ?,
        revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ?
  `).run(
    input.title,
    input.documentType,
    input.schemaVersion,
    input.contentJson,
    input.updatedAt,
    input.id,
    input.expectedRevision,
  )
}

export function deleteTeachingDocument(id: string) {
  return db.prepare('DELETE FROM teaching_documents WHERE id = ?').run(id)
}

export function listTeachingDocumentAssets(documentId: string) {
  return db.prepare(`
    SELECT * FROM teaching_document_assets
    WHERE document_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(documentId) as TeachingDocumentAssetRow[]
}

export function getTeachingDocumentAsset(id: string) {
  return db.prepare('SELECT * FROM teaching_document_assets WHERE id = ?').get(id) as TeachingDocumentAssetRow | undefined
}

export function insertTeachingDocumentAsset(row: TeachingDocumentAssetRow) {
  return db.prepare(`
    INSERT INTO teaching_document_assets
      (id, document_id, original_name, mime_type, byte_size, width, height, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.document_id,
    row.original_name,
    row.mime_type,
    row.byte_size,
    row.width,
    row.height,
    row.storage_path,
    row.created_at,
  )
}
