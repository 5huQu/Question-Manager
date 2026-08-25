import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorTopBar } from './EditorTopBar'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('EditorTopBar', () => {
  it('uses an internal anchor for the Document Style destination', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(
      <EditorTopBar
        documentTitle="函数讲义"
        saveState="saved"
        canUndo={false}
        canRedo={false}
        canvasMode="paginated"
        zoom={1}
        onBack={vi.fn()}
        onTitleChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onCanvasModeChange={vi.fn()}
        onZoomChange={vi.fn()}
        onInsert={vi.fn()}
        styleHref="/teaching-documents/doc-1/style"
      />,
    ))
    const link = Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).find((anchor) => anchor.textContent?.includes('文档样式'))
    expect(link?.getAttribute('href')).toBe('/teaching-documents/doc-1/style')
  })
})
