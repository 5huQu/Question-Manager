import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuestionContentEditor } from './QuestionContentEditor'

describe('QuestionContentEditor scroll ownership', () => {
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

  it('can delegate scrolling to its parent so editor toolbars remain sticky there', async () => {
    await act(async () => {
      root.render(<QuestionContentEditor
        entityKey="candidate:scroll"
        contentScroll="parent"
        value={{ stemMarkdown: '题干', answerText: '', analysisMarkdown: '解析' }}
        onChange={() => undefined}
      />)
    })

    const editorRoot = container.firstElementChild as HTMLElement
    expect(editorRoot.className).toContain('overflow-visible')
    expect(container.querySelector<HTMLElement>('[data-editor-toolbar]')?.className).toContain('sticky')
  })
})
