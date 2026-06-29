import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-quick-actions-'))
process.env.QUESTION_DATA_DIR = tempRoot

const { ensureSchema } = await import('../dist/db/schema.js')
const { createQuestion } = await import('../dist/db/questions.js')
const { closeDatabase } = await import('../dist/db/connection.js')
const {
  getDailyQuestion,
  getQuickActionMetadata,
  generateRandomPaper,
} = await import('../dist/services/question-bank/quick-actions.service.js')

function seedQuestion(input) {
  return createQuestion({
    sourceTitle: 'quick-actions-test',
    stemMarkdown: `测试题干 ${input.questionNo}`,
    answerText: '参考答案',
    analysisMarkdown: '测试解析',
    bankStatus: 'ready',
    ...input,
  })
}

try {
  ensureSchema()

  seedQuestion({
    questionNo: '1',
    stage: '高一',
    questionType: '单选题',
    difficultyScore10: 5,
    knowledgePoints: ['函数'],
    solutionMethods: ['数形结合'],
  })
  seedQuestion({
    questionNo: '2',
    stage: '高二',
    questionType: '单选题',
    difficultyScore10: 5,
    knowledgePoints: ['函数'],
    solutionMethods: ['分类讨论'],
  })
  seedQuestion({
    questionNo: '3',
    stage: '高二',
    questionType: '填空题',
    difficultyScore10: 6,
    knowledgePoints: ['导数'],
    solutionMethods: ['数形结合'],
  })
  seedQuestion({
    questionNo: '4',
    stage: '高二',
    questionType: '解答题',
    difficultyScore10: 0,
    knowledgePoints: ['函数'],
    solutionMethods: ['数形结合'],
  })

  const metadata = getQuickActionMetadata()
  assert.deepEqual(metadata.stages.sort(), ['高一', '高二'])
  assert.equal(metadata.questionTypes.find((item) => item.type === '单选题')?.total, 2)

  const daily = getDailyQuestion({ stage: '高一' })
  assert.equal(daily.question.stage, '高一')

  assert.throws(
    () => generateRandomPaper({
      stage: '高二',
      knowledgePoints: ['函数'],
      solutionMethods: ['数形结合'],
      matchMode: 'strict',
      difficultyMode: 'standard',
      typeCounts: { 单选题: 1, 填空题: 1 },
    }),
    /题库中符合条件的题目数量为 0/
  )

  const loose = generateRandomPaper({
    stage: '高二',
    knowledgePoints: ['函数'],
    solutionMethods: ['数形结合'],
    matchMode: 'loose',
    difficultyMode: 'standard',
    typeCounts: { 单选题: 1, 填空题: 1 },
  })
  assert.equal(loose.questions.length, 2)
  assert.equal(loose.summary.generatedTotal, 2)

  const legacy = generateRandomPaper({
    stage: '高二',
    difficultyMode: 'standard',
    counts: { singleChoice: 1, multiChoice: 0, fillBlank: 0, bigQuestion: 0 },
  })
  assert.equal(legacy.questions.length, 1)
  assert.equal(legacy.questions[0].questionType, '单选题')

  const unknownDifficultyFallback = generateRandomPaper({
    stage: '高二',
    knowledgePoints: ['函数'],
    solutionMethods: ['数形结合'],
    matchMode: 'strict',
    difficultyMode: 'standard',
    typeCounts: { 解答题: 1 },
  })
  assert.equal(unknownDifficultyFallback.questions.length, 1)
  assert.equal(unknownDifficultyFallback.questions[0].difficultyScore10, 0)
  assert.ok(unknownDifficultyFallback.warnings.some((warning) => warning.includes('难度待定')))

  console.log('quick actions ok')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
