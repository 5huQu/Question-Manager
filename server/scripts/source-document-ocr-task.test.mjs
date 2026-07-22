import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'source-document-ocr-task-test-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.DOC2X_API_KEY = 'test-doc2x-key'
process.env.DOC2X_API_BASE_URL = 'https://doc2x.example.test'
process.env.DOC2X_MODEL = 'v3-2026'
process.env.DOC2X_POLL_SECONDS = '1'

const doc2xFormula = String.raw`\(\gamma _ {1} + \delta ^ {2}\)`
const doc2xPayload = {
  code: 'success',
  data: {
    status: 'success',
    progress: 100,
    result: {
      task_id: 'task_doc2x_status_flow',
      pages: [
        {
          page_idx: 0,
          width: 800,
          height: 1100,
          md: `1. Doc2X 公式保持 ${doc2xFormula}`,
          layout: {
            blocks: [
              { id: 'doc2x_text_status_1', type: 'Text', text: `1. Doc2X 公式保持 ${doc2xFormula}`, bbox: [10, 20, 620, 80] },
            ],
          },
        },
      ],
    },
  },
}

const originalFetch = globalThis.fetch
let preuploadCalls = 0
let uploadCalls = 0
let statusCalls = 0
let fetchMode = 'success'
globalThis.fetch = async (url, init = {}) => {
  const href = String(url)
  const method = String(init.method || 'GET').toUpperCase()
  if (href === 'https://doc2x.example.test/api/v2/parse/preupload' && method === 'POST') {
    preuploadCalls += 1
    return new Response(JSON.stringify({
      code: 'success',
      data: {
        uid: 'uid_doc2x_status_flow',
        url: 'https://upload.example.test/doc2x-status-flow.pdf',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (href === 'https://upload.example.test/doc2x-status-flow.pdf' && method === 'PUT') {
    uploadCalls += 1
    return new Response('', { status: 200 })
  }
  if (href === 'https://doc2x.example.test/api/v2/parse/status?uid=uid_doc2x_status_flow' && method === 'GET') {
    statusCalls += 1
    if (fetchMode === 'failure') {
      return new Response(JSON.stringify({
        code: 'success',
        data: { status: 'failed', detail: 'provider rejected document', progress: 35 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify(doc2xPayload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  throw new Error(`Unexpected fetch call: ${method} ${href}`)
}

const { closeDatabase } = await import('../dist/index.js')
const { db } = await import('../dist/db/connection.js')
const { createSourceDocument } = await import('../dist/repositories/source-documents.repo.js')
const { createQuestionCandidate } = await import('../dist/repositories/question-candidates.repo.js')
const { createOcrDocument, listOcrDocuments } = await import('../dist/repositories/ocr-documents.repo.js')
const taskRepo = await import('../dist/repositories/source-document-ocr-tasks.repo.js')
const { assetPathFor } = await import('../dist/utils/paths.js')
const {
  getSourceDocumentOcrStatus,
  loadOcrDocument,
  recoverInterruptedSourceDocumentOcrTasks,
  startSourceDocumentOcr,
} = await import('../dist/services/import-flow-v2/import-flow-v2.service.js')

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForOcrStatus(sourceDocumentId, expectedStatus) {
  let latest
  for (let attempt = 0; attempt < 100; attempt += 1) {
    latest = getSourceDocumentOcrStatus(sourceDocumentId)
    if (latest.task.status === expectedStatus) return latest
    await wait(20)
  }
  return latest
}

try {
  const sourceDocumentId = 'src_doc2x_status_flow'
  const pdfPath = path.join(tempRoot, 'data', 'import-flow-v2', 'source-documents', sourceDocumentId, 'original.pdf')
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true })
  fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'))

  const sourceDocument = createSourceDocument({
    id: sourceDocumentId,
    title: 'Doc2X Status Flow',
    originalFileName: 'doc2x-status-flow.pdf',
    filePath: assetPathFor(pdfPath),
    fileType: 'pdf',
    pageCount: 0,
    provider: 'doc2x',
    status: 'uploaded',
  })
  assert.ok(sourceDocument)

  const started = startSourceDocumentOcr(sourceDocumentId, { provider: 'doc2x' })
  assert.equal(started.task.provider, 'doc2x')
  assert.equal(started.task.status, 'ocr_running')
  assert.equal(started.task.attempt, 1)
  assert.equal(started.task.lifecycleStatus, 'running')
  assert.throws(
    () => startSourceDocumentOcr(sourceDocumentId, { provider: 'doc2x' }),
    (error) => error?.status === 409,
    'the database must reject a second active task for the same source document',
  )

  const finished = await waitForOcrStatus(sourceDocumentId, 'ocr_succeeded')
  assert.equal(finished.task.provider, 'doc2x')
  assert.equal(finished.task.status, 'ocr_succeeded')
  assert.ok(finished.task.ocrDocumentId)
  assert.equal(finished.sourceDocument.provider, 'doc2x')
  assert.equal(finished.sourceDocument.status, 'ocr_succeeded')
  assert.equal(finished.sourceDocument.pageCount, 1)

  const [ocrRecord] = listOcrDocuments({ sourceDocumentId, limit: 1 })
  assert.ok(ocrRecord)
  assert.equal(ocrRecord.provider, 'doc2x')
  const document = loadOcrDocument(ocrRecord.id)
  assert.equal(document.provider, 'doc2x')
  assert.ok(document.markdown.includes(doc2xFormula), 'Doc2X formula markdown must stay unchanged through the OCR task')
  assert.equal(preuploadCalls, 1)
  assert.equal(uploadCalls, 1)
  assert.equal(statusCalls, 1)

  const rerun = startSourceDocumentOcr(sourceDocumentId, { provider: 'doc2x', force: true })
  assert.equal(rerun.task.attempt, 2)
  await waitForOcrStatus(sourceDocumentId, 'ocr_succeeded')
  const attempts = db.prepare(`
    SELECT attempt, status FROM source_document_ocr_tasks
    WHERE source_document_id = ? ORDER BY attempt
  `).all(sourceDocumentId).map((row) => ({ attempt: row.attempt, status: row.status }))
  assert.deepEqual(attempts, [
    { attempt: 1, status: 'succeeded' },
    { attempt: 2, status: 'succeeded' },
  ], 'force reruns must append immutable attempt history')
  createQuestionCandidate({
    id: 'candidate_committed_ocr_rerun_guard',
    sourceDocumentId,
    questionNo: '1',
    status: 'committed',
    committedQuestionId: 'question_committed_ocr_rerun_guard',
    committedAt: new Date().toISOString(),
  })
  assert.throws(
    () => startSourceDocumentOcr(sourceDocumentId, { provider: 'doc2x', force: true }),
    (error) => error?.status === 409,
    'force rerun must remain blocked after any candidate is committed',
  )

  const interruptedId = 'src_restart_interrupted'
  createSourceDocument({
    id: interruptedId,
    title: 'Interrupted OCR',
    originalFileName: 'interrupted.pdf',
    filePath: '',
    fileType: 'pdf',
    provider: 'glm',
    status: 'ocr_running',
  })
  const interruptedQueued = taskRepo.createQueuedTask({ sourceDocumentId: interruptedId, provider: 'glm' })
  taskRepo.claimTask(interruptedQueued.id, 'dead-process', '2000-01-01T00:00:00.000Z')
  recoverInterruptedSourceDocumentOcrTasks()
  const interrupted = getSourceDocumentOcrStatus(interruptedId)
  assert.equal(interrupted.task.lifecycleStatus, 'interrupted')
  assert.equal(interrupted.task.errorCode, 'process_interrupted')
  assert.equal(interrupted.sourceDocument.status, 'ocr_failed')
  recoverInterruptedSourceDocumentOcrTasks()
  assert.equal(getSourceDocumentOcrStatus(interruptedId).task.lifecycleStatus, 'interrupted', 'recovery must be idempotent')

  const repairedId = 'src_restart_repaired'
  createSourceDocument({
    id: repairedId,
    title: 'Repair OCR',
    originalFileName: 'repair.pdf',
    filePath: '',
    fileType: 'pdf',
    provider: 'doc2x',
    status: 'ocr_running',
  })
  const repairTask = taskRepo.createQueuedTask({ sourceDocumentId: repairedId, provider: 'doc2x' })
  taskRepo.claimTask(repairTask.id, 'dead-process', '2000-01-01T00:00:00.000Z')
  const repairedOcr = createOcrDocument({
    id: 'ocrdoc_recovery_repair',
    sourceDocumentId: repairedId,
    provider: 'doc2x',
    rawResultPath: '',
    markdownPath: '',
    blocksJsonPath: '',
    assetsJsonPath: '',
  })
  assert.ok(repairedOcr)
  recoverInterruptedSourceDocumentOcrTasks()
  const repaired = getSourceDocumentOcrStatus(repairedId)
  assert.equal(repaired.task.lifecycleStatus, 'succeeded')
  assert.equal(repaired.task.ocrDocumentId, repairedOcr.id)
  assert.equal(repaired.sourceDocument.status, 'ocr_succeeded')

  const failedId = 'src_provider_failure'
  const failedPath = path.join(tempRoot, 'data', 'import-flow-v2', 'source-documents', failedId, 'original.pdf')
  fs.mkdirSync(path.dirname(failedPath), { recursive: true })
  fs.writeFileSync(failedPath, Buffer.from('%PDF-1.4\n%%EOF\n'))
  createSourceDocument({
    id: failedId,
    title: 'Provider Failure',
    originalFileName: 'provider-failure.pdf',
    filePath: assetPathFor(failedPath),
    fileType: 'pdf',
    provider: 'doc2x',
    status: 'uploaded',
  })
  fetchMode = 'failure'
  startSourceDocumentOcr(failedId, { provider: 'doc2x' })
  const failed = await waitForOcrStatus(failedId, 'ocr_failed')
  assert.equal(failed.task.lifecycleStatus, 'failed')
  assert.equal(failed.task.errorCode, 'doc2x_provider_error')
  assert.match(failed.task.error, /provider rejected document/)

  const rollbackId = 'src_completion_rollback'
  const rollbackPath = path.join(tempRoot, 'data', 'import-flow-v2', 'source-documents', rollbackId, 'original.pdf')
  fs.mkdirSync(path.dirname(rollbackPath), { recursive: true })
  fs.writeFileSync(rollbackPath, Buffer.from('%PDF-1.4\n%%EOF\n'))
  createSourceDocument({
    id: rollbackId,
    title: 'Completion Rollback',
    originalFileName: 'completion-rollback.pdf',
    filePath: assetPathFor(rollbackPath),
    fileType: 'pdf',
    provider: 'doc2x',
    status: 'uploaded',
  })
  db.exec(`
    CREATE TRIGGER fail_ocr_success_update
    BEFORE UPDATE OF status ON source_documents
    WHEN NEW.id = '${rollbackId}' AND NEW.status = 'ocr_succeeded'
    BEGIN
      SELECT RAISE(ABORT, 'simulated source update failure');
    END;
  `)
  fetchMode = 'success'
  startSourceDocumentOcr(rollbackId, { provider: 'doc2x' })
  const rolledBack = await waitForOcrStatus(rollbackId, 'ocr_failed')
  assert.equal(rolledBack.task.lifecycleStatus, 'failed')
  assert.equal(listOcrDocuments({ sourceDocumentId: rollbackId }).length, 0, 'OCRDocument insert must roll back with source update')
  db.exec('DROP TRIGGER fail_ocr_success_update')

  console.log('source document ocr task ok')
} catch (error) {
  console.error('Test failed:', error)
  process.exit(1)
} finally {
  globalThis.fetch = originalFetch
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
