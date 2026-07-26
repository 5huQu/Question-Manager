import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeachingDocumentAutosave, type AutosaveState } from './autosave'

afterEach(() => vi.useRealTimers())

describe('TeachingDocumentAutosave', () => {
  it('debounces changes and saves only the latest value', async () => {
    vi.useFakeTimers()
    let value = 'a'
    const writes: string[] = []
    const states: AutosaveState[] = []
    const autosave = new TeachingDocumentAutosave(() => value, async (next) => { writes.push(next) }, (state) => states.push(state), 500)
    autosave.changed()
    value = 'ab'
    autosave.changed()
    await vi.advanceTimersByTimeAsync(499)
    expect(writes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual(['ab'])
    expect(states.at(-1)).toBe('saved')
  })

  it('serializes writes when content changes during an in-flight save', async () => {
    let value = 'first'
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const writes: string[] = []
    const autosave = new TeachingDocumentAutosave(
      () => value,
      async (next) => { writes.push(next); if (writes.length === 1) await gate },
      () => undefined,
      0,
    )
    autosave.changed()
    const first = autosave.flush()
    value = 'second'
    autosave.changed()
    release()
    await first
    expect(writes).toEqual(['first', 'second'])
  })

  it('reports failures without dropping local data and stops after a conflict', async () => {
    const states: AutosaveState[] = []
    let attempts = 0
    const autosave = new TeachingDocumentAutosave(
      () => 'local',
      async () => {
        attempts += 1
        if (attempts === 1) throw new Error('offline')
        throw Object.assign(new Error('conflict'), { status: 409 })
      },
      (state) => states.push(state),
      0,
    )
    autosave.changed()
    await autosave.flush()
    expect(states.at(-1)).toBe('failed')
    autosave.changed()
    await autosave.flush()
    expect(states.at(-1)).toBe('conflict')
    await autosave.flush()
    expect(attempts).toBe(2)
  })
})
