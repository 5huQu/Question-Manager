import { describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import type { PaginationResult, RenderReadinessResult } from '@/utils/teachingDocument'
import { TeachingDocumentLayoutCoordinator, type LayoutCoordinatorWorkResult } from './layoutCoordinator'

const document: TeachingDocumentV1 = {
  version: 1,
  documentType: 'worksheet',
  title: '',
  metadata: {},
  content: [],
}

const readiness: RenderReadinessResult = {
  ready: true,
  timedOut: false,
  pendingFonts: false,
  pendingImages: [],
  pendingQuestions: [],
  pendingFigures: [],
  failedImages: [],
  diagnostics: [],
}

const pagination: PaginationResult = {
  pages: [],
  diagnostics: [],
  measurementVersion: 'm',
  paragraphMeasurementVersion: 'p',
  boxMeasurementVersion: 'b',
  questionMeasurementVersion: 'q',
}

function settled(): LayoutCoordinatorWorkResult {
  return {
    status: 'settled',
    document,
    pagination,
    readiness,
    paragraphLineCount: 0,
    choiceLayoutOverrides: {},
  }
}

function requestInput(key: string, execute: () => Promise<LayoutCoordinatorWorkResult>) {
  return {
    key,
    documentRevision: `document-${key}`,
    resourceRevision: 'resources',
    layoutStyleSignature: 'style',
    variant: 'source' as const,
    execute,
  }
}

describe('TeachingDocumentLayoutCoordinator', () => {
  it('deduplicates simultaneous requests for one layout key', async () => {
    let release: ((result: LayoutCoordinatorWorkResult) => void) | undefined
    const execute = vi.fn(() => new Promise<LayoutCoordinatorWorkResult>((resolve) => { release = resolve }))
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const first = coordinator.request(requestInput('same', execute))
    const second = coordinator.request(requestInput('same', execute))

    expect(execute).toHaveBeenCalledTimes(0)
    expect(second.shared).toBe(true)
    await Promise.resolve()
    release?.(settled())
    await expect(first.promise).resolves.toMatchObject({ status: 'settled', key: 'same' })
    await expect(second.promise).resolves.toMatchObject({ status: 'settled', key: 'same' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps settled snapshots after consumers release and serves warm cache', async () => {
    const execute = vi.fn(async () => settled())
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const first = coordinator.request(requestInput('cached', execute))
    await first.promise
    first.release()
    const warm = coordinator.request(requestInput('cached', execute))

    expect(warm.cacheHit).toBe(true)
    await expect(warm.promise).resolves.toMatchObject({ key: 'cached', status: 'settled' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('prevents an older generation from overwriting a newer snapshot', async () => {
    const completions = new Map<string, (result: LayoutCoordinatorWorkResult) => void>()
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const events = vi.fn()
    coordinator.subscribe(events)
    const old = coordinator.request(requestInput('old', () => new Promise((resolve) => completions.set('old', resolve))))
    await Promise.resolve()
    const current = coordinator.request(requestInput('current', () => new Promise((resolve) => completions.set('current', resolve))))
    await Promise.resolve()
    completions.get('current')?.(settled())
    await expect(current.promise).resolves.toMatchObject({ key: 'current' })
    completions.get('old')?.(settled())
    await expect(old.promise).rejects.toMatchObject({ name: 'AbortError' })

    expect(coordinator.getSnapshot('old')).toBeNull()
    expect(coordinator.getSnapshot('current')).toMatchObject({ status: 'settled' })
    expect(events.mock.calls.some(([event]) => event.key === 'current' && event.status === 'settled')).toBe(true)
  })

  it('retains stable resource readiness independently from pagination snapshots', () => {
    const coordinator = new TeachingDocumentLayoutCoordinator()
    coordinator.cacheResourceReadiness('r1', { ...readiness, failedImages: ['missing.png'] })
    expect(coordinator.getResourceReadiness('r1')?.failedImages).toEqual(['missing.png'])
    expect(coordinator.getSnapshot('r1')).toBeNull()
  })

  it('exposes the latest same-variant snapshot and one shared measurement cache', async () => {
    const coordinator = new TeachingDocumentLayoutCoordinator()
    await coordinator.request(requestInput('first', async () => settled())).promise
    await coordinator.request(requestInput('second', async () => settled())).promise

    expect(coordinator.getLatestSnapshot('source')).toMatchObject({ key: 'second' })
    expect(coordinator.getLatestSnapshot('student')).toBeNull()
    expect(coordinator.getMeasurementCache()).toBe(coordinator.getMeasurementCache())
  })

  it('does not cache an incomplete choice-layout retry', async () => {
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const execute = vi.fn()
      .mockResolvedValueOnce({ status: 'retry', choiceLayoutOverrides: { question: 2 } })
      .mockResolvedValueOnce(settled())

    const retry = coordinator.request(requestInput('choice-retry', execute))
    await expect(retry.promise).resolves.toMatchObject({ status: 'retry' })
    expect(coordinator.getSnapshot('choice-retry')).toBeNull()

    const completed = coordinator.request(requestInput('choice-retry', execute))
    expect(completed.cacheHit).toBe(false)
    await expect(completed.promise).resolves.toMatchObject({ status: 'settled' })
    expect(coordinator.getSnapshot('choice-retry')).toMatchObject({ status: 'settled' })
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
