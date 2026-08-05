import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePreviewPageWindow } from './usePreviewPageWindow'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function WindowHarness({ unitCount, target }: { unitCount: number; target?: number }) {
  const window = usePreviewPageWindow({
    unitCount,
    active: true,
    targetUnitIndexes: [target],
  })
  return Array.from({ length: unitCount }, (_, index) => (
    <div
      key={index}
      ref={window.refForUnit(index)}
      data-teaching-preview-unit-index={index}
      data-mounted={window.mountedUnitIndexes.has(index) ? 'true' : 'false'}
    />
  ))
}

describe('usePreviewPageWindow', () => {
  let root: ReturnType<typeof createRoot> | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    vi.unstubAllGlobals()
  })

  it('moves the buffered mount window with observed visibility', async () => {
    let notify: IntersectionObserverCallback | null = null
    const disconnect = vi.fn()
    class FakeIntersectionObserver {
      readonly root = null
      readonly rootMargin = '100% 0px'
      readonly thresholds = [0]
      constructor(callback: IntersectionObserverCallback) {
        notify = callback
      }
      observe() {}
      unobserve() {}
      disconnect() { disconnect() }
      takeRecords() { return [] }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)

    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(<WindowHarness unitCount={12} />)
    })
    expect(container.querySelectorAll('[data-mounted="true"]')).toHaveLength(3)

    const first = container.querySelector<HTMLElement>('[data-teaching-preview-unit-index="0"]')!
    const sixth = container.querySelector<HTMLElement>('[data-teaching-preview-unit-index="5"]')!
    await act(async () => {
      notify?.([
        { target: first, isIntersecting: false } as unknown as IntersectionObserverEntry,
        { target: sixth, isIntersecting: true } as unknown as IntersectionObserverEntry,
      ], {} as IntersectionObserver)
    })

    const mounted = Array.from(container.querySelectorAll<HTMLElement>('[data-mounted="true"]'))
      .map((node) => Number(node.dataset.teachingPreviewUnitIndex))
    expect(mounted).toEqual([3, 4, 5, 6, 7])
    act(() => root?.unmount())
    root = null
    expect(disconnect).toHaveBeenCalled()
  })

  it('keeps an explicit navigation target mounted outside the visible window', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(<WindowHarness unitCount={12} target={10} />)
    })

    const mounted = Array.from(container.querySelectorAll<HTMLElement>('[data-mounted="true"]'))
      .map((node) => Number(node.dataset.teachingPreviewUnitIndex))
    expect(mounted).toEqual([0, 1, 2, 8, 9, 10, 11])
  })
})
