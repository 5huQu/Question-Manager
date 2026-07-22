import type { DatabaseMigration } from '../migrator.js'

function validateLegacyImportProvenanceArchive(database: import('node:sqlite').DatabaseSync) {
  const columns = (database.prepare('PRAGMA table_info(import_provenance_archive)').all() as Array<{ name: string }>).map((row) => row.name)
  const expected = ['provenance_kind', 'legacy_id', 'import_job_id', 'source_document_id', 'resolution', 'detail_json', 'created_at']
  if (columns.join(',') !== expected.join(',')) throw new Error('Legacy import-provenance archive invariant failed: columns differ')
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_import_provenance_archive_job'").get()) {
    throw new Error('Legacy import-provenance archive invariant failed: missing job index')
  }
  const violations = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM import_provenance_archive archive
    LEFT JOIN import_jobs job ON job.id = archive.import_job_id
    LEFT JOIN source_documents source ON source.id = archive.source_document_id
    WHERE job.id IS NULL OR (archive.source_document_id IS NOT NULL AND source.id IS NULL)
  `).get() as { count: number }).count)
  if (violations) throw new Error(`Legacy import-provenance archive invariant failed: ${violations} ownership violation(s)`)
}

export const importProvenanceArchiveMigration: DatabaseMigration = {
  version: 6,
  name: 'import_provenance_archive',
  description: 'Audit canonical ImportJob ownership assigned to historical V2 documents and orphaned V1 run references without inventing source files (v1).',
  fingerprint: 'import-provenance-archive-v1',
  legacyChecksums: [
    'fcd86161aa7f4dcfff4c242d50d1fdf57399c620f2240d19cd53f508c2cd8246',
    '2215a1b53b0b60cf86671a91679daad497f590e9323d6863bb63f2b063c48a70',
  ].map((checksum) => ({
    checksum,
    description: 'Validated import-provenance archive v6 build: exact columns and job index exist; all archived owners resolve.',
    validate: validateLegacyImportProvenanceArchive,
  })),
  up(database) {
    database.exec(`
      CREATE TABLE import_provenance_archive (
        provenance_kind TEXT NOT NULL CHECK (provenance_kind IN ('v2_source_document', 'missing_v2_source_document', 'orphan_v1_run')),
        legacy_id TEXT NOT NULL,
        import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE RESTRICT,
        source_document_id TEXT REFERENCES source_documents(id) ON DELETE SET NULL,
        resolution TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        PRIMARY KEY (provenance_kind, legacy_id)
      );
      CREATE INDEX idx_import_provenance_archive_job
        ON import_provenance_archive(import_job_id, provenance_kind);
    `)
  },
}
