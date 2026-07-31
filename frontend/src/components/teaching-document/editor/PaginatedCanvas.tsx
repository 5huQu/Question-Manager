/**
 * PaginatedCanvas — 可编辑分页画布（T5）
 *
 * 让分页不再是单独的只读预览，而是编辑器本身的视觉表面：
 * - 编辑器保持单一连续 DOM，分页边界通过 ProseMirror decoration
 *   在文档流中真实占位（Tiptap 不支持真正的多容器），
 * - 分页结果（与独立预览/导出共用同一 paginateTeachingDocument 管线）
 *   驱动页间空隙、页眉页脚与页码标签，
 * - 页眉页脚为文档级只读 chrome，点击可打开共享设置面板，
 * - 内容区宽度 = PaperSpec contentWidthPx，居中显示。
 *
 * 与 A4PaginationPreview 的关系：二者复用同一测量与分页管线，
 * 不复制第二套 renderer；A4PaginationPreview 保留为独立只读预览。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { Editor } from '@tiptap/react'
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
import { DEFAULT_PAGINATION_LAYOUT_DELAY_MS, useDeferredPaginationDocument } from './useDeferredPaginationDocument'
import { PrintChrome, type PrintChromeSection } from '../PrintChrome'
import {
  TeachingDocumentRenderer,
} from '../TeachingDocumentRenderer'
import {
  type FigureResolution,
  type QuestionResolution,
} from '../blocks/BlockRenderer'
import { FloatingBlockToolbar } from '@/pages/teaching-documents/components/FloatingBlockToolbar'
import { BlockInsertPoint } from '@/pages/teaching-documents/components/BlockInsertMenu'
import type { HeadingLevel } from '@/pages/teaching-documents/components/BlockInsertMenu'
import { CARD_CHILD_TYPES } from '@/pages/teaching-documents/components/blockLabels'
import { useBlockDragReorder } from '@/pages/teaching-documents/components/useBlockDragReorder'
import { paginationGapAnchors, type EditorPaginationLayout } from './paginationDecorations'
import { BOX_CHILD_SELECT_EVENT, blockIdFromEditorSelection, isExternalDocumentSync, type BoxChildSelectDetail } from './selection'

export interface PaginatedCanvasProps {
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

  // ─── 选中与块操作（与 EditorCanvas 对齐） ───────────────────────────────
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
  /** 将分页编辑画布的页数回传给页面级快速翻页控件。 */
  onPageCountChange?: (count: number) => void

  // ─── 页眉页脚 chrome ────────────────────────────────────────────────────
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
}

export function PaginatedCanvas(props: PaginatedCanvasProps) {
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
  } = props

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

  // 编辑画布使用 document 立即回显；精确分页使用空闲期后的稳定快照。
  // 这避免长文档每次键入都重建隐藏的 TeachingDocumentRenderer 与测量管线。
  const { layoutDocument, layoutPending } = useDeferredPaginationDocument(document, layoutUpdateDelayMs)

  // ─── 隐藏测量根（与独立预览共用同一渲染器与管线） ───────────────────────
  const [measureRoot, setMeasureRoot] = useState<HTMLElement | null>(null)

  const paginationState = usePagination({
    document: layoutDocument,
    paper,
    printLayout,
    measureRoot,
    resolveQuestion,
    fontVars,
    renderVersion,
    debounceMs,
    geometryAdapter,
    paragraphGeometryAdapter,
    boxGeometryAdapter,
    questionGeometryAdapter,
    readinessWait,
  })
  const { pagination, readiness, generation, settled, choiceLayoutOverrides } = paginationState
  const [documentEditor, setDocumentEditor] = useState<Editor | null>(null)

  // ─── 编辑器选区追踪（与 EditorCanvas 一致） ─────────────────────────────
  const handleSelectionUpdate = useCallback((editor: Editor) => {
    const blockId = blockIdFromEditorSelection(editor.state)
    if (blockId && blockId !== '__empty__') onSelect(blockId)
  }, [onSelect])

  const handleEditorReady = useCallback((editor: Editor | null) => {
    setDocumentEditor(editor)
    onEditorReady?.(editor)
    if (!editor) return
    editor.on('selectionUpdate', ({ transaction }) => {
      if (!isExternalDocumentSync(transaction)) handleSelectionUpdate(editor)
    })
  }, [onEditorReady, handleSelectionUpdate])

  useEffect(() => {
    const handleChildSelect = (event: Event) => {
      const detail = (event as CustomEvent<BoxChildSelectDetail>).detail
      if (detail?.blockId) onSelect(detail.blockId)
    }
    window.addEventListener(BOX_CHILD_SELECT_EVENT, handleChildSelect)
    return () => window.removeEventListener(BOX_CHILD_SELECT_EVENT, handleChildSelect)
  }, [onSelect])

  const pages = pagination?.pages ?? []
  useEffect(() => {
    onPageCountChange?.(pages.length || 1)
  }, [onPageCountChange, pages.length])
  const pageGapPx = 24
  const paginationLayout = useMemo<EditorPaginationLayout | null>(() => pagination ? ({
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
  }) : null, [contentWidthPx, layoutDocument, marginBottomPx, marginLeftPx, marginRightPx, marginTopPx, metrics.contentHeightPx, metrics.footerHeightPx, metrics.headerHeightPx, pageWidthPx, pagination])
  const finalPageBlankPx = pagination?.pages.length
    ? Math.max(0, metrics.contentHeightPx - pagination.pages[pagination.pages.length - 1].usedHeight)
    : 0

  const selectionNodeType = documentEditor && documentEditor.state.selection.$from.depth >= 1
    ? documentEditor.state.selection.$from.node(1).type.name
    : ''
  const showTextFormatting = selectionNodeType === 'docHeading' || selectionNodeType === 'docParagraph'
  const [contentRoot, setContentRoot] = useState<HTMLDivElement | null>(null)
  const [hoveredBlockId, setHoveredBlockId] = useState('')
  const handleBlockHover = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-block-id]') : null
    const blockId = target?.dataset.blockId || ''
    if (!blockId) return
    setHoveredBlockId((current) => {
      // 从卡片内段落移动到段落下方留白时，最近的 data-block-id 会变成
      // 外层卡片。保留原段落锚点，才能穿过留白点击到悬浮的 “+”。
      const currentOwner = document.content.find((block) => block.type === 'box' && block.children.some((child) => child.id === current))
      if (currentOwner?.id === blockId) return current
      return current === blockId ? current : blockId
    })
  }, [document.content])
  const insertAnchorId = hoveredBlockId || selectedId
  const insertAnchorBoxId = useMemo(() => {
    if (!insertAnchorId) return ''
    return document.content.find((block) => block.type === 'box' && block.children.some((child) => child.id === insertAnchorId))?.id || ''
  }, [document.content, insertAnchorId])
  const totalPages = pages.length || 1
  const diagnosticCount = pagination?.diagnostics.length ?? 0
  // content-visibility 只优化编辑画布，不会影响隐藏测量树和最终导出精度。
  const shouldVirtualizeOffscreen = document.content.length >= 24
  const dragHandlers = useBlockDragReorder({ document, onSelect, onReorder, onMoveSection })
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
      className="td-pagination-experiment td-paginated-canvas td-theme-print min-w-0"
      style={fontVars as CSSProperties | undefined}
      data-layout-pending={String(layoutPending)}
    >
      <span className="sr-only" aria-live="polite">
        {layoutPending ? '内容已更新，正在等待重新排版。' : '分页布局已更新。'}
      </span>
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

      {/* 纸张列：内容区宽度 = contentWidthPx，居中。 */}
      <div className="pb-8" style={{ zoom: viewZoom }}>
        <div
          className="td-editor-fonts td-paper-page td-editor-chrome relative mx-auto border border-zinc-200 bg-white shadow-sm dark:border-zinc-800"
          style={{
            width: `${pageWidthPx}px`,
            minHeight: `${metrics.pageHeightPx}px`,
            padding: `${marginTopPx}px ${marginRightPx}px ${marginBottomPx}px ${marginLeftPx}px`,
            boxSizing: 'border-box',
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
          <div className="relative" {...dragHandlers} onPointerMoveCapture={handleBlockHover}>
            <div ref={setContentRoot} data-teaching-page-content="" style={{ width: `${contentWidthPx}px` }}>
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
                  paginationLayout={paginationLayout}
                  pagination={pagination}
                  printLayout={printLayout}
                  pageGapPx={pageGapPx}
                  virtualizeOffscreen={shouldVirtualizeOffscreen}
                />
              ) : <BlockInsertPoint empty onInsert={(type, headingLevel) => onInsertAfter(type, '', headingLevel)} />}
            </div>

            {selectedId ? (
              <>
                <FloatingBlockToolbar
                  visible
                  anchorBlockId={selectedId}
                  anchorRoot={contentRoot}
                  isBoxChild={selectedIsBoxChild}
                  textEditor={documentEditor}
                  showTextFormatting={showTextFormatting}
                  onMove={onMove}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                  onOpenProperties={onOpenProperties}
                  onEditQuestion={onEditQuestion}
                />
              </>
            ) : null}

            {insertAnchorId ? (
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

          {printLayout.footer.enabled ? (
            <>
              <div aria-hidden="true" style={{ height: `${finalPageBlankPx}px` }} />
              <PrintChrome
                section="footer"
                slots={printLayout.footer.slots}
                documentTitle={document.title}
                documentType={document.documentType}
                pageNumber={totalPages}
                totalPages={totalPages}
                printLayout={printLayout}
                activeSlot={editingChromeSlot?.section === 'footer' ? editingChromeSlot.slot : undefined}
                onSlotEdit={onChromeSlotEdit}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
