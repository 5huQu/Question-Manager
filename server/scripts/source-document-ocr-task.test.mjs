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
    return new Response(JSON.stringify(doc2xPayload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  throw new Error(`Unexpected fetch call: ${method} ${href}`)
}

const { closeDatabase } = await import('../dist/index.js')
const { createSourceDocument } = await import('../dist/repositories/source-documents.repo.js')
const { listOcrDocuments } = await import('../dist/repositories/ocr-documents.repo.js')
const { assetPathFor } = await import('../dist/utils/paths.js')
const {
  getSourceDocumentOcrStatus,
  loadOcrDocument,
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

  console.log('source document ocr task ok')
} catch (error) {
  console.error('Test failed:', error)
  process.exit(1)
} finally {
  globalThis.fetch = originalFetch
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
