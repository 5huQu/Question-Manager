import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import type { ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import type { PaginationResult, RenderReadinessResult } from '@/utils/teachingDocument'
import type { TeachingDocumentPrintVariant } from '@/utils/teachingDocument/printVariant'

export type LayoutCoordinatorVariant = TeachingDocumentPrintVariant | 'source'
export type LayoutCoordinatorStatus = 'measuring' | 'settled' | 'failed'

export interface LayoutCoordinatorSnapshot {
  key: string
  documentRevision: string
  resourceRevision: string
  variant: LayoutCoordinatorVariant
  generation: number
  status: 'settled' | 'failed'
  document: TeachingDocumentV1
  pagination: PaginationResult | null
  readiness: RenderReadinessResult
  paragraphLineCount: number
  choiceLayoutOverrides: ChoiceLayoutOverrides
}

export type LayoutCoordinatorWorkResult =
  | Omit<LayoutCoordinatorSnapshot, 'key' | 'documentRevision' | 'resourceRevision' | 'variant' | 'generation'>
  | { status: 'retry'; choiceLayoutOverrides: ChoiceLayoutOverrides }

export interface LayoutCoordinatorEvent {
  key: string
  generation: number
  status: LayoutCoordinatorStatus
  snapshot?: LayoutCoordinatorSnapshot
}

export interface LayoutCoordinatorRequest {
  key: string
  documentRevision: string
  resourceRevision: string
  variant: LayoutCoordinatorVariant
  execute(context: { generation: number; signal: AbortSignal }): Promise<LayoutCoordinatorWorkResult>
}

export interface LayoutCoordinatorRequestHandle {
  generation: number
  cacheHit: boolean
  shared: boolean
  promise: Promise<LayoutCoordinatorWorkResult | LayoutCoordinatorSnapshot>
  release(): void
}

interface InFlightLayoutRequest {
  generation: number
  controller: AbortController
  consumers: number
  promise: Promise<LayoutCoordinatorWorkResult | LayoutCoordinatorSnapshot>
}

const MAX_SNAPSHOTS = 4
const MAX_RESOURCE_REVISIONS = 8
const dependencyIdentities = new WeakMap<object, number>()
let dependencyIdentitySequence = 0

function dependencyIdentity(value: unknown) {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return String(value ?? '')
  const object = value as object
  const cached = dependencyIdentities.get(object)
  if (cached) return String(cached)
  dependencyIdentitySequence += 1
  dependencyIdentities.set(object, dependencyIdentitySequence)
  return String(dependencyIdentitySequence)
}

/** 测试注入的 geometry 实现不属于文档签名，但更换后必须使旧快照失效。 */
export function createLayoutCoordinatorKey(paginationSignature: string, geometryDependencies: unknown[]) {
  if (geometryDependencies.every((dependency) => dependency === undefined)) return paginationSignature
  return `${paginationSignature}:geometry-${geometryDependencies.map(dependencyIdentity).join('.')}`
}

function abortedError() {
  return new DOMException('Layout request aborted', 'AbortError')
}

export class TeachingDocumentLayoutCoordinator {
  private generation = 0
  private snapshots = new Map<string, LayoutCoordinatorSnapshot>()
  private resourceReadiness = new Map<string, RenderReadinessResult>()
  private inFlight = new Map<string, InFlightLayoutRequest>()
  private listeners = new Set<(event: LayoutCoordinatorEvent) => void>()

  request(input: LayoutCoordinatorRequest): LayoutCoordinatorRequestHandle {
    const cached = this.snapshots.get(input.key)
    if (cached) {
      const generation = this.nextGeneration()
      this.cancelBefore(generation)
      const snapshot = { ...cached, generation }
      this.touchSnapshot(input.key, snapshot)
      this.publish({ key: input.key, generation, status: snapshot.status, snapshot })
      return {
        generation,
        cacheHit: true,
        shared: false,
        promise: Promise.resolve(snapshot),
        release: () => undefined,
      }
    }

    const existing = this.inFlight.get(input.key)
    if (existing) {
      existing.consumers += 1
      return this.handleFor(input.key, existing, true)
    }

    const generation = this.nextGeneration()
    this.cancelBefore(generation)
    const controller = new AbortController()
    const current: InFlightLayoutRequest = {
      generation,
      controller,
      consumers: 1,
      promise: Promise.resolve({ status: 'retry', choiceLayoutOverrides: {} }),
    }
    current.promise = Promise.resolve()
      .then(() => input.execute({ generation, signal: controller.signal }))
      .then((result) => {
        if (controller.signal.aborted) throw abortedError()
        if (result.status === 'retry') return result
        const snapshot: LayoutCoordinatorSnapshot = {
          ...result,
          key: input.key,
          documentRevision: input.documentRevision,
          resourceRevision: input.resourceRevision,
          variant: input.variant,
          generation,
        }
        if (snapshot.status === 'settled') this.touchSnapshot(input.key, snapshot)
        this.publish({ key: input.key, generation, status: snapshot.status, snapshot })
        return snapshot
      })
      .finally(() => {
        if (this.inFlight.get(input.key) === current) this.inFlight.delete(input.key)
      })
    this.inFlight.set(input.key, current)
    this.publish({ key: input.key, generation, status: 'measuring' })
    return this.handleFor(input.key, current, false)
  }

  getSnapshot(key: string) {
    return this.snapshots.get(key) ?? null
  }

  getResourceReadiness(revision: string) {
    return this.resourceReadiness.get(revision) ?? null
  }

  cacheResourceReadiness(revision: string, readiness: RenderReadinessResult) {
    this.resourceReadiness.delete(revision)
    this.resourceReadiness.set(revision, readiness)
    while (this.resourceReadiness.size > MAX_RESOURCE_REVISIONS) {
      const oldestKey = this.resourceReadiness.keys().next().value
      if (!oldestKey) break
      this.resourceReadiness.delete(oldestKey)
    }
  }

  subscribe(listener: (event: LayoutCoordinatorEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  cancelBefore(generation: number) {
    this.inFlight.forEach((request) => {
      if (request.generation < generation) request.controller.abort()
    })
  }

  clear() {
    this.inFlight.forEach((request) => request.controller.abort())
    this.inFlight.clear()
    this.snapshots.clear()
    this.resourceReadiness.clear()
  }

  private nextGeneration() {
    this.generation += 1
    return this.generation
  }

  private handleFor(key: string, request: InFlightLayoutRequest, shared: boolean): LayoutCoordinatorRequestHandle {
    let released = false
    return {
      generation: request.generation,
      cacheHit: false,
      shared,
      promise: request.promise,
      release: () => {
        if (released) return
        released = true
        request.consumers = Math.max(0, request.consumers - 1)
        if (request.consumers === 0 && this.inFlight.get(key) === request) request.controller.abort()
      },
    }
  }

  private touchSnapshot(key: string, snapshot: LayoutCoordinatorSnapshot) {
    this.snapshots.delete(key)
    this.snapshots.set(key, snapshot)
    while (this.snapshots.size > MAX_SNAPSHOTS) {
      const oldestKey = this.snapshots.keys().next().value
      if (!oldestKey) break
      this.snapshots.delete(oldestKey)
    }
  }

  private publish(event: LayoutCoordinatorEvent) {
    this.listeners.forEach((listener) => listener(event))
  }
}
