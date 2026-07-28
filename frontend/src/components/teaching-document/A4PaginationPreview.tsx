import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { FigureAssetRef, TeachingDocumentV1 } from '@/types/teachingDocument'
import {
  resolveDocumentPaper,
  measureTeachingDocumentBoxes,
  measureTeachingDocument,
  measureTeachingDocumentParagraphs,
  measureTeachingDocumentQuestions,
  measureBoxChildQuestions,
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
  onBlockSelect?: (blockId: string, pageIndex: number) => void
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
  onBlockSelect,
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
  const [readiness, setReadiness] = useState<RenderReadinessResult>(PREPARING_READINESS)
  const [pagination, setPagination] = useState<PaginationResult | null>(null)
  const [measurementGeneration, setMeasurementGeneration] = useState(0)
  const [paragraphLineCount, setParagraphLineCount] = useState(0)
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
    if (!root) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const controller = new AbortController()
    setReadiness(PREPARING_READINESS)
    setPagination(null)
    setMeasurementGeneration(generation)
    // 新 generation 开始即向父层发布 preparing/null，
    // 使导出 readiness 在重新测量期间被 stale generation 与空分页阻塞。
    onPaginationState?.({ pagination: null, readiness: PREPARING_READINESS, measurementGeneration: generation })

    void readinessWait(root, { timeoutMs: 8_000, stableFrames: 2, signal: controller.signal })
      .then((nextReadiness) => {
        if (controller.signal.aborted || generation !== generationRef.current) return
        setReadiness(nextReadiness)
        const measurement = measureTeachingDocument(root, document, geometryAdapter)
        const paragraphMeasurements = measureTeachingDocumentParagraphs(root, document, paragraphGeometryAdapter)
        const boxMeasurements = measureTeachingDocumentBoxes(
          root,
          document,
          measurement,
          boxGeometryAdapter,
        )
        const questionMeasurements = measureTeachingDocumentQuestions(
          root,
          document,
          measurement,
          resolveQuestion,
          geometryAdapter,
          paragraphGeometryAdapter,
          questionGeometryAdapter,
        )
        const boxChildQuestionMeasurements = measureBoxChildQuestions(
          root,
          document,
          measurement,
          resolveQuestion,
          geometryAdapter,
          paragraphGeometryAdapter,
          questionGeometryAdapter,
        )
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
          paper,
          metrics,
          documentHeaderSpanColumns: spread ? 2 : 1,
        })
        setPagination(paginationResult)
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
  }, [boxGeometryAdapter, document, fontVars, geometryAdapter, metrics, paper, paragraphGeometryAdapter, questionGeometryAdapter, readinessWait, renderVersion, resolveQuestion, spread])

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
          <TeachingDocumentRenderer
            document={document}
            {...rendererProps}
            eagerImages
            surface="paper"
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
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
            <button
              type="button"
              key={`${diagnostic.code}:${diagnostic.blockId || ''}:${diagnostic.pageIndex ?? ''}:${index}`}
              onClick={() => diagnostic.blockId && onBlockSelect?.(diagnostic.blockId, diagnostic.pageIndex ?? 0)}
              className="block w-full rounded px-2 py-1 text-left text-[11px] text-amber-900 hover:bg-amber-100/70 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
              [{diagnostic.code}] {diagnostic.message}
            </button>
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
                document={document}
                sheetPaper={sheetPaper}
                columnPaper={paper}
                printLayout={printLayout}
                pageProps={{
                  resolvers: rendererProps,
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
              document={document}
              paper={paper}
              printLayout={printLayout}
              totalPages={pagination?.pages.length ?? 0}
              resolvers={rendererProps}
            selectedBlockId={selectedBlockId}
            overflowBlockIds={overflowIdsByPage.get(page.index)}
            editingChromeSlot={editingChromeSlot}
            onChromeSlotEdit={onChromeSlotEdit}
            onBlockSelect={onBlockSelect}
              className="absolute left-0 top-0 overflow-hidden border border-zinc-300 bg-white shadow-sm"
              style={{
                transform: `scale(${safeZoom})`,
                transformOrigin: 'top left',
                '--td-paper-content-height': `${metrics.contentHeightPx}px`,
              } as CSSProperties}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
