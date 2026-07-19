import { describe, expect, it } from 'vitest'
import type { Basket, BasketQuestion } from '@/types'
import { allowedFigurePlacements, hydrateLayout, moveWithinSection, patchQuestion, resetLayoutQuestions } from './layoutWorkbenchModel'

function question(relationId: string, sectionName: string): BasketQuestion {
  return { relationId, sectionName, score: 5, item: { id: `q-${relationId}`, questionType: sectionName === '解答题' ? '解答题' : '单选题' } } as BasketQuestion
}

const basket = { questions: [question('a', '选择题'), question('b', '选择题'), question('c', '解答题')] } as Basket

describe('layoutWorkbenchModel', () => {
  it('hydrates every basket question while preserving saved overrides', () => {
    const layout = hydrateLayout(basket, { version: 1, questions: [
      { relationId: 'b', order: 0, choiceLayout: 'four', multiFigureLayout: 'row', figures: [] },
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

  it('restores a page or the whole paper to structured automatic values', () => {
    const layout = hydrateLayout(basket)
    layout.questions[0] = { ...layout.questions[0], choiceLayout: 'four', pageBreakBefore: true, figures: [{ figureId: 'f1', placement: 'side-right' }] }
    const pageReset = resetLayoutQuestions(layout, ['a'], ['c'])
    expect(pageReset.questions[0]).toMatchObject({ choiceLayout: 'auto', pageBreakBefore: false, figures: [] })
    expect(pageReset.questions[1]).toEqual(layout.questions[1])
    const allReset = resetLayoutQuestions(pageReset, pageReset.questions.map(item => item.relationId), ['c'])
    expect(allReset.solutionPageStrategy).toBe('auto')
    expect(allReset.questions[2].answerAreaHeight).toBe(4.2)
  })

  it('only offers side slots for one unanchored stem figure', () => {
    expect(allowedFigurePlacements({ usage: 'stem', stemFigureCount: 1, anchored: false })).toContain('side-right')
    expect(allowedFigurePlacements({ usage: 'stem', stemFigureCount: 2, anchored: false })).not.toContain('side-right')
    expect(allowedFigurePlacements({ usage: 'stem', stemFigureCount: 1, anchored: true })).not.toContain('side-left')
    expect(allowedFigurePlacements({ usage: 'analysis', stemFigureCount: 1, anchored: false })).toEqual(['auto'])
  })
})
