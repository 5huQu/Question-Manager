import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, LoaderCircle, MapPin } from 'lucide-react'
import type { FigureAssetRef, TeachingDocumentV1 } from '@/types/teachingDocument'
import { choiceLayoutOverridesEqual, type ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import {
  resolveDocumentPaper,
  createTeachingDocumentLayoutChangeSet,
  createTeachingDocumentLayoutSignatures,
  measuredChoiceLayoutOverrides,
  measureTeachingDocumentIncrementally,
  paginateTeachingDocument,
  createDefaultPrintLayout,
  createCountingParagraphRangeGeometryAdapter,
  effectivePaperMetrics,
  isA3LandscapeSpread,
  paperMetrics,
  waitForRenderReadiness,
  type GeometryAdapter,
  type BoxChromeGeometryAdapter,
  type ParagraphRangeGeometryAdapter,
  type QuestionChromeGeometryAdapter,
  type PaginationResult,
  type PaperSpec,
  type PrintLayoutSpec,
  type RenderReadinessResult,
} from '@/utils/teachingDocument'
import { documentForPrintVariant, type TeachingDocumentPrintVariant } from '@/utils/teachingDocument/printVariant'
import {
  TeachingDocumentRenderer,
  type TeachingDocumentRendererProps,
} from './TeachingDocumentRenderer'
import {
  type FigureResolution,
  type QuestionResolution,
} from './blocks/BlockRenderer'
import { PaperPageView } from './PaperPageView'
import { A3TwoColumnSheetView } from './A3TwoColumnSheetView'
import { createLayoutPerformanceProfiler } from '@/utils/teachingDocument/layout/performance'
import {
  INITIAL_LAYOUT_REQUEST,
  type LayoutRequest,
} from './editor/useDeferredPaginationDocument'
import {
  createLayoutCoordinatorKey,
  createLayoutCoordinatorMeasurementSignature,
  TeachingDocumentLayoutCoordinator,
  type LayoutCoordinatorSnapshot,
} from './editor/layoutCoordinator'

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

export interface A4PaginationState {
  pagination: PaginationResult | null
  readiness: RenderReadinessResult
  measurementGeneration: number
}

export interface A4PaginationPreviewProps {
  document: TeachingDocumentV1
  resolveQuestion?: (questionId: string) => QuestionResolution
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  paper?: PaperSpec
  /** 物理纸张；A3 横向时 paper 为逻辑 A4 页，sheetPaper 为 A3 横向纸面。 */
  sheetPaper?: PaperSpec
  /** 打印布局（页眉页脚）；默认使用 createDefaultPrintLayout(paper)。 */
  printLayout?: PrintLayoutSpec
  /** 字体 CSS 变量（如 --td-body-font / --td-heading-font），注入后测量与渲染同步生效。 */
  fontVars?: Record<string, string>
  zoom?: number
  selectedBlockId?: string
  renderVersion?: string
  /**
   * 是否处于激活状态（页面级：a4 预览可见时才测量）。
   * 编辑器页常驻挂载本预览以保留分页缓存，隐藏期间不跑测量管线。
   */
  active?: boolean
  onBlockSelect?: (blockId: string, pageIndex: number) => void
  /** 诊断的明确修复入口；例如切回编辑模式并打开对应块的属性。 */
  onDiagnosticNavigate?: (blockId: string, pageIndex: number) => void
  editingChromeSlot?: { section: 'header' | 'footer'; slot: import('@/types/teachingDocument').PrintChromeSlotPosition } | null
  onChromeSlotEdit?: (section: 'header' | 'footer', slot: import('@/types/teachingDocument').PrintChromeSlotPosition) => void
  /** 分页状态变化回调，供外部获取 pagination/readiness/generation */
  onPaginationState?: (state: A4PaginationState) => void
  /** 测试注入点：JSDOM 不提供真实 geometry。 */
  geometryAdapter?: GeometryAdapter
  paragraphGeometryAdapter?: ParagraphRangeGeometryAdapter
  boxGeometryAdapter?: BoxChromeGeometryAdapter
  questionGeometryAdapter?: QuestionChromeGeometryAdapter
  readinessWait?: typeof waitForRenderReadiness
  layoutRequest?: LayoutRequest
  /** 打印版本作为独立布局策略；源文档本身保持不变。 */
  variant?: TeachingDocumentPrintVariant
  /** 文档级布局协调器；省略时使用当前预览实例的本地协调器。 */
  coordinator?: TeachingDocumentLayoutCoordinator
}

export function A4PaginationPreview({
  document,
  resolveQuestion,
  resolveFigure,
  paper: paperProp,
  sheetPaper: sheetPaperProp,
  printLayout: printLayoutProp,
  fontVars,
  zoom = 1,
  selectedBlockId,
  renderVersion = '',
  active = true,
  onBlockSelect,
  onDiagnosticNavigate,
  editingChromeSlot,
  onChromeSlotEdit,
  onPaginationState,
  geometryAdapter,
  paragraphGeometryAdapter,
  boxGeometryAdapter,
  questionGeometryAdapter,
  readinessWait = waitForRenderReadiness,
  layoutRequest = INITIAL_LAYOUT_REQUEST,
  variant,
  coordinator: coordinatorOption,
}: A4PaginationPreviewProps) {
  const paper = useMemo(
    () => paperProp ?? resolveDocumentPaper(document.style),
    [paperProp, document.style],
  )
  const sheetPaper = sheetPaperProp ?? paper
  const spread = isA3LandscapeSpread(sheetPaper)
  const layoutDocument = useMemo(
    () => variant ? documentForPrintVariant(document, variant) : document,
    [document, variant],
  )
  const sheetMetrics = useMemo(() => paperMetrics(sheetPaper), [sheetPaper])
  const measurementRootRef = useRef<HTMLDivElement>(null)
  const [localCoordinator] = useState(() => new TeachingDocumentLayoutCoordinator())
  const coordinator = coordinatorOption ?? localCoordinator
  /** 可见页面的展示快照：重测期间保留上一对（文档，分页），避免白屏闪烁。 */
  const displayDocumentRef = useRef(layoutDocument)
  const displayChoiceLayoutOverridesRef = useRef<ChoiceLayoutOverrides>({})
  const [readiness, setReadiness] = useState<RenderReadinessResult>(PREPARING_READINESS)
  const [pagination, setPagination] = useState<PaginationResult | null>(null)
  const [measurementGeneration, setMeasurementGeneration] = useState(0)
  const [paragraphLineCount, setParagraphLineCount] = useState(0)
  const [reflowing, setReflowing] = useState(false)
  const [choiceLayoutOverrides, setChoiceLayoutOverrides] = useState<ChoiceLayoutOverrides>({})
  const printLayout = useMemo(
    () => printLayoutProp ?? createDefaultPrintLayout(paper),
    [printLayoutProp, paper],
  )
  // 页眉页脚参与分页有效高度。保守统一扣除：即使 showOnFirstPage=false，
  // 首页也扣除页眉高度（已知风险：首页页眉区域留白）。
  const metrics = useMemo(() => effectivePaperMetrics(printLayout), [printLayout])
  const layoutSignatures = useMemo(() => createTeachingDocumentLayoutSignatures({
    document,
    paper,
    printLayout,
    fontVars,
    renderVersion,
    spread,
    variant,
  }), [document, fontVars, paper, printLayout, renderVersion, spread, variant])
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
  const safeZoom = Math.min(1.5, Math.max(0.35, zoom))

  useEffect(() => {
    if (coordinator.getSnapshot(coordinatorKey)) return
    setChoiceLayoutOverrides((current) => Object.keys(current).length ? {} : current)
  }, [coordinator, coordinatorKey])

  useEffect(() => {
    const root = measurementRootRef.current
    if (!active || !root) return
    let live = true
    const previousSnapshot = coordinator.getLatestSnapshot(layoutSignatures.variant)
    const changeSet = createTeachingDocumentLayoutChangeSet({
      previous: previousSnapshot?.document ?? null,
      current: layoutDocument,
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
      execute: async ({ generation, signal }) => {
        const profiler = createLayoutPerformanceProfiler({
          pipeline: 'preview',
          generation,
          metadata: {
            blockCount: layoutDocument.content.length,
            spread,
            variant: layoutSignatures.variant,
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
          const cachedResourceReadiness = coordinator.getResourceReadiness(layoutSignatures.resourceRevision)
          profiler.addMetadata({ resourceCacheHit: Boolean(cachedResourceReadiness) })
          const endResourceWait = profiler.startPhase('resource-wait')
          let nextReadiness: RenderReadinessResult
          try {
            nextReadiness = cachedResourceReadiness
              ?? await readinessWait(root, { timeoutMs: 8_000, stableFrames: 2, signal })
          } finally {
            endResourceWait()
          }
          if (signal.aborted) throw new DOMException('Layout request aborted', 'AbortError')
          coordinator.cacheResourceReadiness(layoutSignatures.resourceRevision, nextReadiness)

          const measuredLayouts = profiler.measure('choice-layout', () => (
            measuredChoiceLayoutOverrides(root, choiceLayoutOverrides)
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
              root,
              document: layoutDocument,
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
          const nextParagraphLineCount = paragraphMeasurements.reduce((total, paragraph) => total + paragraph.lines.length, 0)
          const paginationResult = profiler.measure('pagination', () => paginateTeachingDocument({
            document: layoutDocument,
            measurements: measurement,
            paragraphMeasurements,
            boxMeasurements,
            questionMeasurements,
            boxChildQuestionMeasurements,
            boxChildRawMarkdownMeasurements,
            paper,
            metrics,
            documentHeaderSpanColumns: spread ? 2 : 1,
            incremental: incrementalPagination,
          }))
          const reusedPageCount = incrementalPagination
            ? paginationResult.pages.findIndex((page, index) => page !== incrementalPagination.previous.pages[index])
            : 0
          profiler.addMetadata({
            reusedPageCount: reusedPageCount < 0 ? paginationResult.pages.length : reusedPageCount,
          })
          profiler.finish('settled')
          return {
            status: 'settled' as const,
            document: layoutDocument,
            pagination: paginationResult,
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
            document: layoutDocument,
            pagination: null,
            readiness: failedReadiness,
            paragraphLineCount: 0,
            choiceLayoutOverrides,
          }
        }
      },
    })

    setMeasurementGeneration(handle.generation)
    if (handle.cacheHit) {
      const profiler = createLayoutPerformanceProfiler({
        pipeline: 'preview',
        generation: handle.generation,
        metadata: {
          blockCount: layoutDocument.content.length,
          cacheHit: true,
          spread,
          variant: layoutSignatures.variant,
          resourceRevision: layoutSignatures.resourceRevision,
          paginationSignature: layoutSignatures.paginationSignature,
        },
      })
      profiler.finish('settled')
    } else {
      setReflowing(true)
      setReadiness(PREPARING_READINESS)
      // 导出只接受当前 generation 的稳定快照；可见页面仍保留旧的成对快照。
      onPaginationState?.({ pagination: null, readiness: PREPARING_READINESS, measurementGeneration: handle.generation })
    }
    void handle.promise.then((result) => {
      if (!live) return
      if (result.status === 'retry') {
        setChoiceLayoutOverrides(result.choiceLayoutOverrides)
        return
      }
      const snapshot = result as LayoutCoordinatorSnapshot
      displayDocumentRef.current = snapshot.document
      displayChoiceLayoutOverridesRef.current = snapshot.choiceLayoutOverrides
      setReadiness(snapshot.readiness)
      setPagination(snapshot.pagination)
      setParagraphLineCount(snapshot.paragraphLineCount)
      setReflowing(false)
      onPaginationState?.({
        pagination: snapshot.pagination,
        readiness: snapshot.readiness,
        measurementGeneration: snapshot.generation,
      })
    }).catch((error) => {
      if (!live || (error instanceof DOMException && error.name === 'AbortError')) return
      setReflowing(false)
    })

    return () => {
      live = false
      handle.release()
    }
  }, [active, boxGeometryAdapter, choiceLayoutOverrides, coordinator, coordinatorKey, geometryAdapter, layoutDocument, layoutRequest.priority, layoutRequest.reason, layoutSignatures.documentRevision, layoutSignatures.layoutStyleSignature, layoutSignatures.paginationSignature, layoutSignatures.resourceRevision, layoutSignatures.variant, measurementStyleSignature, metrics, onPaginationState, paper, paragraphGeometryAdapter, questionGeometryAdapter, readinessWait, resolveQuestion, spread])

  const rendererProps: Pick<TeachingDocumentRendererProps, 'resolveQuestion' | 'resolveFigure'> = {
    resolveQuestion,
    resolveFigure,
  }
  const overflowIdsByPage = useMemo(() => {
    const map = new Map<number, Set<string>>()
    for (const diagnostic of pagination?.diagnostics || []) {
      if (diagnostic.severity !== 'error' || !diagnostic.blockId) continue
      if (diagnostic.code !== 'rawmarkdown-overflow' && diagnostic.code !== 'table-overflow') continue
      const pageIndex = diagnostic.pageIndex ?? 0
      const set = map.get(pageIndex) || new Set<string>()
      set.add(diagnostic.blockId)
      map.set(pageIndex, set)
    }
    return map
  }, [pagination])
  const fragmentCount = pagination?.pages.reduce(
    (total, page) => total + page.items.reduce((pageTotal, item) => {
      if (item.kind !== 'fragment') return pageTotal
      if (item.fragmentType === 'paragraph') return pageTotal + 1
      if (item.fragmentType === 'box') {
        return pageTotal + 1 + item.childItems.filter(
          (child) => child.kind === 'paragraph-child-fragment',
        ).length
      }
      return pageTotal + 1 + item.regionItems.filter(
        (region) => region.kind === 'question-paragraph-fragment',
      ).length
    }, 0),
    0,
  ) || 0
  const diagnosticGuide = (diagnostic: import('@/utils/teachingDocument').RenderDiagnostic) => {
    if (diagnostic.code === 'box-overflow') {
      const box = displayDocumentRef.current.content.find((block) => block.id === diagnostic.blockId && block.type === 'box')
      if (box?.type === 'box' && box.breakBehavior === 'avoid') {
        return '该知识卡片被设置为“不拆开”，且自身高度已超过一页的可用内容区。定位后可在右侧「高级 → 跨页方式」改为“自动”或“允许拆散”；也可以精简或拆分卡片内容。'
      }
      return '该知识卡片已启用跨页拆分，但其中一个分页片段仍超过页面。点击“定位并修复”可查看对应内容；重点检查无法继续拆分的图片、公式或表格。'
    }
    if (diagnostic.code === 'box-child-overflow') return '该知识卡片已启用跨页拆分，但这个子内容本身无法继续拆开。定位后可缩小图片/公式、拆分表格，或把内容拆成多张卡片。'
    if (diagnostic.code === 'table-overflow') return '定位后可缩短表格内容、拆分为多张表，或调整页面设置。'
    if (diagnostic.code === 'rawmarkdown-overflow') return '定位后可拆分该段 Markdown 内容，或缩短其中不可拆分的表格。'
    return '点击定位到对应内容后，可在右侧属性面板调整该块或修改正文。'
  }

  return (
    <div
      className="td-pagination-experiment td-theme-print min-w-0"
      style={fontVars as CSSProperties | undefined}
    >
      <div
        aria-hidden="true"
        data-teaching-measure-root=""
        className="pointer-events-none fixed -left-[100000px] top-0 overflow-visible opacity-0"
        style={{
          width: `${metrics.contentWidthPx}px`,
          '--td-paper-content-height': `${metrics.contentHeightPx}px`,
        } as CSSProperties}
      >
        <div ref={measurementRootRef}>
          {active ? (
            <TeachingDocumentRenderer
              document={layoutDocument}
              {...rendererProps}
              eagerImages
              surface="paper"
              choiceLayoutOverrides={choiceLayoutOverrides}
              probeChoiceLayouts
            />
          ) : null}
        </div>
      </div>

      {active && (reflowing || !pagination) ? (
        <div
          role="status"
          data-teaching-layout-status=""
          className="sticky top-2 z-10 mx-auto mb-3 flex w-fit items-center gap-1.5 rounded-md border border-zinc-200 bg-white/90 px-2 py-1 text-[11px] text-zinc-500 shadow-sm backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-400"
        >
          {readiness.timedOut ? <AlertTriangle className="size-3" /> : <LoaderCircle className="size-3 animate-spin" />}
          {readiness.timedOut ? '排版资源准备失败' : pagination ? '正在重新排版' : '正在准备排版'}
        </div>
      ) : null}

      <div className="hidden" aria-hidden="true">
        {!pagination ? (
          <span className="inline-flex items-center gap-1.5">
            <LoaderCircle className="size-3.5 animate-spin" />
            正在准备排版资源
          </span>
        ) : (
          <>
            <span className="font-medium">
              {spread ? `${Math.ceil(pagination.pages.length / 2)} 页 · 双栏` : `${pagination.pages.length} 页`}
            </span>
            <span className="text-zinc-300">·</span>
            <span>{readiness.ready ? '资源与布局已稳定' : readiness.timedOut ? '资源准备超时，已降级测量' : '资源状态未完全稳定'}</span>
            <span>段落行 {paragraphLineCount}</span>
            <span>片段 {fragmentCount}</span>
            <span>测量 g{measurementGeneration}</span>
            {readiness.failedImages.length ? <span>失败图片 {readiness.failedImages.length}</span> : null}
            {pagination.diagnostics.length ? (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                {pagination.diagnostics.length} 项诊断
              </span>
            ) : null}
          </>
        )}
      </div>

      {pagination?.diagnostics.length ? (
        <div className="mb-3 max-h-28 overflow-auto rounded-lg border border-amber-200 bg-amber-50/40 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
          {pagination.diagnostics.slice(0, 20).map((diagnostic, index) => (
            <div
              key={`${diagnostic.code}:${diagnostic.blockId || ''}:${diagnostic.pageIndex ?? ''}:${index}`}
              className="flex items-start gap-2 rounded px-2 py-1.5 text-[11px] text-amber-900 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{diagnostic.code === 'box-overflow' ? '知识卡片无法完整放入单页' : `[${diagnostic.code}]`}</p>
                <p className="mt-0.5">{diagnostic.message}</p>
                <p className="mt-1 text-amber-800/80 dark:text-amber-300/80">{diagnosticGuide(diagnostic)}</p>
              </div>
              {diagnostic.blockId ? (
                <button
                  type="button"
                  onClick={() => (onDiagnosticNavigate || onBlockSelect)?.(diagnostic.blockId!, diagnostic.pageIndex ?? 0)}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/60"
                >
                  <MapPin className="size-3" />定位并修复
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-5">
        {spread ? Array.from({ length: Math.ceil((pagination?.pages.length || 0) / 2) }, (_, sheetIndex) => {
          const leftPage = pagination!.pages[sheetIndex * 2]
          const rightPage = pagination!.pages[sheetIndex * 2 + 1]
          return (
            <div
              key={`sheet:${sheetIndex}`}
              className="relative mx-auto"
              style={{ width: sheetMetrics.pageWidthPx * safeZoom, height: sheetMetrics.pageHeightPx * safeZoom }}
            >
              <A3TwoColumnSheetView
                pages={[leftPage, rightPage]}
                sheetIndex={sheetIndex}
                sheetCount={Math.ceil(pagination!.pages.length / 2)}
                logicalPageCount={pagination!.pages.length}
                document={displayDocumentRef.current}
                sheetPaper={sheetPaper}
                columnPaper={paper}
                printLayout={printLayout}
                pageProps={{
                  resolvers: rendererProps,
                  choiceLayoutOverrides: displayChoiceLayoutOverridesRef.current,
                  selectedBlockId,
                  overflowBlockIds: overflowIdsByPage.get(leftPage.index),
                  editingChromeSlot,
                  onChromeSlotEdit,
                  onBlockSelect,
                }}
                className="absolute left-0 top-0 border border-zinc-300 shadow-sm"
                style={{
                  transform: `scale(${safeZoom})`,
                  transformOrigin: 'top left',
                  contentVisibility: 'auto',
                }}
              />
            </div>
          )
        }) : (pagination?.pages || []).map((page) => (
          <div
            key={page.index}
            className="relative mx-auto"
            style={{ width: metrics.pageWidthPx * safeZoom, height: metrics.pageHeightPx * safeZoom }}
          >
            <PaperPageView
              page={page}
              document={displayDocumentRef.current}
              paper={paper}
              printLayout={printLayout}
              totalPages={pagination?.pages.length ?? 0}
              resolvers={rendererProps}
              choiceLayoutOverrides={displayChoiceLayoutOverridesRef.current}
            selectedBlockId={selectedBlockId}
            overflowBlockIds={overflowIdsByPage.get(page.index)}
            editingChromeSlot={editingChromeSlot}
            onChromeSlotEdit={onChromeSlotEdit}
            onBlockSelect={onBlockSelect}
              className="absolute left-0 top-0 overflow-hidden border border-zinc-300 bg-white shadow-sm"
              style={{
                transform: `scale(${safeZoom})`,
                transformOrigin: 'top left',
                contentVisibility: 'auto',
                '--td-paper-content-height': `${metrics.contentHeightPx}px`,
              } as CSSProperties}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
