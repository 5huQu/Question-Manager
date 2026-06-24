import assert from 'node:assert/strict'
import { parseQuestionCandidates } from '../dist/services/question-parser/index.js'

function block(markdown, content, pageNo, id, type = 'text', assetId = '') {
  const markdownStart = markdown.indexOf(content)
  assert.notEqual(markdownStart, -1, 'test block content must exist in markdown')
  return {
    id,
    pageNo,
    type,
    content,
    markdownStart,
    markdownEnd: markdownStart + content.length,
    ...(assetId ? { assetId } : {}),
  }
}

const markdown = [
  '<!-- DOC2X_PAGE:1 -->',
  '一、选择题',
  '1. 已知函数 $f(x)=x^2$，求 $f(2)$。',
  '<img src="figure-1.png">',
  '',
  '2、若 $a=3$，求 $a+1$。',
  '',
  '答案',
  '1. 4',
  '2. 4',
  '',
  '解析',
  '1. 代入 $2^2=4$。',
  '2. 由 $3+1=4$。',
].join('\n')

const ocrDocument = {
  id: 'ocr_parser_test',
  sourceDocumentId: 'src_parser_test',
  provider: 'doc2x',
  rawResultPath: '/tmp/doc2x/raw.json',
  markdown,
  pages: [
    {
      pageNo: 1,
      width: 800,
      height: 1100,
      blocks: [
        block(markdown, '1. 已知函数 $f(x)=x^2$，求 $f(2)$。', 1, 'b_q1'),
        block(markdown, '<img src="figure-1.png">', 1, 'b_fig1', 'image', 'asset_fig1'),
        block(markdown, '2、若 $a=3$，求 $a+1$。', 1, 'b_q2'),
      ],
    },
    {
      pageNo: 2,
      width: 800,
      height: 1100,
      blocks: [
        block(markdown, '1. 代入 $2^2=4$。', 2, 'b_a1'),
        block(markdown, '2. 由 $3+1=4$。', 2, 'b_a2'),
      ],
    },
  ],
  assets: [
    { id: 'asset_fig1', type: 'image', path: 'figure-1.png', pageNo: 1, sourceBlockId: 'b_fig1' },
  ],
  metadata: {},
  createdAt: '2026-06-24T00:00:00.000Z',
}

const candidates = parseQuestionCandidates(ocrDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(candidates.length, 2)
assert.equal(candidates[0].questionNo, '1')
assert.match(candidates[0].stemMarkdown, /已知函数/)
assert.equal(candidates[0].answerText, '4')
assert.match(candidates[0].analysisMarkdown, /代入/)
assert.equal(candidates[0].status, 'ready')
assert.equal(candidates[0].figures.length, 1)
assert.equal(candidates[0].sourceRefs.some((ref) => ref.kind === 'stem' && ref.blockIds.includes('b_q1')), true)
assert.equal(candidates[1].questionNo, '2')
assert.equal(candidates[1].answerText, '4')
assert.match(candidates[1].analysisMarkdown, /3\+1=4/)

const duplicateDocument = {
  ...ocrDocument,
  id: 'ocr_duplicate_test',
  markdown: '1. 第一题\n\n1. 重复题',
  pages: [],
  assets: [],
}
const duplicates = parseQuestionCandidates(duplicateDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(duplicates.length, 2)
assert.equal(duplicates.every((candidate) => candidate.issues.some((issue) => issue.code === 'duplicate_question_no')), true)
assert.equal(duplicates.every((candidate) => candidate.issues.some((issue) => issue.code === 'missing_answer')), true)
assert.equal(duplicates.every((candidate) => candidate.issues.some((issue) => issue.code === 'missing_analysis')), true)

const noNumberDocument = {
  ...ocrDocument,
  id: 'ocr_missing_no_test',
  markdown: '这是一段没有题号的 OCR 文本。',
  pages: [],
  assets: [],
}
const missingNo = parseQuestionCandidates(noNumberDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(missingNo.length, 1)
assert.equal(missingNo[0].issues.some((issue) => issue.code === 'missing_question_no'), true)

console.log('question parser ok')
