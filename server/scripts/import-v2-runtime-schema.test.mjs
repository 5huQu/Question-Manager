import assert from 'node:assert/strict'
import { assertWithSchema, parseWithSchema } from '../dist/contracts/runtime-schema.js'
import {
  candidateSchema, exportRecordSchema, parserConfigSchema, parserPreviewResponseSchema,
} from '../dist/contracts/import-v2-schemas.js'
import { defaultParserConfig } from '../dist/services/question-parser/default-parser-config.js'

const candidate = {
  id: 'candidate-1', sourceDocumentId: 'source-1', ocrDocumentId: 'ocr-1', questionNo: '1',
  stemMarkdown: '题干', answerText: 'A', analysisMarkdown: '解析', contentRevision: 1,
  questionType: '单选题', difficultyScore10: 5, difficultyLabel: '中等',
  knowledgePoints: ['集合'], solutionMethods: ['定义法'],
  figures: [{ id: 'figure-1', usage: 'stem', path: 'figure.png', bbox: [1, 2, 3, 4] }],
  sourceRefs: [{ sourceDocumentId: 'source-1', pageNo: 1, blockIds: ['block-1'], bbox: [1, 2, 3, 4], kind: 'stem' }],
  status: 'ready', province: '', city: '', paperTitle: '', batchName: '', stage: '高中', subject: '数学',
  paperKind: 'unknown', examYear: 0, sourceOrg: '', issues: [], parseDiagnostics: [], parserConfigSnapshot: {},
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

assert.equal(assertWithSchema(candidate, candidateSchema), candidate)
assert.throws(
  () => assertWithSchema({ ...candidate, figures: [{ ...candidate.figures[0], bbox: [1, 2, '3', 4] }] }, candidateSchema),
  /figures\[0\]\.bbox\[2\].*有限数字/,
)
assert.throws(
  () => assertWithSchema({ ...candidate, parserConfigSnapshot: { ...defaultParserConfig, sectionHeadings: ['选择题', 1] } }, candidateSchema),
  /parserConfigSnapshot.*不符合任何允许的格式/,
)

const exportRecord = {
  id: 'export-1', sourceType: 'import_job', collectionId: '', runId: '', importJobId: 'job-1',
  title: '试卷', format: 'pdf', variant: 'exam-teacher', filename: 'paper.pdf', path: 'paper.pdf',
  url: '/assets/paper.pdf', items: [{ questionId: 'question-1', exportOrder: 1 }], snapshot: {},
  contentLength: 1024, questionCount: 1, status: 'succeeded', error: '', createdAt: '2026-01-01T00:00:00.000Z',
}
assert.equal(assertWithSchema(exportRecord, exportRecordSchema), exportRecord)
assert.throws(
  () => assertWithSchema({ ...exportRecord, items: [{ questionId: 'question-1', exportOrder: 0 }] }, exportRecordSchema),
  /items\[0\]\.exportOrder.*不能小于 1/,
)

assert.equal(parseWithSchema(defaultParserConfig, parserConfigSchema), defaultParserConfig)
const parserPreview = {
  config: defaultParserConfig,
  structures: [{
    id: 'structure-1', kind: 'question_no', questionNo: '1', start: 0, end: 2,
    lineStart: 1, lineEnd: 1, label: '第 1 题', severity: 'info',
  }],
  candidatePreviews: [{
    questionNo: '1', stemPreview: '题干', answerPreview: 'A', analysisPreview: '解析',
    sourceRanges: { stem: { start: 0, end: 2 } }, issues: [],
  }],
  diagnostics: [],
}
assert.equal(assertWithSchema(parserPreview, parserPreviewResponseSchema), parserPreview)
assert.throws(
  () => assertWithSchema({ ...parserPreview, structures: [{ ...parserPreview.structures[0], lineStart: 0 }] }, parserPreviewResponseSchema),
  /structures\[0\]\.lineStart.*不能小于 1/,
)

console.log('import V2 runtime schemas ok')
