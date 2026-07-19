import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-layout-drafts-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { app, closeDatabase } = await import('../dist/index.js')
const { db } = await import('../dist/db/connection.js')
const { ensureSchema } = await import('../dist/db/schema.js')
const { createQuestion } = await import('../dist/db/questions.js')
const collections = await import('../dist/services/question-bank/collections.service.js')
const drafts = await import('../dist/services/question-bank/layout-drafts.service.js')
const draftRepo = await import('../dist/repositories/question-bank/layout-drafts.repo.js')
const items = await import('../dist/services/question-bank/items.service.js')

try {
  db.exec('DROP TABLE question_bank_layout_drafts')
  ensureSchema()
  const migratedColumns = db.prepare('PRAGMA table_info(question_bank_layout_drafts)').all().map((column) => column.name)
  assert.ok(migratedColumns.includes('preview_warnings_json'), '旧库启动应创建完整草稿表')
  assert.ok(migratedColumns.includes('content_overrides_json'), '旧库启动应补齐内容覆盖列')
  assert.ok(db.prepare('PRAGMA table_info(question_bank_items)').all().some((column) => column.name === 'content_revision'))
  assert.ok(db.prepare('PRAGMA table_info(question_candidates)').all().some((column) => column.name === 'content_revision'))

  const editableQuestion = createQuestion({ stemMarkdown: '原题干', answerText: '原答案', analysisMarkdown: '原解析' })
  assert.equal(editableQuestion.contentRevision, 1)
  const noChange = items.updateItem(editableQuestion.id, { expectedContentRevision: 1, stemMarkdown: '原题干' })
  assert.equal(noChange.contentRevision, 1, '内容无变化时不应递增版本')
  const changedItem = items.updateItem(editableQuestion.id, { expectedContentRevision: 1, stemMarkdown: '题库新题干' })
  assert.equal(changedItem.contentRevision, 2)
  assert.throws(
    () => items.updateItem(editableQuestion.id, { expectedContentRevision: 1, stemMarkdown: '过期写入' }),
    (error) => error?.status === 409 && error?.body?.actualContentRevision === 2,
  )

  const editableCollection = collections.createCollection({ title: '内容覆盖试卷', kind: 'paper' })
  const withQuestion = collections.addCollectionItem(editableCollection.id, { questionId: editableQuestion.id })
  const relationId = withQuestion.questions[0].relationId
  const editableDraft = drafts.createLayoutDraft(editableCollection.id, {})
  const editedDraft = drafts.updateLayoutDraft(editableDraft.id, {
    revision: editableDraft.revision,
    contentEdits: [{ relationId, content: { stemMarkdown: '仅当前试卷题干' } }],
  })
  assert.equal(editedDraft.contentOverrides[relationId].stemMarkdown, '仅当前试卷题干')
  assert.equal(editedDraft.effectiveContentSnapshot.questions[0].item.stemMarkdown, '仅当前试卷题干')
  assert.equal(items.getItem(editableQuestion.id).stemMarkdown, '题库新题干', '试卷内编辑不得隐式更新题库')
  const synced = drafts.syncLayoutContentToBank(editableDraft.id, relationId, {
    revision: editedDraft.revision,
    expectedContentRevision: 2,
  })
  assert.equal(synced.item.stemMarkdown, '仅当前试卷题干')
  assert.equal(synced.item.contentRevision, 3)
  assert.equal(Object.keys(synced.draft.contentOverrides).length, 0)

  const conflictDraft = drafts.updateLayoutDraft(editableDraft.id, {
    revision: synced.draft.revision,
    contentEdits: [{ relationId, analysisMarkdown: '试卷内解析' }],
  })
  items.updateItem(editableQuestion.id, { expectedContentRevision: 3, analysisMarkdown: '题库并发解析' })
  const refreshedConflict = drafts.refreshLayoutDraftContent(editableDraft.id, conflictDraft.revision)
  assert.equal(refreshedConflict.preservedOverrides, 1)
  assert.equal(refreshedConflict.conflicts.length, 1)
  assert.equal(refreshedConflict.draft.effectiveContentSnapshot.questions[0].item.analysisMarkdown, '试卷内解析')
  assert.throws(
    () => drafts.syncLayoutContentToBank(editableDraft.id, relationId, { revision: refreshedConflict.draft.revision, expectedContentRevision: 3 }),
    (error) => error?.status === 409 && error?.body?.actualContentRevision === 4,
  )
  drafts.deleteLayoutDraft(editableDraft.id)
  collections.deleteCollection(editableCollection.id)

  const sourceImage = path.join(tempRoot, 'source-figure.png')
  fs.writeFileSync(sourceImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
  const imageQuestion = createQuestion({ stemMarkdown: '含图题目', questionType: '解答题', figures: [{ id: 'figure-1', usage: 'stem', path: path.basename(sourceImage) }] })
  const imageCollection = collections.createCollection({ title: '图片快照', kind: 'paper' })
  collections.addCollectionItem(imageCollection.id, { questionId: imageQuestion.id })
  const replaced = collections.replaceCollectionItems(imageCollection.id, { questionIds: [imageQuestion.id, imageQuestion.id], title: '批次替换试卷' })
  assert.equal(replaced.questionCount, 1, '批次替换应去重并原子写入题目')
  assert.equal(replaced.title, '批次替换试卷')
  const imageDraft = drafts.createLayoutDraft(imageCollection.id, {})
  const snapshottedPath = imageDraft.contentSnapshot.questions[0].item.figures[0].path
  assert.notEqual(snapshottedPath, path.basename(sourceImage))
  fs.rmSync(sourceImage)
  assert.equal(fs.existsSync(path.join(tempRoot, snapshottedPath)), true, '删除原图后草稿私有图片副本仍应存在')
  drafts.deleteLayoutDraft(imageDraft.id)
  assert.equal(fs.existsSync(path.join(tempRoot, 'layout-drafts', imageDraft.id)), false, '删除草稿应清理私有图片')
  collections.deleteCollection(imageCollection.id)

  const collection = collections.createCollection({ title: '快照原始标题', kind: 'paper' })
  const created = drafts.createLayoutDraft(collection.id, { name: '第一版', variant: 'teacher' })
  assert.equal(created.revision, 1)
  assert.equal(created.variant, 'teacher')
  assert.equal(created.templateSpecVersion, 1)
  assert.equal(created.templateSpec.templateId, 'worksheet')
  assert.equal(created.templateSpec.page.widthMm, 210)
  assert.equal(created.contentSnapshot.title, '快照原始标题')

  collections.updateCollection(collection.id, { title: '题库后来标题' })
  assert.equal(drafts.getLayoutDraft(created.id).contentSnapshot.title, '快照原始标题', '草稿内容快照不应随集合变化')

  const refreshed = drafts.refreshLayoutDraftContent(created.id, created.revision)
  assert.equal(refreshed.changed, true, '显式刷新应将当前集合内容写入新的快照 revision')
  assert.equal(refreshed.draft.revision, 2)
  assert.equal(refreshed.draft.contentSnapshot.title, '题库后来标题')
  assert.equal(drafts.refreshLayoutDraftContent(created.id, refreshed.draft.revision).changed, false, '内容未变时不应徒增 revision')

  const previousPreviewDir = path.join(tempRoot, 'data', 'layout-previews', created.id, 'r2')
  fs.mkdirSync(previousPreviewDir, { recursive: true })
  fs.writeFileSync(path.join(previousPreviewDir, 'student.pdf'), 'previous pdf')
  fs.writeFileSync(path.join(previousPreviewDir, 'student-page-1.png'), 'previous page')
  draftRepo.setPreviewState(created.id, 2, 'ready', `layout-previews/${created.id}/r2/student.pdf`, [`layout-previews/${created.id}/r2/student-page-1.png`], [{ code: 'question-split', questionId: 'q1' }], '')
  const updated = drafts.updateLayoutDraft(created.id, {
    revision: 2,
    layout: { version: 1, solutionPageStrategy: 'two', questions: [{ relationId: 'rel-1', choiceLayout: 'four', figures: [], equalizedAnswerAreaHeight: 6.4, equalizedPageBreakBefore: true }] },
  })
  assert.equal(updated.revision, 3)
  assert.equal(updated.layout.solutionPageStrategy, 'two')
  assert.equal(updated.layout.questions[0].equalizedAnswerAreaHeight, 6.4)
  assert.equal(updated.layout.questions[0].equalizedPageBreakBefore, true)
  assert.equal(updated.preview.status, 'idle')
  assert.equal(updated.preview.pages.length, 1, '新 revision 编译前应保留上一份可用 PDF 页面')
  assert.equal(updated.preview.displayRevision, 2, '新 revision 编译前应标记正在显示的旧 PDF revision')

  assert.throws(
    () => drafts.updateLayoutDraft(created.id, { revision: 2, layout: updated.layout }),
    (error) => error?.status === 409 && /更新|冲突/.test(error.message),
    '旧 revision 必须被拒绝',
  )

  const preview = drafts.generateLayoutPreview(created.id, updated.revision)
  assert.equal(preview.status, 'queued')
  assert.equal(preview.displayRevision, 2, '排队和编译期间应继续显示旧 PDF')
  let finished = drafts.getPreviewStatus(created.id)
  for (let attempt = 0; attempt < 100 && ['queued', 'rendering'].includes(finished.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    finished = drafts.getPreviewStatus(created.id)
  }
  assert.equal(finished.status, 'failed', '空草稿编译失败应落库而不是导致服务崩溃')
  assert.match(finished.error, /题目|导出/)

  draftRepo.setPreviewState(created.id, updated.revision, 'rendering', '', [], [], '')
  drafts.recoverInterruptedLayoutPreviews()
  assert.equal(drafts.getPreviewStatus(created.id).status, 'failed')
  assert.match(drafts.getPreviewStatus(created.id).error, /退出|重新生成/)

  const outside = path.join(os.tmpdir(), `qbank-outside-${Date.now()}.txt`)
  fs.writeFileSync(outside, 'private')
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const port = server.address().port
  const response = await fetch(`http://127.0.0.1:${port}/assets/${encodeURIComponent(outside)}`)
  assert.notEqual(response.status, 200, '/assets 不得读取存储根目录外文件')
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(outside, { force: true })

  collections.deleteCollection(collection.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM question_bank_layout_drafts WHERE id = ?').get(created.id).count, 0, '删除集合应级联删除草稿')
  console.log('layout draft service tests passed')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
