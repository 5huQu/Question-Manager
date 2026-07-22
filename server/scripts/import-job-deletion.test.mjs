import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-job-delete-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { ensureSchema } = await import('../dist/db/schema.js')
const { db, closeDatabase } = await import('../dist/db/connection.js')
const { createQuestion } = await import('../dist/db/questions.js')
const { createImportJob, addSourceDocumentToImportJob, deleteImportJob, transferSourceDocumentBetweenImportJobs } = await import('../dist/services/import-flow-v2/import-job.service.js')
const { cleanupImportJobTrash } = await import('../dist/services/import-flow-v2/import-job-trash.service.js')
const { createSourceDocument } = await import('../dist/services/import-flow-v2/source-document.service.js')
const { sourceDocumentDir } = await import('../dist/services/import-flow-v2/import-flow-v2.paths.js')

try {
  ensureSchema()
  console.log('1. Exclusive source ownership is enforced as a conflict...')
  const source = createSourceDocument({ id: 'delete_source', title: 'Delete source' }).sourceDocument
  const first = createImportJob({ id: 'delete_job', title: 'Delete job' }).importJob
  const second = createImportJob({ id: 'other_job', title: 'Other job' }).importJob
  addSourceDocumentToImportJob(first.id, { sourceDocumentId: source.id, role: 'full' })
  assert.throws(() => addSourceDocumentToImportJob(second.id, { sourceDocumentId: source.id, role: 'full' }), /已属于导入任务/)
  assert.equal(transferSourceDocumentBetweenImportJobs({ sourceDocumentId: source.id, fromJobId: first.id, toJobId: second.id, role: 'questions' }).document.jobId, second.id)
  assert.equal(transferSourceDocumentBetweenImportJobs({ sourceDocumentId: source.id, fromJobId: second.id, toJobId: first.id, role: 'full' }).document.jobId, first.id)

  console.log('2. File move failure leaves database records and source files intact...')
  const moveFailureSource = createSourceDocument({ id: 'move_failure_source', title: 'Move failure' }).sourceDocument
  const moveFailureJob = createImportJob({ id: 'move_failure_job', title: 'Move failure job' }).importJob
  addSourceDocumentToImportJob(moveFailureJob.id, { sourceDocumentId: moveFailureSource.id, role: 'full' })
  const moveFailureSourceDir = sourceDocumentDir(moveFailureSource.id)
  fs.mkdirSync(moveFailureSourceDir, { recursive: true })
  fs.writeFileSync(path.join(moveFailureSourceDir, 'original.pdf'), 'source')
  const conflictingTrash = path.join(tempRoot, 'data', 'import-flow-v2', 'trash', 'import-jobs', moveFailureJob.id, 'source-documents', moveFailureSource.id)
  fs.mkdirSync(conflictingTrash, { recursive: true })
  assert.throws(() => deleteImportJob(moveFailureJob.id), /移入回收站失败/)
  assert.equal(fs.existsSync(path.join(moveFailureSourceDir, 'original.pdf')), true)
  assert.ok(db.prepare('SELECT id FROM import_jobs WHERE id = ?').get(moveFailureJob.id))
  fs.rmSync(conflictingTrash, { recursive: true, force: true })
  assert.equal(deleteImportJob(moveFailureJob.id).success, true)

  console.log('3. Database deletion failure restores files and preserves bank questions...')
  const sourceDir = sourceDocumentDir(source.id)
  fs.mkdirSync(sourceDir, { recursive: true })
  fs.writeFileSync(path.join(sourceDir, 'original.pdf'), 'source')
  const question = createQuestion({ importSourceId: first.id, importJobId: first.id, stemMarkdown: '保留题目' })
  db.exec(`
    CREATE TRIGGER fail_import_job_delete_for_test
    BEFORE DELETE ON import_jobs WHEN OLD.id = 'delete_job'
    BEGIN SELECT RAISE(ABORT, 'forced import job delete failure'); END;
  `)
  assert.throws(() => deleteImportJob(first.id), /forced import job delete failure/)
  assert.equal(fs.existsSync(path.join(sourceDir, 'original.pdf')), true)
  assert.ok(db.prepare('SELECT id FROM import_jobs WHERE id = ?').get(first.id))
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(question.id).import_job_id, first.id)
  assert.equal(db.prepare('SELECT status FROM import_job_deletion_manifests WHERE job_id = ?').get(first.id).status, 'failed')

  console.log('4. Retrying succeeds, trashes files, and detaches rather than deletes questions...')
  db.exec('DROP TRIGGER fail_import_job_delete_for_test')
  const result = deleteImportJob(first.id)
  assert.equal(result.success, true)
  assert.equal(fs.existsSync(path.join(result.recoveryPath, 'source-documents', source.id, 'original.pdf')), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_jobs WHERE id = ?').get(first.id).count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM source_documents WHERE id = ?').get(source.id).count, 0)
  assert.equal(db.prepare('SELECT import_job_id FROM question_bank_items WHERE id = ?').get(question.id).import_job_id, null)
  assert.equal(db.prepare('SELECT status FROM import_job_deletion_manifests WHERE job_id = ?').get(first.id).status, 'trashed')

  console.log('5. Trash retention removes only expired completed manifests...')
  db.prepare("UPDATE import_job_deletion_manifests SET updated_at = '2000-01-01T00:00:00.000Z' WHERE job_id = ?").run(first.id)
  const cleanup = cleanupImportJobTrash({ retentionDays: 30, now: new Date('2026-01-01T00:00:00.000Z') })
  assert.deepEqual(cleanup.removed, [first.id])
  assert.equal(fs.existsSync(result.recoveryPath), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_job_deletion_manifests WHERE job_id = ?').get(first.id).count, 0)

  console.log('import job deletion ok')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
