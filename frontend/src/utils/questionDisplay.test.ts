import { describe,expect,it } from 'vitest'
import { parseChoiceQuestion } from './questionDisplay'

describe('parseChoiceQuestion',()=>{
 it('parses four choices written on the same source line',()=>{
  const parsed=parseChoiceQuestion('已知 $z=\\frac{2}{1-i}$，则 $|z|=$（ ） A. $\\sqrt2$ B. $\\sqrt3$ C. 2 D. $\\sqrt5$')
  expect(parsed?.stem).toContain('已知')
  expect(parsed?.options.map((option)=>option.label)).toEqual(['A','B','C','D'])
  expect(parsed?.options.map((option)=>option.content)).toEqual(['$\\sqrt2$','$\\sqrt3$','2','$\\sqrt5$'])
 })
})
