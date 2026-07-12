import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutQuickPreview } from './LayoutQuickPreview'
import type { BasketQuestion, QuestionItem } from '@/types'
import type { QuestionLayout } from '@/api/layoutDrafts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function question(overrides: Partial<QuestionItem> = {}): BasketQuestion {
  return {
    relationId: 'relation-1',
    score: 15,
    item: {
      id: 'question-1', serialNo: 1, questionNo: '18', stage: '高三', questionType: '解答题', difficultyScore: 0, difficultyScore10: 0, difficultyLabel: '', chapter: '', knowledgePoints: [], solutionMethods: [], sourceTitle: '', bankStatus: 'ready', stemMarkdown: '题干', answerText: '', analysisMarkdown: '', totalScore: 15, scoringRubric: [], sliceImagePath: '', figures: [], sourceRunId: '', updatedAt: '', hasFigures: false,
      ...overrides,
    },
  }
}

const layout: QuestionLayout = { relationId: 'relation-1', choiceLayout: 'auto', figures: [], keepTogether: true }

describe('LayoutQuickPreview', () => {
  it('renders Doc2X figures and inline KaTeX for a solution question without fabricated choices', () => {
    const entry = question({
      stemMarkdown: '已知 $z=\\frac{1}{i}$。\n\n<!-- DOC2X_FIGURE:figure-18 -->\n\n(1) 求最小值；',
      figures: [{ id: 'figure-18', blockId: 'figure-18', usage: 'stem', path: 'question_figures/figure-18.png' }],
    })
    act(() => root.render(<LayoutQuickPreview entries={[{ question: entry, layout }]} selectedId="relation-1" zoom={1} onSelect={vi.fn()} />))

    expect(container.querySelector('.katex')).toBeTruthy()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/question_figures/figure-18.png')
    expect(container.textContent).not.toContain('DOC2X_FIGURE')
    expect(container.textContent).not.toContain('选项内容')
    expect(container.textContent).toContain('(1) 求最小值')
  })

  it('uses the actual four parsed choices only for a question marked as a choice question', () => {
    const entry = question({
      questionType: '单选题',
      stemMarkdown: '下列正确的是\nA. $1$\nB. $2$\nC. $3$\nD. $4$',
    })
    act(() => root.render(<LayoutQuickPreview entries={[{ question: entry, layout }]} selectedId="relation-1" zoom={1} onSelect={vi.fn()} />))

    expect(container.textContent).toContain('A')
    expect(container.textContent).toContain('D')
    expect(container.textContent).toContain('1')
    expect(container.textContent).toContain('4')
    expect(container.textContent).not.toContain('选项内容')
    expect(container.querySelectorAll('.choice-option')).toHaveLength(4)
  })

  it('maps forced four and two column layouts to the shared option grid classes', () => {
    const entry = question({ questionType: '单选题', stemMarkdown: '题干 A. 甲 B. 乙 C. 丙 D. 丁' })
    act(() => root.render(<LayoutQuickPreview entries={[{ question: entry, layout: { ...layout, choiceLayout: 'four' } }]} selectedId="relation-1" zoom={1} onSelect={vi.fn()} />))
    expect(container.querySelector('.choice-options-quad')).toBeTruthy()
    act(() => root.render(<LayoutQuickPreview entries={[{ question: entry, layout: { ...layout, choiceLayout: 'two' } }]} selectedId="relation-1" zoom={1} onSelect={vi.fn()} />))
    expect(container.querySelector('.choice-options-double')).toBeTruthy()
  })

  it('centers an unconfigured block figure by default', () => {
    const entry = question({ figures: [{ id: 'figure-1', usage: 'stem', path: 'question_figures/figure-1.png' }] })
    act(() => root.render(<LayoutQuickPreview entries={[{ question: entry, layout }]} selectedId="relation-1" zoom={1} onSelect={vi.fn()} />))
    expect(container.querySelector('img')?.parentElement?.classList.contains('mx-auto')).toBe(true)
  })

  it('gives each question a stable outline navigation anchor', () => {
    act(() => root.render(<LayoutQuickPreview entries={[{ question: question(), layout }]} selectedId="" zoom={1} onSelect={vi.fn()} />))
    expect(container.querySelector('#layout-question-relation-1')).toBeTruthy()
    expect(container.querySelector('[data-preview-page="1"]')).toBeTruthy()
  })

  it('renders answers and analysis only in the teacher variant', () => {
    const entry = question({ answerText: '42', analysisMarkdown: '计算可得。' })
    act(() => root.render(<LayoutQuickPreview entries={[{ question: entry, layout }]} selectedId="" zoom={1} onSelect={vi.fn()} variant="student" />))
    expect(container.textContent).not.toContain('计算可得')
    act(() => root.render(<LayoutQuickPreview entries={[{ question: entry, layout }]} selectedId="" zoom={1} onSelect={vi.fn()} variant="teacher" />))
    expect(container.textContent).toContain('答案：')
    expect(container.textContent).toContain('42')
    expect(container.textContent).toContain('计算可得')
  })
})
