import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-ai-cleaner-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { ensureSchema } = await import('../dist/db/schema.js')
const { createQuestion, getQuestion } = await import('../dist/db/questions.js')
const { updateItem } = await import('../dist/services/question-bank/items.service.js')
const { previewQuestionAiClean } = await import('../dist/services/question-bank/ai-cleaner.service.js')
const { closeDatabase } = await import('../dist/db/connection.js')

function mockSettings(overrides = {}) {
  return {
    apiBaseUrl: 'https://example.test/v1/chat/completions',
    apiKey: 'test-key',
    model: 'test-model',
    timeoutSeconds: 10,
    ...overrides,
  }
}

function mockFetchContent(content) {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

try {
  ensureSchema()

  const defaultItem = createQuestion({
    sourceTitle: 'ai-cleaner-test',
    stemMarkdown: '默认评分字段题',
    answerText: '',
    analysisMarkdown: '',
  })
  assert.equal(defaultItem.totalScore, 0)
  assert.deepEqual(defaultItem.scoringRubric, [])

  const question = createQuestion({
    sourceTitle: 'ai-cleaner-test',
    stemMarkdown: '(17分)\n已知函数 $f(x)=\\ln(mx+1)$。',
    answerText: '',
    analysisMarkdown: '解：第一问结论。5分\n第二问结论。10分',
    totalScore: 17,
    scoringRubric: [{ label: '原始', score: 17, text: '原始评分' }],
  })
  assert.equal(question.totalScore, 17)
  assert.deepEqual(question.scoringRubric, [{ label: '原始', score: 17, text: '原始评分' }])

  const updated = updateItem(question.id, {
    totalScore: 20,
    scoringRubric: [{ label: '一', score: 8, text: '第一问' }, { label: '二', score: 12, text: '第二问' }],
  })
  assert.equal(updated.totalScore, 20)
  assert.deepEqual(getQuestion(question.id).scoringRubric, [
    { label: '一', score: 8, text: '第一问' },
    { label: '二', score: 12, text: '第二问' },
  ])

  const preview = await previewQuestionAiClean(question.id, { mode: 'full' }, {
    settings: mockSettings(),
    fetchImpl: mockFetchContent(JSON.stringify({
      stemMarkdown: '(17分)\n已知函数 $f(x)=\\ln(mx+1)$。',
      answerText: '',
      analysisMarkdown: '解：第一问结论。5分\n第二问结论。10分\n第三问结论。17分',
      totalScore: 99,
      scoringRubric: [{ label: '模型', score: 99, text: '应被忽略' }],
      warnings: ['已修复格式'],
      confidence: 0.91,
    })),
  })
  assert.equal(preview.itemId, question.id)
  assert.equal(preview.mode, 'full')
  assert.equal('totalScore' in preview.patch, false)
  assert.equal('scoringRubric' in preview.patch, false)
  assert.equal(preview.patch.stemMarkdown.includes('17分'), false)
  assert.equal(preview.patch.analysisMarkdown.includes('5分'), false)
  assert.equal(preview.patch.analysisMarkdown.includes('10分'), false)
  assert.equal(preview.patch.analysisMarkdown.includes('17分'), false)
  assert.equal(preview.formatIssues.length, 0)
  assert.equal(preview.confidence, 0.91)

  await assert.rejects(
    () => previewQuestionAiClean(question.id, { mode: 'full' }, {
      settings: mockSettings(),
      fetchImpl: mockFetchContent('不是 JSON'),
    }),
    /合法 JSON/
  )

  await assert.rejects(
    () => previewQuestionAiClean(question.id, { mode: 'full' }, {
      settings: mockSettings({ apiKey: '' }),
      fetchImpl: mockFetchContent('{}'),
    }),
    /缺少 AI 助手模型配置/
  )

  const riskyPreview = await previewQuestionAiClean(question.id, { mode: 'format_only' }, {
    settings: mockSettings(),
    fetchImpl: mockFetchContent(JSON.stringify({
      stemMarkdown: '坏公式 $x',
      answerText: '',
      analysisMarkdown: '',
      warnings: [],
      confidence: 0.4,
    })),
  })
  assert.equal(riskyPreview.formatIssues.length, 1)
  assert.ok(riskyPreview.warnings.some((warning) => warning.includes('渲染风险')))

  console.log('ai cleaner service ok')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
