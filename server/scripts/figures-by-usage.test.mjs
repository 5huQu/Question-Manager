import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// 1. 测试后端 figuresForQuestionBank 逻辑
import { figuresForQuestionBank } from '../dist/services/import-flow-v2/import-flow-v2.service.js'

console.log('Testing figuresForQuestionBank...')
const mockCandidateFigures = [
  { id: 'fig_stem_1', usage: 'stem', path: 'a.png', pageNo: 1, bbox: [0, 0, 10, 10] },
  { id: 'fig_stem_2', usage: 'question', path: 'b.png', pageNo: 1, bbox: [0, 0, 10, 10] },
  { id: 'fig_stem_3', usage: '', path: 'c.png', pageNo: 1, bbox: [0, 0, 10, 10] },
  { id: 'fig_analysis', usage: 'analysis', path: 'd.png', pageNo: 2, bbox: [0, 0, 10, 10] },
  { id: 'fig_options', usage: 'options', path: 'e.png', pageNo: 2, bbox: [0, 0, 10, 10] },
]

const bankedFigures = figuresForQuestionBank(mockCandidateFigures)

assert.equal(bankedFigures.length, 5)
// usage === 'stem' should stay 'stem'
assert.equal(bankedFigures[0].usage, 'stem')
assert.equal(bankedFigures[0].category, 'question')

// usage === 'question' should become 'stem'
assert.equal(bankedFigures[1].usage, 'stem')
assert.equal(bankedFigures[1].category, 'question')

// empty usage should become 'stem'
assert.equal(bankedFigures[2].usage, 'stem')
assert.equal(bankedFigures[2].category, 'question')

// usage === 'analysis' should stay 'analysis'
assert.equal(bankedFigures[3].usage, 'analysis')
assert.equal(bankedFigures[3].category, 'analysis')

// usage === 'options' should stay 'options'
assert.equal(bankedFigures[4].usage, 'options')
assert.equal(bankedFigures[4].category, 'question')

console.log('figuresForQuestionBank tests passed.')

// 2. 测试前端 figuresByUsage 逻辑
console.log('Testing frontend figuresByUsage...')

const displayCodePath = path.resolve('frontend/src/utils/questionDisplay.ts')
const displayCode = fs.readFileSync(displayCodePath, 'utf8')

// 提取 figuresByUsage 函数定义并移去 TS 类型注释
const functionMatch = displayCode.match(/export function figuresByUsage\([\s\S]*?\n\}/)
if (!functionMatch) {
  throw new Error('Failed to locate figuresByUsage function in questionDisplay.ts')
}

const cleanedFunction = functionMatch[0]
  .replace('export ', '')
  .replace('figures: QuestionFigure[]', 'figures')
  .replace('target: string', 'target')

// 执行函数
const figuresByUsage = new Function(`${cleanedFunction}; return figuresByUsage`)()

const mockFigures = [
  { id: 'f1', usage: 'stem' },
  { id: 'f2', usage: 'question' },
  { id: 'f3', category: 'question' },
  { id: 'f4', usage: '' },
  { id: 'f5', usage: 'analysis' },
  { id: 'f6', category: 'analysis' },
  { id: 'f7', usage: 'options' },
]

// stem should match empty, stem, question, and category=question
const stemMatched = figuresByUsage(mockFigures, 'stem')
assert.deepEqual(stemMatched.map(f => f.id), ['f1', 'f2', 'f3', 'f4'])

// analysis should match usage=analysis and category=analysis
const analysisMatched = figuresByUsage(mockFigures, 'analysis')
assert.deepEqual(analysisMatched.map(f => f.id), ['f5', 'f6'])

// options should match usage=options
const optionsMatched = figuresByUsage(mockFigures, 'options')
assert.deepEqual(optionsMatched.map(f => f.id), ['f7'])

console.log('frontend figuresByUsage tests passed.')
console.log('All figures compatibility tests passed!')
