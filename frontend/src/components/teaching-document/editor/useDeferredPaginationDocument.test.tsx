import { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { useDeferredPaginationDocument } from './useDeferredPaginationDocument'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function documentWith(title: string): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title,
    metadata: {},
    content: [{ type: 'paragraph', id: `${title}-p`, content: [{ type: 'text', text: title }] }],
  }
}

function Harness({ document, delayMs, onState }: {
  document: TeachingDocumentV1
  delayMs: number
  onState: (state: ReturnType<typeof useDeferredPaginationDocument>) => void
}) {
  const state = useDeferredPaginationDocument(document, delayMs)
  useEffect(() => {
    onState(state)
  }, [onState, state])
  return <output data-layout-title={state.layoutDocument.title} data-layout-pending={String(state.layoutPending)} />
}

describe('useDeferredPaginationDocument', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
    vi.useRealTimers()
  })

  it('keeps the previous layout snapshot until typing becomes idle', async () => {
    const states: Array<ReturnType<typeof useDeferredPaginationDocument>> = []
    const onState = (state: ReturnType<typeof useDeferredPaginationDocument>) => states.push(state)
    const first = documentWith('初稿')
    const changed = documentWith('修改后')
    root = createRoot(container)

    await act(async () => { root?.render(<Harness document={first} delayMs={700} onState={onState} />) })
    await act(async () => { root?.render(<Harness document={changed} delayMs={700} onState={onState} />) })
    expect(container.querySelector('output')?.getAttribute('data-layout-title')).toBe('初稿')
    expect(container.querySelector('output')?.getAttribute('data-layout-pending')).toBe('true')

    await act(async () => { await vi.advanceTimersByTimeAsync(699) })
    expect(container.querySelector('output')?.getAttribute('data-layout-title')).toBe('初稿')

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(container.querySelector('output')?.getAttribute('data-layout-title')).toBe('修改后')
    expect(container.querySelector('output')?.getAttribute('data-layout-pending')).toBe('false')
    expect(states.at(-1)?.layoutDocument).toBe(changed)
  })

  it('only lays out the newest snapshot during a burst of edits', async () => {
    const onState = vi.fn()
    root = createRoot(container)
    await act(async () => { root?.render(<Harness document={documentWith('初稿')} delayMs={700} onState={onState} />) })
    await act(async () => { root?.render(<Harness document={documentWith('修改一')} delayMs={700} onState={onState} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    await act(async () => { root?.render(<Harness document={documentWith('修改二')} delayMs={700} onState={onState} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })

    expect(container.querySelector('output')?.getAttribute('data-layout-title')).toBe('修改二')
    expect(container.querySelector('output')?.getAttribute('data-layout-pending')).toBe('false')
  })
})
