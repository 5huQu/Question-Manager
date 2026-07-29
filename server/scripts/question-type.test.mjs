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
// an open-ended problem into a choice question when its type is inferred.
assert.equal(inferQuestionType(solutionStem, '证明过程见解析，点A、B、C、D满足条件。'), '解答题')
assert.equal(normalizeQuestionType('OCR题', solutionStem, '答案：A'), '解答题')
assert.equal(normalizeQuestionType('单选题', solutionStem, '答案：A'), '单选题')

// A saved type is an explicit editor decision. The word “计算” is common in
// choice stems and must not overwrite a manual multi-choice selection.
const calculationChoices = [
  '下列计算结果正确的是（ ）',
  'A. 1',
  'B. 2',
  'C. 3',
  'D. 4',
].join('\n')
assert.equal(normalizeQuestionType('多选题', calculationChoices, '答案：AB'), '多选题')

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

// Curve labels such as "C: y²=2px" must not be mistaken for choice markers.
// The ordered-subsequence strategy skips the phantom C and still finds A-D.
const curveLabelInline = [
  '已知 O为坐标原点，抛物线 C: $y^{2}=2px(p>0)$的焦点为 F，点 B(-2,0)在 C的准线上，过 B的直线与 C交于不同的两点 M,N，则',
  '',
  'A. p=4 B. $\\overrightarrow{OM}\\cdot\\overrightarrow{ON}=20$ C. $\\frac{|MB|}{|MF|}\\geqslant\\sqrt{2}$ D. $\\frac{1}{|MF|}+\\frac{1}{|NF|}=\\frac{1}{2}$',
].join('\n')
assert.equal(hasReliableFourChoiceOptions(curveLabelInline), true)
assert.equal(inferQuestionType(curveLabelInline, 'ABD'), '多选题')
assert.equal(inferQuestionType(curveLabelInline, 'A'), '单选题')

// Colon-separated inline options (OCR style) remain supported.
const colonInline = '下列结论正确的是 A: 甲 B: 乙 C: 丙 D: 丁'
assert.equal(hasReliableFourChoiceOptions(colonInline), true)
assert.equal(inferQuestionType(colonInline, '故选B'), '单选题')

// OCR may place mathematical labels such as sin A:/sin B:/sin C: before an
// inline option block. The trailing A-D sequence is the real option structure.
const mathLabelsBeforeInlineChoices = '在 ABC中，若 sin A:sin B:sin C=3:5:7，则最小边长等于（ ） A. 3 B. 6 C. 9 D. 12'
assert.equal(hasReliableFourChoiceOptions(mathLabelsBeforeInlineChoices), true)
assert.equal(inferQuestionType(mathLabelsBeforeInlineChoices, 'B\n\n【来源】模拟试题'), '单选题')

// “计算” in the context of a construction or a cultural-history stem is not
// an open-ended signal when the question has a structured option block.
const calculationChoice = '用于计算远处目标高度的方法，则第二次影长是表高的（ ） A. 1倍 B. 3/2倍 C. 5/2倍 D. 7/2倍'
assert.equal(inferQuestionType(calculationChoice, 'A'), '单选题')

const geometryCalculationChoice = '矩形 CMNK 为计算所做，则（ ） A. sin β = cos γ cos δ B. cos β = cos γ cos δ C. sin α = 1 D. cos α = 1'
assert.equal(inferQuestionType(geometryCalculationChoice, 'D'), '单选题')

// Curve label with colon followed by line-separated options is also fine.
const curveLabelLineSeparated = [
  '已知椭圆 C: $\\frac{x^2}{4}+\\frac{y^2}{3}=1$ 的左右焦点分别为 F1、F2，点 P 在 C 上，则',
  'A. 1 B. 2 C. 3 D. 4',
].join('\n')
assert.equal(hasReliableFourChoiceOptions(curveLabelLineSeparated), true)
assert.equal(inferQuestionType(curveLabelLineSeparated, 'AC'), '多选题')

console.log('question type inference tests passed')
