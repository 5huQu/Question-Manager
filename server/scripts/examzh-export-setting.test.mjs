import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'question-manager-examzh-setting-'))
process.env.QUESTION_DATA_DIR = tempRoot

const configDir = path.join(tempRoot, 'config')
fs.mkdirSync(configDir, { recursive: true })
const settingsPath = path.join(configDir, 'app_settings.json')
const writeTemplateSetting = (examExportTemplate) => fs.writeFileSync(
  settingsPath,
  JSON.stringify({ examExportTemplate, examWatermark: '测试水印' }),
)
writeTemplateSetting('examch')

const { closeDatabase } = await import('../dist/index.js')
const { db } = await import('../dist/db/connection.js')
const { createQuestion } = await import('../dist/db/questions.js')
const collections = await import('../dist/services/question-bank/collections.service.js')
const exports = await import('../dist/services/question-bank/export.js')

try {
  const question = createQuestion({
    questionNo: '1',
    questionType: '单选题',
    stemMarkdown: '函数 $f(x)=x^2$ 的最小值为（　　）\nA. 0\nB. 1\nC. 2\nD. 3',
    answerText: 'A',
    analysisMarkdown: '由平方的非负性可知。',
  })
  const optionFigurePath = path.join(tempRoot, 'option.png')
  fs.writeFileSync(
    optionFigurePath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  )
  const imageChoiceQuestion = createQuestion({
    questionNo: '2',
    questionType: '单选题',
    stemMarkdown: [
      '选出正确图像（　　）',
      'A. <!-- DOC2X_FIGURE:option-a -->',
      'B. <!-- DOC2X_FIGURE:option-b -->',
      'C. <!-- DOC2X_FIGURE:option-c -->',
      'D. <!-- DOC2X_FIGURE:option-d -->',
    ].join('\n'),
    answerText: 'A',
    figures: ['a', 'b', 'c', 'd'].map((label) => ({
      id: `option-${label}`,
      usage: 'options',
      optionLabel: label.toUpperCase(),
      path: path.relative(tempRoot, optionFigurePath),
    })),
  })
  db.prepare('UPDATE question_bank_items SET stem_markdown = ? WHERE id = ?').run([
    '选出正确图像（　　）',
    'A. <!-- DOC2X_FIGURE:option-a -->',
    'B. <!-- DOC2X_FIGURE:option-b -->',
    'C. <!-- DOC2X_FIGURE:option-c -->',
    'D. <!-- DOC2X_FIGURE:option-d -->',
  ].join('\n'), imageChoiceQuestion.id)
  const collection = collections.createCollection({ title: 'ExamZh 设置测试', kind: 'paper' })
  collections.addCollectionItem(collection.id, { questionId: question.id, score: 5 })
  const assembled = collections.getCollection(collection.id)

  const examZhCollection = exports.exportCollectionWorksheetPdfWithDiagnostics(assembled, 'student', 'qbank-exam')
  assert.equal(fs.existsSync(examZhCollection.pdfPath), true)
  assert.match(fs.readFileSync(examZhCollection.texPath, 'utf8'), /\\documentclass\{exam-zh\}/)

  const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(question.id)
  const imageChoiceRow = db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(imageChoiceQuestion.id)
  const examZhSet = exports.exportQuestionSetPdf({ id: 'examzh-question-set', title: '题组导出', rows: [row, imageChoiceRow], template: 'exam', variant: 'student' })
  const examZhTex = fs.readFileSync(examZhSet.texPath, 'utf8')
  assert.match(examZhTex, /\\documentclass\{exam-zh\}/)
  const imageChoices = examZhTex.match(/\\includegraphics\[width=0\.9\\linewidth,keepaspectratio\][^\n]*/g) || []
  assert.equal(imageChoices.length, 4, '应输出四张行内选项图')
  const choiceBlocks = (examZhTex.match(/\\begin\{choices\}[\s\S]*?\\end\{choices\}/g) || []).join('\n')
  assert.doesNotMatch(choiceBlocks, /\\begin\{flushleft\}/, '选项图不应使用段落环境')

  writeTemplateSetting('builtin')
  const builtinSet = exports.exportQuestionSetPdf({ id: 'builtin-question-set', title: '内置题组导出', rows: [row], template: 'exam', variant: 'student' })
  const builtinTex = builtinSet.path.replace(/\.pdf$/, '.tex')
  assert.match(fs.readFileSync(builtinTex, 'utf8'), /\\documentclass\{qbank-exam\}/)

  console.log('exam-zh export setting tests passed')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
