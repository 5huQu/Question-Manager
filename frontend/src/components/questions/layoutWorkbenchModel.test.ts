import { describe, expect, it } from 'vitest'
import type { Basket, BasketQuestion } from '@/types'
import { hydrateLayout, moveWithinSection, patchQuestion } from './layoutWorkbenchModel'

function question(relationId: string, sectionName: string): BasketQuestion {
  return { relationId, sectionName, score: 5, item: { id: `q-${relationId}`, questionType: sectionName === '解答题' ? '解答题' : '单选题' } } as BasketQuestion
}

const basket = { questions: [question('a', '选择题'), question('b', '选择题'), question('c', '解答题')] } as Basket

describe('layoutWorkbenchModel', () => {
  it('hydrates every basket question while preserving saved overrides', () => {
    const layout = hydrateLayout(basket, { version: 1, questions: [
      { relationId: 'b', order: 0, choiceLayout: 'four', figures: [] },
      { relationId: 'a', order: 1, choiceLayout: 'auto', figures: [] },
      { relationId: 'c', order: 2, choiceLayout: 'auto', figures: [] },
    ] })
    expect(layout.questions.map((item) => item.relationId)).toEqual(['b', 'a', 'c'])
    expect(layout.questions[0].choiceLayout).toBe('four')
    expect(layout.questions[2].answerAreaHeight).toBe(4.2)
  })

  it('reorders within a section and rejects cross-section moves', () => {
    const layout = hydrateLayout(basket)
    expect(moveWithinSection(layout, basket, 'b', 'a').questions.map((item) => item.relationId)).toEqual(['b', 'a', 'c'])
    expect(moveWithinSection(layout, basket, 'a', 'c')).toBe(layout)
  })

  it('patches only the selected question layout', () => {
    const layout = hydrateLayout(basket)
    const next = patchQuestion(layout, 'a', { pageBreakBefore: true, choiceLayout: 'two' })
    expect(next.questions[0]).toMatchObject({ pageBreakBefore: true, choiceLayout: 'two' })
    expect(next.questions[1]).toEqual(layout.questions[1])
  })
})
