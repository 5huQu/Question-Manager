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
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import type {
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
  onInsertAfter: (type: TeachingBlock['type'], afterBlockId: string) => void
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenProperties: () => void
  onReorder: (order: string[], mergeKey: string) => void
  onEditQuestion?: () => void
  onEditorChange?: (doc: TeachingDocumentV1) => void
  onEditorReady?: (editor: Editor | null) => void

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
    onEditQuestion,
    onEditorChange,
    onEditorReady,
    editingChromeSlot,
    onChromeSlotEdit,
    geometryAdapter,
    paragraphGeometryAdapter,
    boxGeometryAdapter,
    questionGeometryAdapter,
    readinessWait,
    debounceMs,
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

  // ─── 隐藏测量根（与独立预览共用同一渲染器与管线） ───────────────────────
  const [measureRoot, setMeasureRoot] = useState<HTMLElement | null>(null)

  const paginationState = usePagination({
    document,
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
  const { pagination, readiness, generation, settled } = paginationState
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
  const pageGapPx = 24
  const paginationLayout = useMemo<EditorPaginationLayout | null>(() => pagination ? ({
    anchors: paginationGapAnchors(document, pagination, metrics.contentHeightPx),
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
  }) : null, [contentWidthPx, document, marginBottomPx, marginLeftPx, marginRightPx, marginTopPx, metrics.contentHeightPx, metrics.footerHeightPx, metrics.headerHeightPx, pageWidthPx, pagination])
  const finalPageBlankPx = pagination?.pages.length
    ? Math.max(0, metrics.contentHeightPx - pagination.pages[pagination.pages.length - 1].usedHeight)
    : 0

  const selectedBlockIndex = document.content.findIndex(
    (block) => block.id === selectedTopLevelId,
  )
  const selectionNodeType = documentEditor && documentEditor.state.selection.$from.depth >= 1
    ? documentEditor.state.selection.$from.node(1).type.name
    : ''
  const showTextFormatting = selectionNodeType === 'docHeading' || selectionNodeType === 'docParagraph'
  const [contentRoot, setContentRoot] = useState<HTMLDivElement | null>(null)
  const totalPages = pages.length || 1
  const diagnosticCount = pagination?.diagnostics.length ?? 0
  const dragHandlers = useBlockDragReorder({ document, onSelect, onReorder })

  return (
    <div
      className="td-pagination-experiment td-paginated-canvas td-theme-print min-w-0"
      style={fontVars as CSSProperties | undefined}
    >
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
        <div ref={setMeasureRoot}>
          <TeachingDocumentRenderer
            document={document}
            resolveQuestion={resolveQuestion}
            resolveFigure={resolveFigure}
            eagerImages
            surface="paper"
          />
        </div>
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
          <div className="relative" {...dragHandlers}>
            <div ref={setContentRoot} data-teaching-page-content="" style={{ width: `${contentWidthPx}px` }}>
              <header
                className="td-document-header mb-8 text-center"
                {...{ 'data-teaching-document-header': '' }}
              >
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {document.title || '未命名文档'}
                </h1>
              </header>

              <DocumentEditor
                document={document}
                onChange={onEditorChange || (() => {})}
                resolvers={{ resolveQuestion, resolveFigure }}
                onEditorReady={handleEditorReady}
                paginationLayout={paginationLayout}
                pagination={pagination}
                printLayout={printLayout}
                pageGapPx={pageGapPx}
              />

              {!document.content.length ? (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/10 p-12 text-center dark:border-zinc-800">
                  <p className="text-sm text-zinc-400 dark:text-zinc-500">
                    文档为空，使用顶部“插入”按钮添加内容。
                  </p>
                </div>
              ) : null}
            </div>

            {selectedId ? (
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

        {/* 块间插入点（选中块后显示） */}
        {selectedBlockIndex >= 0 ? (
          <div className="mx-auto" style={{ width: `${contentWidthPx}px` }}>
            <BlockInsertPoint onInsert={(type) => onInsertAfter(type, selectedTopLevelId)} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
