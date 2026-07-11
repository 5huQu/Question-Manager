import assert from 'node:assert/strict'
import { qbankChoiceLayout } from '../dist/utils/worksheet-figures.js'

assert.equal(qbankChoiceLayout(['$y=x^3$', '$y=x+\\frac{1}{x}$', '$y=2^x-2^{-x}$', '$y=\\ln|x|$']), 'four')
assert.equal(qbankChoiceLayout(['$y=x^3$', '$y=x+\n\\frac{1}{x}$', '$y=2^x-2^{-x}$', '$y=\\ln|x|$']), 'four')
assert.equal(qbankChoiceLayout(['简短选项', '另一个简短选项', '第三个选项', '第四个选项']), 'four')

assert.equal(qbankChoiceLayout([
  '这是一个长度适中但四栏空间不足的选择题选项内容',
  '这是另一个长度适中但四栏空间不足的选择题选项',
  '第三个长度适中的选择题选项内容',
  '第四个长度适中的选择题选项内容',
]), 'two')

assert.equal(qbankChoiceLayout(['第一段\n\n第二段', 'B', 'C', 'D']), 'one')
assert.equal(qbankChoiceLayout(['| 列一 | 列二 |', 'B', 'C', 'D']), 'one')
assert.equal(qbankChoiceLayout(['![图](figure.png)', 'B', 'C', 'D']), 'one')
assert.equal(qbankChoiceLayout(['$$x^2$$', 'B', 'C', 'D']), 'one')
assert.equal(qbankChoiceLayout(['A', 'B', 'C']), 'one')

console.log('choice layout tests passed')
