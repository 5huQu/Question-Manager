import { describe, expect, it } from 'vitest'
import { choiceLayoutForTexts } from './choiceLayout'

describe('choiceLayoutForTexts', () => {
  it('uses one column for interval-union formula choices', () => {
    expect(choiceLayoutForTexts([
      '$(-\\infty, a-1]\\cup[a+1, +\\infty)$',
      '$[a-1, a+1]$',
      '$(-\\infty, a+1]\\cup[a-1, +\\infty)$',
      '$[a+1, a-1]$',
    ])).toBe('single')
  })

  it('keeps short plain-text choices compact', () => {
    expect(choiceLayoutForTexts(['第一象限', '第二象限', '第三象限', '第四象限'])).toBe('quad')
  })

  it('keeps short vector fractions in one four-column row', () => {
    expect(choiceLayoutForTexts([
      '$\\frac{3}{2}\\overrightarrow{CA}$',
      '$-\\frac{3}{2}\\overrightarrow{CA}$',
      '$\\frac{1}{2}\\overrightarrow{CA}$',
      '$-\\frac{1}{2}\\overrightarrow{CA}$',
    ])).toBe('quad')
  })

  it('does not force short infinity intervals into one column', () => {
    expect(choiceLayoutForTexts([
      '$(-\\infty, 1)$',
      '$[1, 3]$',
      '$(1, 3]$',
      '$[3, +\\infty)$',
    ])).toBe('quad')
  })
})
