import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import {
  QuestionCardContextLabel,
  QuestionCardFrame,
  QuestionCardHeader,
  QuestionCardSolution,
} from './QuestionCard'

const item = {
  id: 'question-card-test',
  serialNo: 42,
  questionType: '单选题',
  stage: '高三',
  chapter: '函数',
  difficulty: 0.6,
  stemMarkdown: '测试题干',
  answerText: 'A',
  analysisMarkdown: '测试解析',
  knowledgePoints: ['函数性质'],
  solutionMethods: [],
  figures: [],
} as unknown as QuestionItem

describe('shared question card', () => {
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

  it('renders the shared frame and scene-specific context label', async () => {
    await act(async () => {
      root.render(
        <QuestionCardFrame selected>
          <QuestionCardHeader item={item} leading={<QuestionCardContextLabel>第 1 题</QuestionCardContextLabel>} />
        </QuestionCardFrame>,
      )
    })

    const card = container.querySelector('article')
    expect(card?.classList.contains('question-card')).toBe(true)
    expect(card?.classList.contains('question-card--selected')).toBe(true)
    expect(container.textContent).toContain('第 1 题')
    expect(container.textContent).toContain('难度:')
    expect(container.textContent).toContain('#42')
  })

  it('keeps the shared solution disclosure mounted and updates accessibility state', async () => {
    await act(async () => {
      root.render(<QuestionCardSolution item={item} open={false} />)
    })
    const disclosure = container.querySelector('.question-card-disclosure')
    expect(disclosure?.getAttribute('aria-hidden')).toBe('true')
    expect(disclosure?.classList.contains('grid-rows-[0fr]')).toBe(true)

    await act(async () => {
      root.render(<QuestionCardSolution item={item} open />)
    })
    expect(disclosure?.getAttribute('aria-hidden')).toBe('false')
    expect(disclosure?.classList.contains('grid-rows-[1fr]')).toBe(true)
    expect(container.textContent).toContain('测试解析')
  })
})
