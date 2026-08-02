import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, LoaderCircle, MapPin } from 'lucide-react'
import type { FigureAssetRef, TeachingDocumentV1 } from '@/types/teachingDocument'
import { choiceLayoutOverridesEqual, type ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import {
  resolveDocumentPaper,
  measuredChoiceLayoutOverrides,
  measureTeachingDocumentAll,
  paginateTeachingDocument,
  createDefaultPrintLayout,
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

/** 资源签名未变化（如教师/学生版切换、页眉页脚调整）时直接使用的就绪态。 */
const INSTANT_READINESS: RenderReadinessResult = {
  ready: true,
  timedOut: false,
  pendingFonts: false,
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
}: A4PaginationPreviewProps) {
  const paper = useMemo(
    () => paperProp ?? resolveDocumentPaper(document.style),
    [paperProp, document.style],
  )
  const sheetPaper = sheetPaperProp ?? paper
  const spread = isA3LandscapeSpread(sheetPaper)
  const sheetMetrics = useMemo(() => paperMetrics(sheetPaper), [sheetPaper])
  const measurementRootRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  /** 可见页面的展示快照：重测期间保留上一对（文档，分页），避免白屏闪烁。 */
  const displayDocumentRef = useRef(document)
  /** 上一轮测量的资源签名；用于跳过与资源装载无关的重测等待。 */
  const measurementSignatureRef = useRef('')
  const [readiness, setReadiness] = useState<RenderReadinessResult>(PREPARING_READINESS)
  const [pagination, setPagination] = useState<PaginationResult | null>(null)
  const [measurementGeneration, setMeasurementGeneration] = useState(0)
  const [paragraphLineCount, setParagraphLineCount] = useState(0)
  const [choiceLayoutOverrides, setChoiceLayoutOverrides] = useState<ChoiceLayoutOverrides>({})
  useEffect(() => {
    setChoiceLayoutOverrides((current) => Object.keys(current).length ? {} : current)
  }, [document, renderVersion])
  const printLayout = useMemo(
    () => printLayoutProp ?? createDefaultPrintLayout(paper),
    [printLayoutProp, paper],
  )
  // 页眉页脚参与分页有效高度。保守统一扣除：即使 showOnFirstPage=false，
  // 首页也扣除页眉高度（已知风险：首页页眉区域留白）。
  const metrics = useMemo(() => effectivePaperMetrics(printLayout), [printLayout])
  const safeZoom = Math.min(1.5, Math.max(0.35, zoom))

  useEffect(() => {
    const root = measurementRootRef.current
    if (!active || !root) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const controller = new AbortController()
    setReadiness(PREPARING_READINESS)
    setMeasurementGeneration(generation)
    // 新 generation 开始即向父层发布 preparing/null，
    // 使导出 readiness 在重新测量期间被 stale generation 与空分页阻塞。
    // 注意：内部渲染保留上一对（文档，分页）快照，避免切换教师/学生版白屏。
    onPaginationState?.({ pagination: null, readiness: PREPARING_READINESS, measurementGeneration: generation })

    // 资源签名（内容 + 字体变量 + 资源版本）未变化时跳过 waitForRenderReadiness：
    // 字体、图片、题目的装载状态都没变，等待只会白白耗时（教师/学生版切换、页眉页脚调整即此类）。
    const nextSignature = `${JSON.stringify(document.content)}|${JSON.stringify(fontVars || {})}|${renderVersion}`
    const resourcesUnchanged = measurementSignatureRef.current === nextSignature
    measurementSignatureRef.current = nextSignature
    const wait = resourcesUnchanged
      ? Promise.resolve(INSTANT_READINESS)
      : readinessWait(root, { timeoutMs: 8_000, stableFrames: 2, signal: controller.signal })

    void wait.then((nextReadiness) => {
      if (controller.signal.aborted || generation !== generationRef.current) return
      setReadiness(nextReadiness)
        const measuredLayouts = measuredChoiceLayoutOverrides(root, choiceLayoutOverrides)
        if (!choiceLayoutOverridesEqual(measuredLayouts, choiceLayoutOverrides)) {
          setChoiceLayoutOverrides(measuredLayouts)
          return
        }
        const bundle = measureTeachingDocumentAll(
          root,
          document,
          {
            geometry: geometryAdapter,
            paragraphGeometry: paragraphGeometryAdapter,
            boxGeometry: boxGeometryAdapter,
            questionGeometry: questionGeometryAdapter,
          },
          resolveQuestion,
          choiceLayoutOverrides,
        )
        const { measurement, paragraphs: paragraphMeasurements, boxes: boxMeasurements, questions: questionMeasurements, boxChildQuestions: boxChildQuestionMeasurements, boxChildRawMarkdowns: boxChildRawMarkdownMeasurements } = bundle
        measurement.diagnostics.push(...nextReadiness.diagnostics)
        if (controller.signal.aborted || generation !== generationRef.current) return
        setParagraphLineCount(paragraphMeasurements.reduce((total, paragraph) => total + paragraph.lines.length, 0))
        setMeasurementGeneration(generation)
        const paginationResult = paginateTeachingDocument({
          document,
          measurements: measurement,
          paragraphMeasurements,
          boxMeasurements,
          questionMeasurements,
          boxChildQuestionMeasurements,
          boxChildRawMarkdownMeasurements,
          paper,
          metrics,
          documentHeaderSpanColumns: spread ? 2 : 1,
        })
        setPagination(paginationResult)
        // 展示快照与分页同步切换，保证可见页面永远渲染一致的一对。
        displayDocumentRef.current = document
        onPaginationState?.({ pagination: paginationResult, readiness: nextReadiness, measurementGeneration: generation })
      })
      .catch((error) => {
        // readiness 等待被拒绝（非中断/非过期 generation）时发布稳定失败态：
        // 清空分页并标记 timedOut，使导出 readiness 被阻塞，避免悬挂的未处理 rejection。
        if (controller.signal.aborted || generation !== generationRef.current) return
        const failedReadiness: RenderReadinessResult = {
          ...PREPARING_READINESS,
          timedOut: true,
          diagnostics: [{
            code: 'resource-timeout',
            severity: 'error',
            message: error instanceof Error ? error.message : '排版资源准备失败。',
          }],
        }
        setReadiness(failedReadiness)
        setPagination(null)
        onPaginationState?.({ pagination: null, readiness: failedReadiness, measurementGeneration: generation })
      })

    return () => controller.abort()
  }, [active, boxGeometryAdapter, choiceLayoutOverrides, document, fontVars, geometryAdapter, metrics, paper, paragraphGeometryAdapter, questionGeometryAdapter, readinessWait, renderVersion, resolveQuestion, spread])

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
              document={document}
              {...rendererProps}
              eagerImages
              surface="paper"
              choiceLayoutOverrides={choiceLayoutOverrides}
              probeChoiceLayouts
            />
          ) : null}
        </div>
      </div>

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
                  choiceLayoutOverrides,
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
              choiceLayoutOverrides={choiceLayoutOverrides}
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
