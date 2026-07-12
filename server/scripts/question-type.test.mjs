import assert from 'node:assert/strict'
import {
  hasReliableFourChoiceOptions,
  inferQuestionType,
  normalizeQuestionType,
} from '../dist/utils/question-type.js'

const solutionStem = [
  '如图，已知圆锥PO的底面直径AB=2，母线PA=3，动点M从A点出发。',
  '<!-- DOC2X_FIGURE:glm_asset_cone -->',
  '(1) 求L长度的最小值；',
  '(2) 若点Q在圆O上，且向量 $\\overrightarrow{PM}=\\frac{2}{3}\\overrightarrow{PQ}$，求证：存在非零向量。',
].join('\n')

// A-D letters in an answer, diagram description, or analysis must never turn
// an open-ended problem into a choice question.
assert.equal(inferQuestionType(solutionStem, '证明过程见解析，点A、B、C、D满足条件。'), '解答题')
assert.equal(normalizeQuestionType('OCR题', solutionStem, '答案：A'), '解答题')
assert.equal(normalizeQuestionType('单选题', solutionStem, '答案：A'), '解答题')

const fourChoices = [
  '下列函数中既是奇函数又是增函数的是（ ）',
  'A. $y=x^3$',
  'B. $y=x+\\frac{1}{x}$',
  'C. $y=2^x-2^{-x}$',
  'D. $y=\\ln|x|$',
].join('\n')
assert.equal(hasReliableFourChoiceOptions(fourChoices), true)
assert.equal(inferQuestionType(fourChoices, '答案：A'), '单选题')

const inlineChoices = '下列命题中正确的是 A. $x>0$ B. $x<0$ C. $x=0$ D. $x\\ne0$'
assert.equal(hasReliableFourChoiceOptions(inlineChoices), true)
assert.equal(inferQuestionType(inlineChoices, '故选D'), '单选题')

const geometryLetters = '在四面体ABCD中，点E、F分别在线段AB、CD上，求证：平面AEF与平面BCD平行。'
assert.equal(hasReliableFourChoiceOptions(geometryLetters), false)
assert.equal(inferQuestionType(geometryLetters, '由A、B、C、D四点的位置关系可得。'), '解答题')

// A bare A-D answer is insufficient without both an option structure and a
// strong selection prompt in the stem.
assert.equal(inferQuestionType('已知点A、B、C、D共圆，求证四边形ABCD为圆内接四边形。', 'A'), '解答题')

console.log('question type inference tests passed')
