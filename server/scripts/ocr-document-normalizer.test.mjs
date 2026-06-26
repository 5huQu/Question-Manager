import assert from 'node:assert/strict'
import { normalizeGlmOCRDocument } from '../dist/services/ocr-providers/glm.normalizer.js'
import { normalizeDoc2xOCRDocument } from '../dist/services/ocr-providers/doc2x.normalizer.js'
import { applyWatermarkCleanup, cleanWatermarkText } from '../dist/services/import-flow-v2/watermark-cleanup.js'

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
      { index: 1, label: 'text', content: '1. 已知函数 $f(x)=x^2$，求 $f(2)$。\n<div style="text-align:center">\n<img class="figure" src="https://example.com/a.png?x=1&y=2$z=value" loading="lazy">\n</div>', bbox_2d: [10, 20, 600, 80], confidence: 0.98 },
      { index: 2, label: 'image', content: 'https://example.test/glm-figure-1.png', bbox_2d: [80, 120, 360, 320] },
    ],
    [
      { index: 3, label: 'text', content: '【答案】4\n【解析】代入可得 $2^2=4$。', bbox_2d: [10, 20, 720, 160] },
    ],
  ],
}

const doc2xFormulaMarkdown = String.raw`\(\alpha _ {1}+\beta ^ {2}\) 与 \[ y = \frac {1}{2} \]`

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
          md: `1. 如图，求三角形面积。${doc2xFormulaMarkdown}\n\n<!-- Media -->\n<img src="https://example.test/doc2x-figure-1.png">\n<!-- Media -->`,
          layout: {
            blocks: [
              { id: 'doc2x_text_1', type: 'Text', text: `1. 如图，求三角形面积。${doc2xFormulaMarkdown}`, bbox: [12, 20, 520, 70], score: 0.99 },
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
assert.equal(glmDocument.assets.length, 2)
assert.match(glmDocument.markdown, /GLM_PAGE:1/)
assert.match(glmDocument.markdown, /已知函数/)
assert.match(glmDocument.markdown, /<!--\s*DOC2X_FIGURE:glm_inline_asset_[a-f0-9]{12}\s*-->/)
assert.doesNotMatch(glmDocument.markdown, /<img\b/i)
assert.doesNotMatch(glmDocument.markdown, /<div\b/i)
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
assert.ok(doc2xDocument.markdown.includes(doc2xFormulaMarkdown), 'Doc2X formula markdown must stay byte-for-byte unchanged')
assert.equal(doc2xDocument.pages[0].blocks[0].content.includes(doc2xFormulaMarkdown), true)
assert.match(doc2xDocument.markdown, /<!--\s*DOC2X_FIGURE:doc2x_asset_[a-f0-9]{12}\s*-->/)
assert.doesNotMatch(doc2xDocument.markdown, /<!--\s*Media\s*-->/i)
assert.equal(doc2xDocument.metadata.taskId, 'doc2x-task-1')

const watermarkText = cleanWatermarkText([
  '# 鼎尖教育',
  '1. 正常题干 鼎尖教育',
  '保持原文。',
].join('\n'), ['鼎尖教育'])
assert.doesNotMatch(watermarkText.text, /鼎尖教育/)
assert.match(watermarkText.text, /1\. 正常题干/)
assert.doesNotMatch(watermarkText.text, /^#\s*$/m)

const watermarkedDocument = applyWatermarkCleanup({
  ...glmDocument,
  markdown: '# 鼎尖教育\n1. 已知函数。',
  pages: [{
    pageNo: 1,
    width: 800,
    height: 1200,
    blocks: [
      { id: 'wm', pageNo: 1, type: 'text', content: '鼎尖教育', markdownStart: 0, markdownEnd: 4 },
      { id: 'stem', pageNo: 1, type: 'text', content: '1. 已知函数。鼎尖教育', markdownStart: 5, markdownEnd: 18 },
    ],
  }],
}, { watermark: { enabled: true, terms: ['鼎尖教育'] } }).document
assert.doesNotMatch(watermarkedDocument.markdown, /鼎尖教育/)
assert.equal(watermarkedDocument.pages[0].blocks[0].content, '')
assert.equal(watermarkedDocument.pages[0].blocks[1].content, '1. 已知函数。')
assert.equal(watermarkedDocument.metadata.watermarkCleanup.enabled, true)

import { localizeRemoteImages, figuresForQuestionBank } from '../dist/services/import-flow-v2/import-flow-v2.service.js'

// Test A: HTML img -> DOC2X_FIGURE -> assets 对应一致
{
  const matches = Array.from(glmDocument.markdown.matchAll(/<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/g))
  assert.equal(matches.length, 2)
  const placeholderIds = matches.map((m) => m[1])
  for (const id of placeholderIds) {
    const matchedAsset = glmDocument.assets.find((a) => a.id === id)
    assert.ok(matchedAsset, `Asset with ID ${id} must exist`)
    assert.ok(matchedAsset.path.startsWith('http'), 'Asset path must initially be a remote URL')
  }
}

// Test B: localizeRemoteImages 后 asset.path 变为本地 portable path
{
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(1024),
    }
  }
  
  try {
    const clonedDocument = JSON.parse(JSON.stringify(glmDocument))
    clonedDocument.sourceDocumentId = 'test_source_id'
    await localizeRemoteImages(clonedDocument)
    
    for (const asset of clonedDocument.assets) {
      assert.ok(
        asset.path.startsWith('data/import-flow-v2/source-documents/test_source_id/assets/'),
        `Asset path should become local portable path, got ${asset.path}`
      )
    }
  } finally {
    globalThis.fetch = originalFetch
  }
}

// Test C: figuresForQuestionBank 测试，验证入库后 blockId 不丢失
{
  const testCandidateFigures = [
    { id: 'fig_1', blockId: 'fig_1_block', usage: 'stem', path: 'path/to/fig.png', pageNo: 1 },
  ]
  const qbFigures = figuresForQuestionBank(testCandidateFigures)
  assert.equal(qbFigures[0].blockId, 'fig_1_block')
}

console.log('ocr document normalizer ok')
