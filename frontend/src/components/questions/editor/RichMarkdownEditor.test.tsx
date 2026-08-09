import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RichMarkdownEditor } from './RichMarkdownEditor'

describe('RichMarkdownEditor toolbar', () => {
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

  it('keeps the formatting and table controls in one sticky toolbar group', async () => {
    await act(async () => {
      root.render(<RichMarkdownEditor id="analysis" label="解析" value="长内容" onChange={() => undefined} />)
    })

    const toolbar = container.querySelector<HTMLElement>('[data-editor-toolbar]')
    expect(toolbar?.className).toContain('sticky')
    expect(toolbar?.className).toContain('top-0')
    expect(toolbar?.className).toContain('z-20')
    expect(toolbar?.parentElement?.className).toContain('overflow-visible')
  })

  it('keeps Markdown source mode spacious for editing', async () => {
    await act(async () => {
      root.render(<RichMarkdownEditor id="analysis" label="解析" value={'```text\n原始内容\n```'} onChange={() => undefined} />)
    })

    const source = container.querySelector<HTMLTextAreaElement>('[aria-label="解析 Markdown 源码"]')
    expect(source?.className).toContain('min-h-[28rem]')
    expect(source?.className).toContain('resize-y')
  })
})
