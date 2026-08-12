import type { DatabaseMigration } from '../migrator.js'

/**
 * v11 — 重建 teaching_documents 表，放宽 document_type CHECK 约束以支持错题集
 * （wrong-question-collection）文档。SQLite 无法原地修改 CHECK 约束，必须重建
 * 表；迁移保留全部现有行与索引。
 */
export const teachingDocumentTypeConstraintMigration: DatabaseMigration = {
  version: 11,
  name: 'teaching_documents_document_type',
  description: 'Rebuild teaching_documents with widened document_type CHECK constraint to allow wrong-question-collection.',
  fingerprint: 'teaching-documents-document-type-v1',
  up(database) {
    database.exec(`
      CREATE TABLE teaching_documents_document_type_v11 (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        document_type TEXT NOT NULL CHECK (document_type IN ('worksheet', 'exam', 'lecture', 'wrong-question-collection')),
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        revision INTEGER NOT NULL CHECK (revision > 0),
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO teaching_documents_document_type_v11
        (id, title, document_type, schema_version, revision, content_json, created_at, updated_at)
      SELECT id, title, document_type, schema_version, revision, content_json, created_at, updated_at
      FROM teaching_documents;

      DROP TABLE teaching_documents;
      ALTER TABLE teaching_documents_document_type_v11 RENAME TO teaching_documents;

      CREATE INDEX idx_teaching_documents_updated
        ON teaching_documents(updated_at DESC);
    `)
  },
}
