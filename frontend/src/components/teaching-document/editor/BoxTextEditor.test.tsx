import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ParagraphBlock } from '@/types/teachingDocument'
import { BoxTextEditor } from './BoxTextEditor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('BoxTextEditor', () => {
  it('将相邻段落作为一个连续编辑区，Enter 创建新段落', async () => {
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<BoxTextEditor paragraphs={[{ type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '第一段' }] }]} onChange={onChange} />)
    })
    const editor = container.querySelector<HTMLElement>('[data-box-text-editor]')
    expect(editor).toBeTruthy()
    await act(async () => {
      editor!.focus()
      editor!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    const latest = onChange.mock.calls.at(-1)?.[0] as ParagraphBlock[]
    expect(latest).toHaveLength(2)
    expect(latest.map((paragraph) => paragraph.id)).toEqual(['p1', expect.any(String)])
  })

  it('为每个连续段落输出业务块 id，供悬停插入锚点定位', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<BoxTextEditor paragraphs={[
        { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '第一段' }] },
        { type: 'paragraph', id: 'p2', content: [{ type: 'text', text: '第二段' }] },
      ]} onChange={vi.fn()} />)
    })
    const paragraphNodes = container.querySelectorAll('[data-box-text-editor] p')
    expect(paragraphNodes[0]?.getAttribute('data-block-id')).toBe('p1')
    expect(paragraphNodes[1]?.getAttribute('data-block-id')).toBe('p2')
  })
})
