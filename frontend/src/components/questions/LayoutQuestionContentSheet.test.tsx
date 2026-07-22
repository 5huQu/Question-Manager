import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionItem } from '@/types'
import { LayoutQuestionContentSheet } from './LayoutQuestionContentSheet'

const item = {
  id: 'q1',
  contentRevision: 3,
  stemMarkdown: '题干 $x+1$',
  answerText: '1',
  analysisMarkdown: '解析',
  figures: [],
} as unknown as QuestionItem

describe('LayoutQuestionContentSheet', () => {
  let container: HTMLDivElement
  let root: Root

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

  it('keeps layout edits private until the explicit sync confirmation', async () => {
    const sync = vi.fn().mockResolvedValue(undefined)
    await act(async () => {
      root.render(
        <LayoutQuestionContentSheet
          open
          draftId="layout-1"
          relationId="rel-1"
          item={{ ...item, stemMarkdown: '当前试卷题干' }}
          originalItem={item}
          hasOverride
          baseContentRevision={3}
          onClose={() => undefined}
          onSaveCurrent={vi.fn().mockResolvedValue(undefined)}
          onSyncToBank={sync}
        />,
      )
    })
    expect(container.textContent).toContain('题库原题尚未改变')
    const openConfirm = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('同步题库原题'))!
    await act(async () => openConfirm.click())
    expect(container.textContent).toContain('下列字段将写入正式题库')
    const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent === '确认同步')!
    await act(async () => confirm.click())
    expect(sync).toHaveBeenCalledWith(3)
  })
})
