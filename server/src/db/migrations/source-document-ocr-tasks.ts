import type { DatabaseMigration } from '../migrator.js'

function validateLegacyOcrTasks(database: import('node:sqlite').DatabaseSync) {
  const expectedColumns = [
    'id', 'source_document_id', 'provider', 'status', 'attempt', 'provider_task_id', 'provider_phase',
    'provider_progress', 'started_at', 'finished_at', 'heartbeat_at', 'lease_owner', 'lease_expires_at',
    'ocr_document_id', 'error_code', 'error_message', 'metadata_json', 'created_at', 'updated_at',
  ]
  const actualColumns = (database.prepare('PRAGMA table_info(source_document_ocr_tasks)').all() as Array<{ name: string }>).map((row) => row.name)
  if (actualColumns.join(',') !== expectedColumns.join(',')) {
    throw new Error('Legacy OCR-task migration invariant failed: source_document_ocr_tasks columns differ')
  }
  for (const index of ['idx_source_document_ocr_tasks_one_active', 'idx_source_document_ocr_tasks_source_latest', 'idx_source_document_ocr_tasks_recovery']) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)) {
      throw new Error(`Legacy OCR-task migration invariant failed: missing index ${index}`)
    }
  }
  const violations = Number((database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM source_document_ocr_tasks task LEFT JOIN source_documents source ON source.id = task.source_document_id WHERE source.id IS NULL)
      + (SELECT COUNT(*) FROM source_document_ocr_tasks WHERE provider NOT IN ('doc2x', 'glm'))
      + (SELECT COUNT(*) FROM source_document_ocr_tasks WHERE status NOT IN ('queued', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled'))
      + (SELECT COUNT(*) FROM source_document_ocr_tasks WHERE attempt <= 0)
      + (SELECT COUNT(*) FROM (SELECT source_document_id FROM source_document_ocr_tasks WHERE status IN ('queued', 'running') GROUP BY source_document_id HAVING COUNT(*) > 1)) AS count
  `).get() as { count: number }).count)
  if (violations !== 0) throw new Error(`Legacy OCR-task migration invariant failed: ${violations} data violation(s)`)
}

export const sourceDocumentOcrTasksMigration: DatabaseMigration = {
  version: 4,
  name: 'source_document_ocr_tasks',
  description: 'Persist V2 source-document OCR attempts, leases, progress, results, and structured failures (v1).',
  fingerprint: 'source-document-ocr-tasks-v1',
  legacyChecksums: [
    'e7fabb750929abfcc6724de92ce500e1f5ed63f7eb485fa22080d89931d1fb63',
    '71cddb3aabfbcca70b7267966c4d3adf81cd4c949228d1d7360ef9580bf191a6',
  ].map((checksum) => ({
    checksum,
    description: 'Validated OCR-task v4 intermediate build: exact columns and lifecycle indexes exist; source ownership, provider/status/attempt domains, and one-active-task invariant hold.',
    validate: validateLegacyOcrTasks,
  })),
  up(database) {
    database.exec(`
      CREATE TABLE source_document_ocr_tasks (
        id TEXT PRIMARY KEY,
        source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('doc2x', 'glm')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled')),
        attempt INTEGER NOT NULL CHECK (attempt > 0),
        provider_task_id TEXT NOT NULL DEFAULT '',
        provider_phase TEXT NOT NULL DEFAULT '',
        provider_progress INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL DEFAULT '',
        finished_at TEXT NOT NULL DEFAULT '',
        heartbeat_at TEXT NOT NULL DEFAULT '',
        lease_owner TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT NOT NULL DEFAULT '',
        ocr_document_id TEXT REFERENCES ocr_documents(id) ON DELETE SET NULL,
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_document_id, attempt)
      );

      CREATE UNIQUE INDEX idx_source_document_ocr_tasks_one_active
        ON source_document_ocr_tasks(source_document_id)
        WHERE status IN ('queued', 'running');
      CREATE INDEX idx_source_document_ocr_tasks_source_latest
        ON source_document_ocr_tasks(source_document_id, attempt DESC);
      CREATE INDEX idx_source_document_ocr_tasks_recovery
        ON source_document_ocr_tasks(status, lease_expires_at);

      INSERT INTO source_document_ocr_tasks (
        id, source_document_id, provider, status, attempt, started_at, finished_at,
        error_code, error_message, metadata_json, created_at, updated_at
      )
      SELECT 'ocrtask_migrated_' || id, id, provider, 'interrupted', 1, updated_at, CURRENT_TIMESTAMP,
             'legacy_process_interrupted', 'OCR task was running before persistent task tracking was installed.',
             '{"migratedFromSourceDocumentStatus":true}', updated_at, CURRENT_TIMESTAMP
      FROM source_documents
      WHERE status = 'ocr_running' AND provider IN ('doc2x', 'glm');

      UPDATE source_documents
      SET status = 'ocr_failed', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'ocr_running';
    `)
  },
}
