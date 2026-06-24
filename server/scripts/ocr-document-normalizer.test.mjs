import assert from 'node:assert/strict'
import { normalizeGlmOCRDocument } from '../dist/services/ocr-providers/glm.normalizer.js'
import { normalizeDoc2xOCRDocument } from '../dist/services/ocr-providers/doc2x.normalizer.js'

const glmPayload = {
  model: 'glm-ocr',
  request_id: 'glm-request-1',
  data_info: {
    pages: [
      { width: 800, height: 1200 },
      { width: 800, height: 1200 },
    ],
  },
  layout_details: [
    [
      { index: 1, label: 'text', content: '1. 已知函数 $f(x)=x^2$，求 $f(2)$。', bbox_2d: [10, 20, 600, 80], confidence: 0.98 },
      { index: 2, label: 'image', content: 'https://example.test/glm-figure-1.png', bbox_2d: [80, 120, 360, 320] },
    ],
    [
      { index: 3, label: 'text', content: '【答案】4\n【解析】代入可得 $2^2=4$。', bbox_2d: [10, 20, 720, 160] },
    ],
  ],
}

const doc2xPayload = {
  code: 'success',
  data: {
    result: {
      task_id: 'doc2x-task-1',
      pages: [
        {
          page_idx: 0,
          width: 800,
          height: 1100,
          md: '1. 如图，求三角形面积。\n\n<img src="https://example.test/doc2x-figure-1.png">',
          layout: {
            blocks: [
              { id: 'doc2x_text_1', type: 'Text', text: '1. 如图，求三角形面积。', bbox: [12, 20, 520, 70], score: 0.99 },
              { id: 'doc2x_fig_1', type: 'Figure', src: 'https://example.test/doc2x-figure-1.png', bbox: [90, 120, 430, 390] },
            ],
          },
        },
      ],
    },
  },
}

const glmDocument = normalizeGlmOCRDocument(glmPayload, {
  id: 'ocr_glm_test',
  sourceDocumentId: 'src_test',
  rawResultPath: '/tmp/glm/raw.json',
  createdAt: '2026-06-24T00:00:00.000Z',
})

assert.equal(glmDocument.provider, 'glm')
assert.equal(glmDocument.sourceDocumentId, 'src_test')
assert.equal(glmDocument.rawResultPath, '/tmp/glm/raw.json')
assert.equal(glmDocument.pages.length, 2)
assert.equal(glmDocument.pages[0].blocks.length, 2)
assert.equal(glmDocument.assets.length, 1)
assert.match(glmDocument.markdown, /GLM_PAGE:1/)
assert.match(glmDocument.markdown, /已知函数/)
assert.ok(glmDocument.pages[0].blocks[0].markdownStart !== undefined)

const doc2xDocument = normalizeDoc2xOCRDocument(doc2xPayload, {
  id: 'ocr_doc2x_test',
  sourceDocumentId: 'src_test',
  rawResultPath: '/tmp/doc2x/raw.json',
  createdAt: '2026-06-24T00:00:00.000Z',
})

assert.equal(doc2xDocument.provider, 'doc2x')
assert.equal(doc2xDocument.sourceDocumentId, 'src_test')
assert.equal(doc2xDocument.rawResultPath, '/tmp/doc2x/raw.json')
assert.equal(doc2xDocument.pages.length, 1)
assert.equal(doc2xDocument.pages[0].blocks.length, 2)
assert.equal(doc2xDocument.assets.length, 1)
assert.match(doc2xDocument.markdown, /DOC2X_PAGE:1/)
assert.match(doc2xDocument.markdown, /三角形面积/)
assert.equal(doc2xDocument.metadata.taskId, 'doc2x-task-1')

console.log('ocr document normalizer ok')
