import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'import-job-list-performance-test-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { closeDatabase } = await import('../dist/index.js')
const { db } = await import('../dist/db/connection.js')
const { listImportJobsWithStats } = await import('../dist/services/import-flow-v2/import-batch.service.js')

const now = new Date().toISOString()
const insertJob = db.prepare(`INSERT INTO import_jobs (id, title, mode, status, created_at, updated_at) VALUES (?, ?, 'single_document', 'parsed', ?, ?)`)
const insertSource = db.prepare(`INSERT INTO source_documents (id, title, original_file_name, file_path, file_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pdf', 'parsed', ?, ?)`)
const insertLink = db.prepare(`INSERT INTO import_job_documents (id, job_id, source_document_id, role, sort_order, created_at, updated_at) VALUES (?, ?, ?, 'full', ?, ?, ?)`)
const insertCandidate = db.prepare(`INSERT INTO question_candidates (id, source_document_id, question_no, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
const insertQuestion = db.prepare(`INSERT INTO question_bank_items (id, serial_no, question_no, import_source_id, import_job_id, bank_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)`)

try {
  db.exec('BEGIN')
  let serial = 1
  for (let jobIndex = 0; jobIndex < 200; jobIndex += 1) {
    const jobId = `perf-job-${jobIndex}`
    insertJob.run(jobId, `Performance Job ${jobIndex}`, now, now)
    for (let documentIndex = 0; documentIndex < 2; documentIndex += 1) {
      const sourceId = `perf-source-${jobIndex}-${documentIndex}`
      insertSource.run(sourceId, sourceId, `${sourceId}.pdf`, `${sourceId}.pdf`, now, now)
      insertLink.run(`perf-link-${jobIndex}-${documentIndex}`, jobId, sourceId, documentIndex, now, now)
      for (let candidateIndex = 0; candidateIndex < 10; candidateIndex += 1) {
        const status = candidateIndex < 6 ? 'ready' : candidateIndex < 9 ? 'committed' : 'needs_review'
        insertCandidate.run(`perf-candidate-${jobIndex}-${documentIndex}-${candidateIndex}`, sourceId, String(candidateIndex + 1), status, now, now)
      }
      insertQuestion.run(
        `perf-question-${jobIndex}-${documentIndex}`,
        serial,
        String(documentIndex + 1),
        sourceId,
        documentIndex === 0 ? jobId : null,
        now,
        now,
      )
      serial += 1
    }
  }
  db.exec('COMMIT')

  const startedAt = performance.now()
  const result = listImportJobsWithStats({ limit: 200 })
  const elapsedMs = performance.now() - startedAt
  assert.equal(result.items.length, 200)
  assert.equal(result.items[0].documents.length, 2)
  assert.deepEqual(result.items[0].stats, {
    sourceDocumentCount: 2,
    ocrSucceededCount: 2,
    candidateCount: 20,
    committedCandidateCount: 6,
    questionCount: 2,
    needsReviewCount: 2,
    blockedCount: 0,
  })
  assert.ok(elapsedMs < 2000, `aggregate job listing took ${elapsedMs.toFixed(1)}ms`)
  console.log(`ImportJob aggregate list test passed in ${elapsedMs.toFixed(1)}ms.`)
} finally {
  if (db.isTransaction) db.exec('ROLLBACK')
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
