import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisibilityAwarePolling } from './useVisibilityAwarePolling'

let container: HTMLDivElement
let root: Root

function Harness({ task, enabled = true, onError }: { task: (signal: AbortSignal) => Promise<void>; enabled?: boolean; onError?: (error: unknown) => void }) {
  useVisibilityAwarePolling(task, { enabled, intervalMs: 1_000, immediate: true, onError })
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('useVisibilityAwarePolling', () => {
  it('waits for the current request before scheduling the next one', async () => {
    let resolveFirst!: () => void
    const task = vi.fn(() => new Promise<void>((resolve) => { resolveFirst = resolve }))
    act(() => root.render(<Harness task={task} />))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(task).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(task).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('aborts active work while hidden and resumes when visible', async () => {
    const signals: AbortSignal[] = []
    const task = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<void>(() => undefined)
    })
    act(() => root.render(<Harness task={task} />))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(signals[0].aborted).toBe(true)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('reports failures without stopping later polls', async () => {
    const failure = new Error('network unavailable')
    const onError = vi.fn()
    const task = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    act(() => root.render(<Harness task={task} onError={onError} />))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(onError).toHaveBeenCalledWith(failure)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(task).toHaveBeenCalledTimes(2)
  })
})
