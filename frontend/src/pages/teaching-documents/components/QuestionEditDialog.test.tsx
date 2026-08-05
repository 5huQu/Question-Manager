import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionItem } from '@/types'
import type { QuestionBlock } from '@/types/teachingDocument'

vi.mock('@/api/questionBank', () => ({
  questionBankApi: { updateItem: vi.fn() },
}))

vi.mock('@/components/questions/editor/QuestionContentEditor', () => ({
  QuestionContentEditor: ({ title }: { title?: string }) => <div data-testid="question-content-editor">{title}</div>,
}))

vi.mock('@/components/questions/QuestionFigureManager', () => ({
  QuestionFigureManager: ({ onFiguresChange }: { onFiguresChange?: (figures: unknown[]) => void }) => (
    <div data-testid="question-figure-manager">
      题图管理内容
      <button type="button" onClick={() => onFiguresChange?.([])}>同步题图</button>
    </div>
  ),
}))

import { QuestionEditDialog } from './QuestionEditDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const block = {
  type: 'question',
  id: 'block-1',
  questionId: 'question-1',
} as QuestionBlock

const question = {
  id: 'question-1',
  questionNo: '11',
  stemMarkdown: '题干',
  answerText: '答案',
  analysisMarkdown: '解析',
  figures: [],
  contentRevision: 1,
} as Partial<QuestionItem> as QuestionItem

describe('QuestionEditDialog figure management panel', () => {
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

  function renderDialog(onFiguresChanged = vi.fn()) {
    return act(async () => {
      root.render(
        <QuestionEditDialog
          block={block}
          question={question}
          onClose={() => undefined}
          onWrittenBack={() => undefined}
          onKeepLocal={() => undefined}
          onFiguresChanged={onFiguresChanged}
        />,
      )
    })
  }

  it('switches between content editing and the new figure management panel', async () => {
    await renderDialog()
    expect(document.querySelector('[data-testid="question-content-editor"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="question-figure-manager"]')).toBeNull()

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        .find((button) => button.textContent?.includes('题图管理'))
        ?.click()
    })

    expect(document.querySelector('[data-testid="question-content-editor"]')).toBeNull()
    expect(document.querySelector('[data-testid="question-figure-manager"]')?.textContent).toContain('题图管理内容')
  })

  it('forwards figure updates to the document page cache callback', async () => {
    const onFiguresChanged = vi.fn()
    await renderDialog(onFiguresChanged)
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        .find((button) => button.textContent?.includes('题图管理'))
        ?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="question-figure-manager"] button')?.click()
    })
    expect(onFiguresChanged).toHaveBeenCalledWith([])
  })
})
