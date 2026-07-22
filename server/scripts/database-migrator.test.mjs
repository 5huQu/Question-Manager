import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-migrator-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { migrateDatabase, migrationChecksum } = await import('../dist/db/migrator.js')
const { candidateFixDomainMigration } = await import('../dist/db/migrations/candidate-fix-domain.js')
const { ensureSchema, databaseMigrationStatus, applicationMigrations } = await import('../dist/db/schema.js')
const { db, closeDatabase } = await import('../dist/db/connection.js')
const { createQuestion } = await import('../dist/db/questions.js')

try {
  console.log('1. Migrator is ordered, idempotent, checksummed, and transactional...')
  const memory = new DatabaseSync(':memory:')
  const migrations = [
    { version: 1, name: 'one', description: 'one-v1', fingerprint: 'one-v1', up(database) { database.exec('CREATE TABLE sample (id TEXT PRIMARY KEY)') } },
    { version: 2, name: 'two', description: 'two-v1', fingerprint: 'two-v1', up(database) { database.prepare('INSERT INTO sample (id) VALUES (?)').run('created') } },
  ]
  const dryRun = migrateDatabase(memory, migrations, { dryRun: true })
  assert.equal(dryRun.every((item) => item.pending), true)
  assert.equal(memory.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get().count, 0)
  migrateDatabase(memory, migrations)
  migrateDatabase(memory, migrations)
  assert.equal(memory.prepare('SELECT COUNT(*) AS count FROM sample').get().count, 1)
  assert.throws(() => migrateDatabase(memory, [{ ...migrations[0], description: 'changed' }, migrations[1]]), /checksum mismatch/)

  const stableA = { ...migrations[0], fingerprint: 'stable-v1' }
  const stableB = { ...stableA, up() { throw new Error('transpiled differently') } }
  assert.equal(migrationChecksum(stableA), migrationChecksum(stableB), 'explicit fingerprints must not depend on Function.toString()')
  assert.notEqual(migrationChecksum(stableA), migrationChecksum({ ...stableA, fingerprint: 'stable-v2' }))

  const parityRoot = path.join(tempRoot, 'checksum-parity')
  const sourceChecksums = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    process.env.QUESTION_DATA_DIR = ${JSON.stringify(parityRoot)};
    const { applicationMigrations } = await import('./server/src/db/schema.ts');
    const { migrationChecksum } = await import('./server/src/db/migrator.ts');
    const { closeDatabase } = await import('./server/src/db/connection.ts');
    try { console.log(JSON.stringify(applicationMigrations.map(migrationChecksum))); } finally { closeDatabase(); }
  `], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(sourceChecksums.status, 0, sourceChecksums.stderr)
  assert.deepEqual(JSON.parse(sourceChecksums.stdout.trim()), applicationMigrations.map(migrationChecksum), 'source and compiled checksums must match')

  assert.throws(() => migrateDatabase(new DatabaseSync(':memory:'), [{ ...migrations[0], fingerprint: '' }]), /Missing database migration fingerprint/)

  const failing = { version: 3, name: 'failing', description: 'failing-v1', fingerprint: 'failing-v1', up(database) {
    database.prepare('INSERT INTO sample (id) VALUES (?)').run('rolled-back')
    throw new Error('forced migration failure')
  } }
  assert.throws(() => migrateDatabase(memory, [...migrations, failing]), /forced migration failure/)
  assert.equal(memory.prepare("SELECT COUNT(*) AS count FROM sample WHERE id = 'rolled-back'").get().count, 0)
  assert.equal(memory.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 3').get().count, 0)
  memory.close()

  console.log('2. Legacy checksum reconciliation is explicit, validated, transactional, and audited...')
  const reconcileDb = new DatabaseSync(':memory:')
  const current = { version: 1, name: 'reconciled', description: 'current-v2', fingerprint: 'reconciled-v2', up(database) {
    database.exec('CREATE TABLE reconciled_data (id TEXT PRIMARY KEY)')
  } }
  const legacyChecksum = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  reconcileDb.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE reconciled_data (id TEXT PRIMARY KEY);
    INSERT INTO schema_migrations VALUES (1, 'reconciled', '${legacyChecksum}', 'earlier');
  `)
  let validated = 0
  const compatible = { ...current, legacyChecksums: [{
    checksum: legacyChecksum,
    description: 'reconciled_data schema invariant',
    validate(database) {
      validated += 1
      assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reconciled_data'").get())
    },
  }] }
  const compatibleStatus = migrateDatabase(reconcileDb, [compatible], { dryRun: true })
  assert.equal(compatibleStatus[0].reconciliation.legacyChecksum, legacyChecksum)
  assert.equal(reconcileDb.prepare('SELECT checksum FROM schema_migrations').get().checksum, legacyChecksum)
  migrateDatabase(reconcileDb, [compatible])
  assert.notEqual(reconcileDb.prepare('SELECT checksum FROM schema_migrations').get().checksum, legacyChecksum)
  assert.equal(reconcileDb.prepare('SELECT legacy_checksum FROM schema_migration_reconciliations').get().legacy_checksum, legacyChecksum)
  assert.ok(validated >= 2)
  assert.throws(() => migrateDatabase(reconcileDb, [{ ...current, description: 'changed-again' }]), /checksum mismatch/)

  const rejectedDb = new DatabaseSync(':memory:')
  rejectedDb.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, 'reconciled', '${legacyChecksum}', 'earlier');
  `)
  assert.throws(() => migrateDatabase(rejectedDb, [{ ...current, legacyChecksums: [{
    checksum: legacyChecksum,
    description: 'required table exists',
    validate() { throw new Error('required table missing') },
  }] }]), /required table missing/)
  assert.equal(rejectedDb.prepare('SELECT checksum FROM schema_migrations').get().checksum, legacyChecksum)
  assert.equal(rejectedDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'schema_migration_reconciliations'").get().count, 0)
  rejectedDb.close()
  reconcileDb.close()

  console.log('3. Destructive migrations require and verify a retained SQLite backup...')
  const destructiveDb = new DatabaseSync(path.join(tempRoot, 'destructive.sqlite'))
  const baseMigration = { version: 1, name: 'base', description: 'base-v1', fingerprint: 'base-v1', up(database) {
    database.exec("CREATE TABLE retained (value TEXT); INSERT INTO retained VALUES ('before')")
  } }
  const destructiveMigration = { version: 2, name: 'drop_retained', description: 'drop-v1', fingerprint: 'drop-retained-v1', destructive: true, up(database) {
    database.exec('DROP TABLE retained')
  } }
  migrateDatabase(destructiveDb, [baseMigration])
  assert.throws(() => migrateDatabase(destructiveDb, [baseMigration, destructiveMigration]), /requires backup configuration/)
  const backupDirectory = path.join(tempRoot, 'backups')
  migrateDatabase(destructiveDb, [baseMigration, destructiveMigration], { backup: { directory: backupDirectory, retention: 1 } })
  const backupName = fs.readdirSync(backupDirectory).find((name) => name.endsWith('.sqlite'))
  assert.ok(backupName)
  assert.ok(fs.existsSync(path.join(backupDirectory, `${backupName}.json`)))
  const backupDb = new DatabaseSync(path.join(backupDirectory, backupName), { readOnly: true })
  assert.equal(backupDb.prepare('SELECT value FROM retained').get().value, 'before')
  backupDb.close()
  destructiveDb.close()

  console.log('4. Candidate fix migration restores only valid legacy V2 drafts...')
  const legacy = new DatabaseSync(':memory:')
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE question_candidates (id TEXT PRIMARY KEY, content_revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE source_documents (id TEXT PRIMARY KEY);
    CREATE TABLE pdf_slicer_annotation_sessions (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL,
      source_profile_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finalized_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE pdf_slicer_annotation_regions (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, source_run_id TEXT NOT NULL, kind TEXT NOT NULL,
      question_key TEXT NOT NULL, question_label TEXT NOT NULL, question_keys_json TEXT NOT NULL,
      segments_json TEXT NOT NULL, sort_order INTEGER NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO question_candidates VALUES ('candidate_valid', 7);
    INSERT INTO source_documents VALUES ('source_valid');
    INSERT INTO pdf_slicer_annotation_sessions VALUES
      ('sess_candidate_valid', 'candidate_valid', 4, 'draft', '{"source_valid":{"pageCount":2}}', 'now', 'now', ''),
      ('sess_candidate_final', 'candidate_valid', 5, 'finalized', '{}', 'now', 'now', 'now'),
      ('sess_candidate_missing', 'missing', 1, 'draft', '{}', 'now', 'now', '');
    INSERT INTO pdf_slicer_annotation_regions VALUES
      ('region_valid', 'sess_candidate_valid', 'source_valid', 'question', 'stem', '题干', '[]', '[{"page":1,"x":0,"y":0,"width":1,"height":1}]', 0, '', 'now', 'now'),
      ('region_missing_source', 'sess_candidate_valid', 'missing', 'solution', 'analysis', '解析', '[]', '[]', 1, '', 'now', 'now');
  `)
  migrateDatabase(legacy, [candidateFixDomainMigration])
  migrateDatabase(legacy, [candidateFixDomainMigration])
  assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM candidate_fix_sessions').get().count, 1)
  assert.equal(legacy.prepare('SELECT base_content_revision FROM candidate_fix_sessions').get().base_content_revision, 7)
  assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM candidate_fix_regions').get().count, 1)
  assert.equal(legacy.prepare('SELECT source_document_id FROM candidate_fix_regions').get().source_document_id, 'source_valid')
  assert.deepEqual(
    legacy.prepare('SELECT reason FROM candidate_fix_migration_exceptions ORDER BY reason').all().map((row) => row.reason),
    ['candidate_not_found', 'source_document_not_found'],
  )
  legacy.close()

  console.log('5. Legacy import source formats backfill to canonical import_job_id...')
  ensureSchema()
  db.exec(`
    DROP TRIGGER trg_import_job_documents_exclusive_insert;
    DROP TRIGGER trg_import_job_documents_exclusive_update;
    DELETE FROM schema_migrations WHERE version = 2;
  `)
  const now = new Date().toISOString()
  for (const id of ['job_direct', 'job_prefixed', 'job_source', 'job_ambiguous_a', 'job_ambiguous_b']) {
    db.prepare(`INSERT INTO import_jobs (id, title, mode, status, created_at, updated_at) VALUES (?, ?, 'single_document', 'draft', ?, ?)`)
      .run(id, id, now, now)
  }
  for (const id of ['source_unique', 'source_ambiguous']) {
    db.prepare(`INSERT INTO source_documents (id, title, original_file_name, created_at, updated_at) VALUES (?, ?, '', ?, ?)`)
      .run(id, id, now, now)
  }
  const links = [
    ['link_unique', 'job_source', 'source_unique'],
    ['link_ambiguous_a', 'job_ambiguous_a', 'source_ambiguous'],
    ['link_ambiguous_b', 'job_ambiguous_b', 'source_ambiguous'],
  ]
  for (const [id, jobId, sourceId] of links) {
    db.prepare(`INSERT INTO import_job_documents (id, job_id, source_document_id, role, created_at, updated_at) VALUES (?, ?, ?, 'full', ?, ?)`)
      .run(id, jobId, sourceId, now, now)
  }
  const direct = createQuestion({ importSourceId: 'job_direct' })
  const prefixed = createQuestion({ importSourceId: 'ifv2-job:job_prefixed' })
  const source = createQuestion({ importSourceId: 'source_unique' })
  const ambiguous = createQuestion({ importSourceId: 'source_ambiguous' })
  ensureSchema()
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(direct.id).import_job_id, 'job_direct')
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(prefixed.id).import_job_id, 'job_prefixed')
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(source.id).import_job_id, 'job_source')
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(ambiguous.id).import_job_id, null)
  assert.equal(db.prepare('SELECT reason FROM import_identity_exceptions WHERE question_id = ?').get(ambiguous.id).reason, 'ambiguous_source_document')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_job_ownership_conflicts WHERE source_document_id = ?').get('source_ambiguous').count, 1)
  assert.equal(databaseMigrationStatus().every((item) => !item.pending), true)

  console.log('database migrator ok')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
