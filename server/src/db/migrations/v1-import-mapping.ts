import type { DatabaseMigration } from '../migrator.js'

function validateLegacyV1ImportMapping(database: import('node:sqlite').DatabaseSync) {
  const expectedColumns: Record<string, string[]> = {
    v1_import_batch_map: ['batch_id', 'import_job_id', 'migrated_at'],
    v1_import_run_map: ['run_id', 'source_document_id', 'import_job_id', 'migrated_at'],
    v1_import_migration_runs: ['id', 'mode', 'report_json', 'gate_passed', 'created_at'],
  }
  for (const [table, columns] of Object.entries(expectedColumns)) {
    const actual = (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name)
    if (actual.join(',') !== columns.join(',')) throw new Error(`Legacy V1 mapping migration invariant failed: ${table} columns differ`)
  }
  for (const index of ['idx_v1_import_run_map_job', 'idx_v1_import_migration_runs_created']) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)) {
      throw new Error(`Legacy V1 mapping migration invariant failed: missing index ${index}`)
    }
  }
  const violations = Number((database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM v1_import_batch_map mapping LEFT JOIN import_jobs job ON job.id = mapping.import_job_id WHERE job.id IS NULL)
      + (SELECT COUNT(*) FROM v1_import_run_map mapping LEFT JOIN source_documents source ON source.id = mapping.source_document_id WHERE source.id IS NULL)
      + (SELECT COUNT(*) FROM v1_import_run_map mapping LEFT JOIN import_jobs job ON job.id = mapping.import_job_id WHERE job.id IS NULL)
      + (SELECT COUNT(*) FROM v1_import_migration_runs WHERE gate_passed NOT IN (0, 1)) AS count
  `).get() as { count: number }).count)
  if (violations !== 0) throw new Error(`Legacy V1 mapping migration invariant failed: ${violations} data violation(s)`)
}

export const v1ImportMappingMigration: DatabaseMigration = {
  version: 5,
  name: 'v1_import_mapping',
  description: 'Record repeatable V1 batch/run to V2 ImportJob/SourceDocument mappings and migration audit runs (v1).',
  fingerprint: 'v1-import-mapping-v1',
  legacyChecksums: [
    '67aac863cab795f9af565d150cabdaabf9e5fd2321e2746869c74716a7431bab',
    '92ee071f2df07c0a9c39f5cf1e2315c622d4bf5ef0a93014f419f50d1eff6605',
  ].map((checksum) => ({
    checksum,
    description: 'Validated V1 mapping v5 intermediate build: exact mapping/audit columns and indexes exist; all mapped V2 owners exist and gate values are boolean.',
    validate: validateLegacyV1ImportMapping,
  })),
  up(database) {
    database.exec(`
      CREATE TABLE v1_import_batch_map (
        batch_id TEXT PRIMARY KEY,
        import_job_id TEXT NOT NULL UNIQUE REFERENCES import_jobs(id) ON DELETE CASCADE,
        migrated_at TEXT NOT NULL
      );

      CREATE TABLE v1_import_run_map (
        run_id TEXT PRIMARY KEY,
        source_document_id TEXT NOT NULL UNIQUE REFERENCES source_documents(id) ON DELETE CASCADE,
        import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
        migrated_at TEXT NOT NULL
      );

      CREATE TABLE v1_import_migration_runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        report_json TEXT NOT NULL,
        gate_passed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_v1_import_run_map_job ON v1_import_run_map(import_job_id, run_id);
      CREATE INDEX idx_v1_import_migration_runs_created ON v1_import_migration_runs(created_at DESC);
    `)
  },
}
