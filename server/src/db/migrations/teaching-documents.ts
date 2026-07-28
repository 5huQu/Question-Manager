import type { DatabaseMigration } from '../migrator.js'

export const teachingDocumentsMigration: DatabaseMigration = {
  version: 7,
  name: 'teaching_documents',
  description: 'Persist versioned teaching documents, optimistic revisions, and document asset metadata (v1).',
  fingerprint: 'teaching-documents-v1',
  up(database) {
    database.exec(`
      CREATE TABLE teaching_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        document_type TEXT NOT NULL CHECK (document_type IN ('worksheet', 'exam', 'lecture')),
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        revision INTEGER NOT NULL CHECK (revision > 0),
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE teaching_document_assets (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        original_name TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        width INTEGER NOT NULL CHECK (width > 0),
        height INTEGER NOT NULL CHECK (height > 0),
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_teaching_documents_updated
        ON teaching_documents(updated_at DESC);
      CREATE INDEX idx_teaching_document_assets_document
        ON teaching_document_assets(document_id, created_at);
    `)
  },
}
