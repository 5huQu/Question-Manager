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
  const collection = collections.createCollection({ title: 'ExamZh 设置测试', kind: 'paper' })
  collections.addCollectionItem(collection.id, { questionId: question.id, score: 5 })
  const assembled = collections.getCollection(collection.id)

  const examZhCollection = exports.exportCollectionWorksheetPdfWithDiagnostics(assembled, 'student', 'qbank-exam')
  assert.equal(fs.existsSync(examZhCollection.pdfPath), true)
  assert.match(fs.readFileSync(examZhCollection.texPath, 'utf8'), /\\documentclass\{exam-zh\}/)

  const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(question.id)
  const examZhSet = exports.exportQuestionSetPdf({ id: 'examzh-question-set', title: '题组导出', rows: [row], template: 'exam', variant: 'student' })
  assert.match(fs.readFileSync(examZhSet.texPath, 'utf8'), /\\documentclass\{exam-zh\}/)

  writeTemplateSetting('builtin')
  const builtinSet = exports.exportQuestionSetPdf({ id: 'builtin-question-set', title: '内置题组导出', rows: [row], template: 'exam', variant: 'student' })
  const builtinTex = builtinSet.path.replace(/\.pdf$/, '.tex')
  assert.match(fs.readFileSync(builtinTex, 'utf8'), /\\documentclass\{qbank-exam\}/)

  console.log('exam-zh export setting tests passed')
} finally {
  closeDatabase()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
