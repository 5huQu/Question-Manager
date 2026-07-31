import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-teaching-documents-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { app, closeDatabase } = await import('../dist/index.js')
const { inspectTeachingDocumentAssetReferences } = await import('../dist/services/teaching-documents.service.js')
const server = app.listen(0, '127.0.0.1')

try {
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const json = async (url, init) => {
    const response = await fetch(`${baseUrl}${url}`, init)
    return { response, body: await response.json() }
  }

  const defaultExam = await json('/api/teaching-documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '默认试卷', documentType: 'exam' }),
  })
  assert.equal(defaultExam.response.status, 201)
  assert.deepEqual(defaultExam.body.content.style, {
    typographyPreset: 'exam', bodyFont: 'songti', bodyLatinFont: 'times', bodyNumberFont: 'times',
    headingFont: 'heiti', headingLatinFont: 'arial', headingNumberFont: 'times', marginPreset: 'compact', questionSpacing: 'compact',
  })

  const defaultLecture = await json('/api/teaching-documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '默认讲义', documentType: 'lecture' }),
  })
  assert.equal(defaultLecture.response.status, 201)
  assert.deepEqual(defaultLecture.body.content.style, {
    typographyPreset: 'lecture', bodyFont: 'songti', bodyLatinFont: 'georgia', bodyNumberFont: 'times',
    headingFont: 'heiti', headingLatinFont: 'arial', headingNumberFont: 'times', marginPreset: 'normal', questionSpacing: 'normal',
  })

  const originalUnknown = { nested: ['kept', { value: 1 }] }
  const content = {
    version: 1,
    documentType: 'lecture',
    title: '持久化测试',
    metadata: { source: 'test' },
    content: [
      { type: 'paragraph', id: 'paragraph-1', content: [{ type: 'text', text: '正文' }] },
      { type: 'table', id: 'table-1', hasHeader: true, rows: [
        [{ content: [{ type: 'text', text: '变量' }] }, { content: [{ type: 'inlineMath', latex: 'x^2' }] }],
        [{ content: [{ type: 'text', text: '定义域' }] }, { content: [{ type: 'text', text: 'R' }] }],
      ] },
      { type: 'unknown', id: 'unknown-1', originalType: 'futureBlock', rawData: originalUnknown },
    ],
  }
  const created = await json('/api/teaching-documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '持久化测试', documentType: 'lecture', content }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.revision, 1)
  assert.equal(created.body.content.content[1].type, 'table')
  assert.equal(created.body.content.content[1].rows[0][1].content[0].latex, 'x^2')
  assert.deepEqual(created.body.content.content[2].rawData, originalUnknown)
  const documentId = created.body.id

  const fetched = await json(`/api/teaching-documents/${documentId}`)
  assert.equal(fetched.response.status, 200)
  assert.deepEqual(fetched.body.content.content[2].rawData, originalUnknown)

  const updatedContent = { ...content, title: '更新后', content: [...content.content, { type: 'divider', id: 'divider-1' }] }
  const updated = await json(`/api/teaching-documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 1, title: '更新后', content: updatedContent }),
  })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.revision, 2)

  const conflict = await json(`/api/teaching-documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 1, title: '旧客户端覆盖' }),
  })
  assert.equal(conflict.response.status, 409)
  assert.equal(conflict.body.error, 'revision_conflict')
  assert.equal(conflict.body.actualRevision, 2)
  assert.equal(conflict.body.current.blockCount, 4)

  const invalid = await json('/api/teaching-documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '无效', documentType: 'lecture', content: { version: 1, documentType: 'lecture', title: '无效', metadata: {}, content: [{ type: 'paragraph', id: '', content: [] }] } }),
  })
  assert.equal(invalid.response.status, 422)
  assert.equal(invalid.body.error, 'teaching_document_validation_failed')

  const tableInBox = await json('/api/teaching-documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '卡片表格',
      documentType: 'lecture',
      content: {
        version: 1,
        documentType: 'lecture',
        title: '卡片表格',
        metadata: {},
        content: [{
          type: 'box', id: 'box-with-table', templateId: 'concept', breakBehavior: 'auto', children: [{
            type: 'table', id: 'table-in-box', hasHeader: true,
            rows: [[{ content: [{ type: 'text', text: '表头' }] }]],
          }, {
            type: 'rawMarkdown', id: 'markdown-in-box', markdown: '**要点**：$y=kx+b$', reason: 'user-inserted',
          }],
        }],
      },
    }),
  })
  assert.equal(tableInBox.response.status, 201)
  assert.equal(tableInBox.body.content.content[0].children[0].type, 'table')
  assert.equal(tableInBox.body.content.content[0].children[1].type, 'rawMarkdown')

  const unboundQuestion = await json('/api/teaching-documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '待选择题目',
      documentType: 'lecture',
      content: {
        version: 1,
        documentType: 'lecture',
        title: '待选择题目',
        metadata: {},
        content: [{ type: 'question', id: 'unbound-question', questionId: '' }],
      },
    }),
  })
  assert.equal(unboundQuestion.response.status, 201)
  assert.equal(unboundQuestion.body.issues.some((issue) => issue.code === 'invalid-question-ref'), true)

  const malformedJson = await fetch(`${baseUrl}/api/teaching-documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"title":',
  })
  assert.equal(malformedJson.status, 400)
  assert.deepEqual(await malformedJson.json(), { error: '请求 JSON 格式无效。', code: 'INVALID_JSON' })

  const absolutePath = await json('/api/teaching-documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '路径', documentType: 'lecture', content: { version: 1, documentType: 'lecture', title: '路径', metadata: {}, content: [{ type: 'figure', id: 'f1', asset: { type: 'legacyPath', path: '/Users/example/private.png' }, alignment: 'center' }] } }),
  })
  assert.equal(absolutePath.response.status, 422)

  const duplicated = await json(`/api/teaching-documents/${documentId}/duplicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(duplicated.response.status, 201)
  assert.notEqual(duplicated.body.id, documentId)
  assert.notEqual(duplicated.body.content.content[0].id, updated.body.content.content[0].id)
  assert.deepEqual(duplicated.body.content.content[2].rawData, originalUnknown)

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png')
  const assetResponse = await fetch(`${baseUrl}/api/teaching-documents/${documentId}/assets`, { method: 'POST', body: form })
  assert.equal(assetResponse.status, 201)
  const asset = await assetResponse.json()
  assert.equal(asset.documentId, documentId)
  assert.equal(asset.width, 1)
  assert.equal(asset.height, 1)
  assert.match(asset.url, /^\/assets\/data\/teaching-documents\//)
  assert.equal(asset.url.includes(tempRoot), false)
  const imageResponse = await fetch(`${baseUrl}${asset.url}`)
  assert.equal(imageResponse.status, 200)
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png)

  const imageContent = {
    ...updated.body.content,
    content: [...updated.body.content.content, {
      type: 'figure',
      id: 'document-image-1',
      asset: { type: 'documentAsset', assetId: asset.id },
      alignment: 'center',
    }],
  }
  const imageUpdate = await json(`/api/teaching-documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2, content: imageContent }),
  })
  assert.equal(imageUpdate.response.status, 200)
  const duplicateWithAsset = await json(`/api/teaching-documents/${documentId}/duplicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(duplicateWithAsset.response.status, 201)
  assert.equal(duplicateWithAsset.body.content.content.at(-1).asset.assetId, asset.id)
  assert.equal(duplicateWithAsset.body.assets[0].id, asset.id)
  assert.deepEqual(inspectTeachingDocumentAssetReferences(asset.id), {
    assetId: asset.id,
    referenced: true,
    documentIds: [documentId, duplicateWithAsset.body.id].sort(),
  })

  const invalidForm = new FormData()
  invalidForm.append('file', new Blob(['not an image'], { type: 'image/png' }), 'fake.png')
  const invalidImage = await fetch(`${baseUrl}/api/teaching-documents/${documentId}/assets`, { method: 'POST', body: invalidForm })
  assert.equal(invalidImage.status, 400)

  const deleted = await json(`/api/teaching-documents/${documentId}`, { method: 'DELETE' })
  assert.equal(deleted.response.status, 200)
  assert.equal(deleted.body.deleted, true)
  assert.equal(deleted.body.retainedAssets, 1)
  assert.deepEqual(inspectTeachingDocumentAssetReferences(asset.id), {
    assetId: asset.id,
    referenced: true,
    documentIds: [duplicateWithAsset.body.id],
  })

  const deletedDuplicate = await json(`/api/teaching-documents/${duplicateWithAsset.body.id}`, { method: 'DELETE' })
  assert.equal(deletedDuplicate.response.status, 200)
  assert.deepEqual(inspectTeachingDocumentAssetReferences(asset.id), {
    assetId: asset.id,
    referenced: false,
    documentIds: [],
  })
  const missing = await fetch(`${baseUrl}/api/teaching-documents/${documentId}`)
  assert.equal(missing.status, 404)
  const retainedImage = await fetch(`${baseUrl}${asset.url}`)
  assert.equal(retainedImage.status, 200)

  console.log('TeachingDocument persistence checks passed.')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
