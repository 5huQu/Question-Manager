import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-ocr-json-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.QUESTION_AUTH_MODE = 'disabled'

const { closeDatabase } = await import('../dist/index.js')
const { importOCRDocumentJson } = await import('../dist/services/import-flow-v2/ocr-document.service.js')

const validDocument = {
  provider: 'doc2x',
  markdown: '1. JSON OCR 题干',
  pages: [{
    pageNo: 1,
    width: 1000,
    height: 1400,
    blocks: [{ id: 'block_1', pageNo: 1, type: 'text', content: '1. JSON OCR 题干' }],
  }],
  assets: [],
  metadata: { title: 'OCR JSON 测试' },
}

try {
  const result = await importOCRDocumentJson({ ocrDocument: validDocument, sourceDocument: { title: '上传的 OCR JSON' } })
  assert.equal(result.sourceDocument.fileType, 'json')
  assert.equal(result.ocrDocument.provider, 'doc2x')

  assert.rejects(() => importOCRDocumentJson({}), /OCRDocument JSON schema 错误/)
  assert.rejects(() => importOCRDocumentJson({ ocrDocument: { ...validDocument, pages: {} } }), /OCRDocument JSON schema 错误/)
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('OCRDocument JSON import contract ok')
