import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QuestionContentDraft } from '@/types/questionContent'
import { questionEditorDraftKey, useQuestionEditorDraft, type UseQuestionEditorDraftResult } from './useQuestionEditorDraft'

const initial: QuestionContentDraft = { stemMarkdown: '原题', answerText: 'A', analysisMarkdown: '原解析' }

function Harness({ onResult, entityId = 'q1' }: { onResult: (result: UseQuestionEditorDraftResult) => void; entityId?: string }) {
  onResult(useQuestionEditorDraft({ entityType: 'question', entityId, initialValue: initial, contentRevision: 3, warnBeforeUnload: false }))
  return null
}

describe('useQuestionEditorDraft', () => {
  let container: HTMLDivElement
  let root: Root
  let result: UseQuestionEditorDraftResult

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    localStorage.clear()
  })

  function render(entityId = 'q1') {
    act(() => root.render(<Harness entityId={entityId} onResult={(next) => { result = next }} />))
  }

  it('persists dirty edits under an entity-isolated key', () => {
    render()
    expect(result.dirty).toBe(false)

    act(() => result.updateField('stemMarkdown', '修改后的题目'))

    expect(result.dirty).toBe(true)
    const stored = JSON.parse(localStorage.getItem(questionEditorDraftKey('question', 'q1')) || 'null')
    expect(stored.value.stemMarkdown).toBe('修改后的题目')
    expect(localStorage.getItem(questionEditorDraftKey('question', 'q2'))).toBeNull()
  })

  it('recovers a local draft for the same entity', () => {
    localStorage.setItem(questionEditorDraftKey('question', 'q1'), JSON.stringify({
      version: 1,
      entityKey: 'question:q1',
      baseContentRevision: 2,
      value: { ...initial, analysisMarkdown: '未保存的解析' },
      savedAt: '2026-07-13T10:00:00.000Z',
    }))
    render()

    expect(result.value.analysisMarkdown).toBe('未保存的解析')
    expect(result.hasRecoveredDraft).toBe(true)
    expect(result.recoveredAt?.toISOString()).toBe('2026-07-13T10:00:00.000Z')
  })

  it('discards recovery and markSaved clears local storage', () => {
    render()
    act(() => result.updateField('answerText', 'B'))
    expect(localStorage.getItem(questionEditorDraftKey('question', 'q1'))).not.toBeNull()

    act(() => result.markSaved())
    expect(result.dirty).toBe(false)
    expect(localStorage.getItem(questionEditorDraftKey('question', 'q1'))).toBeNull()

    act(() => result.updateField('analysisMarkdown', '另一份草稿'))
    act(() => result.discardDraft())
    expect(result.value.analysisMarkdown).toBe('原解析')
    expect(result.dirty).toBe(false)
  })
})
