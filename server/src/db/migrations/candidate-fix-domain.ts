import type { DatabaseSync } from 'node:sqlite'
import type { DatabaseMigration } from '../migrator.js'

function count(database: DatabaseSync, sql: string) {
  return Number((database.prepare(sql).get() as { count: number }).count)
}

function validateLegacyCandidateFixDomain(database: DatabaseSync) {
  const expectedColumns: Record<string, string[]> = {
    candidate_fix_sessions: ['id', 'candidate_id', 'revision', 'status', 'source_profiles_json', 'base_content_revision', 'created_at', 'updated_at', 'finalized_at'],
    candidate_fix_regions: ['id', 'session_id', 'source_document_id', 'kind', 'question_key', 'question_label', 'question_keys_json', 'segments_json', 'sort_order', 'note', 'created_at', 'updated_at'],
    candidate_fix_migration_exceptions: ['id', 'legacy_session_id', 'legacy_region_id', 'reason', 'created_at'],
  }
  for (const [table, columns] of Object.entries(expectedColumns)) {
    const actual = (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name)
    if (actual.join(',') !== columns.join(',')) throw new Error(`Legacy candidate-fix migration invariant failed: ${table} columns differ`)
  }

  const requiredIndexes = [
    'idx_candidate_fix_one_draft',
    'idx_candidate_fix_sessions_candidate',
    'idx_candidate_fix_regions_session_order',
    'idx_candidate_fix_regions_source',
  ]
  for (const index of requiredIndexes) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)) {
      throw new Error(`Legacy candidate-fix migration invariant failed: missing index ${index}`)
    }
  }

  const violations = [
    count(database, 'SELECT COUNT(*) AS count FROM candidate_fix_sessions session LEFT JOIN question_candidates candidate ON candidate.id = session.candidate_id WHERE candidate.id IS NULL'),
    count(database, 'SELECT COUNT(*) AS count FROM candidate_fix_regions region LEFT JOIN candidate_fix_sessions session ON session.id = region.session_id WHERE session.id IS NULL'),
    count(database, 'SELECT COUNT(*) AS count FROM candidate_fix_regions region LEFT JOIN source_documents source ON source.id = region.source_document_id WHERE source.id IS NULL'),
    count(database, "SELECT COUNT(*) AS count FROM (SELECT candidate_id FROM candidate_fix_sessions WHERE status = 'draft' GROUP BY candidate_id HAVING COUNT(*) > 1)"),
    count(database, "SELECT COUNT(*) AS count FROM candidate_fix_sessions WHERE status NOT IN ('draft', 'finalized', 'superseded')"),
    count(database, "SELECT COUNT(*) AS count FROM candidate_fix_regions WHERE kind NOT IN ('question', 'solution', 'shared_answer_key')"),
  ].reduce((sum, value) => sum + value, 0)
  if (violations !== 0) throw new Error(`Legacy candidate-fix migration invariant failed: ${violations} data violation(s)`)
}

export const candidateFixDomainMigration: DatabaseMigration = {
  version: 3,
  name: 'candidate_fix_domain',
  description: 'Create V2-native candidate fix sessions and regions, and migrate restorable V2 drafts from legacy annotation tables (v1).',
  fingerprint: 'candidate-fix-domain-v1',
  legacyChecksums: [
    'bd48068f0e35af5ac0ded8351561041d740e59ac5c497f14c286a4f52998a4b1',
    '053923f6302711b15114309e0a110199b15916cab57b0e7a00e11643569fcb28',
  ].map((checksum) => ({
    checksum,
    description: 'Validated candidate-fix v3 intermediate build: exact tables/columns and required indexes exist; candidate/source foreign-key ownership, status/kind domains, and one-draft-per-candidate invariants hold.',
    validate: validateLegacyCandidateFixDomain,
  })),
  up(database: DatabaseSync) {
    database.exec(`
      CREATE TABLE candidate_fix_sessions (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES question_candidates(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'superseded')),
        source_profiles_json TEXT NOT NULL DEFAULT '{}',
        base_content_revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finalized_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE candidate_fix_regions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES candidate_fix_sessions(id) ON DELETE CASCADE,
        source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('question', 'solution', 'shared_answer_key')),
        question_key TEXT NOT NULL DEFAULT '',
        question_label TEXT NOT NULL DEFAULT '',
        question_keys_json TEXT NOT NULL DEFAULT '[]',
        segments_json TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE candidate_fix_migration_exceptions (
        id TEXT PRIMARY KEY,
        legacy_session_id TEXT NOT NULL,
        legacy_region_id TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX idx_candidate_fix_one_draft
        ON candidate_fix_sessions(candidate_id) WHERE status = 'draft';
      CREATE INDEX idx_candidate_fix_sessions_candidate
        ON candidate_fix_sessions(candidate_id, updated_at DESC);
      CREATE INDEX idx_candidate_fix_regions_session_order
        ON candidate_fix_regions(session_id, sort_order, created_at);
      CREATE INDEX idx_candidate_fix_regions_source
        ON candidate_fix_regions(source_document_id);
    `)

    const legacyTablesExist = ['pdf_slicer_annotation_sessions', 'pdf_slicer_annotation_regions'].every((table) =>
      Boolean(database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)),
    )
    if (!legacyTablesExist) return

    database.exec(`
      INSERT OR IGNORE INTO candidate_fix_migration_exceptions
        (id, legacy_session_id, legacy_region_id, reason, created_at)
      SELECT 'session:' || legacy.id, legacy.id, '', 'candidate_not_found', datetime('now')
      FROM pdf_slicer_annotation_sessions legacy
      LEFT JOIN question_candidates candidate ON candidate.id = legacy.batch_id
      WHERE legacy.id LIKE 'sess_candidate_%' AND legacy.status = 'draft' AND candidate.id IS NULL;

      INSERT OR IGNORE INTO candidate_fix_sessions (
        id, candidate_id, revision, status, source_profiles_json, base_content_revision,
        created_at, updated_at, finalized_at
      )
      SELECT legacy.id, legacy.batch_id, legacy.revision, 'draft', legacy.source_profile_json,
             COALESCE(candidate.content_revision, 1), legacy.created_at, legacy.updated_at, ''
      FROM pdf_slicer_annotation_sessions legacy
      JOIN question_candidates candidate ON candidate.id = legacy.batch_id
      WHERE legacy.id LIKE 'sess_candidate_%' AND legacy.status = 'draft';

      INSERT OR IGNORE INTO candidate_fix_migration_exceptions
        (id, legacy_session_id, legacy_region_id, reason, created_at)
      SELECT 'region:' || region.id, region.session_id, region.id, 'source_document_not_found', datetime('now')
      FROM pdf_slicer_annotation_regions region
      JOIN candidate_fix_sessions session ON session.id = region.session_id
      LEFT JOIN source_documents source ON source.id = region.source_run_id
      WHERE source.id IS NULL;

      INSERT OR IGNORE INTO candidate_fix_regions (
        id, session_id, source_document_id, kind, question_key, question_label,
        question_keys_json, segments_json, sort_order, note, created_at, updated_at
      )
      SELECT region.id, region.session_id, region.source_run_id, region.kind,
             region.question_key, region.question_label, region.question_keys_json,
             region.segments_json, region.sort_order, region.note, region.created_at, region.updated_at
      FROM pdf_slicer_annotation_regions region
      JOIN candidate_fix_sessions session ON session.id = region.session_id
      JOIN source_documents source ON source.id = region.source_run_id;
    `)
  },
}
