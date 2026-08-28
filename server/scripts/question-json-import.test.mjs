import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-question-json-'))
process.env.QUESTION_DATA_DIR = tempRoot
process.env.QUESTION_AUTH_MODE = 'disabled'

const { closeDatabase } = await import('../dist/index.js')
const { importJsonItems } = await import('../dist/services/question-bank/items.service.js')
const { db } = await import('../dist/db/connection.js')

try {
  const snake = importJsonItems({ questions: [{ questionNo: '1', problem_text: '蛇形题干', answer: 'A', analysis: '蛇形解析' }] })
  assert.equal(snake.items[0].stemMarkdown, '蛇形题干')
  assert.equal(snake.items[0].answerText, 'A')
  assert.equal(snake.items[0].analysisMarkdown, '蛇形解析')

  const markdown = importJsonItems({ questions: [{ questionNo: '2', stemMarkdown: '标准题干', answerText: 'B', analysisMarkdown: '标准解析' }] })
  assert.equal(markdown.items[0].stemMarkdown, '标准题干')
  assert.equal(markdown.items[0].answerText, 'B')
  assert.equal(markdown.items[0].analysisMarkdown, '标准解析')

  const camel = importJsonItems({ questions: [{ questionNo: '3', problemText: '兼容题干', answerText: 'C', analysisText: '兼容解析' }] })
  assert.equal(camel.items[0].stemMarkdown, '兼容题干')
  assert.equal(camel.items[0].analysisMarkdown, '兼容解析')

  for (const payload of [
    { answer: 'A' },
    { questions: [null] },
    { problem_text: '   ' },
  ]) {
    assert.throws(() => importJsonItems(payload), /题目 JSON schema 错误/)
  }

  const before = db.prepare('SELECT COUNT(*) AS count FROM question_bank_items').get().count
  assert.throws(() => importJsonItems({
    questions: [
      { problem_text: '本应整体回滚的第一题', answer: 'A' },
      { answer: '第二题缺少题干' },
    ],
  }), /题目 JSON schema 错误/)
  const after = db.prepare('SELECT COUNT(*) AS count FROM question_bank_items').get().count
  assert.equal(after, before, '整批验证失败时不得留下前面已解析的题目')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('question JSON import contract ok')
