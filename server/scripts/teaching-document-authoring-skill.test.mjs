import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const preflight = path.join(projectRoot, 'skills', 'teaching-document-authoring', 'scripts', 'preflight-teaching-document.mjs')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-teaching-document-skill-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.QUESTION_AUTH_MODE = 'disabled'

const { app, closeDatabase } = await import('../dist/index.js')
const server = app.listen(0, '127.0.0.1')

async function json(baseUrl, url, init) {
  const response = await fetch(`${baseUrl}${url}`, init)
  return { response, body: await response.json() }
}

try {
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`

  const question = await json(baseUrl, '/api/question-bank/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      questionNo: '1', stage: '高中', questionType: '单选题', sourceTitle: 'Skill smoke test',
      stemMarkdown: '函数 $f(x)=x$ 的导数是（ ）\n\nA. $1$\nB. $0$\nC. $x$\nD. $x^2$',
      answerText: 'A', analysisMarkdown: '由导数定义可得 $f\prime(x)=1$。',
      bankStatus: 'ready', knowledgePoints: [], solutionMethods: [], totalScore: 5,
    }),
  })
  assert.equal(question.response.status, 201)

  const created = await json(baseUrl, '/api/teaching-documents', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Skill 最小讲义', documentType: 'lecture' }),
  })
  assert.equal(created.response.status, 201)

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'skill-pixel.png')
  const uploaded = await fetch(`${baseUrl}/api/teaching-documents/${created.body.id}/assets`, { method: 'POST', body: form })
  assert.equal(uploaded.status, 201)
  const asset = await uploaded.json()

  const content = {
    version: 1,
    documentType: 'lecture',
    title: 'Skill 最小讲义',
    metadata: { source: 'teaching-document-authoring smoke test' },
    content: [
      { type: 'heading', id: 'skill-heading', level: 1, content: [{ type: 'text', text: '函数导数' }] },
      { type: 'paragraph', id: 'skill-paragraph', content: [{ type: 'text', text: '导数描述函数的瞬时变化率。' }] },
      { type: 'figure', id: 'skill-figure', asset: { type: 'documentAsset', assetId: asset.id }, alignment: 'center', alt: '最小测试图片' },
      { type: 'question', id: 'skill-question', questionId: question.body.id, display: { showAnswer: false, showAnalysis: false } },
    ],
  }
  const draftPath = path.join(tempRoot, 'draft.json')
  fs.writeFileSync(draftPath, JSON.stringify(content))
  const preflightReport = JSON.parse(execFileSync(process.execPath, [preflight, draftPath], { encoding: 'utf8' }))
  assert.equal(preflightReport.valid, true)

  const saved = await json(baseUrl, `/api/teaching-documents/${created.body.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: created.body.revision, title: content.title, content }),
  })
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.revision, 2)

  const reloaded = await json(baseUrl, `/api/teaching-documents/${created.body.id}`)
  assert.equal(reloaded.response.status, 200)
  assert.equal(reloaded.body.content.content[2].asset.assetId, asset.id)
  assert.equal(reloaded.body.content.content[3].questionId, question.body.id)
  assert.equal(reloaded.body.issues.some((issue) => issue.level === 'error'), false)
  console.log('Teaching document authoring Skill smoke test passed.')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
