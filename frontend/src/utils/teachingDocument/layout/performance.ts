export type LayoutPerformancePipeline = 'editor' | 'preview'
export type LayoutPerformanceStatus = 'settled' | 'failed' | 'aborted' | 'retry'
export type LayoutPerformancePhase =
  | 'schedule-wait'
  | 'resource-wait'
  | 'choice-layout'
  | 'dom-measurement'
  | 'pagination'

export interface LayoutPerformanceTrace {
  id: string
  pipeline: LayoutPerformancePipeline
  generation: number
  status: LayoutPerformanceStatus
  startedAt: number
  duration: number
  metadata: Record<string, string | number | boolean>
  phases: Partial<Record<LayoutPerformancePhase, number>>
}

interface ActiveLayoutPerformanceTrace {
  id: string
  pipeline: LayoutPerformancePipeline
  generation: number
  startedAt: number
  metadata: Record<string, string | number | boolean>
  phases: Partial<Record<LayoutPerformancePhase, number>>
}

declare global {
  interface Window {
    __QUESTION_MANAGER_LAYOUT_PERF__?: boolean
    __QUESTION_MANAGER_LAYOUT_TRACES__?: LayoutPerformanceTrace[]
  }
}

export const LAYOUT_PERFORMANCE_EVENT = 'question-manager:layout-performance'
const MAX_RETAINED_TRACES = 100

function now() {
  return globalThis.performance?.now?.() ?? Date.now()
}

export function teachingDocumentLayoutProfilingEnabled() {
  if (typeof window === 'undefined') return false
  if (window.__QUESTION_MANAGER_LAYOUT_PERF__ === true) return true
  return new URLSearchParams(window.location.search).get('layoutPerf') === '1'
}

function publishMeasure(trace: ActiveLayoutPerformanceTrace, phase: LayoutPerformancePhase | 'total', start: number, duration: number) {
  try {
    globalThis.performance?.measure?.(`qm:layout:${trace.pipeline}:${phase}`, {
      start,
      duration,
      detail: {
        traceId: trace.id,
        generation: trace.generation,
        ...trace.metadata,
      },
    })
  } catch {
    // Older test/browser implementations may not support numeric User Timing options.
  }
}

export function createLayoutPerformanceProfiler(input: {
  pipeline: LayoutPerformancePipeline
  generation: number
  metadata?: Record<string, string | number | boolean>
}) {
  const enabled = teachingDocumentLayoutProfilingEnabled()
  const trace: ActiveLayoutPerformanceTrace = {
    id: `${input.pipeline}-${input.generation}-${Math.round(now() * 1000)}`,
    pipeline: input.pipeline,
    generation: input.generation,
    startedAt: now(),
    metadata: { ...(input.metadata ?? {}) },
    phases: {},
  }
  let finished = false

  const startPhase = (phase: LayoutPerformancePhase) => {
    if (!enabled) return () => undefined
    const startedAt = now()
    let ended = false
    return () => {
      if (ended || finished) return
      ended = true
      const duration = Math.max(0, now() - startedAt)
      trace.phases[phase] = (trace.phases[phase] ?? 0) + duration
      publishMeasure(trace, phase, startedAt, duration)
    }
  }

  const measure = <T,>(phase: LayoutPerformancePhase, operation: () => T): T => {
    const end = startPhase(phase)
    try {
      return operation()
    } finally {
      end()
    }
  }

  const addMetadata = (metadata: Record<string, string | number | boolean>) => {
    if (!enabled || finished) return
    Object.assign(trace.metadata, metadata)
  }

  const finish = (status: LayoutPerformanceStatus) => {
    if (!enabled || finished) return
    finished = true
    const duration = Math.max(0, now() - trace.startedAt)
    const result: LayoutPerformanceTrace = { ...trace, status, duration }
    publishMeasure(trace, 'total', trace.startedAt, duration)
    const retained = [...(window.__QUESTION_MANAGER_LAYOUT_TRACES__ ?? []), result]
      .slice(-MAX_RETAINED_TRACES)
    window.__QUESTION_MANAGER_LAYOUT_TRACES__ = retained
    window.dispatchEvent(new CustomEvent<LayoutPerformanceTrace>(LAYOUT_PERFORMANCE_EVENT, { detail: result }))
  }

  return { enabled, startPhase, measure, addMetadata, finish }
}

export function clearTeachingDocumentLayoutPerformance() {
  if (typeof window !== 'undefined') window.__QUESTION_MANAGER_LAYOUT_TRACES__ = []
  globalThis.performance?.clearMeasures?.('qm:layout:editor:schedule-wait')
  globalThis.performance?.clearMeasures?.('qm:layout:editor:resource-wait')
  globalThis.performance?.clearMeasures?.('qm:layout:editor:choice-layout')
  globalThis.performance?.clearMeasures?.('qm:layout:editor:dom-measurement')
  globalThis.performance?.clearMeasures?.('qm:layout:editor:pagination')
  globalThis.performance?.clearMeasures?.('qm:layout:editor:total')
  globalThis.performance?.clearMeasures?.('qm:layout:preview:resource-wait')
  globalThis.performance?.clearMeasures?.('qm:layout:preview:choice-layout')
  globalThis.performance?.clearMeasures?.('qm:layout:preview:dom-measurement')
  globalThis.performance?.clearMeasures?.('qm:layout:preview:pagination')
  globalThis.performance?.clearMeasures?.('qm:layout:preview:total')
}
