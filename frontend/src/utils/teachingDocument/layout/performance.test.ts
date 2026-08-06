import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearTeachingDocumentLayoutPerformance,
  createLayoutPerformanceProfiler,
  LAYOUT_PERFORMANCE_EVENT,
} from './performance'

describe('teaching document layout performance profiler', () => {
  afterEach(() => {
    window.__QUESTION_MANAGER_LAYOUT_PERF__ = false
    clearTeachingDocumentLayoutPerformance()
    vi.restoreAllMocks()
  })

  it('does not retain traces unless profiling is explicitly enabled', () => {
    const profiler = createLayoutPerformanceProfiler({ pipeline: 'editor', generation: 1 })
    profiler.measure('pagination', () => 42)
    profiler.finish('settled')
    expect(window.__QUESTION_MANAGER_LAYOUT_TRACES__).toBeUndefined()
  })

  it('records phases and publishes a completed trace', () => {
    window.__QUESTION_MANAGER_LAYOUT_PERF__ = true
    const listener = vi.fn()
    window.addEventListener(LAYOUT_PERFORMANCE_EVENT, listener)

    const profiler = createLayoutPerformanceProfiler({
      pipeline: 'preview',
      generation: 3,
      metadata: { blockCount: 100, variant: 'teacher' },
    })
    expect(profiler.measure('dom-measurement', () => 'measured')).toBe('measured')
    profiler.addMetadata({ paragraphTextRangeCalls: 180, paragraphTextProbeCalls: 42 })
    profiler.finish('settled')

    expect(window.__QUESTION_MANAGER_LAYOUT_TRACES__).toHaveLength(1)
    expect(window.__QUESTION_MANAGER_LAYOUT_TRACES__?.[0]).toMatchObject({
      pipeline: 'preview',
      generation: 3,
      status: 'settled',
      metadata: {
        blockCount: 100,
        variant: 'teacher',
        paragraphTextRangeCalls: 180,
        paragraphTextProbeCalls: 42,
      },
    })
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(LAYOUT_PERFORMANCE_EVENT, listener)
  })
})
