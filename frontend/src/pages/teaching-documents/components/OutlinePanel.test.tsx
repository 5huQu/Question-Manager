import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { OutlinePanel } from './OutlinePanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const source: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '侧栏动画测试',
  metadata: {},
  content: [{ type: 'paragraph', id: 'paragraph-1', content: [{ type: 'text', text: '正文' }] }],
}

describe('OutlinePanel dock motion', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  async function render(open: boolean) {
    await act(async () => {
      root?.render(
        <OutlinePanel
          variant="docked"
          open={open}
          document={source}
          selectedId=""
          issues={[]}
          onClose={vi.fn()}
          onOpen={vi.fn()}
          onSelect={vi.fn()}
          onFixIds={vi.fn()}
        />,
      )
    })
  }

  it('uses discrete dock widths instead of animating layout width', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await render(false)
    const dock = container.querySelector<HTMLElement>('[data-teaching-outline-dock]')
    expect(dock?.className).toContain('w-11')
    expect(dock?.style.width).toBe('')

    await render(true)
    expect(dock?.className).toContain('w-64')
    expect(dock?.dataset.teachingDockOccupied).toBe('true')
    expect(dock?.style.width).toBe('')

    await render(false)
    expect(dock?.className).toContain('w-64')
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
    })
    expect(dock?.className).toContain('w-11')
    expect(dock?.dataset.teachingDockOccupied).toBe('false')
  })
})
