/**
 * usePagination — 编辑器运行时的派生分页状态
 *
 * 设计约束（对应 T5 规格与接口约束 C3/C4）：
 * - 分页是派生状态（PaginationResult），绝不写回持久化文档。
 * - generation/abort 机制：每次依赖变化递增 generation 并中断上一轮，
 *   过期 generation 的测量结果一律丢弃，避免陈旧分页覆盖新分页。
 * - 字体/图片未稳定（readiness.ready=false）时禁止宣称排版完成；
 *   readiness 等待被拒绝时发布稳定的 timedOut 失败态。
 * - 防抖：编辑器内容变化后 debounceMs（默认 300ms）才触发重新测量与分页，
 *   避免逐键输入导致的抖动与重复测量。
 * - 重新测量期间保留上一份 pagination 用于平滑渲染，但 readiness 重置为
 *   preparing（ready=false），导出 readiness 因此被正确阻塞。
 * - 测量复用与独立预览完全相同的管线（measureTeachingDocument 等），
 *   保证编辑画布与打印预览/导出的分页结果一致，不复制第二套 renderer。
 */
import { useEffect, useMemo, useState } from 'react'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { choiceLayoutOverridesEqual, type ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import {
  effectivePaperMetrics,
  canUseTeachingDocumentLayoutChangeSetHint,
  createTeachingDocumentLayoutChangeSet,
  createCountingParagraphRangeGeometryAdapter,
  createTeachingDocumentLayoutSignatures,
  measuredChoiceLayoutOverrides,
  measureTeachingDocumentIncrementally,
  paginateTeachingDocument,
  waitForRenderReadiness,
  type BoxChromeGeometryAdapter,
  type GeometryAdapter,
  type PaginationResult,
  type PaperSpec,
  type ParagraphRangeGeometryAdapter,
  type PrintLayoutSpec,
  type QuestionChromeGeometryAdapter,
  type RenderReadinessResult,
} from '@/utils/teachingDocument'
import type { QuestionResolution } from '../blocks/BlockRenderer'
import { createLayoutPerformanceProfiler } from '@/utils/teachingDocument/layout/performance'
import { INITIAL_LAYOUT_REQUEST, type LayoutRequest } from './useDeferredPaginationDocument'
import {
  createLayoutCoordinatorKey,
  createLayoutCoordinatorMeasurementSignature,
  TeachingDocumentLayoutCoordinator,
  type LayoutCoordinatorSnapshot,
} from './layoutCoordinator'

const PREPARING_READINESS: RenderReadinessResult = {
  ready: false,
  timedOut: false,
  pendingFonts: true,
  pendingImages: [],
  pendingQuestions: [],
  pendingFigures: [],
  failedImages: [],
  diagnostics: [],
}

export interface UsePaginationOptions {
  document: TeachingDocumentV1
  paper: PaperSpec
  printLayout: PrintLayoutSpec
  /** 隐藏测量渲染根（TeachingDocumentRenderer 的容器），为 null 时不分页。 */
  measureRoot: HTMLElement | null
  resolveQuestion?: (questionId: string) => QuestionResolution
  /** 字体 CSS 变量；变化时触发重新测量（与渲染同步生效）。 */
  fontVars?: Record<string, string>
  /** 资源版本号（题目/图片装载状态）；变化时触发重新测量。 */
  renderVersion?: string
  /** 内容变化后的防抖毫秒数，默认 300。 */
  debounceMs?: number
  /** 测试注入点：JSDOM 不提供真实 geometry。 */
  geometryAdapter?: GeometryAdapter
  paragraphGeometryAdapter?: ParagraphRangeGeometryAdapter
  boxGeometryAdapter?: BoxChromeGeometryAdapter
  questionGeometryAdapter?: QuestionChromeGeometryAdapter
  readinessWait?: typeof waitForRenderReadiness
  layoutRequest?: LayoutRequest
  /** 文档级布局协调器；省略时使用当前 hook 实例的本地协调器。 */
  coordinator?: TeachingDocumentLayoutCoordinator
}

export interface UsePaginationResult {
  /** 最近一次完成的分页结果；重新测量期间保留上一份以避免闪烁。 */
  pagination: PaginationResult | null
  readiness: RenderReadinessResult
  /** 当前 measurement generation，单调递增。 */
  generation: number
  paragraphLineCount: number
  /** 分页结果是否属于当前依赖（即最近一轮测量已完成）。 */
  settled: boolean
  /** 已由真实 DOM 宽度确认的题目选项列数。 */
  choiceLayoutOverrides: ChoiceLayoutOverrides
}

export function usePagination(options: UsePaginationOptions): UsePaginationResult {
  const {
    document,
    paper,
    printLayout,
    measureRoot,
    resolveQuestion,
    fontVars,
    renderVersion,
    debounceMs: debounceMsOption,
    geometryAdapter,
    paragraphGeometryAdapter,
    boxGeometryAdapter,
    questionGeometryAdapter,
    readinessWait = waitForRenderReadiness,
    layoutRequest = INITIAL_LAYOUT_REQUEST,
    coordinator: coordinatorOption,
  } = options
  const debounceMs = debounceMsOption ?? (layoutRequest.reason === 'typing' ? 300 : 0)

  // 页眉页脚参与分页有效高度，与独立预览保持同一扣除语义。
  const metrics = useMemo(() => effectivePaperMetrics(printLayout), [printLayout])

  const [localCoordinator] = useState(() => new TeachingDocumentLayoutCoordinator())
  const coordinator = coordinatorOption ?? localCoordinator
  const [pagination, setPagination] = useState<PaginationResult | null>(null)
  const [readiness, setReadiness] = useState<RenderReadinessResult>(PREPARING_READINESS)
  const [generation, setGeneration] = useState(0)
  const [paragraphLineCount, setParagraphLineCount] = useState(0)
  const [settled, setSettled] = useState(false)
  const [choiceLayoutOverrides, setChoiceLayoutOverrides] = useState<ChoiceLayoutOverrides>({})

  const layoutSignatures = useMemo(() => createTeachingDocumentLayoutSignatures({
    document,
    paper,
    printLayout,
    fontVars,
    renderVersion,
    spread: false,
  }), [document, fontVars, paper, printLayout, renderVersion])
  const geometryDependencies = [
    geometryAdapter,
    paragraphGeometryAdapter,
    boxGeometryAdapter,
    questionGeometryAdapter,
  ]
  const coordinatorKey = createLayoutCoordinatorKey(layoutSignatures.paginationSignature, geometryDependencies)
  const measurementStyleSignature = createLayoutCoordinatorMeasurementSignature(
    layoutSignatures.layoutStyleSignature,
    geometryDependencies,
  )

  useEffect(() => {
    if (coordinator.getSnapshot(coordinatorKey)) return
    setChoiceLayoutOverrides((current) => Object.keys(current).length ? {} : current)
  }, [coordinator, coordinatorKey])

  useEffect(() => {
    if (!measureRoot) return
    let live = true
    const previousSnapshot = coordinator.getLatestSnapshot(layoutSignatures.variant)
    const canUseTransactionChangeSet = previousSnapshot
      && layoutRequest.changeSet
      && previousSnapshot.layoutStyleSignature === measurementStyleSignature
      && previousSnapshot.resourceRevision === layoutSignatures.resourceRevision
      && previousSnapshot.document.title === document.title
      && canUseTeachingDocumentLayoutChangeSetHint(previousSnapshot.document, document, layoutRequest.changeSet)
    const changeSet = canUseTransactionChangeSet
      ? layoutRequest.changeSet!
      : createTeachingDocumentLayoutChangeSet({
          previous: previousSnapshot?.document ?? null,
          current: document,
          previousLayoutStyleSignature: previousSnapshot?.layoutStyleSignature,
          currentLayoutStyleSignature: measurementStyleSignature,
          previousResourceRevision: previousSnapshot?.resourceRevision,
          currentResourceRevision: layoutSignatures.resourceRevision,
        })
    const incrementalPagination = previousSnapshot?.pagination
      && changeSet.firstDirtyTopLevelIndex > 0
      && !changeSet.paperOrGlobalStyleChanged
      && changeSet.resourceIdsChanged.length === 0
      ? {
          previous: previousSnapshot.pagination,
          firstDirtyTopLevelIndex: changeSet.firstDirtyTopLevelIndex,
        }
      : undefined
    const handle = coordinator.request({
      key: coordinatorKey,
      documentRevision: layoutSignatures.documentRevision,
      resourceRevision: layoutSignatures.resourceRevision,
      layoutStyleSignature: measurementStyleSignature,
      variant: layoutSignatures.variant,
      execute: async ({ generation: currentGeneration, signal }) => {
        const profiler = createLayoutPerformanceProfiler({
          pipeline: 'editor',
          generation: currentGeneration,
          metadata: {
            blockCount: document.content.length,
            debounceMs,
            resourceRevision: layoutSignatures.resourceRevision,
            paginationSignature: layoutSignatures.paginationSignature,
            cacheHit: false,
            reason: layoutRequest.reason,
            priority: layoutRequest.priority,
            firstDirtyTopLevelIndex: changeSet.firstDirtyTopLevelIndex,
            incrementalPagination: Boolean(incrementalPagination),
          },
        })
        try {
          const endScheduleWait = profiler.startPhase('schedule-wait')
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = window.setTimeout(resolve, Math.max(0, debounceMs))
              signal.addEventListener('abort', () => {
                window.clearTimeout(timer)
                reject(new DOMException('Layout request aborted', 'AbortError'))
              }, { once: true })
            })
          } finally {
            endScheduleWait()
          }

          const cachedResourceReadiness = coordinator.getResourceReadiness(layoutSignatures.resourceRevision)
          profiler.addMetadata({ resourceCacheHit: Boolean(cachedResourceReadiness) })
          const endResourceWait = profiler.startPhase('resource-wait')
          let nextReadiness: RenderReadinessResult
          try {
            nextReadiness = cachedResourceReadiness ?? await readinessWait(measureRoot, {
              timeoutMs: 8_000,
              stableFrames: 2,
              signal,
            })
          } finally {
            endResourceWait()
          }
          if (signal.aborted) throw new DOMException('Layout request aborted', 'AbortError')
          coordinator.cacheResourceReadiness(layoutSignatures.resourceRevision, nextReadiness)

          const measuredLayouts = profiler.measure('choice-layout', () => (
            measuredChoiceLayoutOverrides(measureRoot, choiceLayoutOverrides)
          ))
          if (!choiceLayoutOverridesEqual(measuredLayouts, choiceLayoutOverrides)) {
            profiler.finish('retry')
            return { status: 'retry' as const, choiceLayoutOverrides: measuredLayouts }
          }

          const paragraphGeometryCounter = profiler.enabled
            ? createCountingParagraphRangeGeometryAdapter(paragraphGeometryAdapter)
            : null
          const incrementalMeasurement = profiler.measure('dom-measurement', () => (
            measureTeachingDocumentIncrementally({
              root: measureRoot,
              document,
              cache: coordinator.getMeasurementCache(),
              layoutStyleSignature: measurementStyleSignature,
              variant: layoutSignatures.variant,
              resourceRevision: layoutSignatures.resourceRevision,
              adapters: {
                geometry: geometryAdapter,
                paragraphGeometry: paragraphGeometryCounter?.adapter ?? paragraphGeometryAdapter,
                boxGeometry: boxGeometryAdapter,
                questionGeometry: questionGeometryAdapter,
              },
              resolveQuestion,
              choiceLayoutOverrides,
              cacheable: nextReadiness.ready && !nextReadiness.timedOut,
            })
          ))
          const bundle = incrementalMeasurement.bundle
          profiler.addMetadata({
            measuredBlockCount: incrementalMeasurement.measuredBlockCount,
            measurementCacheHitBlockCount: incrementalMeasurement.cacheHitBlockCount,
          })
          if (paragraphGeometryCounter) {
            profiler.addMetadata({
              paragraphTextRangeCalls: paragraphGeometryCounter.stats.textRangeCalls,
              paragraphTextProbeCalls: paragraphGeometryCounter.stats.textProbeCalls,
              paragraphAtomicRectCalls: paragraphGeometryCounter.stats.atomicCalls,
            })
          }
          const { measurement, paragraphs: paragraphMeasurements, boxes: boxMeasurements, questions: questionMeasurements, boxChildQuestions: boxChildQuestionMeasurements, boxChildRawMarkdowns: boxChildRawMarkdownMeasurements } = bundle
          measurement.diagnostics.push(...nextReadiness.diagnostics)
          if (signal.aborted) throw new DOMException('Layout request aborted', 'AbortError')
          const nextParagraphLineCount = paragraphMeasurements.reduce((total, item) => total + item.lines.length, 0)
          const result = profiler.measure('pagination', () => paginateTeachingDocument({
            document,
            measurements: measurement,
            paragraphMeasurements,
            boxMeasurements,
            questionMeasurements,
            boxChildQuestionMeasurements,
            boxChildRawMarkdownMeasurements,
            paper,
            metrics,
            incremental: incrementalPagination,
          }))
          const reusedPageCount = incrementalPagination
            ? result.pages.findIndex((page, index) => page !== incrementalPagination.previous.pages[index])
            : 0
          profiler.addMetadata({
            reusedPageCount: reusedPageCount < 0 ? result.pages.length : reusedPageCount,
          })
          profiler.finish('settled')
          return {
            status: 'settled' as const,
            document,
            pagination: result,
            readiness: nextReadiness,
            paragraphLineCount: nextParagraphLineCount,
            choiceLayoutOverrides,
          }
        } catch (error) {
          if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            profiler.finish('aborted')
            throw error
          }
          const failedReadiness: RenderReadinessResult = {
            ...PREPARING_READINESS,
            timedOut: true,
            diagnostics: [{
              code: 'resource-timeout',
              severity: 'error',
              message: error instanceof Error ? error.message : '排版资源准备失败。',
            }],
          }
          profiler.finish('failed')
          return {
            status: 'failed' as const,
            document,
            pagination: null,
            readiness: failedReadiness,
            paragraphLineCount: 0,
            choiceLayoutOverrides,
          }
        }
      },
    })

    setGeneration(handle.generation)
    if (handle.cacheHit) {
      const cachedSnapshot = coordinator.getSnapshot(coordinatorKey)
      if (cachedSnapshot) {
        setPagination(cachedSnapshot.pagination)
        setReadiness(cachedSnapshot.readiness)
        setParagraphLineCount(cachedSnapshot.paragraphLineCount)
        setChoiceLayoutOverrides(cachedSnapshot.choiceLayoutOverrides)
        setSettled(cachedSnapshot.status === 'settled')
      }
      const profiler = createLayoutPerformanceProfiler({
        pipeline: 'editor',
        generation: handle.generation,
        metadata: {
          blockCount: document.content.length,
          cacheHit: true,
          resourceRevision: layoutSignatures.resourceRevision,
          paginationSignature: layoutSignatures.paginationSignature,
        },
      })
      profiler.finish('settled')
    } else {
      // 保留上一份 pagination 供平滑渲染，但 readiness 立即阻塞导出。
      setReadiness(PREPARING_READINESS)
      setSettled(false)
    }
    void handle.promise.then((result) => {
      if (!live) return
      if (result.status === 'retry') {
        setChoiceLayoutOverrides(result.choiceLayoutOverrides)
        return
      }
      const snapshot = result as LayoutCoordinatorSnapshot
      setPagination(snapshot.pagination)
      setReadiness(snapshot.readiness)
      setParagraphLineCount(snapshot.paragraphLineCount)
      setChoiceLayoutOverrides(snapshot.choiceLayoutOverrides)
      setSettled(snapshot.status === 'settled')
    }).catch((error) => {
      if (!live || (error instanceof DOMException && error.name === 'AbortError')) return
      setSettled(false)
    })

    return () => {
      live = false
      handle.release()
    }
  }, [
    measureRoot,
    document,
    paper,
    metrics,
    resolveQuestion,
    fontVars,
    renderVersion,
    debounceMs,
    geometryAdapter,
    paragraphGeometryAdapter,
    boxGeometryAdapter,
    questionGeometryAdapter,
    readinessWait,
    choiceLayoutOverrides,
    layoutRequest.priority,
    layoutRequest.reason,
    layoutRequest.changeSet,
    layoutSignatures.documentRevision,
    layoutSignatures.layoutStyleSignature,
    layoutSignatures.paginationSignature,
    layoutSignatures.resourceRevision,
    layoutSignatures.variant,
    measurementStyleSignature,
    coordinatorKey,
    coordinator,
  ])

  return { pagination, readiness, generation, paragraphLineCount, settled, choiceLayoutOverrides }
}
