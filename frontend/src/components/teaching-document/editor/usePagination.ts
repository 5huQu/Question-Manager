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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { choiceLayoutOverridesEqual, type ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import {
  effectivePaperMetrics,
  measuredChoiceLayoutOverrides,
  measureTeachingDocumentAll,
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
  } = options
  const debounceMs = debounceMsOption ?? (layoutRequest.reason === 'typing' ? 300 : 0)

  // 页眉页脚参与分页有效高度，与独立预览保持同一扣除语义。
  const metrics = useMemo(() => effectivePaperMetrics(printLayout), [printLayout])

  const generationRef = useRef(0)
  const [pagination, setPagination] = useState<PaginationResult | null>(null)
  const [readiness, setReadiness] = useState<RenderReadinessResult>(PREPARING_READINESS)
  const [generation, setGeneration] = useState(0)
  const [paragraphLineCount, setParagraphLineCount] = useState(0)
  const [settled, setSettled] = useState(false)
  const [choiceLayoutOverrides, setChoiceLayoutOverrides] = useState<ChoiceLayoutOverrides>({})

  useEffect(() => {
    setChoiceLayoutOverrides((current) => Object.keys(current).length ? {} : current)
  }, [document, renderVersion])

  useEffect(() => {
    if (!measureRoot) return
    const currentGeneration = generationRef.current + 1
    generationRef.current = currentGeneration
    const controller = new AbortController()
    const profiler = createLayoutPerformanceProfiler({
      pipeline: 'editor',
      generation: currentGeneration,
      metadata: {
        blockCount: document.content.length,
        debounceMs,
        reason: layoutRequest.reason,
        priority: layoutRequest.priority,
      },
    })

    // 新一轮开始：重置 readiness（阻塞导出）、标记未 settled，
    // 但保留上一份 pagination 供平滑渲染。
    setReadiness(PREPARING_READINESS)
    setSettled(false)
    setGeneration(currentGeneration)

    const endScheduleWait = profiler.startPhase('schedule-wait')
    const timer = window.setTimeout(() => {
      endScheduleWait()
      const endResourceWait = profiler.startPhase('resource-wait')
      void readinessWait(measureRoot, {
        timeoutMs: 8_000,
        stableFrames: 2,
        signal: controller.signal,
        })
        .then((nextReadiness) => {
          endResourceWait()
          if (controller.signal.aborted || currentGeneration !== generationRef.current) return
          setReadiness(nextReadiness)

          const measuredLayouts = profiler.measure('choice-layout', () => (
            measuredChoiceLayoutOverrides(measureRoot, choiceLayoutOverrides)
          ))
          if (!choiceLayoutOverridesEqual(measuredLayouts, choiceLayoutOverrides)) {
            setChoiceLayoutOverrides(measuredLayouts)
            profiler.finish('retry')
            return
          }

          const bundle = profiler.measure('dom-measurement', () => measureTeachingDocumentAll(
            measureRoot,
            document,
            {
              geometry: geometryAdapter,
              paragraphGeometry: paragraphGeometryAdapter,
              boxGeometry: boxGeometryAdapter,
              questionGeometry: questionGeometryAdapter,
            },
            resolveQuestion,
            choiceLayoutOverrides,
          ))
          const { measurement, paragraphs: paragraphMeasurements, boxes: boxMeasurements, questions: questionMeasurements, boxChildQuestions: boxChildQuestionMeasurements, boxChildRawMarkdowns: boxChildRawMarkdownMeasurements } = bundle
          measurement.diagnostics.push(...nextReadiness.diagnostics)
          if (controller.signal.aborted || currentGeneration !== generationRef.current) return

          setParagraphLineCount(
            paragraphMeasurements.reduce((total, item) => total + item.lines.length, 0),
          )
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
          }))
          setPagination(result)
          setSettled(true)
          profiler.finish('settled')
        })
        .catch((error) => {
          endResourceWait()
          // readiness 等待被拒绝（非中断/非过期 generation）时发布稳定失败态：
          // 标记 timedOut 使导出 readiness 被阻塞，避免悬挂的未处理 rejection。
          if (controller.signal.aborted || currentGeneration !== generationRef.current) return
          const failedReadiness: RenderReadinessResult = {
            ...PREPARING_READINESS,
            timedOut: true,
            diagnostics: [
              {
                code: 'resource-timeout',
                severity: 'error',
                message: error instanceof Error ? error.message : '排版资源准备失败。',
              },
            ],
          }
          setReadiness(failedReadiness)
          setPagination(null)
          setSettled(false)
          profiler.finish('failed')
        })
    }, Math.max(0, debounceMs))

    return () => {
      window.clearTimeout(timer)
      controller.abort()
      profiler.finish('aborted')
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
  ])

  return { pagination, readiness, generation, paragraphLineCount, settled, choiceLayoutOverrides }
}
