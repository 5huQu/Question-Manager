import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-limits-test-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.CANDIDATE_FIGURE_UPLOAD_MAX_BYTES = String(1024 * 1024)

const { app, closeDatabase } = await import('../dist/index.js')
const server = app.listen(0, '127.0.0.1')

try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' }), 'oversized.png')
  const response = await fetch(`http://127.0.0.1:${address.port}/api/import-flow-v2/candidates/missing/figures/upload`, {
    method: 'POST',
    body: form,
  })
  assert.equal(response.status, 413)
  assert.match(response.headers.get('content-type') || '', /application\/json/)
  assert.deepEqual(await response.json(), {
    error: '上传文件超过大小限制。',
    code: 'LIMIT_FILE_SIZE',
  })
  console.log('Upload limit JSON error test passed.')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
