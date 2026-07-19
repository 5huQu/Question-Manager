import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-figure-move-test-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { closeDatabase } = await import('../dist/index.js')
const { importOCRDocumentJson } = await import('../dist/services/import-flow-v2/ocr-document.service.js')
const { moveCandidateFigure, uploadCandidateFigure } = await import('../dist/services/import-flow-v2/candidate.service.js')
const candidateRepo = await import('../dist/repositories/question-candidates.repo.js')

try {
  const sourceDocumentId = 'source_figure_move'
  const ocrDocumentId = 'ocr_figure_move'
  await importOCRDocumentJson({
    sourceDocument: { id: sourceDocumentId, title: '题图移动测试' },
    ocrDocument: {
      id: ocrDocumentId,
      sourceDocumentId,
      provider: 'doc2x',
      markdown: '5. 第五题。\n6. 第六题。',
      pages: [{
        pageNo: 1,
        width: 1000,
        height: 1400,
        blocks: [
          { id: 'block_q5', pageNo: 1, type: 'text', content: '5. 第五题。', bbox: [100, 100, 500, 240] },
          { id: 'block_figure_q6', pageNo: 1, type: 'image', content: '', assetId: 'asset_figure_q6', bbox: [600, 260, 900, 560] },
          { id: 'block_q6', pageNo: 1, type: 'text', content: '6. 第六题。', bbox: [100, 260, 550, 620] },
        ],
      }],
      assets: [{
        id: 'asset_figure_q6',
        type: 'image',
        path: 'import-flow-v2/source-documents/source_figure_move/assets/q6.png',
        pageNo: 1,
        bbox: [600, 260, 900, 560],
        sourceBlockId: 'block_figure_q6',
      }],
    },
  })

  const source = candidateRepo.createQuestionCandidate({
    id: 'candidate_q5',
    sourceDocumentId,
    ocrDocumentId,
    questionNo: '5',
    stemMarkdown: [
      '第五题题干。',
      '',
      '<!-- figureText: 输电图 -->',
      '<!-- DOC2X_FIGURE:asset_figure_q6 -->',
      '',
      'A. 选项 A',
      'B. 选项 B',
    ].join('\n'),
    answerText: 'A',
    analysisMarkdown: '第五题解析。',
    figures: [{
      id: 'asset_figure_q6',
      usage: 'stem',
      path: 'import-flow-v2/source-documents/source_figure_move/assets/q6.png',
      sourceDocumentId,
      sourceBlockId: 'block_figure_q6',
      pageNo: 1,
      bbox: [600, 260, 900, 560],
    }],
    sourceRefs: [{
      sourceDocumentId,
      pageNo: 1,
      blockIds: ['block_q5', 'block_figure_q6'],
      bbox: [100, 100, 900, 560],
      kind: 'stem',
    }],
  })
  const target = candidateRepo.createQuestionCandidate({
    id: 'candidate_q6',
    sourceDocumentId,
    ocrDocumentId,
    questionNo: '6',
    stemMarkdown: '第六题题干。\n\nA. 选项 A\n\nB. 选项 B',
    answerText: 'B',
    analysisMarkdown: '第六题解析。',
    sourceRefs: [{ sourceDocumentId, pageNo: 1, blockIds: ['block_q6'], bbox: [100, 260, 550, 620], kind: 'stem' }],
  })

  const moved = moveCandidateFigure(source.id, 'asset_figure_q6', {
    targetCandidateId: target.id,
    usage: 'stem',
    sourceExpectedContentRevision: source.contentRevision,
    targetExpectedContentRevision: target.contentRevision,
  })
  assert.equal(moved.sourceCandidate.figures.length, 0)
  assert.doesNotMatch(moved.sourceCandidate.stemMarkdown, /DOC2X_FIGURE|figureText/)
  assert.deepEqual(moved.sourceCandidate.sourceRefs[0].blockIds, ['block_q5'])
  assert.deepEqual(moved.sourceCandidate.sourceRefs[0].bbox, [100, 100, 500, 240])
  assert.equal(moved.targetCandidate.figures[0].id, 'asset_figure_q6')
  assert.match(moved.targetCandidate.stemMarkdown, /第六题题干。[\s\S]*DOC2X_FIGURE:asset_figure_q6[\s\S]*A\. 选项 A/)
  assert.equal(moved.targetCandidate.sourceRefs.some((ref) => ref.kind === 'figure' && ref.blockIds.includes('block_figure_q6')), true)
  assert.equal(moved.sourceCandidate.contentRevision, source.contentRevision + 1)
  assert.equal(moved.targetCandidate.contentRevision, target.contentRevision + 1)

  const changedUsage = moveCandidateFigure(target.id, 'asset_figure_q6', {
    targetCandidateId: target.id,
    usage: 'analysis',
    sourceExpectedContentRevision: moved.targetCandidate.contentRevision,
  })
  assert.equal(changedUsage.targetCandidate.figures[0].usage, 'analysis')
  assert.doesNotMatch(changedUsage.targetCandidate.stemMarkdown, /DOC2X_FIGURE:asset_figure_q6/)
  assert.match(changedUsage.targetCandidate.analysisMarkdown, /第六题解析。[\s\S]*DOC2X_FIGURE:asset_figure_q6/)

  const uploadResult = uploadCandidateFigure(target.id, {
    originalname: 'supplement.png',
    mimetype: 'image/png',
    buffer: Buffer.from('mock-image'),
  }, { usage: 'stem' })
  assert.equal(uploadResult.figure.origin, 'manual_upload')
  assert.equal(uploadResult.figure.originalName, 'supplement.png')
  assert.equal(uploadResult.figure.usage, 'stem')
  assert.equal(uploadResult.candidate.figures.some((figure) => figure.id === uploadResult.figure.id), true)
  assert.equal(fs.existsSync(path.join(tempRoot, uploadResult.figure.path)), true)
  assert.throws(
    () => uploadCandidateFigure(target.id, {
      originalname: 'notes.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from('not-an-image'),
    }, {}),
    (error) => error?.status === 400,
  )

  assert.throws(
    () => moveCandidateFigure(target.id, 'asset_figure_q6', {
      targetCandidateId: source.id,
      usage: 'stem',
      sourceExpectedContentRevision: moved.targetCandidate.contentRevision,
      targetExpectedContentRevision: moved.sourceCandidate.contentRevision,
    }),
    (error) => error?.status === 409 && error?.body?.error === 'content_revision_conflict',
  )

  console.log('Candidate figure move tests passed.')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 207 })
}
