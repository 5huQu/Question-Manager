import type { DatabaseSync } from 'node:sqlite'
import type { DatabaseMigration } from '../migrator.js'

function hasColumn(database: DatabaseSync, table: string, column: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return columns.some((item) => item.name === column)
}

function validateLegacyImportJobIdentity(database: DatabaseSync) {
  if (!hasColumn(database, 'question_bank_items', 'import_job_id')) {
    throw new Error('Legacy import-job identity invariant failed: missing question_bank_items.import_job_id')
  }
  for (const table of ['import_identity_exceptions', 'import_job_ownership_conflicts', 'import_job_deletion_manifests']) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
      throw new Error(`Legacy import-job identity invariant failed: missing table ${table}`)
    }
  }
  for (const object of [
    'idx_qb_import_job_status_created', 'idx_import_job_documents_source_owner',
    'trg_import_job_documents_exclusive_insert', 'trg_import_job_documents_exclusive_update',
  ]) {
    if (!database.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(object)) {
      throw new Error(`Legacy import-job identity invariant failed: missing schema object ${object}`)
    }
  }
  const orphaned = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM question_bank_items question
    LEFT JOIN import_jobs job ON job.id = question.import_job_id
    WHERE question.import_job_id IS NOT NULL AND job.id IS NULL
  `).get() as { count: number }).count)
  if (orphaned) throw new Error(`Legacy import-job identity invariant failed: ${orphaned} orphaned question owner(s)`)
}

export const importJobIdentityMigration: DatabaseMigration = {
  version: 2,
  name: 'import_job_identity_and_safe_deletion',
  description: 'Add canonical question import_job_id, audited legacy backfill, exclusive source ownership, and retryable deletion manifests (v1).',
  fingerprint: 'import-job-identity-and-safe-deletion-v1',
  acceptLegacyChecksum: true,
  legacyChecksums: [
    '43543ae8b36eae75ef40ea864504f7264cad905c795e308bc90063a6d570145a',
    '42b7a7cd9f45d3914e736162a6a478c4b613fcd49328c69fe63e36fdcb425b31',
    '0f3019073efeef36fbf182f741c144979036f4d02ff6dcd267802b20f138c519',
  ].map((checksum) => ({
    checksum,
    description: 'Validated import-job identity v2 build: canonical owner column, audit/deletion tables, indexes and exclusivity triggers exist; question ownership has no orphaned jobs.',
    validate: validateLegacyImportJobIdentity,
  })),
  up(database) {
    if (!hasColumn(database, 'question_bank_items', 'import_job_id')) {
      database.exec('ALTER TABLE question_bank_items ADD COLUMN import_job_id TEXT REFERENCES import_jobs(id) ON DELETE SET NULL')
    }

    database.exec(`
      CREATE TABLE IF NOT EXISTS import_identity_exceptions (
        question_id TEXT PRIMARY KEY,
        import_source_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        candidate_job_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS import_job_ownership_conflicts (
        source_document_id TEXT PRIMARY KEY,
        job_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS import_job_deletion_manifests (
        job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source_document_ids_json TEXT NOT NULL DEFAULT '[]',
        moved_paths_json TEXT NOT NULL DEFAULT '[]',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_qb_import_job_status_created
        ON question_bank_items(import_job_id, bank_status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_import_job_documents_source_owner
        ON import_job_documents(source_document_id, job_id);

      CREATE TRIGGER IF NOT EXISTS trg_import_job_documents_exclusive_insert
      BEFORE INSERT ON import_job_documents
      WHEN EXISTS (
        SELECT 1 FROM import_job_documents
        WHERE source_document_id = NEW.source_document_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'source document already belongs to another import job');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_import_job_documents_exclusive_update
      BEFORE UPDATE OF source_document_id, job_id ON import_job_documents
      WHEN EXISTS (
        SELECT 1 FROM import_job_documents
        WHERE source_document_id = NEW.source_document_id AND job_id != NEW.job_id AND id != OLD.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'source document already belongs to another import job');
      END;
    `)

    const now = new Date().toISOString()
    database.prepare(`
      UPDATE question_bank_items
      SET import_job_id = import_source_id
      WHERE import_job_id IS NULL
        AND import_source_id != ''
        AND EXISTS (SELECT 1 FROM import_jobs WHERE id = question_bank_items.import_source_id)
    `).run()
    database.prepare(`
      UPDATE question_bank_items
      SET import_job_id = SUBSTR(import_source_id, 10)
      WHERE import_job_id IS NULL
        AND import_source_id LIKE 'ifv2-job:%'
        AND EXISTS (SELECT 1 FROM import_jobs WHERE id = SUBSTR(question_bank_items.import_source_id, 10))
    `).run()
    database.prepare(`
      UPDATE question_bank_items
      SET import_job_id = (
        SELECT MIN(job_id) FROM import_job_documents
        WHERE source_document_id = question_bank_items.import_source_id
      )
      WHERE import_job_id IS NULL
        AND import_source_id != ''
        AND (SELECT COUNT(DISTINCT job_id) FROM import_job_documents WHERE source_document_id = question_bank_items.import_source_id) = 1
    `).run()

    database.prepare(`
      INSERT OR REPLACE INTO import_identity_exceptions
        (question_id, import_source_id, reason, candidate_job_ids_json, created_at)
      SELECT q.id, q.import_source_id,
        CASE
          WHEN COUNT(DISTINCT d.job_id) > 1 THEN 'ambiguous_source_document'
          ELSE 'unresolved_import_source'
        END,
        COALESCE(json_group_array(DISTINCT d.job_id) FILTER (WHERE d.job_id IS NOT NULL), '[]'), ?
      FROM question_bank_items q
      LEFT JOIN import_job_documents d ON d.source_document_id = q.import_source_id
      WHERE q.import_job_id IS NULL AND q.import_source_id != ''
      GROUP BY q.id, q.import_source_id
    `).run(now)

    database.prepare(`
      INSERT OR REPLACE INTO import_job_ownership_conflicts (source_document_id, job_ids_json, created_at)
      SELECT source_document_id, json_group_array(DISTINCT job_id), ?
      FROM import_job_documents
      GROUP BY source_document_id
      HAVING COUNT(*) > 1
    `).run(now)
  },
}
