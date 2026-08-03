import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-assets-security-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.QUESTION_AUTH_MODE = 'disabled'

const { app, closeDatabase } = await import('../dist/index.js')

function write(relativePath, content = 'asset') {
  const target = path.join(tempRoot, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}

write('data/question_figures/question-1/figure.png', 'public image')
write('data/import-flow-v2/source-documents/source-1/assets/figure.webp', 'document image')
write('data/teaching-documents/doc-1/assets/figure.svg', '<svg />')
write('data/layout-drafts/draft-1/assets/figure.png', 'draft image')
write('data/layout-previews/draft-1/r1/student.pdf', 'preview pdf')
write('data/layout-previews/draft-1/r1/student-page-1.png', 'preview page')
write('data/layout-preview-cache/cache-1/student.pdf', 'cached preview')
write('output/pdf/collection-exports/collection-1/paper.pdf', 'export pdf')
write('config/ocr.env', 'GLM_OCR_API_KEY=secret')
write('data/layout-previews/draft-1/r1/student.log', 'private log')
write('data/layout-previews/draft-1/r1/student.tex', 'private source')
write('data/import-flow-v2/source-documents/source-1/original.pdf', 'private source document')
write('data/import-flow-v2/source-documents/source-1/ocr/glm/raw.json', 'private OCR result')
write('tmp/uploads/upload.png', 'private temporary file')
write('data/.hidden', 'private dot file')
write('data/question_figures/question-1/.hidden.png', 'private dot file')

const outsideSecret = write('private/secret.txt', 'private')
const symlinkPath = path.join(tempRoot, 'data/question_figures/question-1/escape.png')
try {
  fs.symlinkSync(outsideSecret, symlinkPath)
} catch (error) {
  if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
}

const server = app.listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const port = server.address().port
const get = (assetPath) => fetch(`http://127.0.0.1:${port}/files/${assetPath}`)

try {
  const imageResponse = await get('data/question_figures/question-1/figure.png')
  assert.equal(imageResponse.status, 200)
  assert.equal(await imageResponse.text(), 'public image')

  for (const assetPath of [
    'data/import-flow-v2/source-documents/source-1/assets/figure.webp',
    'data/teaching-documents/doc-1/assets/figure.svg',
    'data/layout-drafts/draft-1/assets/figure.png',
    'data/layout-previews/draft-1/r1/student.pdf',
    'data/layout-previews/draft-1/r1/student-page-1.png',
    'data/layout-preview-cache/cache-1/student.pdf',
    'output/pdf/collection-exports/collection-1/paper.pdf',
  ]) {
    assert.equal((await get(assetPath)).status, 200, `合法资源应可访问: ${assetPath}`)
  }

  for (const assetPath of [
    'config/ocr.env',
    'data/question.sqlite',
    'data/layout-previews/draft-1/r1/student.log',
    'data/layout-previews/draft-1/r1/student.tex',
    'data/import-flow-v2/source-documents/source-1/original.pdf',
    'data/import-flow-v2/source-documents/source-1/ocr/glm/raw.json',
    'tmp/uploads/upload.png',
    'data/.hidden',
    'data/question_figures/question-1/.hidden.png',
    'data/layout-previews/draft-1/r1/../student.log',
    'data/question_figures/../.hidden',
  ]) {
    assert.equal((await get(assetPath)).status, 404, `敏感资源不应可访问: ${assetPath}`)
  }

  if (fs.existsSync(symlinkPath)) {
    assert.equal((await get('data/question_figures/question-1/escape.png')).status, 404, '软链接越界不应可访问')
  }

  assert.equal((await get('data/question_figures/%E0%A4%A')).status, 404, '非法 URL 编码不应暴露资源')

  // Legacy /assets/data/... URLs redirect to /files/... so stored URLs keep working.
  const legacyRedirect = await fetch(`http://127.0.0.1:${port}/assets/data/question_figures/question-1/figure.png`, { redirect: 'manual' })
  assert.equal(legacyRedirect.status, 301)
  assert.equal(legacyRedirect.headers.get('location'), '/files/data/question_figures/question-1/figure.png')

  const legacyFollowed = await fetch(`http://127.0.0.1:${port}/assets/data/question_figures/question-1/figure.png`)
  assert.equal(legacyFollowed.status, 200)
  assert.equal(await legacyFollowed.text(), 'public image')

  const legacyPrivate = await fetch(`http://127.0.0.1:${port}/assets/config/ocr.env`, { redirect: 'manual' })
  assert.equal(legacyPrivate.status, 404, '未列入白名单的旧 /assets 路径不应重定向')
  console.log('assets security tests passed')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
