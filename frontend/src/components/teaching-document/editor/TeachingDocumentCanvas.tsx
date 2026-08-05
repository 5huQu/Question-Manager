/**
 * TeachingDocumentCanvas — 可编辑画布（连续流 / 页面编辑共用）
 *
 * 单一组件承载两种编辑模式：
 * - 连续流（continuous）：书写面，无分页测量；纸张容器 max-w 限制 + 页眉页脚 chrome；
 * - 页面编辑（paginated）：分页是编辑器本身的视觉表面——ProseMirror decoration 页隙、
 *   页眉页脚 chrome、隐藏测量树（与独立预览/导出共用同一 paginateTeachingDocument 管线）。
 *
 * 关键约束：两种模式共用同一棵组件树与同一个 DocumentEditor 实例。
 * 切换模式、或由页面级隐藏本画布以展示 a4 打印预览时，编辑器都不会被销毁，
 * 光标位置与撤销历史得以保留。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import type {
  BoxChildBlock,
  FigureAssetRef,
  PrintChromeSlotPosition,
  TeachingBlock,
  TeachingDocumentV1,
} from '@/types/teachingDocument'
import {
  printLayoutMetrics,
  type PaperSpec,
  type PrintLayoutSpec,
} from '@/utils/teachingDocument'
import { DocumentEditor } from './DocumentEditor'
import { usePagination } from './usePagination'
import type { TeachingDocumentLayoutCoordinator } from './layoutCoordinator'
import {
  DEFAULT_PAGINATION_LAYOUT_DELAY_MS,
  INITIAL_LAYOUT_REQUEST,
  useDeferredPaginationDocument,
  type LayoutRequest,
} from './useDeferredPaginationDocument'
import { PrintChrome, type PrintChromeSection } from '../PrintChrome'
import { TeachingDocumentRenderer } from '../TeachingDocumentRenderer'
import type {
  FigureResolution,
  QuestionResolution,
} from '../blocks/BlockRenderer'
import { FloatingBlockToolbar } from '@/pages/teaching-documents/components/FloatingBlockToolbar'
import { BlockGripHandle } from '@/pages/teaching-documents/components/BlockGripHandle'
import { BlockInsertPoint } from '@/pages/teaching-documents/components/BlockInsertMenu'
import type { HeadingLevel } from '@/pages/teaching-documents/components/BlockInsertMenu'
import { CARD_CHILD_TYPES } from '@/pages/teaching-documents/components/blockLabels'
import { useBlockDragReorder } from '@/pages/teaching-documents/components/useBlockDragReorder'
import { subscribeTopLevelMultiSelect } from './selection'
import { paginationGapAnchors, type EditorPaginationLayout } from './paginationDecorations'
import {
  BOX_CHILD_SELECT_EVENT,
  blockIdFromEditorSelection,
  clearEditorSelectionToFirstTextBlock,
  emitDocumentSelectionChanged,
  isExternalDocumentSync,
  type BoxChildSelectDetail,
} from './selection'

export type TeachingCanvasMode = 'continuous' | 'paginated'

const CONTINUOUS_PAPER_WIDTH_PX = 760
const MIN_FIT_SCALE = 0.55
const MAX_FIT_SCALE = 1.35

/**
 * 纸张始终以固定排版宽度渲染，侧栏开合只改变外层显示比例，不能触发正文重排。
 * 保留用户选择的 zoom 作为乘数，因此手动缩放和自动适配可以叠加。
 */
export function fitCanvasScale(availableWidth: number, paperWidth: number, zoom: number): number {
  const fit = availableWidth > 0 && paperWidth > 0
    ? Math.min(MAX_FIT_SCALE, Math.max(MIN_FIT_SCALE, availableWidth / paperWidth))
    : 1
  return Math.round(fit * zoom * 1000) / 1000
}

export interface TeachingDocumentCanvasProps {
  document: TeachingDocumentV1
  paper: PaperSpec
  printLayout: PrintLayoutSpec
  /** 字体 CSS 变量（如 --td-body-font / --td-heading-font）。 */
  fontVars?: Record<string, string>
  /** 仅影响编辑画布显示，不参与分页测量。 */
  zoom?: number
  /** 资源版本号（题目/图片装载状态），变化触发重新测量。 */
  renderVersion?: string
  resolveQuestion: (questionId: string) => QuestionResolution
  resolveFigure: (asset: FigureAssetRef) => FigureResolution

  // ─── 选中与块操作 ────────────────────────────────────────────────────────
  selectedId: string
  selectedTopLevelId: string
  selectedIsBoxChild: boolean
  onSelect: (blockId: string) => void
  onInsertAfter: (type: TeachingBlock['type'], afterBlockId: string, headingLevel?: HeadingLevel) => void
  onInsertBoxChild: (type: BoxChildBlock['type'], boxId: string, afterChildId?: string) => void
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenProperties: () => void
  onReorder: (order: string[], mergeKey: string) => void
  onMoveSection?: (headingId: string, targetHeadingId: string, position: 'before' | 'after', mergeKey: string) => void
  onEditQuestion?: () => void
  onEditorChange?: (doc: TeachingDocumentV1) => void
  onEditorDirty?: () => void
  onEditorFlushReady?: (flush: (() => void) | null) => void
  onEditorReady?: (editor: Editor | null) => void

  // ─── 模式与页眉页脚 chrome ──────────────────────────────────────────────
  /** 编辑模式；两种模式共用同一个 DocumentEditor 实例，切换不销毁编辑器。 */
  mode?: TeachingCanvasMode
  /** 连续流模式页眉页脚的“总页数”（沿用 a4 分页状态；分页模式使用自身分页结果）。 */
  totalPages?: number
  /** 将分页编辑画布的页数回传给页面级快速翻页控件。 */
  onPageCountChange?: (count: number) => void
  editingChromeSlot?: { section: PrintChromeSection; slot: PrintChromeSlotPosition } | null
  onChromeSlotEdit?: (section: PrintChromeSection, slot: PrintChromeSlotPosition) => void

  // ─── 测试注入点（JSDOM 无真实 geometry） ───────────────────────────────
  geometryAdapter?: import('@/utils/teachingDocument').GeometryAdapter
  paragraphGeometryAdapter?: import('@/utils/teachingDocument').ParagraphRangeGeometryAdapter
  boxGeometryAdapter?: import('@/utils/teachingDocument').BoxChromeGeometryAdapter
  questionGeometryAdapter?: import('@/utils/teachingDocument').QuestionChromeGeometryAdapter
  readinessWait?: typeof import('@/utils/teachingDocument').waitForRenderReadiness
  /** 内容变化后的防抖毫秒数（测试可设为 0）。 */
  debounceMs?: number
  /** 输入停顿多久后，才以最新内容重建隐藏测量树并精确分页。 */
  layoutUpdateDelayMs?: number
  /** 最近一次布局请求的明确来源；只有 typing 使用尾随延迟。 */
  layoutRequest?: LayoutRequest
  /** 与打印预览共享的文档级布局协调器。 */
  layoutCoordinator?: TeachingDocumentLayoutCoordinator
}

export function TeachingDocumentCanvas(props: TeachingDocumentCanvasProps) {
  const {
    document,
    paper,
    printLayout,
    fontVars,
    zoom = 1,
    renderVersion,
    resolveQuestion,
    resolveFigure,
    selectedId,
    selectedTopLevelId,
    selectedIsBoxChild,
    onSelect,
    onInsertAfter,
    onMove,
    onDuplicate,
    onDelete,
    onOpenProperties,
    onReorder,
    onMoveSection,
    onEditQuestion,
    onEditorChange,
    onEditorDirty,
    onEditorFlushReady,
    onEditorReady,
    mode = 'continuous',
    totalPages: continuousTotalPages = 1,
    onPageCountChange,
    editingChromeSlot,
    onChromeSlotEdit,
    geometryAdapter,
    paragraphGeometryAdapter,
    boxGeometryAdapter,
    questionGeometryAdapter,
    readinessWait,
    debounceMs,
    layoutUpdateDelayMs = DEFAULT_PAGINATION_LAYOUT_DELAY_MS,
    layoutRequest = INITIAL_LAYOUT_REQUEST,
    layoutCoordinator,
  } = props

  const paginated = mode === 'paginated'
  const metrics = useMemo(() => printLayoutMetrics(printLayout), [printLayout])
  const viewZoom = Math.min(1.5, Math.max(0.5, zoom))
  const {
    contentWidthPx,
    pageWidthPx,
    marginTopPx,
    marginRightPx,
    marginBottomPx,
    marginLeftPx,
  } = metrics
  const [canvasViewport, setCanvasViewport] = useState<HTMLDivElement | null>(null)
  const [canvasViewportWidth, setCanvasViewportWidth] = useState(0)
  useLayoutEffect(() => {
    if (!canvasViewport) return
    const updateWidth = () => setCanvasViewportWidth(canvasViewport.clientWidth)
    updateWidth()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth)
    observer?.observe(canvasViewport)
    return () => observer?.disconnect()
  }, [canvasViewport])
  const paperDisplayWidthPx = paginated ? pageWidthPx : CONTINUOUS_PAPER_WIDTH_PX
  const displayScale = fitCanvasScale(canvasViewportWidth, paperDisplayWidthPx, viewZoom)

  // 编辑画布使用 document 立即回显；精确分页使用空闲期后的稳定快照。
  // 连续流模式没有测量树（measureRoot 为 null，usePagination 直接短路）。
  const { layoutDocument, layoutPending } = useDeferredPaginationDocument(
    document,
    paginated ? layoutUpdateDelayMs : 0,
    layoutRequest,
  )

  // ─── 隐藏测量根（与独立预览共用同一渲染器与管线） ───────────────────────
  const [measureRoot, setMeasureRoot] = useState<HTMLElement | null>(null)

  const paginationState = usePagination({
    document: layoutDocument,
    paper,
    printLayout,
    measureRoot: paginated ? measureRoot : null,
    resolveQuestion,
    fontVars,
    renderVersion,
    debounceMs,
    geometryAdapter,
    paragraphGeometryAdapter,
    boxGeometryAdapter,
    questionGeometryAdapter,
    readinessWait,
    layoutRequest,
    coordinator: layoutCoordinator,
  })
  const { pagination, readiness, generation, settled, choiceLayoutOverrides } = paginationState
  const [documentEditor, setDocumentEditor] = useState<Editor | null>(null)

  // ─── 编辑器选区追踪 ─────────────────────────────────────────────────────
  const documentEditorRef = useRef<Editor | null>(null)
  /** 程序化清理选区期间不上报（防止清理触发其他编辑器清理形成乒乓）。 */
  const suppressSelectionReportRef = useRef(false)
  const handleSelectionUpdate = useCallback((editor: Editor) => {
    const blockId = blockIdFromEditorSelection(editor.state)
    if (blockId && blockId !== '__empty__' && !suppressSelectionReportRef.current) {
      onSelect(blockId)
      // 全文档单选：把本次选区变化广播出去，卡片编辑器与文档级选中环随之清除。
      emitDocumentSelectionChanged(blockId)
    }
  }, [onSelect])

  const handleEditorReady = useCallback((editor: Editor | null) => {
    setDocumentEditor(editor)
    documentEditorRef.current = editor
    onEditorReady?.(editor)
    if (!editor) return
    editor.on('selectionUpdate', ({ transaction }) => {
      if (!isExternalDocumentSync(transaction)) handleSelectionUpdate(editor)
    })
  }, [onEditorReady, handleSelectionUpdate])

  useEffect(() => {
    const handleChildSelect = (event: Event) => {
      const detail = (event as CustomEvent<BoxChildSelectDetail>).detail
      if (!detail?.blockId) return
      onSelect(detail.blockId)
      emitDocumentSelectionChanged(detail.blockId)
      // 全文档单选：选中卡片子块时，文档级编辑器不应继续高亮卡片/其他对象。
      const currentEditor = documentEditorRef.current
      if (currentEditor && currentEditor.state.selection instanceof NodeSelection) {
        suppressSelectionReportRef.current = true
        clearEditorSelectionToFirstTextBlock(currentEditor)
        suppressSelectionReportRef.current = false
      }
    }
    window.addEventListener(BOX_CHILD_SELECT_EVENT, handleChildSelect)
    return () => window.removeEventListener(BOX_CHILD_SELECT_EVENT, handleChildSelect)
  }, [onSelect])

  const pages = pagination?.pages ?? []
  useEffect(() => {
    onPageCountChange?.(paginated ? pages.length || 1 : 1)
  }, [onPageCountChange, pages.length, paginated])
  const pageGapPx = 24
  const paginationLayout = useMemo<EditorPaginationLayout | null>(() => paginated && pagination ? ({
    anchors: paginationGapAnchors(layoutDocument, pagination, metrics.contentHeightPx),
    pageWidthPx,
    contentWidthPx,
    marginLeftPx,
    marginRightPx,
    marginTopPx,
    marginBottomPx,
    headerHeightPx: metrics.headerHeightPx,
    footerHeightPx: metrics.footerHeightPx,
    pageGapPx,
    totalPages: pagination.pages.length,
    documentTitle: document.title,
  }) : null, [contentWidthPx, layoutDocument, marginBottomPx, marginLeftPx, marginRightPx, marginTopPx, metrics.contentHeightPx, metrics.footerHeightPx, metrics.headerHeightPx, pageWidthPx, paginated, pagination])
  const finalPageBlankPx = paginated && pagination?.pages.length
    ? Math.max(0, metrics.contentHeightPx - pagination.pages[pagination.pages.length - 1].usedHeight)
    : 0

  const [contentRoot, setContentRoot] = useState<HTMLDivElement | null>(null)
  const { hoveredBlockId, handlers: dragHandlers } = useBlockDragReorder({
    document,
    onSelect,
    onReorder,
    onMoveSection,
  })
  const insertAnchorId = hoveredBlockId || selectedId
  // 拖拽手柄只对顶层块显示（卡片内部的对象用卡片多选/光标插入交互）
  const topLevelIdSet = useMemo(() => new Set(document.content.map((block) => block.id)), [document.content])
  const gripAnchorId = hoveredBlockId && topLevelIdSet.has(hoveredBlockId) ? hoveredBlockId : ''
  const insertAnchorBoxId = useMemo(() => {
    if (!insertAnchorId) return ''
    return document.content.find((block) => block.type === 'box' && block.children.some((child) => child.id === insertAnchorId))?.id || ''
  }, [document.content, insertAnchorId])
  // 卡片内插入点只在卡片活跃时显示（点击进卡片后），不随悬停逐段弹出。
  const cardActive = Boolean(insertAnchorBoxId && (selectedId === insertAnchorBoxId
    || (selectedIsBoxChild && selectedTopLevelId === insertAnchorBoxId)))
  // 顶层多选集合变化：派发空事务刷新 TopLevelMultiSelectDecoration。
  useEffect(() => subscribeTopLevelMultiSelect(() => {
    const currentEditor = documentEditorRef.current
    if (currentEditor) currentEditor.view.dispatch(currentEditor.state.tr.setMeta('top-level-multi-refresh', true))
  }), [])
  const totalPages = paginated ? (pages.length || 1) : continuousTotalPages
  const diagnosticCount = pagination?.diagnostics.length ?? 0
  // content-visibility 只优化编辑画布，不会影响隐藏测量树和最终导出精度。
  const shouldVirtualizeOffscreen = document.content.length >= 24
  const measurementTree = useMemo(() => (
    <TeachingDocumentRenderer
      document={layoutDocument}
      resolveQuestion={resolveQuestion}
      resolveFigure={resolveFigure}
      eagerImages
      surface="paper"
      choiceLayoutOverrides={choiceLayoutOverrides}
      probeChoiceLayouts
    />
  ), [choiceLayoutOverrides, layoutDocument, resolveFigure, resolveQuestion])

  return (
    <div
      ref={setCanvasViewport}
      className={paginated ? 'td-pagination-experiment td-paginated-canvas td-theme-print min-w-0' : ''}
      style={paginated ? (fontVars as CSSProperties | undefined) : undefined}
      data-layout-pending={paginated ? String(layoutPending) : undefined}
      data-canvas-scale={displayScale}
    >
      {paginated ? (
        <>
          <span className="sr-only" aria-live="polite">
            {layoutPending ? '内容已更新，正在等待重新排版。' : '分页布局已更新。'}
          </span>
          {layoutPending || !settled ? (
            <div
              role="status"
              data-teaching-layout-status=""
              className="sticky top-2 z-10 mx-auto mb-2 flex w-fit items-center gap-1.5 rounded-md border border-zinc-200 bg-white/90 px-2 py-1 text-[11px] text-zinc-500 shadow-sm backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-400"
            >
              <LoaderCircle className="size-3 animate-spin" />
              {pagination ? '正在重新排版' : '正在准备排版'}
            </div>
          ) : null}
          {/* 隐藏测量树：与独立预览同一渲染器，宽度 = 内容区宽，主动加载图片。 */}
          <div
            aria-hidden="true"
            data-teaching-measure-root=""
            className="pointer-events-none fixed -left-[100000px] top-0 overflow-visible opacity-0"
            style={{
              width: `${contentWidthPx}px`,
              '--td-paper-content-height': `${metrics.contentHeightPx}px`,
            } as CSSProperties}
          >
            <div ref={setMeasureRoot}>{measurementTree}</div>
          </div>

          {/* 状态栏 */}
          <div className="hidden" aria-hidden="true">
            {!pagination ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle className="size-3.5 animate-spin" />
                正在准备排版资源
              </span>
            ) : (
              <>
                <span className="font-medium">{totalPages} 页</span>
                <span className="text-zinc-300">·</span>
                <span>
                  {readiness.ready
                    ? '资源与布局已稳定'
                    : readiness.timedOut
                      ? '资源准备超时，已降级测量'
                      : settled
                        ? '资源状态未完全稳定'
                        : '正在重新测量…'}
                </span>
                <span>测量 g{generation}</span>
                {diagnosticCount ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3.5" />
                    {diagnosticCount} 项诊断
                  </span>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : null}

      {/* 纸张列：分页模式按 PaperSpec 宽度铺排；连续流为受限书写面。 */}
      <div className={paginated ? 'pb-8' : ''}>
        <div
          className={`td-editor-fonts td-paper-page td-editor-chrome relative ${paginated
            ? 'mx-auto border border-zinc-200 bg-white shadow-sm dark:border-zinc-800'
            : 'mx-auto my-0 min-h-[790px] w-[760px] max-w-none bg-white shadow-[0_0_0_1px_rgba(24,24,27,0.08),0_12px_28px_rgba(24,24,27,0.05)] dark:bg-zinc-950'}`}
          style={{
            zoom: displayScale,
            ...(fontVars as CSSProperties | undefined),
            ...(paginated
              ? {
                  width: `${pageWidthPx}px`,
                  minHeight: `${metrics.pageHeightPx}px`,
                  padding: `${marginTopPx}px ${marginRightPx}px ${marginBottomPx}px ${marginLeftPx}px`,
                  boxSizing: 'border-box',
                }
              : {}),
          }}
        >
          {printLayout.header.enabled ? (
            <PrintChrome
              section="header"
              slots={printLayout.header.slots}
              documentTitle={document.title}
              documentType={document.documentType}
              pageNumber={1}
              totalPages={totalPages}
              printLayout={printLayout}
              activeSlot={editingChromeSlot?.section === 'header' ? editingChromeSlot.slot : undefined}
              onSlotEdit={onChromeSlotEdit}
            />
          ) : null}

          {/* 内容流 + ProseMirror 分页占位 */}
          <div className="relative" {...dragHandlers}>
            {gripAnchorId ? <BlockGripHandle blockId={gripAnchorId} anchorRoot={contentRoot} /> : null}
            <div
              ref={setContentRoot}
              data-teaching-page-content=""
              className={paginated ? '' : 'px-5 py-6 sm:px-10 sm:py-9'}
              style={paginated ? { width: `${contentWidthPx}px` } : undefined}
            >
              <header
                className="td-document-header mb-8 text-center"
                {...{ 'data-teaching-document-header': '' }}
              >
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {document.title || '未命名文档'}
                </h1>
              </header>

              {document.content.length ? (
                <DocumentEditor
                  document={document}
                  onChange={onEditorChange || (() => {})}
                  onChangePending={onEditorDirty}
                  onFlushPendingChanges={onEditorFlushReady}
                  resolvers={{ resolveQuestion, resolveFigure }}
                  onEditorReady={handleEditorReady}
                  paginationLayout={paginated ? paginationLayout : null}
                  pagination={paginated ? pagination : null}
                  printLayout={printLayout}
                  pageGapPx={pageGapPx}
                  virtualizeOffscreen={shouldVirtualizeOffscreen}
                />
              ) : <BlockInsertPoint empty onInsert={(type, headingLevel) => onInsertAfter(type, '', headingLevel)} />}
            </div>

            {/* 卡片是一个连续文本框；子块编辑只保留顶栏格式与右侧属性，不叠加
                文档级浮动块工具条，避免遮住卡片标题和正文。 */}
            {selectedId && !selectedIsBoxChild ? (
              <FloatingBlockToolbar
                visible
                anchorBlockId={selectedId}
                anchorRoot={contentRoot}
                isBoxChild={selectedIsBoxChild}
                textEditor={documentEditor}
                showTextFormatting={false}
                showFormulaKeyboard={false}
                onMove={onMove}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onOpenProperties={onOpenProperties}
                onEditQuestion={onEditQuestion}
              />
            ) : null}

            {insertAnchorId && (!insertAnchorBoxId || cardActive) ? (
              <BlockInsertPoint
                anchorBlockId={insertAnchorId}
                anchorRoot={contentRoot}
                types={insertAnchorBoxId ? CARD_CHILD_TYPES : undefined}
                onInsert={(type, headingLevel) => {
                  if (insertAnchorBoxId) {
                    props.onInsertBoxChild(type as BoxChildBlock['type'], insertAnchorBoxId, insertAnchorId)
                    return
                  }
                  onInsertAfter(type, insertAnchorId, headingLevel)
                }}
              />
            ) : null}
          </div>

          {paginated ? <div aria-hidden="true" style={{ height: `${finalPageBlankPx}px` }} /> : null}
          {printLayout.footer.enabled ? (
            <PrintChrome
              section="footer"
              slots={printLayout.footer.slots}
              documentTitle={document.title}
              documentType={document.documentType}
              pageNumber={paginated ? totalPages : 1}
              totalPages={totalPages}
              printLayout={printLayout}
              activeSlot={editingChromeSlot?.section === 'footer' ? editingChromeSlot.slot : undefined}
              onSlotEdit={onChromeSlotEdit}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
