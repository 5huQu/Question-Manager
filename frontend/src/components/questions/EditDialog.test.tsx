import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import type { QuestionItem } from '@/types'

vi.mock('@/components/dialogs/Modal', () => ({
  Modal: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <div>{actions}{children}</div>,
}))

vi.mock('@/api/learningTags', () => ({
  learningTagsApi: { getQuestionBankTagLibraries: vi.fn(async () => ({ knowledgePoints: [], solutionMethods: [] })) },
}))

vi.mock('@/api/settings', () => ({
  settingsApi: { getOcrSettings: vi.fn(async () => ({ teachingStages: [] })) },
}))

vi.mock('@/components/questions/editor', () => ({
  QuestionContentEditor: ({ value, onChange, onSave, conflict }: any) => (
    <div>
      <span data-testid="stem">{value.stemMarkdown}</span>
      {conflict ? <span role="alert">{conflict.message}</span> : null}
      <button type="button" onClick={() => onChange({ ...value, stemMarkdown: '修改后的题干' })}>修改内容</button>
      <button type="button" onClick={() => void onSave(value).catch(() => undefined)}>保存内容</button>
    </div>
  ),
}))

import { EditDialog } from './EditDialog'

const question = {
  id: 'question-1',
  contentRevision: 4,
  stemMarkdown: '原题干',
  answerText: '原答案',
  analysisMarkdown: '原解析',
  figures: [],
  ocrSegmentImages: [],
} as Partial<QuestionItem>

describe('EditDialog unified content editor integration', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderDialog(onSave: (draft?: Partial<QuestionItem>) => Promise<void>, onManageFigures?: () => void) {
    function Harness() {
      const [draft, setDraft] = useState(question)
      return <EditDialog draft={draft} setDraft={setDraft} onClose={() => undefined} onSave={onSave} onManageFigures={onManageFigures} />
    }
    return act(async () => { root.render(<Harness />) })
  }

  it('exposes figure management from the main edit dialog', async () => {
    const onManageFigures = vi.fn()
    await renderDialog(vi.fn(async () => undefined), onManageFigures)
    await act(async () => {
      ;[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '管理题图')!.click()
    })
    expect(onManageFigures).toHaveBeenCalledOnce()
  })

  it('maps editor content back to markdown and rich block fields before saving', async () => {
    const onSave = vi.fn(async (_draft?: Partial<QuestionItem>) => undefined)
    await renderDialog(onSave)

    await act(async () => {
      ;[...container.querySelectorAll('button')].find((button) => button.textContent === '修改内容')!.click()
    })
    expect(container.querySelector('[data-testid="stem"]')?.textContent).toBe('修改后的题干')

    await act(async () => {
      ;[...container.querySelectorAll('button')].find((button) => button.textContent === '保存内容')!.click()
    })
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0]?.stemMarkdown).toBe('修改后的题干')
    expect(onSave.mock.calls[0][0]?.problemBlocks).toEqual(expect.any(Array))
  })

  it('saves edited metadata through the dialog footer', async () => {
    const onSave = vi.fn(async (_draft?: Partial<QuestionItem>) => undefined)
    await renderDialog(onSave)

    await act(async () => {
      ;[...container.querySelectorAll('button')].find((button) => button.textContent === '题目元数据')!.click()
    })
    const sourceInput = [...container.querySelectorAll('input')].find((input) => input.value === '')
    expect(sourceInput).toBeTruthy()
    await act(async () => {
      const input = sourceInput!
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '2026 模拟卷')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      ;[...container.querySelectorAll('button')].find((button) => button.textContent === '保存')!.click()
    })

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0]?.sourceTitle).toBe('2026 模拟卷')
  })

  it('keeps the draft and exposes revision conflicts returned by the API', async () => {
    const onSave = vi.fn(async (_draft?: Partial<QuestionItem>) => {
      throw new ApiError('内容版本冲突', 409, { message: '服务器已有更新', actualContentRevision: 5 })
    })
    await renderDialog(onSave)

    await act(async () => {
      ;[...container.querySelectorAll('button')].find((button) => button.textContent === '修改内容')!.click()
      ;[...container.querySelectorAll('button')].find((button) => button.textContent === '保存内容')!.click()
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('服务器已有更新')
    expect(container.querySelector('[data-testid="stem"]')?.textContent).toBe('修改后的题干')
    expect(window.localStorage.length).toBeGreaterThan(0)
  })
})
