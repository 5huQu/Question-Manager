import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InsertMenuPanel } from './BlockInsertMenu'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('InsertMenuPanel', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('shows sections instead of headings and forwards the selected level', async () => {
    const onPick = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<InsertMenuPanel onPick={onPick} />)
    })

    expect(container.textContent).toContain('插入章节')
    expect(container.textContent).not.toContain('标题')
    const thirdLevel = container.querySelector<HTMLButtonElement>('[title="插入三级章节"]')
    expect(thirdLevel).not.toBeNull()
    await act(async () => thirdLevel?.click())
    expect(onPick).toHaveBeenCalledWith('heading', 3)
  })
})
