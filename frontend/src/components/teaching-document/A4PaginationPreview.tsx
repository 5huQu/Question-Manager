import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { FigureAssetRef, TeachingDocumentV1 } from '@/types/teachingDocument'
import {
  DEFAULT_A4_PAPER,
  measureTeachingDocumentBoxes,
  measureTeachingDocument,
  measureTeachingDocumentParagraphs,
  paginateTeachingDocument,
  paperMetrics,
  TEACHING_DOM,
  waitForRenderReadiness,
  type GeometryAdapter,
  type BoxChromeGeometryAdapter,
  type ParagraphRangeGeometryAdapter,
  type PaginationResult,
  type PaperSpec,
  type RenderReadinessResult,
} from '@/utils/teachingDocument'
import {
  TeachingDocumentRenderer,
  TeachingDocumentFrame,
  type TeachingDocumentRendererProps,
} from './TeachingDocumentRenderer'
import {
  BlockRenderer,
  BoxFragmentRenderer,
  ParagraphFragmentRenderer,
  type FigureResolution,
  type QuestionResolution,
} from './blocks/BlockRenderer'

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

export interface A4PaginationPreviewProps {
  document: TeachingDocumentV1
  resolveQuestion?: (questionId: string) => QuestionResolution
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  paper?: PaperSpec
  zoom?: number
  selectedBlockId?: string
  renderVersion?: string
  onBlockSelect?: (blockId: string, pageIndex: number) => void
  /** 测试注入点：JSDOM 不提供真实 geometry。 */
  geometryAdapter?: GeometryAdapter
  paragraphGeometryAdapter?: ParagraphRangeGeometryAdapter
  boxGeometryAdapter?: BoxChromeGeometryAdapter
  readinessWait?: typeof waitForRenderReadiness
}

export function A4PaginationPreview({
  document,
  resolveQuestion,
  resolveFigure,
  paper = DEFAULT_A4_PAPER,
  zoom = 0.8,
  selectedBlockId,
  renderVersion = '',
  onBlockSelect,
  geometryAdapter,
  paragraphGeometryAdapter,
  boxGeometryAdapter,
  readinessWait = waitForRenderReadiness,
}: A4PaginationPreviewProps) {
  const measurementRootRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const [readiness, setReadiness] = useState<RenderReadinessResult>(PREPARING_READINESS)
  const [pagination, setPagination] = useState<PaginationResult | null>(null)
  const [measurementGeneration, setMeasurementGeneration] = useState(0)
  const [paragraphLineCount, setParagraphLineCount] = useState(0)
  const metrics = useMemo(() => paperMetrics(paper), [paper])
  const safeZoom = Math.min(1.5, Math.max(0.35, zoom))

  useEffect(() => {
    const root = measurementRootRef.current
    if (!root) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const controller = new AbortController()
    setReadiness(PREPARING_READINESS)
    setPagination(null)

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
        measurement.diagnostics.push(...nextReadiness.diagnostics)
        if (controller.signal.aborted || generation !== generationRef.current) return
        setParagraphLineCount(paragraphMeasurements.reduce((total, paragraph) => total + paragraph.lines.length, 0))
        setMeasurementGeneration(generation)
        setPagination(paginateTeachingDocument({
          document,
          measurements: measurement,
          paragraphMeasurements,
          boxMeasurements,
          paper,
        }))
      })

    return () => controller.abort()
  }, [boxGeometryAdapter, document, geometryAdapter, paper, paragraphGeometryAdapter, readinessWait, renderVersion])

  const rendererProps: Pick<TeachingDocumentRendererProps, 'resolveQuestion' | 'resolveFigure'> = {
    resolveQuestion,
    resolveFigure,
  }
  const fragmentCount = pagination?.pages.reduce(
    (total, page) => total + page.items.reduce((pageTotal, item) => {
      if (item.kind !== 'fragment') return pageTotal
      if (item.fragmentType === 'paragraph') return pageTotal + 1
      return pageTotal + 1 + item.childItems.filter(
        (child) => child.kind === 'paragraph-child-fragment',
      ).length
    }, 0),
    0,
  ) || 0

  return (
    <div className="td-pagination-experiment min-w-0">
      <div
        aria-hidden="true"
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
            <span className="font-medium">{pagination.pages.length} 页</span>
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
        {(pagination?.pages || []).map((page) => {
          return (
            <div
              key={page.index}
              className="relative mx-auto"
              style={{ width: metrics.pageWidthPx * safeZoom, height: metrics.pageHeightPx * safeZoom }}
            >
              <section
                className="td-paper-page absolute left-0 top-0 overflow-hidden border border-zinc-300 bg-white shadow-sm"
                data-teaching-page-index={page.index}
                data-page-overflow={page.overflow ? 'true' : 'false'}
                style={{
                  width: `${paper.widthMm}mm`,
                  height: `${paper.heightMm}mm`,
                  padding: `${paper.marginTopMm}mm ${paper.marginRightMm}mm ${paper.marginBottomMm}mm ${paper.marginLeftMm}mm`,
                  boxSizing: 'border-box',
                  transform: `scale(${safeZoom})`,
                  transformOrigin: 'top left',
                  '--td-paper-content-height': `${metrics.contentHeightPx}px`,
                } as CSSProperties}
                onClick={(event) => {
                  const target = event.target
                  if (!(target instanceof Element)) return
                  const block = target.closest<HTMLElement>(`[${TEACHING_DOM.blockId}], [${TEACHING_DOM.sourceBlockId}]`)
                  const blockId = block?.getAttribute(TEACHING_DOM.blockId)
                    || block?.getAttribute(TEACHING_DOM.sourceBlockId)
                  if (blockId) onBlockSelect?.(blockId, page.index)
                }}
              >
                <TeachingDocumentFrame
                  document={document}
                  showTitle={page.showDocumentHeader}
                  surface="paper"
                >
                  {page.items.map((item) => {
                    const block = document.content[item.sourceIndex]
                    if (!block || block.id !== item.blockId) return null
                    if (item.kind === 'fragment'
                      && item.fragmentType === 'paragraph'
                      && block.type === 'paragraph') {
                      return (
                        <ParagraphFragmentRenderer
                          key={`fragment:${item.sourceIndex}:${item.fragmentIndex}`}
                          block={block}
                          item={item}
                          selected={selectedBlockId === block.id}
                        />
                      )
                    }
                    if (item.kind === 'fragment'
                      && item.fragmentType === 'box'
                      && block.type === 'box') {
                      return (
                        <BoxFragmentRenderer
                          key={`box-fragment:${item.sourceIndex}:${item.fragmentIndex}`}
                          block={block}
                          item={item}
                          resolvers={{ ...rendererProps }}
                          selectedBlockId={selectedBlockId}
                        />
                      )
                    }
                    return (
                      <BlockRenderer
                        key={`whole:${item.sourceIndex}`}
                        block={block}
                        resolvers={{ ...rendererProps }}
                        sourceIndex={item.sourceIndex}
                        selectedBlockId={selectedBlockId}
                      />
                    )
                  })}
                  {!page.items.length && !page.showDocumentHeader ? (
                    <span className="sr-only">空白页</span>
                  ) : null}
                </TeachingDocumentFrame>
                <span className="absolute bottom-[6mm] left-0 right-0 text-center text-[9px] text-zinc-400">
                  {page.index + 1}
                </span>
              </section>
            </div>
          )
        })}
      </div>
    </div>
  )
}
