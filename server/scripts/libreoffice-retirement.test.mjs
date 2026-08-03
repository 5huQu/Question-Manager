import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'libreoffice-retirement-test-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.QUESTION_AUTH_MODE = 'disabled'

const { app, closeDatabase } = await import('../dist/index.js')
const server = app.listen(0, '127.0.0.1')

function uploadForm(name, bytes, type) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  return form
}

async function upload(baseUrl, name, bytes, type) {
  return fetch(`${baseUrl}/api/import-flow-v2/source-documents/upload`, {
    method: 'POST',
    body: uploadForm(name, bytes, type),
  })
}

try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const uploadTempDir = path.join(tempRoot, 'tmp', 'uploads')

  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, 'config', 'app_settings.json'), `${JSON.stringify({ setupCompleted: true, sofficePath: '/old/soffice' })}\n`)
  const settingsResponse = await fetch(`${baseUrl}/api/settings`)
  assert.equal(settingsResponse.status, 200)
  const settings = await settingsResponse.json()
  for (const key of ['sofficePath', 'sofficeAvailable', 'sofficeDetectedPath']) {
    assert.equal(key in settings, false, `settings must not expose ${key}`)
  }

  const patchedSettingsResponse = await fetch(`${baseUrl}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setupCompleted: true, sofficePath: '/new/soffice' }),
  })
  assert.equal(patchedSettingsResponse.status, 200)
  const patchedSettings = await patchedSettingsResponse.json()
  assert.equal('sofficePath' in patchedSettings, false)
  const persistedSettings = JSON.parse(fs.readFileSync(path.join(tempRoot, 'config', 'app_settings.json'), 'utf8'))
  assert.equal('sofficePath' in persistedSettings, false)

  const healthResponse = await fetch(`${baseUrl}/api/health`)
  assert.equal(healthResponse.status, 200)
  const health = await healthResponse.json()
  assert.equal('soffice' in health.tools, false)
  assert.equal('sofficePath' in health.tools, false)

  const invalidCases = [
    ['legacy.doc', Buffer.from('not a Word conversion input'), 'application/msword'],
    ['legacy.docx', Buffer.from('PK\x03\x04'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['disguised.pdf', Buffer.from('PK\x03\x04'), 'application/pdf'],
  ]
  for (const [name, bytes, type] of invalidCases) {
    const response = await upload(baseUrl, name, bytes, type)
    assert.equal(response.status, 400, `${name} must be rejected`)
    const payload = await response.json()
    assert.equal(typeof payload.error, 'string')
    if (name.endsWith('.doc') || name.endsWith('.docx')) {
      assert.match(payload.error, /暂不支持 Word 文件/u)
    }
    assert.equal(fs.readdirSync(uploadTempDir).length, 0, `${name} must not leave a temporary upload`)
  }

  const validCases = [
    ['paper.pdf', Buffer.from('%PDF-1.4\n'), 'application/pdf'],
    ['paper.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'],
    ['paper.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'],
    ['paper.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
  ]
  for (const [name, bytes, type] of validCases) {
    const response = await upload(baseUrl, name, bytes, type)
    assert.equal(response.status, 201, `${name} must be accepted`)
    assert.equal(fs.readdirSync(uploadTempDir).length, 0, `${name} must not leave a temporary upload`)
  }

  const documentsResponse = await fetch(`${baseUrl}/api/import-flow-v2/source-documents`)
  const documents = await documentsResponse.json()
  assert.equal(documents.items.length, validCases.length, 'rejected files must not create source-document records')
  console.log('LibreOffice retirement contract passed.')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
