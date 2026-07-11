import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { storageRoot } from '../dist/config.js'
import { buildCollectionWorksheetLatex } from '../dist/services/question-bank/export.js'

fs.mkdirSync(storageRoot, { recursive: true })
const tempDir = fs.mkdtempSync(path.join(storageRoot, 'qbank-worksheet-figures-'))
const figuresDir = path.join(tempDir, 'figures')
fs.mkdirSync(figuresDir)

try {
  const stemFigurePath = path.join(tempDir, 'stem.png')
  const optionFigurePath = path.join(tempDir, 'option.png')
  const analysisFigurePath = path.join(tempDir, 'analysis.png')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  for (const filePath of [stemFigurePath, optionFigurePath, analysisFigurePath]) {
    fs.writeFileSync(filePath, png)
  }

  const collection = {
    id: 'figure-order',
    title: '图片顺序测试',
    questions: [{
      relationId: 'relation-1',
      sortOrder: 1,
      score: 5,
      sectionName: '选择题',
      item: {
        id: 'question-1',
        serialNo: 1,
        questionType: '单选题',
        stemMarkdown: '题干文字\nA. 甲\nB. 乙\nC. 丙\nD. 丁',
        answerText: 'A',
        analysisMarkdown: '解析文字',
        figures: [
          { id: 'stem-unanchored', usage: 'stem', path: path.relative(storageRoot, stemFigurePath) },
          { id: 'option-unanchored', usage: 'options', path: path.relative(storageRoot, optionFigurePath) },
          { id: 'analysis-unanchored', usage: 'analysis', path: path.relative(storageRoot, analysisFigurePath) },
        ],
      },
    }],
  }

  const student = buildCollectionWorksheetLatex(collection, 'student', figuresDir, new Map()).content
  const stemFigureIndex = student.indexOf('q1-stem-unanchored')
  const choicesIndex = student.indexOf('\\qbankchoicesfour')
  const optionFigureIndex = student.indexOf('q1-option-unanchored')
  assert.ok(stemFigureIndex >= 0, `应输出无锚点题干图：${student.match(/\\qbankfigure[^\n]*/g)?.join(' | ')}`)
  assert.ok(stemFigureIndex < choicesIndex, '无锚点题干图应位于完整选项块之前')
  assert.ok(choicesIndex < optionFigureIndex, '无锚点选项图应保留在选项块之后')
  assert.equal(student.includes('q1-analysis-unanchored'), false, '学生版不应输出解析图')

  const inlineCollection = structuredClone(collection)
  inlineCollection.questions[0].item.stemMarkdown =
    '题干前<!-- DOC2X_FIGURE:stem-unanchored -->题干后\nA. 甲\nB. 乙\nC. 丙\nD. 丁'
  const inline = buildCollectionWorksheetLatex(inlineCollection, 'teacher', figuresDir, new Map()).content
  const inlineFigureIndex = inline.indexOf('q1-stem-unanchored')
  assert.ok(inlineFigureIndex < inline.indexOf('\\qbankchoicesfour'), '有锚点题干图应保持在题干内容中')
  assert.equal(
    inline.split('\n').filter((line) => line.startsWith('\\qbankfigure') && line.includes('q1-stem-unanchored')).length,
    1,
    '有锚点题干图不应重复追加',
  )
  assert.ok(inline.indexOf('q1-analysis-unanchored') > inline.indexOf('\\begin{solutionbox}'), '解析图应保留在解析区域')
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}

console.log('worksheet figure order tests passed')
