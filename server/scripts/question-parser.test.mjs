import assert from 'node:assert/strict'
import { defaultParserConfig, parseQuestionCandidates } from '../dist/services/question-parser/index.js'

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

const mathPaperDocument = {
  ...ocrDocument,
  id: 'ocr_math_paper_test',
  markdown: [
    '注意事项：请在答题卡作答。',
    '参考公式：$a^2+b^2=c^2$',
    '一、选择题',
    '第 16 题 已知函数 $f(x)$。',
    '（1）求 $f(1)$；',
    '(2) 求 $f(2)$。',
    '二、填空题',
    '17. 求值。',
    '参考答案',
    '16. $f(1)=1$，$f(2)=2$',
    '17. 4',
    '解析',
    '16. 分别代入即可。',
    '17. 直接计算。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const mathCandidates = parseQuestionCandidates(mathPaperDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(mathCandidates.map((candidate) => candidate.questionNo), ['16', '17'])
assert.match(mathCandidates[0].stemMarkdown, /（1）/)
assert.match(mathCandidates[0].stemMarkdown, /\(2\)/)
assert.doesNotMatch(mathCandidates[0].stemMarkdown, /注意事项|参考公式|一、选择题|二、填空题/)
assert.match(mathCandidates[0].answerText, /f\(1\)/)
assert.match(mathCandidates[0].analysisMarkdown, /分别代入/)
assert.equal(mathCandidates.some((candidate) => candidate.issues.some((issue) => issue.code === 'duplicate_question_no')), false)

const customHeadingConfig = { ...defaultParserConfig, sectionHeadings: [...defaultParserConfig.sectionHeadings, '五、校本练习'] }
const customHeadingDocument = { ...ocrDocument, id: 'ocr_custom_heading_test', markdown: '五、校本练习\n1. 这是第一题。', pages: [], assets: [] }
const customHeadingCandidates = parseQuestionCandidates(customHeadingDocument, { config: customHeadingConfig, now: '2026-06-24T00:00:00.000Z' })
assert.equal(customHeadingCandidates.length, 1)
assert.doesNotMatch(customHeadingCandidates[0].stemMarkdown, /校本练习/)

const imageBetweenDocument = {
  ...ocrDocument,
  id: 'ocr_image_between_test',
  markdown: '1. 第一题题干。\n2. 第二题题干。',
  pages: [{ pageNo: 1, width: 800, height: 1100, blocks: [
    { id: 'b_q1_image', pageNo: 1, type: 'text', content: '1. 第一题题干。', markdownStart: 0, markdownEnd: 9, bbox: [10, 10, 300, 100] },
    { id: 'b_image_between', pageNo: 1, type: 'image', content: 'figure-between.png', bbox: [10, 110, 300, 200] },
    { id: 'b_q2_image', pageNo: 1, type: 'text', content: '2. 第二题题干。', markdownStart: 10, markdownEnd: 19, bbox: [10, 210, 300, 300] },
  ] }],
  assets: [],
}
const imageBetweenCandidates = parseQuestionCandidates(imageBetweenDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(imageBetweenCandidates[0].figures.some((figure) => figure.sourceBlockId === 'b_image_between'), true)

const unplacedImageDocument = { ...imageBetweenDocument, id: 'ocr_unplaced_image_test', pages: [{ pageNo: 2, width: 800, height: 1100, blocks: [{ id: 'b_unplaced', pageNo: 2, type: 'image', content: 'orphan.png' }] }] }
const unplacedImageCandidates = parseQuestionCandidates(unplacedImageDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(unplacedImageCandidates.some((candidate) => candidate.issues.some((issue) => issue.code === 'unplaced_figure')), true)

console.log('question parser ok')
