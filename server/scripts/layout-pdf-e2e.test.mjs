import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-layout-pdf-e2e-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { closeDatabase } = await import('../dist/index.js')
const { createQuestion } = await import('../dist/db/questions.js')
const collections = await import('../dist/services/question-bank/collections.service.js')
const drafts = await import('../dist/services/question-bank/layout-drafts.service.js')

try {
  const collection = collections.createCollection({ title: '四页 PDF 排版验收样卷', kind: 'paper' })
  const sourceImage = path.join(tempRoot, 'sample-figure.png')
  fs.writeFileSync(sourceImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
  const choiceQuestion = createQuestion({ questionNo: '1', questionType: '单选题', stemMarkdown: '根据右图选择正确结论。\nA. 甲\nB. 乙\nC. 丙\nD. 丁', answerText: 'A', figures: [{ id: 'figure-1', usage: 'stem', path: 'sample-figure.png' }], totalScore: 5 })
  collections.addCollectionItem(collection.id, { questionId: choiceQuestion.id, sectionName: '选择题', score: 5 })
  for (let index = 1; index <= 16; index += 1) {
    const question = createQuestion({
      questionNo: String(index),
      questionType: '解答题',
      stemMarkdown: `已知函数 $f_${index}(x)=x^2-${index}x+${index}$，求其单调区间与最小值，并写出完整推导过程。`,
      answerText: `$x=${index}/2$ 时取得最小值。`,
      analysisMarkdown: `配方得 $f_${index}(x)=(x-${index}/2)^2+${index}-${index}^2/4$。`,
      totalScore: 6,
    })
    collections.addCollectionItem(collection.id, { questionId: question.id, sectionName: '解答题', score: 6 })
  }

  const assembled = collections.getCollection(collection.id)
  const reversed = [...assembled.questions].reverse()
  const layout = {
    version: 1,
    questions: reversed.map((entry, order) => entry.item.id === choiceQuestion.id
      ? { relationId: entry.relationId, order, choiceLayout: 'four', figures: [{ figureId: 'figure-1', placement: 'side-right', widthRatio: .32, alignment: 'right' }], keepTogether: true }
      : { relationId: entry.relationId, order, choiceLayout: 'auto', figures: [], keepTogether: true, pageBreakBefore: order === 3, answerAreaHeight: 6, answerAreaManual: true }),
  }
  let draft = drafts.createLayoutDraft(collection.id, { name: '四页验收', layout })
  const editedRelationId = reversed[0].relationId
  const originalStem = reversed[0].item.stemMarkdown
  draft = drafts.updateLayoutDraft(draft.id, {
    revision: draft.revision,
    contentEdits: [{ relationId: editedRelationId, content: { stemMarkdown: `${originalStem}\n\n仅当前试卷校订标记` } }],
  })
  assert.doesNotMatch(
    collections.getCollection(collection.id).questions.find((entry) => entry.relationId === editedRelationId).item.stemMarkdown,
    /仅当前试卷校订标记/,
    '试卷内编辑不应修改题库原题',
  )
  drafts.generateLayoutPreview(draft.id, draft.revision)
  let preview = drafts.getPreviewStatus(draft.id)
  for (let attempt = 0; attempt < 240 && ['queued', 'rendering'].includes(preview.status); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250))
    preview = drafts.getPreviewStatus(draft.id)
  }

  assert.equal(preview.status, 'ready', preview.error || 'PDF 预览应成功生成')
  assert.equal(preview.revision, draft.revision)
  assert.equal(preview.displayRevision, draft.revision)
  assert.ok((preview.variants?.student.pageCount || 0) >= 4, '学生版样卷应不少于四页')
  assert.ok(preview.variants?.teacher.pageCount, '教师版也应生成 PDF 页面')
  assert.equal(Object.keys(preview.questionPages?.student || {}).length, 17, '每道题都应有 PDF telemetry 页码')
  assert.equal(Object.keys(preview.questionPages.student)[0], reversed[0].relationId, 'PDF telemetry 应按草稿中的拖动题序生成')
  const previewTex = fs.readFileSync(path.join(tempRoot, 'data', 'layout-previews', draft.id, `r${draft.revision}`, 'student.tex'), 'utf8')
  assert.match(previewTex, /\\qbankchoiceswithfigure\{right\}\{0\.32\}/, '图片槽位和宽度覆盖应进入 PDF LaTeX')
  assert.match(previewTex, /\\qbankfigure\{[^}]+\}\{0\.9500\}\{right\}/, '图片对齐覆盖应进入 PDF LaTeX')
  assert.match(previewTex, /\\newpage/, '题前强制分页应进入 PDF LaTeX')
  assert.match(previewTex, /仅当前试卷校订标记/, '试卷内容覆盖应进入 PDF LaTeX')

  const exported = drafts.exportLayoutDraft(draft.id, { revision: draft.revision, format: 'pdf' })
  assert.equal(exported.exportRecord.snapshot.draftId, draft.id)
  assert.equal(exported.exportRecord.snapshot.revision, draft.revision)
  assert.equal(exported.exportRecord.snapshot.contentOverrides[editedRelationId].stemMarkdown.includes('仅当前试卷校订标记'), true, '最终导出记录应保存实际内容覆盖')
  assert.equal(fs.existsSync(path.join(tempRoot, exported.path)), true, '最终导出的 PDF 文件应存在')

  console.log(JSON.stringify({ tempRoot, draftId: draft.id, revision: draft.revision, studentPages: preview.variants.student.pageCount, teacherPages: preview.variants.teacher.pageCount, firstStudentPage: preview.variants.student.pageImages[0], exportedPath: exported.path }))
  console.log('layout PDF end-to-end test passed')
} finally {
  closeDatabase()
  if (process.env.KEEP_LAYOUT_PDF_E2E !== '1') fs.rmSync(tempRoot, { recursive: true, force: true })
}
