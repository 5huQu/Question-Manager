import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { storageRoot } from '../dist/config.js'
import { buildCollectionWorksheetLatex } from '../dist/services/question-bank/export.js'
import { decideWorksheetFigureLayout, worksheetAnswerLatex } from '../dist/utils/worksheet-figures.js'
import { splitChoiceStemForExport } from '../dist/utils/exam-zh.js'

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
  const choicesIndex = Math.max(student.indexOf('\\qbankchoicesfour'), student.indexOf('\\qbankchoicestwo'), student.indexOf('\\begin{qbankchoicesone}'))
  const optionFigureIndex = student.indexOf('q1-option-unanchored')
  assert.ok(stemFigureIndex >= 0, `应输出无锚点题干图：${student.match(/\\qbankfigure[^\n]*/g)?.join(' | ')}`)
  assert.ok(stemFigureIndex < choicesIndex, '无锚点题干图应位于完整选项块之前')
  assert.ok(choicesIndex < optionFigureIndex, '无锚点选项图应保留在选项块之后')
  assert.equal(student.includes('q1-analysis-unanchored'), false, '学生版不应输出解析图')
  assert.ok(student.includes('\\qbankchoiceswithfigure{right}{0.38}'), '单图选择题应自动使用左侧纵向选项、右侧题图布局')

  const decision = decideWorksheetFigureLayout({
    questionId: 'question-1', figureId: 'stem-unanchored', imagePath: stemFigurePath,
    stemFigureCount: 1, hasInlineMarker: false, choices: ['-1', '-0.5', '0', '0.5'],
  })
  assert.equal(decision.placement, 'side-right', '单图选择题样例应得到确定性的选项右侧布局')
  assert.equal(decision.layout.resolved, 'side-right')
  assert.ok(decision.reason.includes('纵向排列'))

  const multiple = decideWorksheetFigureLayout({
    questionId: 'question-1', figureId: 'stem-unanchored', imagePath: stemFigurePath,
    stemFigureCount: 2, hasInlineMarker: false, choices: ['甲', '乙', '丙', '丁'],
  })
  assert.equal(multiple.placement, 'block', '多图题不得自动进入单图左右混排')

  const invalidManual = decideWorksheetFigureLayout({
    questionId: 'question-1', figureId: 'missing', stemFigureCount: 1, hasInlineMarker: false,
    choices: ['甲', '乙', '丙', '丁'], requested: { figureId: 'missing', placement: 'side-left' },
  })
  assert.equal(invalidManual.placement, 'block', '缺失图片的人工左右布局应安全回退')
  assert.equal(invalidManual.warnings.some((warning) => warning.code === 'layout-fallback'), true)

  const inlineCollection = structuredClone(collection)
  inlineCollection.questions[0].item.figures[0].blockId = 'source-block-stem'
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

  const consecutiveAnchored = structuredClone(collection)
  consecutiveAnchored.questions[0].item.stemMarkdown = '题干<!-- DOC2X_FIGURE:figure-a --><!-- DOC2X_FIGURE:figure-b -->\nA. 甲\nB. 乙\nC. 丙\nD. 丁'
  consecutiveAnchored.questions[0].item.figures = [
    { id: 'figure-a', usage: 'stem', path: path.relative(storageRoot, stemFigurePath) },
    { id: 'figure-b', usage: 'stem', path: path.relative(storageRoot, optionFigurePath) },
  ]
  const consecutive = buildCollectionWorksheetLatex(consecutiveAnchored, 'student', figuresDir, new Map()).content
  assert.match(consecutive, /\\begin\{qbankfiguregrid\}\{2\}[\s\S]*figure-a[\s\S]*figure-b[\s\S]*\\end\{qbankfiguregrid\}/, '连续锚点图之间只有空白时也应自动并排')

  const boundaryFigure = structuredClone(collection)
  boundaryFigure.questions[0].item.stemMarkdown = '题干文字\n<!-- DOC2X_FIGURE:stem-unanchored -->\nA. 甲\nB. 乙\nC. 丙\nD. 丁'
  const boundary = buildCollectionWorksheetLatex(boundaryFigure, 'student', figuresDir, new Map()).content
  assert.match(boundary, /\\qbankchoiceswithfigure\{right\}[\s\S]*stem-unanchored[\s\S]*\\begin\{qbankchoicesone\}/, '题干与选项之间的单图锚点应进入选项右侧而非单独占行')

  const labelledFigures = structuredClone(collection)
  labelledFigures.questions[0].item.stemMarkdown = [
    '实验题干',
    '<!-- DOC2X_FIGURE:figure-a -->', '图甲',
    '<!-- DOC2X_FIGURE:figure-b -->', '图乙',
    'A. 甲', 'B. 乙', 'C. 丙', 'D. 丁',
  ].join('\n')
  labelledFigures.questions[0].item.figures = [
    { id: 'figure-a', usage: 'stem', path: path.relative(storageRoot, stemFigurePath) },
    { id: 'figure-b', usage: 'stem', path: path.relative(storageRoot, optionFigurePath) },
  ]
  const grouped = buildCollectionWorksheetLatex(labelledFigures, 'student', figuresDir, new Map()).content
  assert.match(grouped, /\\begin\{qbankfiguregrid\}\{2\}[\s\S]*图甲\}\{0\.625\}[\s\S]*图乙\}\{0\.625\}[\s\S]*\\end\{qbankfiguregrid\}/, '连续带标签题图应自动组成紧凑图组并保留单图宽度')

  const splitWithTail = splitChoiceStemForExport('题干\nA. 甲\nB. 乙\nC. 丙\nD. 丁\n（2）后续小问')
  assert.equal(splitWithTail.choices[3], '丁')
  assert.equal(splitWithTail.trailingContent, '（2）后续小问', '选择项后的后续小问不应被吞入选项 D')

  const imageChoiceCollection = structuredClone(collection)
  imageChoiceCollection.questions[0].item.stemMarkdown = [
    '图片选择题',
    'A. <!-- DOC2X_FIGURE:option-a -->',
    'B. <!-- DOC2X_FIGURE:option-b -->',
    'C. <!-- DOC2X_FIGURE:option-c -->',
    'D. <!-- DOC2X_FIGURE:option-d -->',
  ].join('\n')
  imageChoiceCollection.questions[0].item.figures = ['a', 'b', 'c', 'd'].map((label) => ({
    id: `option-${label}`,
    blockId: `source-block-option-${label}`,
    usage: 'options',
    optionLabel: label.toUpperCase(),
    path: path.relative(storageRoot, optionFigurePath),
  }))
  const imageChoice = buildCollectionWorksheetLatex(imageChoiceCollection, 'student', figuresDir, new Map()).content
  assert.equal((imageChoice.match(/\\includegraphics\[width=0\.625\\linewidth,height=2\.8cm/g) || []).length, 4, 'A-D 图片应各自在选项单元格中按紧凑尺寸输出一次')
  assert.equal((imageChoice.match(/^\\qbankfigure.*option-/gm) || []).length, 0, '已内联的选项图不应在题干后重复追加')

  const mixedAnswer = worksheetAnswerLatex('(1) 3.664 (2) D E \\( \\frac{k}{1-k} \\)')
  assert.doesNotMatch(mixedAnswer, /^\$[\s\S]*\\\(/, '含显式数学定界符的混合答案不应再次整体包裹数学环境')

  const blockCollection = structuredClone(collection)
  const blockRendered = buildCollectionWorksheetLatex(blockCollection, 'student', figuresDir, new Map(), undefined, {
    version: 1,
    questions: [{ relationId: 'relation-1', choiceLayout: 'auto', figures: [{ figureId: 'stem-unanchored', placement: 'block' }] }],
  })
  const block = blockRendered.content
  assert.equal(block.includes('\\qbankchoiceswithfigure'), false, '人工 block 应覆盖自动左右混排')
  assert.ok(block.includes('\\begin{samepage}') && block.includes('\\end{samepage}'), '块级题干图和 A-D 应作为整体分页')

  const overflowCollection = structuredClone(collection)
  overflowCollection.questions[0].item.stemMarkdown = '题干\nA. 这是一个明显不适合四栏展示的很长很长的选项内容\nB. 第二个很长选项\nC. 第三个很长选项\nD. 第四个很长选项'
  const overflow = buildCollectionWorksheetLatex(overflowCollection, 'student', figuresDir, new Map(), undefined, {
    version: 1,
    questions: [{ relationId: 'relation-1', choiceLayout: 'four', figures: [] }],
  })
  assert.equal(overflow.warnings.some((warning) => warning.code === 'choice-overflow'), true, '强制四栏的长选项应产生诊断')

  const pagedCollection = structuredClone(collection)
  pagedCollection.questions.push({ ...structuredClone(collection.questions[0]), relationId: 'relation-2', sortOrder: 2, sectionName: '解答题', item: { ...structuredClone(collection.questions[0].item), id: 'question-2', serialNo: 2 } })
  const paged = buildCollectionWorksheetLatex(pagedCollection, 'student', figuresDir, new Map(), undefined, {
    version: 1,
    questions: [
      { relationId: 'relation-1', choiceLayout: 'auto', figures: [] },
      { relationId: 'relation-2', choiceLayout: 'auto', figures: [], pageBreakBefore: true },
    ],
  }).content
  assert.ok(paged.indexOf('\\newpage') < paged.indexOf('\\begin{examquestion}{2}'), '题前强制分页必须传递到最终 LaTeX')
  assert.ok(paged.lastIndexOf('\\newpage') < paged.indexOf('解答题'), '新章节首题分页时必须先换页再输出章节标题，避免标题孤悬空白页')

  const equalizedPaged = buildCollectionWorksheetLatex(pagedCollection, 'student', figuresDir, new Map(), undefined, {
    version: 1,
    questions: [
      { relationId: 'relation-1', choiceLayout: 'auto', figures: [] },
      { relationId: 'relation-2', choiceLayout: 'auto', figures: [], equalizedPageBreakBefore: true },
    ],
  }).content
  assert.ok(equalizedPaged.lastIndexOf('\\newpage') < equalizedPaged.indexOf('解答题'), '等高排版的隐式分页也必须带着章节标题一起换页')
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}

console.log('worksheet figure order tests passed')
