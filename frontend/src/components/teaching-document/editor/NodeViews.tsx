/**
 * 块级 NodeView 组件
 *
 * 每个非文本块（figure/question/box/spacer/divider/pageBreak/blockMath/rawMarkdown/unknown）
 * 使用 ReactNodeViewRenderer 渲染。NodeView 只负责显示和局部交互（点击选中、打开对话框）。
 * 文本块（heading/paragraph）直接渲染为可编辑 ProseMirror 节点，不需要 NodeView。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import 'katex/dist/katex.min.css'
import { CornerDownRight, ImageOff, ArrowDown, ArrowUp, Trash2, Columns3, Plus, Minus } from 'lucide-react'
import type { FigureAssetRef, FigureBlock, SpacerBlock, TeachingBlock, BoxBlock, BoxChildBlock, QuestionBlock, QuestionDisplayOptions, TeachingDocumentV1, TeachingInline, ParagraphBlock, TableCell } from '@/types/teachingDocument'
import type { QuestionResolution, FigureResolution, QuestionLayoutEditor } from '../blocks/BlockRenderer'
import { getBoxTemplateOrFallback } from '@/utils/teachingDocument/boxTemplates'
import { boxBodyStyle, boxFrameStyle, parseBoxAppearance, skinBoxBodyStyle, skinBoxFrameStyle } from '@/utils/teachingDocument/boxAppearance'
import { parseTeachingSkinRef, resolveBoxSkin, resolveTeachingSkinDesignRenderState, resolveTeachingSkinVariantRequest } from '@/utils/teachingDocument/skins'
import { createQuestionRuntimeModel } from '@/utils/teachingDocument/layout/questionRegions'
import { BoxFragmentRenderer, BoxIcon, QuestionRuntimeContent, QuestionPlaceholder } from '../blocks/BlockRenderer'
import { BlockInlineEditor } from '../BlockInlineEditor/BlockInlineEditor'
import { BoxFlowEditor } from './BoxFlowEditor'
import { MarkdownContent } from '@/components/MarkdownContent'
import { DEFAULT_A4_PAPER, newTeachingBlock, sliceTeachingInlines, type PaperSpec, type PaginationResult, type PrintLayoutSpec, type BoxFragmentPaginationItem, type QuestionFragmentPaginationItem, type ParagraphBoxChildFragmentPaginationItem, type InlineRange } from '@/utils/teachingDocument'
import { BlockInsertPoint } from '@/pages/teaching-documents/components/BlockInsertMenu'
import { emitBoxChildSelect } from './selection'
import { PrintChrome } from '../PrintChrome'
import { effectiveSpacerHeightMm } from '@/utils/teachingDocument/layoutCompat'
import { renderTeachingDocumentKatex } from '@/utils/teachingDocument/katexCache'
import { clampFigureWidthMm } from './resizeLogic'
import { resolveFigureLayout, FIGURE_LAYOUT_PRESETS, type FigureLayoutPreset } from '@/utils/teachingDocument/figureLayoutPresets'
import {
  ImageResizeOverlay,
  SpacerResizeHandle,
  useFigureResizeKeyboard,
  useSpacerResizeKeyboard,
} from './ResizeHandles'

// ─── Resolver Context ────────────────────────────────────────────────────────

export interface DocumentEditorResolvers {
  resolveQuestion?: (questionId: string) => QuestionResolution
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  skinPresetBindings?: Readonly<Record<string, string>>
}

const ResolverContext = createContext<DocumentEditorResolvers>({})

export function ResolverProvider({ resolvers, children }: { resolvers: DocumentEditorResolvers; children: React.ReactNode }) {
  return <ResolverContext.Provider value={resolvers}>{children}</ResolverContext.Provider>
}

function useResolvers() {
  return useContext(ResolverContext)
}

// ─── Paper Context ──────────────────────────────────────────────────────────

/**
 * 纸张规格上下文：NodeView 据此计算内容区宽度（图片宽度上限、mm 渲染）。
 * 由 DocumentEditor 从 document.style 解析后提供；缺省为 A4 portrait。
 */
const PaperContext = createContext<PaperSpec>(DEFAULT_A4_PAPER)

interface PaginationContextValue {
  /** 分页 chrome 只需标题与类型；不要把整篇文档放入 context，避免键入回传时重渲染全部 NodeView。 */
  documentTitle: string
  documentType: TeachingDocumentV1['documentType']
  pagination: PaginationResult | null
  paper: PaperSpec
  printLayout: PrintLayoutSpec
  pageGapPx: number
}

const PaginationContext = createContext<PaginationContextValue | null>(null)

export function PaperProvider({ paper, children }: { paper: PaperSpec; children: React.ReactNode }) {
  return <PaperContext.Provider value={paper}>{children}</PaperContext.Provider>
}

export function PaginationProvider({ value, children }: { value: PaginationContextValue; children: React.ReactNode }) {
  return <PaginationContext.Provider value={value}>{children}</PaginationContext.Provider>
}

function usePaginationContext() {
  return useContext(PaginationContext)
}

function PageTransition({ afterPageIndex, context }: { afterPageIndex: number; context: PaginationContextValue }) {
  const page = context.pagination?.pages[afterPageIndex]
  if (!page) return null
  const metrics = {
    pageWidthPx: context.paper.widthMm * (96 / 25.4),
    contentHeightPx: (context.paper.heightMm - context.paper.marginTopMm - context.paper.marginBottomMm) * (96 / 25.4)
      - (context.printLayout.header.enabled ? context.printLayout.header.heightMm * (96 / 25.4) : 0)
      - (context.printLayout.footer.enabled ? context.printLayout.footer.heightMm * (96 / 25.4) : 0),
  }
  const blank = Math.max(0, metrics.contentHeightPx - page.usedHeight)
  return (
    <div className="td-page-transition-react" aria-hidden="true">
      <div style={{ height: `${blank}px` }} />
      {context.printLayout.footer.enabled ? (
        <PrintChrome section="footer" slots={context.printLayout.footer.slots} documentTitle={context.documentTitle} documentType={context.documentType} pageNumber={afterPageIndex + 1} totalPages={context.pagination?.pages.length || 1} printLayout={context.printLayout} />
      ) : null}
      <div
        className="td-page-transition-react-band"
        style={{
          width: `${metrics.pageWidthPx}px`,
          marginLeft: `${-context.paper.marginLeftMm * (96 / 25.4)}px`,
          '--td-page-margin-bottom': `${context.paper.marginBottomMm * (96 / 25.4)}px`,
          '--td-page-margin-top': `${context.paper.marginTopMm * (96 / 25.4)}px`,
          '--td-page-gap': `${context.pageGapPx}px`,
        } as CSSProperties}
      >
        <span className="td-page-transition-bottom-margin" />
        <span className="td-page-transition-physical-gap">
          <span className="td-page-transition-label">{`第 ${afterPageIndex + 2} 页`}</span>
        </span>
        <span className="td-page-transition-top-margin" />
      </div>
      {context.printLayout.header.enabled ? (
        <PrintChrome section="header" slots={context.printLayout.header.slots} documentTitle={context.documentTitle} documentType={context.documentType} pageNumber={afterPageIndex + 2} totalPages={context.pagination?.pages.length || 1} printLayout={context.printLayout} />
      ) : null}
    </div>
  )
}

export function usePaper(): PaperSpec {
  return useContext(PaperContext)
}

/** 纸张内容区宽度 mm（扣除左右页边距） */
export function paperContentWidthMm(paper: PaperSpec): number {
  return paper.widthMm - paper.marginLeftMm - paper.marginRightMm
}

// ─── 选中状态样式 ────────────────────────────────────────────────────────────

function selectionRing(selected: boolean) {
  return `td-node-selectable${selected ? ' is-selected' : ''}`
}

// ─── BlockMath NodeView ──────────────────────────────────────────────────────

export function BlockMathNodeView({ node, selected }: NodeViewProps) {
  const blockId = String(node.attrs.blockId || '')
  const latex = String(node.attrs.latex || '')
  const label = String(node.attrs.label || '')
  const html = useMemo(() => {
    if (!latex) return ''
    return renderTeachingDocumentKatex(latex, true)
  }, [latex])

  return (
    <NodeViewWrapper className={`td-block-math my-4 ${selectionRing(selected)}`} data-block-id={blockId}>
      <div className="overflow-x-auto text-center" data-block-type="blockMath">
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="inline-block rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            <code>{latex || '公式为空'}</code>
            <span className="ml-2 text-xs text-amber-600">公式格式有误</span>
          </span>
        )}
        {label ? <span className="float-right text-sm text-zinc-400">{label}</span> : null}
      </div>
    </NodeViewWrapper>
  )
}

// ─── Table NodeView ─────────────────────────────────────────────────────────

function emptyTableCell(): TableCell {
  return { content: [{ type: 'text', text: '' }] }
}

function parseTableRows(raw: unknown): TableCell[][] {
  try {
    const rows = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(rows) || !rows.length) throw new Error('empty')
    const width = Array.isArray(rows[0]) && rows[0].length ? Math.min(12, rows[0].length) : 2
    return rows.slice(0, 20).map((row) => Array.from({ length: width }, (_, index) => {
      const cell = Array.isArray(row) ? row[index] : undefined
      return cell && typeof cell === 'object' && Array.isArray((cell as TableCell).content)
        ? { content: (cell as TableCell).content }
        : emptyTableCell()
    }))
  } catch {
    return Array.from({ length: 2 }, () => Array.from({ length: 2 }, emptyTableCell))
  }
}

/** 表格保持为一个原子块；格内用既有 BlockInlineEditor，天然支持行内 LaTeX。 */
export function TableNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const blockId = String(node.attrs.blockId || '')
  const rows = useMemo(() => parseTableRows(node.attrs.rows), [node.attrs.rows])
  const hasHeader = node.attrs.hasHeader !== false
  return (
    <NodeViewWrapper className={`td-table my-5 ${selectionRing(selected)}`} data-block-id={blockId}>
      <EditableTable blockId={blockId} rows={rows} hasHeader={hasHeader} selected={selected} onRowsChange={(next) => updateAttributes({ rows: JSON.stringify(next) })} onHeaderChange={(next) => updateAttributes({ hasHeader: next })} />
    </NodeViewWrapper>
  )
}

function EditableTable({
  blockId,
  rows,
  hasHeader,
  selected,
  onRowsChange,
  onHeaderChange,
}: {
  blockId: string
  rows: TableCell[][]
  hasHeader: boolean
  selected: boolean
  onRowsChange: (rows: TableCell[][]) => void
  onHeaderChange: (hasHeader: boolean) => void
}) {
  const updateRows = onRowsChange
  const updateCell = useCallback((rowIndex: number, columnIndex: number, content: TeachingInline[]) => {
    updateRows(rows.map((row, currentRow) => currentRow === rowIndex
      ? row.map((cell, currentColumn) => currentColumn === columnIndex ? { ...cell, content } : cell)
      : row))
  }, [rows, updateRows])
  const addRow = useCallback(() => {
    if (rows.length >= 20) return
    updateRows([...rows, Array.from({ length: rows[0]?.length || 2 }, emptyTableCell)])
  }, [rows, updateRows])
  const removeRow = useCallback(() => {
    if (rows.length <= 1) return
    updateRows(rows.slice(0, -1))
  }, [rows, updateRows])
  const addColumn = useCallback(() => {
    if ((rows[0]?.length || 0) >= 12) return
    updateRows(rows.map((row) => [...row, emptyTableCell()]))
  }, [rows, updateRows])
  const removeColumn = useCallback(() => {
    if ((rows[0]?.length || 0) <= 1) return
    updateRows(rows.map((row) => row.slice(0, -1)))
  }, [rows, updateRows])

  return (
    <div className="td-table my-5" data-block-id={blockId}>
      {selected ? (
        <div className="mb-2 flex items-center gap-1" data-print-hide="">
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] text-zinc-500"><Columns3 className="size-3.5" />表格</span>
          <TableControl label="添加行" onClick={addRow}><Plus className="size-3" />行</TableControl>
          <TableControl label="删除末行" onClick={removeRow} disabled={rows.length <= 1}><Minus className="size-3" />行</TableControl>
          <TableControl label="添加列" onClick={addColumn}><Plus className="size-3" />列</TableControl>
          <TableControl label="删除末列" onClick={removeColumn} disabled={(rows[0]?.length || 0) <= 1}><Minus className="size-3" />列</TableControl>
          <label className="ml-2 flex items-center gap-1 text-[11px] text-zinc-500"><input type="checkbox" checked={hasHeader} onChange={(event) => onHeaderChange(event.target.checked)} />首行表头</label>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-zinc-300 dark:border-zinc-700">
        <table className="w-full table-fixed border-collapse text-sm">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={hasHeader && rowIndex === 0 ? 'bg-zinc-50 dark:bg-zinc-900/60' : ''}>
                {row.map((cell, columnIndex) => (
                  <td key={columnIndex} className="border border-zinc-200 align-top dark:border-zinc-700">
                    <BlockInlineEditor
                      inlines={cell.content}
                      variant="embedded"
                      toolbar="floating"
                      ariaLabel={`表格第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`}
                      onChange={(content) => updateCell(rowIndex, columnIndex, content)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TableControl({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} disabled={disabled} onClick={onClick} className="inline-flex items-center gap-0.5 rounded border border-zinc-200 px-1.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-35 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{children}</button>
}

// ─── Figure NodeView ─────────────────────────────────────────────────────────

export function FigureNodeView({ node, selected, editor }: NodeViewProps) {
  const { resolveFigure } = useResolvers()
  const paper = usePaper()
  const contentWidthMm = paperContentWidthMm(paper)
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined)
  const [dragWidthMm, setDragWidthMm] = useState<number | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const blockId = String(node.attrs.blockId || '')

  const asset: FigureAssetRef = useMemo(() => {
    try {
      return JSON.parse(String(node.attrs.asset || '{}'))
    } catch {
      return { type: 'documentAsset', assetId: '' }
    }
  }, [node.attrs.asset])

  const alignment = String(node.attrs.alignment || 'center') as 'left' | 'center' | 'right'
  const layoutPreset = node.attrs.layoutPreset as FigureLayoutPreset | undefined
  const widthMm = node.attrs.widthMm != null ? Number(node.attrs.widthMm) : undefined
  const widthRatio = node.attrs.widthRatio != null ? Number(node.attrs.widthRatio) : undefined
  const textWrap = (['top-bottom', 'square-left', 'square-right'].includes(String(node.attrs.textWrap))
    ? String(node.attrs.textWrap)
    : 'top-bottom') as NonNullable<FigureBlock['textWrap']>
  const wrapGapMm = Math.max(0, Number(node.attrs.wrapGapMm) || 0)
  const caption = String(node.attrs.caption || '')
  const alt = String(node.attrs.alt || '')
  const groupItems = useMemo<NonNullable<FigureBlock['groupItems']>>(() => {
    try {
      const parsed = JSON.parse(String(node.attrs.groupItems || '[]'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, [node.attrs.groupItems])
  const groupColumns = [1, 2, 3].includes(Number(node.attrs.groupColumns))
    ? Number(node.attrs.groupColumns) as 1 | 2 | 3
    : 2
  const groupGapMm = Math.max(0, Number(node.attrs.groupGapMm) || 0)

  /** 供 effectiveFigureWidthMm 读取的最小 FigureBlock（widthMm 优先，widthRatio 回退） */
  const figureBlock = useMemo<FigureBlock>(() => ({
    type: 'figure',
    id: blockId,
    asset,
    alignment,
    ...(layoutPreset ? { layoutPreset } : {}),
    ...(widthMm != null && Number.isFinite(widthMm) ? { widthMm } : {}),
    ...(widthRatio != null && Number.isFinite(widthRatio) ? { widthRatio } : {}),
  }), [blockId, asset, alignment, layoutPreset, widthMm, widthRatio])

  const effectiveWidthMm = resolveFigureLayout({ preset: layoutPreset, explicitWidthMm: widthMm, legacyAlignment: alignment, legacyWidthRatio: widthRatio, containerWidthMm: contentWidthMm }).widthMm
  const displayWidthMm = dragWidthMm ?? effectiveWidthMm
  const mergeKey = `resize-figure-${blockId}`

  useFigureResizeKeyboard({
    editor,
    blockId,
    selected,
    currentWidthMm: displayWidthMm,
    contentWidthMm,
    mergeKey,
  })

  const resolution = useMemo<FigureResolution>(() => {
    const hasRef = asset.type === 'legacyPath'
      ? asset.path.trim() !== ''
      : asset.type === 'documentAsset'
        ? asset.assetId.trim() !== ''
        : asset.questionId.trim() !== '' && asset.figureId.trim() !== ''
    if (!hasRef) return { status: 'missing' }
    try {
      return resolveFigure ? resolveFigure(asset) : ''
    } catch {
      return { status: 'error' }
    }
  }, [asset, resolveFigure])

  const url = typeof resolution === 'string' ? resolution : ''

  useEffect(() => {
    if (!url) {
      setImageState('error')
      return
    }
    const image = imageRef.current
    setImageState(image?.complete ? (image.naturalWidth > 0 ? 'loaded' : 'error') : 'loading')
  }, [url])

  const resolvedLayout = resolveFigureLayout({ preset: layoutPreset, explicitWidthMm: widthMm, legacyAlignment: alignment, legacyWidthRatio: widthRatio, containerWidthMm: contentWidthMm })
  const alignClass = { left: 'mr-auto', center: 'mx-auto', right: 'ml-auto' }[resolvedLayout.alignment]
  const isSideWrapped = textWrap === 'square-left' || textWrap === 'square-right'
  const wrapperStyle: CSSProperties = isSideWrapped
    ? {
        float: textWrap === 'square-left' ? 'left' : 'right',
        clear: 'both',
        width: `${displayWidthMm}mm`,
        maxWidth: '100%',
        margin: `0 ${textWrap === 'square-left' ? wrapGapMm : 0}mm ${wrapGapMm}mm ${textWrap === 'square-right' ? wrapGapMm : 0}mm`,
      }
    : { clear: 'both' }

  /** pointerup 提交：钳制到内容区宽度后写入编辑器（一个 undo 步骤） */
  const handleCommitWidth = useCallback((mm: number) => {
    const next = clampFigureWidthMm(mm, contentWidthMm)
    editor.commands.setFigureWidth(blockId, next, mergeKey)
    setDragWidthMm(null)
  }, [editor, blockId, contentWidthMm, mergeKey])

  return (
    <NodeViewWrapper className={`td-figure ${isSideWrapped ? '' : 'my-4'} ${selectionRing(selected)}`} style={wrapperStyle} data-block-id={blockId} data-text-wrap={textWrap}>
      {selected ? (
        <div className="mb-2 flex items-center justify-center gap-1" data-print-hide="">
          {([
            ['block-center', '居中插图'],
            ['block-left', '左对齐'],
            ['block-right', '右对齐'],
            ['full-width', '通栏'],
          ] as const).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              className={`rounded border px-2 py-1 text-[11px] ${layoutPreset === preset ? 'border-zinc-900 bg-zinc-100 text-zinc-900' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'}`}
              onClick={() => {
                // 排版预设与 alignment 必须同步：resolveFigureLayout 以 preset 优先，
                // 只写 preset 会让属性面板的“对齐”显示过期值。
                const definition = FIGURE_LAYOUT_PRESETS.find((item) => item.id === preset)
                editor.commands.updateAttributes('docFigure', {
                  layoutPreset: preset,
                  ...(definition ? { alignment: definition.alignment } : {}),
                })
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {groupItems.length ? (
        <div
          className={`grid items-start ${isSideWrapped ? '' : alignClass}`}
          style={{
            width: isSideWrapped ? '100%' : `${displayWidthMm}mm`,
            maxWidth: '100%',
            gridTemplateColumns: `repeat(${groupColumns}, minmax(0, 1fr))`,
            gap: `${groupGapMm}mm`,
          }}
          data-figure-columns={groupColumns}
        >
          {groupItems.map((item) => (
            <FigureGroupEditorItem key={item.id} item={item} resolveFigure={resolveFigure} />
          ))}
        </div>
      ) : !url || imageState === 'error' ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 py-8 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/30">
          <ImageOff className="mr-2 size-5" />
          <span className="text-sm">图片资源缺失</span>
        </div>
      ) : (
        <figure className={isSideWrapped ? '' : alignClass} style={{ width: isSideWrapped ? '100%' : `${displayWidthMm}mm`, maxWidth: '100%' }}>
          <div className="relative flex min-h-32 w-full items-center justify-center">
            {imageState === 'loading' ? (
              <div className="absolute inset-0 flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
                图片加载中…
              </div>
            ) : null}
            <img
              ref={imageRef}
              src={url}
              alt={alt || caption || '文档图片'}
              className={`block h-auto max-h-[70vh] w-full rounded-lg border border-zinc-200 object-contain transition-opacity dark:border-zinc-800 ${imageState === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
              loading="lazy"
              onLoad={() => {
                setImageState('loaded')
                const image = imageRef.current
                if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
                  setAspectRatio(image.naturalWidth / image.naturalHeight)
                }
              }}
              onError={() => setImageState('error')}
            />
            {selected && imageState === 'loaded' ? (
              <ImageResizeOverlay
                currentWidthMm={displayWidthMm}
                maxWidthMm={contentWidthMm}
                aspectRatio={aspectRatio}
                onPreview={setDragWidthMm}
                onCommit={handleCommitWidth}
              />
            ) : null}
          </div>
          {caption ? <figcaption className="mt-1.5 text-center text-xs text-zinc-500">{caption}</figcaption> : null}
        </figure>
      )}
    </NodeViewWrapper>
  )
}

function FigureGroupEditorItem({
  item,
  resolveFigure,
}: {
  item: NonNullable<FigureBlock['groupItems']>[number]
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
}) {
  const resolution = useMemo<FigureResolution>(() => {
    try {
      return resolveFigure ? resolveFigure(item.asset) : ''
    } catch {
      return { status: 'error' }
    }
  }, [item.asset, resolveFigure])
  const url = typeof resolution === 'string' ? resolution : ''
  return (
    <figure className="min-w-0">
      {url ? (
        <img src={url} alt={item.alt || item.caption || '文档图片'} className="block h-auto max-h-[70vh] w-full rounded-lg border border-zinc-200 object-contain dark:border-zinc-800" />
      ) : (
        <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-xs text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/30">图片资源缺失</div>
      )}
      {item.caption ? <figcaption className="mt-1.5 text-center text-xs text-zinc-500">{item.caption}</figcaption> : null}
    </figure>
  )
}

// ─── Question NodeView ───────────────────────────────────────────────────────

export function QuestionNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const { resolveQuestion, resolveFigure } = useResolvers()
  const paper = usePaper()
  const questionId = String(node.attrs.questionId || '')
  const breakBehavior = ['auto', 'avoid', 'force-before'].includes(String(node.attrs.breakBehavior))
    ? String(node.attrs.breakBehavior) as QuestionBlock['breakBehavior']
    : 'auto'
  const display = useMemo<QuestionDisplayOptions>(() => {
    try {
      return JSON.parse(String(node.attrs.display || '{}')) as QuestionDisplayOptions
    } catch {
      return {}
    }
  }, [node.attrs.display])
  const updateInlineContent = useCallback((key: string, content: TeachingInline[]) => {
    const inlineContent = { ...(display.inlineContent || {}) }
    if (content.length) inlineContent[key] = content
    else delete inlineContent[key]
    const nextDisplay = { ...display }
    if (Object.keys(inlineContent).length) nextDisplay.inlineContent = inlineContent
    else delete nextDisplay.inlineContent
    updateAttributes({ display: JSON.stringify(nextDisplay) })
  }, [display, updateAttributes])
  const [dragAnswerHeightMm, setDragAnswerHeightMm] = useState<number | null>(null)
  const [dragFigureWidths, setDragFigureWidths] = useState<Record<string, number>>({})
  const [selectedInsertedFigureKey, setSelectedInsertedFigureKey] = useState('')
  const answerSpace = display.answerSpace
  const effectiveDisplay = dragAnswerHeightMm == null || !answerSpace
    ? display
    : { ...display, answerSpace: { ...answerSpace, heightMm: dragAnswerHeightMm } }
  const figureDisplay = Object.keys(dragFigureWidths).length
    ? {
        ...effectiveDisplay,
        figureOverrides: {
          ...effectiveDisplay.figureOverrides,
          ...Object.fromEntries(Object.entries(dragFigureWidths).map(([key, widthMm]) => [
            key,
            { ...effectiveDisplay.figureOverrides?.[key], widthMm },
          ])),
        },
      }
    : effectiveDisplay
  const localContent = useMemo(() => {
    const raw = String(node.attrs.localContent || '')
    if (!raw) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }, [node.attrs.localContent])

  const block = useMemo<QuestionBlock>(() => ({
    type: 'question',
    id: String(node.attrs.blockId || ''),
    questionId,
    breakBehavior,
    display: figureDisplay,
    ...(localContent ? { localContent } : {}),
  }), [breakBehavior, figureDisplay, localContent, node.attrs.blockId, questionId])
  const paginationContext = usePaginationContext()
  const questionFragments = paginationContext?.pagination?.pages.flatMap((page) => page.items
    .filter((item): item is QuestionFragmentPaginationItem => item.kind === 'fragment' && item.fragmentType === 'question' && item.blockId === block.id)
    .map((item) => ({ item, pageIndex: page.index }))) || []

  const commitAnswerHeight = useCallback((heightMm: number) => {
    if (!answerSpace) return
    updateAttributes({
      display: JSON.stringify({
        ...display,
        answerSpace: { ...answerSpace, heightMm },
      }),
    })
    setDragAnswerHeightMm(null)
  }, [answerSpace, display, updateAttributes])

  const previewFigureWidth = useCallback((figureKey: string, widthMm: number) => {
    setDragFigureWidths((current) => ({ ...current, [figureKey]: widthMm }))
  }, [])
  const commitFigureWidth = useCallback((figureKey: string, widthMm: number) => {
    updateAttributes({
      display: JSON.stringify({
        ...display,
        figureOverrides: {
          ...display.figureOverrides,
          [figureKey]: { ...display.figureOverrides?.[figureKey], widthMm },
        },
      }),
    })
    setDragFigureWidths((current) => {
      const next = { ...current }
      delete next[figureKey]
      return next
    })
  }, [display, updateAttributes])

  const resolution = resolveQuestion?.(questionId)
  const question = resolution && !('status' in resolution) ? resolution : undefined
  const effectiveQuestion = question ? (localContent ? { ...question, ...localContent } : question) : undefined
  const runtimeModel = useMemo(
    () => effectiveQuestion ? createQuestionRuntimeModel(block, effectiveQuestion) : null,
    [block, effectiveQuestion],
  )

  if (resolution && 'status' in resolution && resolution.status === 'loading') {
    return (
      <NodeViewWrapper className={`my-4 ${selectionRing(selected)}`} data-block-id={block.id}>
        <QuestionPlaceholder block={block} message="题目加载中…" status="loading" />
      </NodeViewWrapper>
    )
  }
  if (resolution && 'status' in resolution && resolution.status === 'error') {
    return (
      <NodeViewWrapper className={`my-4 ${selectionRing(selected)}`} data-block-id={block.id}>
        <QuestionPlaceholder block={block} message={`题目加载失败：${resolution.message}`} status="error" tone="error" />
      </NodeViewWrapper>
    )
  }
  if (resolution && 'status' in resolution && resolution.status === 'missing') {
    return (
      <NodeViewWrapper className={`my-4 ${selectionRing(selected)}`} data-block-id={block.id}>
        <QuestionPlaceholder block={block} message={resolution.message || `题目不存在（ID: ${questionId || '未设置'}）`} status="missing" />
      </NodeViewWrapper>
    )
  }

  if (!question || !runtimeModel) {
    return (
      <NodeViewWrapper className={`my-4 ${selectionRing(selected)}`} data-block-id={block.id}>
        <QuestionPlaceholder block={block} message={`题目不可用（ID: ${questionId || '未设置'}）`} status="missing" />
      </NodeViewWrapper>
    )
  }

  const updateFigurePlacement = (figureKey: string, patch: Record<string, unknown>) => {
    const current = display.figureOverrides?.[figureKey] || {}
    const placement = Object.fromEntries(Object.entries({ ...current, ...patch }).filter(([, value]) => value !== undefined))
    const figureOverrides = { ...display.figureOverrides }
    if (Object.keys(placement).length) figureOverrides[figureKey] = placement
    else delete figureOverrides[figureKey]
    const next = { ...display, ...(Object.keys(figureOverrides).length ? { figureOverrides } : {}) }
    if (!Object.keys(figureOverrides).length) delete next.figureOverrides
    updateAttributes({ display: JSON.stringify(next) })
  }

  const layoutEditor: QuestionLayoutEditor = {
    selected,
    contentWidthMm: paperContentWidthMm(paper),
    previewFigureWidth,
    commitFigureWidth,
    selectedFigureKey: selectedInsertedFigureKey,
    onFigureSelect: setSelectedInsertedFigureKey,
  }

  const insertedFigures = display.insertedFigures || []
  const selectedInsertedFigure = insertedFigures.find((figure) => figure.id === selectedInsertedFigureKey)
  const selectedQuestionFigure = question.figures.find((figure) => String(figure.id || figure.blockId || '') === selectedInsertedFigureKey)
  const selectedFigure = selectedInsertedFigure || selectedQuestionFigure
  const selectedFigureAlignment = selectedInsertedFigure?.alignment || display.figureOverrides?.[selectedInsertedFigureKey]?.alignment || 'center'
  const updateInsertedFigure = (patch: Record<string, unknown>) => {
    if (!selectedFigure) return
    if (!selectedInsertedFigure) {
      updateFigurePlacement(selectedInsertedFigureKey, patch)
      return
    }
    updateAttributes({ display: JSON.stringify({
      ...display,
      insertedFigures: insertedFigures.map((figure) => figure.id === selectedInsertedFigure.id ? { ...figure, ...patch } : figure),
    }) })
  }
  const deleteInsertedFigure = () => {
    if (!selectedInsertedFigure) return
    updateAttributes({ display: JSON.stringify({ ...display, insertedFigures: insertedFigures.filter((figure) => figure.id !== selectedInsertedFigure.id).map((figure, index) => ({ ...figure, order: index })) }) })
    setSelectedInsertedFigureKey('')
  }
  const moveInsertedFigure = (direction: -1 | 1) => {
    if (!selectedInsertedFigure) return
    const index = insertedFigures.findIndex((figure) => figure.id === selectedInsertedFigure.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= insertedFigures.length) return
    const next = [...insertedFigures]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateAttributes({ display: JSON.stringify({ ...display, insertedFigures: next.map((figure, itemIndex) => ({ ...figure, order: itemIndex })) }) })
  }

  return (
    <NodeViewWrapper className={selectionRing(selected)} data-block-id={block.id}>
      {selectedFigure ? (
        <div className="mb-2 flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white/95 p-1.5 text-[11px] shadow-sm dark:border-zinc-700 dark:bg-zinc-900" data-print-hide="">
          <span className="px-1 text-zinc-500">图片</span>
          <button type="button" title="左对齐" onClick={() => updateInsertedFigure({ alignment: 'left' })} className={`rounded px-2 py-1 ${selectedFigureAlignment === 'left' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100'}`}>左</button>
          <button type="button" title="居中" onClick={() => updateInsertedFigure({ alignment: 'center' })} className={`rounded px-2 py-1 ${selectedFigureAlignment === 'center' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100'}`}>中</button>
          <button type="button" title="右对齐" onClick={() => updateInsertedFigure({ alignment: 'right' })} className={`rounded px-2 py-1 ${selectedFigureAlignment === 'right' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100'}`}>右</button>
          <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          <button type="button" title="上移" disabled={!selectedInsertedFigure || insertedFigures.findIndex((figure) => figure.id === selectedInsertedFigure.id) === 0} onClick={() => moveInsertedFigure(-1)} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
          <button type="button" title="下移" disabled={!selectedInsertedFigure || insertedFigures.findIndex((figure) => figure.id === selectedInsertedFigure.id) === insertedFigures.length - 1} onClick={() => moveInsertedFigure(1)} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
          <button type="button" title={selectedInsertedFigure ? '删除图片' : '清除图片覆盖'} onClick={selectedInsertedFigure ? deleteInsertedFigure : () => updateFigurePlacement(selectedInsertedFigureKey, {})} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 className="size-3.5" /></button>
        </div>
      ) : null}
      {localContent ? (
        <div className="mt-2">
          <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50/60 px-1.5 py-0.5 text-[11px] font-normal tracking-wide text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">文档本地版本</span>
        </div>
      ) : null}
      <div className="relative">
        {questionFragments.length > 1 ? questionFragments.map(({ item, pageIndex }, index) => (
          <div key={`${item.fragmentIndex}:${pageIndex}`}>
            <QuestionRuntimeContent
              block={block}
              model={runtimeModel}
              continuation={item.continuation}
              regionItems={item.regionItems}
              layoutEditor={layoutEditor}
              resolveFigure={resolveFigure}
              typography={block.display?.typography}
              // 题卡文字在可编辑画布中常驻内部编辑器，用户无需先选中整道题即可划选文字。
              editableQuestionText
              onInlineContentChange={updateInlineContent}
            />
            {index < questionFragments.length - 1 ? <PageTransition afterPageIndex={pageIndex} context={paginationContext!} /> : null}
          </div>
        )) : (
          <QuestionRuntimeContent
            block={block}
            model={runtimeModel}
            continuation={questionFragments[0]?.item.continuation || 'single'}
            trimEndChrome={questionFragments[0]?.item.trimEndChrome}
            regionItems={questionFragments[0]?.item.regionItems}
            layoutEditor={layoutEditor}
            resolveFigure={resolveFigure}
            typography={block.display?.typography}
            editableQuestionText
            onInlineContentChange={updateInlineContent}
          />
        )}
        {selected && answerSpace ? (
          <div className="absolute inset-x-0 bottom-0 z-10" data-print-hide="">
            <SpacerResizeHandle
              currentHeightMm={dragAnswerHeightMm ?? answerSpace.heightMm}
              onPreview={setDragAnswerHeightMm}
              onCommit={commitAnswerHeight}
            />
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}

// ─── Box NodeView ────────────────────────────────────────────────────────────

const BOX_INSERTABLE_TYPES: TeachingBlock['type'][] = ['paragraph', 'rawMarkdown', 'blockMath', 'table', 'figure', 'tikz', 'question', 'divider', 'spacer']

function replaceInlineRange(inlines: TeachingInline[], range: InlineRange, replacement: TeachingInline[]): TeachingInline[] {
  const full = { start: { inlineIndex: 0 }, end: { inlineIndex: inlines.length } }
  const before = sliceTeachingInlines(inlines, { start: full.start, end: range.start }).map((entry) => entry.inline)
  const after = sliceTeachingInlines(inlines, { start: range.end, end: full.end }).map((entry) => entry.inline)
  return [...before, ...replacement, ...after]
}

export function BoxNodeView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const { resolveQuestion, resolveFigure, skinPresetBindings } = useResolvers()
  const templateId = String(node.attrs.templateId || 'concept')
  const title = String(node.attrs.title || '')
  const icon = String(node.attrs.icon || '')
  const appearance = useMemo(() => {
    try {
      return parseBoxAppearance(JSON.parse(String(node.attrs.appearance || '{}')))
    } catch {
      return undefined
    }
  }, [node.attrs.appearance])
  const skin = useMemo(() => {
    try { return parseTeachingSkinRef(node.attrs.skin ? JSON.parse(String(node.attrs.skin)) : undefined) } catch { return undefined }
  }, [node.attrs.skin])
  const breakBehavior = String(node.attrs.breakBehavior || 'auto')
  const children = useMemo<BoxChildBlock[]>(() => {
    try {
      return JSON.parse(String(node.attrs.children || '[]'))
    } catch {
      return []
    }
  }, [node.attrs.children])
  const [focusChildId, setFocusChildId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)

  const template = getBoxTemplateOrFallback(templateId)
  const boxBlock: BoxBlock = {
    type: 'box',
    id: String(node.attrs.blockId || ''),
    templateId,
    ...(title ? { title } : {}),
    ...(icon ? { icon } : {}),
    ...(appearance ? { appearance } : {}),
    ...(skin ? { skin } : {}),
    breakBehavior: breakBehavior as BoxBlock['breakBehavior'],
    children,
  }
  const paginationContext = usePaginationContext()
  const resolvedSkin = resolveBoxSkin(skin, templateId)
  const skinActive = resolvedSkin.status === 'resolved'
  const designVariables = skinActive
    ? resolveTeachingSkinDesignRenderState(resolvedSkin.definition, resolveTeachingSkinVariantRequest(resolvedSkin.skin, resolvedSkin.definition.id, undefined, skinPresetBindings)).cssVariables
    : undefined
  const boxFragments = paginationContext?.pagination?.pages.flatMap((page) => page.items
    .filter((item): item is BoxFragmentPaginationItem => item.kind === 'fragment' && item.fragmentType === 'box' && item.blockId === boxBlock.id)
    .map((item) => ({ item, pageIndex: page.index }))) || []

  const updateChildren = useCallback((nextChildren: BoxChildBlock[]) => {
    updateAttributes({ children: JSON.stringify(nextChildren) })
  }, [updateAttributes])

  const insertChildAfter = useCallback((afterId: string | undefined, type: TeachingBlock['type']) => {
    if (!BOX_INSERTABLE_TYPES.includes(type)) return
    const child = newTeachingBlock(type) as BoxChildBlock
    const index = afterId ? children.findIndex((item) => item.id === afterId) : -1
    const next = [...children]
    next.splice(index + 1, 0, child)
    updateChildren(next)
    setFocusChildId(child.type === 'paragraph' ? child.id : null)
    // 属性面板依赖外层文档状态；下一帧再发出选中事件，确保新子块已进入该状态。
    window.requestAnimationFrame(() => emitBoxChildSelect({ blockId: child.id, parentBlockId: boxBlock.id }))
  }, [boxBlock.id, children, updateChildren])

  const renderFragmentParagraph = useCallback((child: ParagraphBlock, item: ParagraphBoxChildFragmentPaginationItem) => {
    const fragmentInlines = sliceTeachingInlines(child.content, item.range).map((entry) => entry.inline)
    return (
      <div
        className="td-box-child-editor relative"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          emitBoxChildSelect({ blockId: child.id, parentBlockId: boxBlock.id })
        }}
      >
        <BlockInlineEditor
          key={`${child.id}:${item.fragmentIndex}`}
          inlines={fragmentInlines}
          variant="embedded"
          toolbar="floating"
          ariaLabel={`盒子内段落片段 ${item.fragmentIndex + 1}`}
          onChange={(content) => {
            updateChildren(children.map((current) => current.type === 'paragraph' && current.id === child.id
              ? { ...current, content: replaceInlineRange(current.content, item.range, content) }
              : current))}
          }
        />
      </div>
    )
  }, [boxBlock.id, children, updateChildren])

  const renderChildInsertPoint = useCallback((afterChildId: string) => (
    <BlockInsertPoint
      types={BOX_INSERTABLE_TYPES}
      onInsert={(type) => insertChildAfter(afterChildId, type)}
    />
  ), [insertChildAfter])

  const selectBox = useCallback(() => {
    const position = typeof getPos === 'function' ? getPos() : undefined
    if (typeof position !== 'number') return
    editor.chain().focus().setNodeSelection(position).run()
  }, [editor, getPos])

  const commitTitle = useCallback((nextTitle: string) => {
    setEditingTitle(false)
    updateAttributes({ title: nextTitle.trim() })
  }, [updateAttributes])

  return (
    <NodeViewWrapper className={`td-box my-5 ${selectionRing(selected)}`} data-block-id={boxBlock.id}>
      {boxFragments.length > 1 ? (
          boxFragments.map(({ item, pageIndex }, index) => (
            <div key={`${item.fragmentIndex}:${pageIndex}`}>
              <BoxFragmentRenderer
                block={boxBlock}
                item={item}
                resolvers={{ resolveQuestion, resolveFigure }}
                titleEditable={selected}
                onEditBoxTitle={(_, nextTitle) => commitTitle(nextTitle)}
                onSelectBox={selectBox}
                renderEditableParagraph={renderFragmentParagraph}
                renderInsertPoint={renderChildInsertPoint}
                onSelectChild={(blockId) => emitBoxChildSelect({ blockId, parentBlockId: boxBlock.id })}
              />
              {index < boxFragments.length - 1 ? <PageTransition afterPageIndex={pageIndex} context={paginationContext!} /> : null}
            </div>
          ))
      ) : (
        <div className={`td-box overflow-hidden border ${skinActive ? resolvedSkin.definition.className : ''}`} data-skin-id={skinActive ? resolvedSkin.definition.id : undefined} data-skin-state={skin ? resolvedSkin.status : undefined} style={{ ...(skinActive ? skinBoxFrameStyle(appearance, template) : boxFrameStyle(appearance, template)), ...(designVariables || {}) } as CSSProperties}>
          {(template.showHeader || title) ? (
            <div className="td-box-header flex min-w-0 items-center gap-2 px-4 py-2.5" style={skinActive ? undefined : { background: `var(--box-${template.tone}-header)` }} onPointerDown={selectBox}>
              <BoxIcon name={icon || template.defaultIcon} className="size-4 shrink-0" />
              {editingTitle && selected ? (
                <input
                  autoFocus
                  defaultValue={title || template.label}
                  aria-label="卡片标题"
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitTitle(event.currentTarget.value) }
                    if (event.key === 'Escape') { event.preventDefault(); setEditingTitle(false) }
                  }}
                  onBlur={(event) => commitTitle(event.currentTarget.value)}
                  className={`min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none ${skinActive ? '' : 'text-zinc-700 dark:text-zinc-200'}`}
                />
              ) : (
                <span onDoubleClick={(event) => { event.stopPropagation(); setEditingTitle(true) }} title="单击选中卡片，双击编辑标题" className={`text-sm font-semibold ${skinActive ? '' : 'text-zinc-700 dark:text-zinc-200'} ${selected ? 'cursor-text rounded hover:underline' : ''}`}>{title || template.label}</span>
              )}
            </div>
          ) : null}
          <div className="td-box-body px-4 py-3" style={skinActive ? skinBoxBodyStyle(appearance, template) : boxBodyStyle(appearance, template)}>
            {children.length ? (
              <BoxFlowEditor
                children={children}
                boxId={boxBlock.id}
                autoFocusChildId={focusChildId}
                onChange={updateChildren}
                onActiveChildChange={(childId) => emitBoxChildSelect({ blockId: childId, parentBlockId: boxBlock.id })}
              />
            ) : (
              <BlockInsertPoint
                empty
                emptySize="box"
                emptyLabel="向卡片添加内容"
                emptyDescription="点击后可添加正文、题目、公式、图片等"
                types={BOX_INSERTABLE_TYPES}
                onInsert={(type) => insertChildAfter(undefined, type)}
              />
            )}
            {children.length ? (
              <BlockInsertPoint
                types={BOX_INSERTABLE_TYPES}
                onInsert={(type) => insertChildAfter(undefined, type)}
              />
            ) : null}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

// ─── Divider NodeView ────────────────────────────────────────────────────────

export function DividerNodeView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`my-5 ${selectionRing(selected)}`} data-block-id={String(node.attrs.blockId || '')}>
      <hr className="border-t border-zinc-200 dark:border-zinc-800" />
    </NodeViewWrapper>
  )
}

// ─── Spacer NodeView ─────────────────────────────────────────────────────────

export function SpacerNodeView({ node, selected, editor }: NodeViewProps) {
  const blockId = String(node.attrs.blockId || '')
  const heightEm = Number(node.attrs.heightEm) || 2
  const heightMm = node.attrs.heightMm != null ? Number(node.attrs.heightMm) : undefined
  const [dragHeightMm, setDragHeightMm] = useState<number | null>(null)

  /** 供 effectiveSpacerHeightMm 读取的最小 SpacerBlock（heightMm 优先，heightEm 回退） */
  const spacerBlock = useMemo<SpacerBlock>(() => ({
    type: 'spacer',
    id: blockId,
    heightEm,
    ...(heightMm != null && Number.isFinite(heightMm) ? { heightMm } : {}),
  }), [blockId, heightEm, heightMm])

  const effectiveHeightMm = effectiveSpacerHeightMm(spacerBlock)
  const displayHeightMm = dragHeightMm ?? effectiveHeightMm
  const mergeKey = `resize-spacer-${blockId}`

  useSpacerResizeKeyboard({
    editor,
    blockId,
    selected,
    currentHeightMm: displayHeightMm,
    mergeKey,
  })

  /** pointerup 提交：写入编辑器（一个 undo 步骤）；clamp 由 command 保证 */
  const handleCommitHeight = useCallback((mm: number) => {
    editor.commands.setSpacerHeight(blockId, mm, mergeKey)
    setDragHeightMm(null)
  }, [editor, blockId, mergeKey])

  return (
    <NodeViewWrapper className={`${selectionRing(selected)}`} data-block-id={blockId}>
      <div
        className={`td-spacer relative ${
          selected
            ? 'rounded-md border border-dashed border-sky-400/70 bg-sky-50/40 dark:border-sky-600/60 dark:bg-sky-950/20'
            : ''
        }`}
        style={{ height: `${displayHeightMm}mm` }}
        aria-hidden={!selected}
        data-block-type="spacer"
      >
        {selected ? (
          <SpacerResizeHandle
            currentHeightMm={displayHeightMm}
            onPreview={setDragHeightMm}
            onCommit={handleCommitHeight}
          />
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}

// ─── PageBreak NodeView ──────────────────────────────────────────────────────

export function PageBreakNodeView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`td-page-break-marker ${selected ? 'is-selected' : ''}`} data-block-id={String(node.attrs.blockId || '')}>
      <div className="td-page-break-marker-line" aria-label="手动换页符">
        <span />
        <span className="td-page-break-marker-label">
          <CornerDownRight className="size-3" />
          换页
          <span className="font-normal text-zinc-400">下一项从新页开始</span>
        </span>
        <span />
      </div>
    </NodeViewWrapper>
  )
}

// ─── RawMarkdown NodeView ────────────────────────────────────────────────────

export function RawMarkdownNodeView({ node, selected }: NodeViewProps) {
  const markdown = String(node.attrs.markdown || '')
  return (
    <NodeViewWrapper className={`td-raw-markdown my-3 ${selectionRing(selected)}`} data-block-id={String(node.attrs.blockId || '')}>
      <MarkdownContent content={markdown} />
    </NodeViewWrapper>
  )
}

/** TikZ is persisted as source plus a stable SVG asset. Rendering never injects SVG markup. */
export function TikzNodeView({ node, selected }: NodeViewProps) {
  const { resolveFigure } = useResolvers()
  const paper = usePaper()
  const contentWidthMm = paperContentWidthMm(paper)
  const assetId = String(node.attrs.svgAssetId || '')
  const resolution = assetId && resolveFigure ? resolveFigure({ type: 'documentAsset', assetId }) : undefined
  const url = typeof resolution === 'string' ? resolution : ''
  const stale = !assetId || String(node.attrs.sourceHash || '') === ''
  const layoutPreset = node.attrs.layoutPreset as FigureLayoutPreset | undefined
  const layout = resolveFigureLayout({
    preset: layoutPreset,
    explicitWidthMm: node.attrs.widthMm != null ? Number(node.attrs.widthMm) : undefined,
    legacyAlignment: String(node.attrs.alignment || 'center') as 'left' | 'center' | 'right',
    containerWidthMm: contentWidthMm,
  })
  const alignClass = { left: 'mr-auto', center: 'mx-auto', right: 'ml-auto' }[layout.alignment]
  const caption = String(node.attrs.caption || '')
  // 对齐放在内部 figure 上：NodeViewWrapper 的选中态会附加负边距，
  // 若与 mx-auto / mr-auto / ml-auto 共用同一个元素，会覆盖图片对齐。
  return <NodeViewWrapper className={`td-figure my-4 ${selectionRing(selected)}`} data-block-id={String(node.attrs.blockId || '')}>
    {url ? (
      <figure className={alignClass} style={{ width: `${layout.widthMm}mm`, maxWidth: '100%' }}>
        <img src={url} alt={String(node.attrs.alt || caption || 'TikZ 绘图')} className="block h-auto w-full rounded border border-zinc-200" />
        {caption ? <figcaption className="mt-1.5 text-center text-xs text-zinc-500">{caption}</figcaption> : null}
      </figure>
    ) : <div className="rounded border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">TikZ 源码尚未生成预览。</div>}
    {stale ? <p className="mt-1 text-xs text-amber-700">预览已过期，请在属性面板重新生成。</p> : null}
  </NodeViewWrapper>
}

// ─── Unknown NodeView ────────────────────────────────────────────────────────

export function UnknownNodeView({ node, selected }: NodeViewProps) {
  const originalType = String(node.attrs.originalType || 'unknown')
  return (
    <NodeViewWrapper className={`my-3 ${selectionRing(selected)}`} data-block-id={String(node.attrs.blockId || '')}>
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/30">
        <p className="text-xs text-zinc-400">
          未识别的块类型 &quot;{originalType}&quot;（已保留原始数据）
        </p>
      </div>
    </NodeViewWrapper>
  )
}
