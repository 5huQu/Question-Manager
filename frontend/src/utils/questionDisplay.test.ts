import { describe,expect,it } from 'vitest'
import type { QuestionFigure } from '@/types'
import { figureDisplayLabels, orderQuestionFiguresByUsage, parseChoiceQuestion } from './questionDisplay'

describe('figureDisplayLabels', () => {
 it('uses semantic names and numbers each usage in display order', () => {
  const figures = [
   { id: 'internal-stem-1', usage: 'stem' },
   { id: 'internal-stem-2', category: 'question' },
   { id: 'internal-option-a', usage: 'options', optionLabel: 'a' },
   { id: 'internal-analysis-1', usage: 'analysis' },
  ] as QuestionFigure[]

  expect(figureDisplayLabels(figures)).toEqual([
   '题干图 1',
   '题干图 2',
   '选项图 1 · 选项 A',
   '解析图 1',
  ])
 })
})

describe('orderQuestionFiguresByUsage', () => {
 it('orders the editor view by semantic section while preserving order within each section', () => {
  const figures = [
   { id: 'analysis-1', usage: 'analysis' },
   { id: 'stem-1', usage: 'stem' },
   { id: 'answer-1', usage: 'answer' },
   { id: 'stem-2', usage: 'stem' },
  ] as QuestionFigure[]

  expect(orderQuestionFiguresByUsage(figures).map((figure) => figure.id)).toEqual([
   'stem-1', 'stem-2', 'answer-1', 'analysis-1',
  ])
 })
})

describe('parseChoiceQuestion',()=>{
 it('parses four choices written on the same source line',()=>{
  const parsed=parseChoiceQuestion('已知 $z=\\frac{2}{1-i}$，则 $|z|=$（ ） A. $\\sqrt2$ B. $\\sqrt3$ C. 2 D. $\\sqrt5$')
  expect(parsed?.stem).toContain('已知')
  expect(parsed?.options.map((option)=>option.label)).toEqual(['A','B','C','D'])
  expect(parsed?.options.map((option)=>option.content)).toEqual(['$\\sqrt2$','$\\sqrt3$','2','$\\sqrt5$'])
 })

 it('does not mistake a curve label like "C: y²=2px" for choice marker C',()=>{
  const stem='已知 O为坐标原点，抛物线 C: $y^{2}=2px(p>0)$的焦点为 F，过 B的直线与 C交于两点 M,N，则\n\nA. p=4 B. $\\overrightarrow{OM}\\cdot\\overrightarrow{ON}=20$ C. $\\frac{|MB|}{|MF|}\\geqslant\\sqrt2$ D. $\\frac{1}{|MF|}+\\frac{1}{|NF|}=\\frac{1}{2}$'
  const parsed=parseChoiceQuestion(stem)
  expect(parsed?.stem).toContain('抛物线 C: $y^{2}=2px(p>0)$')
  expect(parsed?.options.map((option)=>option.label)).toEqual(['A','B','C','D'])
  expect(parsed?.options.map((option)=>option.content)).toEqual(['p=4','$\\overrightarrow{OM}\\cdot\\overrightarrow{ON}=20$','$\\frac{|MB|}{|MF|}\\geqslant\\sqrt2$','$\\frac{1}{|MF|}+\\frac{1}{|NF|}=\\frac{1}{2}$'])
 })

 it('still parses colon-separated inline choices',()=>{
  const parsed=parseChoiceQuestion('下列结论正确的是 A: 甲 B: 乙 C: 丙 D: 丁')
  expect(parsed?.options.map((option)=>option.label)).toEqual(['A','B','C','D'])
  expect(parsed?.options.map((option)=>option.content)).toEqual(['甲','乙','丙','丁'])
 })

 it('prefers the real option A over a semantic event A label in the stem',()=>{
  const parsed=parseChoiceQuestion('记事件 A：乘积为偶数，则 $P(A)=$\n\nA. $\\frac{3}{8}$ B. $\\frac{7}{8}$\n\nC. $\\frac{5}{8}$ D. $\\frac{1}{8}$')
  expect(parsed?.stem).toBe('记事件 A：乘积为偶数，则 $P(A)=$')
  expect(parsed?.options.map((option)=>option.content)).toEqual([
   '$\\frac{3}{8}$',
   '$\\frac{7}{8}$',
   '$\\frac{5}{8}$',
   '$\\frac{1}{8}$',
  ])
 })
})
