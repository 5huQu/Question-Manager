import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-v1-migration-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { ensureSchema } = await import('../dist/db/schema.js')
const { db, closeDatabase } = await import('../dist/db/connection.js')
const { createQuestion } = await import('../dist/db/questions.js')
const { auditV1ImportData, migrateV1ImportData, v1MigrationReportMarkdown } = await import('../dist/services/import-flow-v2/v1-data-migration.service.js')

try {
  ensureSchema()
  const now = '2025-01-01T00:00:00.000Z'
  const sourceFile = path.join(tempRoot, 'legacy.pdf')
  const figureFile = path.join(tempRoot, 'legacy-figure.png')
  fs.writeFileSync(sourceFile, 'pdf')
  fs.writeFileSync(figureFile, 'figure')
  db.prepare(`
    INSERT INTO pdf_slicer_batches (id, title, workflow_mode, created_at)
    VALUES ('legacy_batch', 'Legacy batch', 'single', ?)
  `).run(now)
  db.prepare(`
    INSERT INTO pdf_slicer_runs (
      run_id, batch_id, pdf_name, pdf_path, source_file_name, source_file_kind,
      run_dir, created_at, updated_at, slice_status, ocr_status, ocr_provider
    ) VALUES ('legacy_run', 'legacy_batch', 'legacy.pdf', ?, 'legacy.pdf', 'pdf', ?, ?, ?, 'succeeded', 'succeeded', 'doc2x')
  `).run(sourceFile, tempRoot, now, now)
  const question = createQuestion({ sourceRunId: 'legacy_run', stemMarkdown: 'Legacy question', figures: [{ path: figureFile }] })
  db.prepare(`
    INSERT INTO source_documents (id, title, created_at, updated_at)
    VALUES ('docimport_existing', 'Existing V2 source', ?, ?)
  `).run(now, now)
  const v2Question = createQuestion({ sourceRunId: 'ifv2:docimport_existing', figures: [{ path: '<table><tr><td>not a file</td></tr></table>' }] })
  const missingV2Question = createQuestion({ sourceRunId: 'ifv2:docimport_missing' })
  db.prepare(`
    INSERT INTO pdf_slicer_review_items (
      result_id, run_id, question_label, page_start, page_end, page_image_path,
      figures_json, created_at, updated_at
    ) VALUES ('legacy_review', 'legacy_run', '1', 1, 1, ?, ?, ?, ?)
  `).run(figureFile, JSON.stringify([{ path: figureFile }]), now, now)
  db.prepare(`
    INSERT INTO pdf_slicer_solution_items (
      id, batch_id, source_run_id, question_no, source_image_path, figures_json, created_at, updated_at
    ) VALUES ('legacy_solution', 'legacy_batch', 'legacy_run', '1', ?, ?, ?, ?)
  `).run(figureFile, JSON.stringify([{ path: figureFile }]), now, now)
  db.prepare(`
    INSERT INTO pdf_slicer_annotation_sessions
      (id, batch_id, source_profile_json, created_at, updated_at)
    VALUES ('legacy_annotation', 'legacy_batch', '{}', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO pdf_slicer_annotation_regions
      (id, session_id, source_run_id, kind, created_at, updated_at)
    VALUES ('legacy_region', 'legacy_annotation', 'legacy_run', 'question', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO question_bank_export_records (id, source_type, run_id, created_at)
    VALUES ('legacy_export', 'run', 'legacy_run', ?)
  `).run(now)
  db.prepare(`
    INSERT INTO question_bank_export_records (id, source_type, run_id, title, created_at)
    VALUES ('orphan_export', 'run', 'missing_legacy_run', 'Orphan export', ?)
  `).run(now)

  console.log('1. Audit blocks retirement before legacy records are mapped...')
  const before = auditV1ImportData()
  assert.equal(before.gatePassed, false)
  assert.equal(before.exceptions.some((item) => item.kind === 'unmapped_review_item'), true)
  assert.equal(before.exceptions.some((item) => item.kind === 'unmapped_solution_item'), true)
  assert.equal(before.exceptions.some((item) => item.kind === 'unmapped_annotation_session'), true)

  console.log('2. Migration is repeatable and covers batch/run sources, questions, exports, and archived annotations...')
  const first = migrateV1ImportData()
  const second = migrateV1ImportData()
  assert.equal(first.gatePassed, true, JSON.stringify(first, null, 2))
  assert.equal(second.gatePassed, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM v1_import_batch_map').get().count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM v1_import_run_map').get().count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_job_documents WHERE source_document_id = ?').get('v1-source:legacy_run').count, 1)
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(question.id).import_job_id, 'v1-job:legacy_batch')
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_export_records WHERE id = ?').get('legacy_export').import_job_id, 'v1-job:legacy_batch')
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(v2Question.id).import_job_id, 'archive-v2doc:docimport_existing')
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(missingV2Question.id).import_job_id, 'archive-v2doc:docimport_missing')
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_export_records WHERE id = ?').get('orphan_export').import_job_id, 'archive-v1run:missing_legacy_run')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_provenance_archive').get().count, 3)
  assert.equal(first.missingFigureFiles.some((item) => item.path.startsWith('<table')), false)
  assert.deepEqual(first.archivedAnnotationSessionIds, ['legacy_annotation'])
  assert.equal(first.annotationTableDeletionBlocked, true)
  assert.match(v1MigrationReportMarkdown(first), /WS-04 gate: PASS/)
  assert.match(v1MigrationReportMarkdown(first), /Annotation table deletion blocked: YES/)

  console.log('3. Missing review/solution assets block the gate and are identified by record type...')
  fs.rmSync(figureFile)
  const missing = auditV1ImportData()
  assert.equal(missing.gatePassed, false)
  assert.equal(missing.missingFigureFiles.some((item) => item.recordType === 'review'), true)
  assert.equal(missing.missingFigureFiles.some((item) => item.recordType === 'solution'), true)

  console.log('4. CLI caller emits durable JSON and Markdown reports with gate exit status...')
  const reportDir = path.join(tempRoot, 'reports')
  const cli = spawnSync(process.execPath, ['server/scripts/v1-import-migrate.mjs', 'audit', '--output', reportDir], {
    cwd: process.cwd(),
    env: { ...process.env, QUESTION_DATA_DIR: tempRoot },
    encoding: 'utf8',
  })
  assert.equal(cli.status, 3, cli.stderr)
  assert.equal(fs.readdirSync(reportDir).some((name) => name.endsWith('.json')), true)
  assert.equal(fs.readdirSync(reportDir).some((name) => name.endsWith('.md')), true)

  console.log('v1 import migration ok')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
