/**
 * 块级 NodeView 组件
 *
 * 每个非文本块（figure/question/box/spacer/divider/pageBreak/blockMath/rawMarkdown/unknown）
 * 使用 ReactNodeViewRenderer 渲染。NodeView 只负责显示和局部交互（点击选中、打开对话框）。
 * 文本块（heading/paragraph）直接渲染为可编辑 ProseMirror 节点，不需要 NodeView。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { CornerDownRight, ImageOff } from 'lucide-react'
import type { FigureAssetRef, FigureBlock, SpacerBlock, TeachingBlock, BoxBlock, BoxChildBlock, QuestionBlock, QuestionDisplayOptions, TeachingDocumentV1, TeachingInline, ParagraphBlock } from '@/types/teachingDocument'
import type { QuestionResolution, FigureResolution, QuestionLayoutEditor } from '../blocks/BlockRenderer'
import { getBoxTemplateOrFallback } from '@/utils/teachingDocument/boxTemplates'
import { createQuestionRuntimeModel } from '@/utils/teachingDocument/layout/questionRegions'
import { BoxFragmentRenderer, QuestionRuntimeContent, QuestionPlaceholder } from '../blocks/BlockRenderer'
import { BlockRenderer } from '../blocks/BlockRenderer'
import { BlockInlineEditor } from '../BlockInlineEditor/BlockInlineEditor'
import { MarkdownContent } from '@/components/MarkdownContent'
import { DEFAULT_A4_PAPER, newTeachingBlock, sliceTeachingInlines, type PaperSpec, type PaginationResult, type PrintLayoutSpec, type BoxFragmentPaginationItem, type QuestionFragmentPaginationItem, type ParagraphBoxChildFragmentPaginationItem, type InlineRange } from '@/utils/teachingDocument'
import { BlockInsertPoint } from '@/pages/teaching-documents/components/BlockInsertMenu'
import { emitBoxChildSelect } from './selection'
import { PrintChrome } from '../PrintChrome'
import { effectiveFigureWidthMm, effectiveSpacerHeightMm } from '@/utils/teachingDocument/layoutCompat'
import { clampFigureWidthMm } from './resizeLogic'
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
  document: TeachingDocumentV1
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
        <PrintChrome section="footer" slots={context.printLayout.footer.slots} documentTitle={context.document.title} documentType={context.document.documentType} pageNumber={afterPageIndex + 1} totalPages={context.pagination?.pages.length || 1} printLayout={context.printLayout} />
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
        <PrintChrome section="header" slots={context.printLayout.header.slots} documentTitle={context.document.title} documentType={context.document.documentType} pageNumber={afterPageIndex + 2} totalPages={context.pagination?.pages.length || 1} printLayout={context.printLayout} />
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
  const latex = String(node.attrs.latex || '')
  const label = String(node.attrs.label || '')
  const html = useMemo(() => {
    if (!latex) return ''
    try {
      return katex.renderToString(latex, { displayMode: true, throwOnError: true, strict: false })
    } catch {
      return ''
    }
  }, [latex])

  return (
    <NodeViewWrapper className={`td-block-math my-4 ${selectionRing(selected)}`}>
      <div className="overflow-x-auto text-center" data-block-type="blockMath">
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="inline-block rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            <code>{latex || '公式为空'}</code>
            <span className="ml-2 text-xs text-amber-600">公式渲染失败</span>
          </span>
        )}
        {label ? <span className="float-right text-sm text-zinc-400">{label}</span> : null}
      </div>
    </NodeViewWrapper>
  )
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
  const widthMm = node.attrs.widthMm != null ? Number(node.attrs.widthMm) : undefined
  const widthRatio = node.attrs.widthRatio != null ? Number(node.attrs.widthRatio) : undefined
  const caption = String(node.attrs.caption || '')
  const alt = String(node.attrs.alt || '')

  /** 供 effectiveFigureWidthMm 读取的最小 FigureBlock（widthMm 优先，widthRatio 回退） */
  const figureBlock = useMemo<FigureBlock>(() => ({
    type: 'figure',
    id: blockId,
    asset,
    alignment,
    ...(widthMm != null && Number.isFinite(widthMm) ? { widthMm } : {}),
    ...(widthRatio != null && Number.isFinite(widthRatio) ? { widthRatio } : {}),
  }), [blockId, asset, alignment, widthMm, widthRatio])

  const effectiveWidthMm = effectiveFigureWidthMm(figureBlock, contentWidthMm)
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

  const alignClass = { left: 'mr-auto', center: 'mx-auto', right: 'ml-auto' }[alignment]

  /** pointerup 提交：钳制到内容区宽度后写入编辑器（一个 undo 步骤） */
  const handleCommitWidth = useCallback((mm: number) => {
    const next = clampFigureWidthMm(mm, contentWidthMm)
    editor.commands.setFigureWidth(blockId, next, mergeKey)
    setDragWidthMm(null)
  }, [editor, blockId, contentWidthMm, mergeKey])

  return (
    <NodeViewWrapper className={`td-figure my-4 ${selectionRing(selected)}`}>
      {!url || imageState === 'error' ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 py-8 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/30">
          <ImageOff className="mr-2 size-5" />
          <span className="text-sm">图片资源缺失</span>
        </div>
      ) : (
        <figure className={alignClass} style={{ width: `${displayWidthMm}mm`, maxWidth: '100%' }}>
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

// ─── Question NodeView ───────────────────────────────────────────────────────

export function QuestionNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const { resolveQuestion } = useResolvers()
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
  const [dragAnswerHeightMm, setDragAnswerHeightMm] = useState<number | null>(null)
  const [dragFigureWidths, setDragFigureWidths] = useState<Record<string, number>>({})
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

  const block: QuestionBlock = {
    type: 'question',
    id: String(node.attrs.blockId || ''),
    questionId,
    breakBehavior,
    display: figureDisplay,
    ...(localContent ? { localContent } : {}),
  }
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

  if (resolution && 'status' in resolution && resolution.status === 'loading') {
    return (
      <NodeViewWrapper className={`my-4 ${selectionRing(selected)}`}>
        <QuestionPlaceholder block={block} message="题目加载中…" status="loading" />
      </NodeViewWrapper>
    )
  }
  if (resolution && 'status' in resolution && resolution.status === 'error') {
    return (
      <NodeViewWrapper className={`my-4 ${selectionRing(selected)}`}>
        <QuestionPlaceholder block={block} message={`题目加载失败：${resolution.message}`} status="error" tone="error" />
      </NodeViewWrapper>
    )
  }
  if (resolution && 'status' in resolution && resolution.status === 'missing') {
    return (
      <NodeViewWrapper className={`my-4 ${selectionRing(selected)}`}>
        <QuestionPlaceholder block={block} message={resolution.message || `题目不存在（ID: ${questionId || '未设置'}）`} status="missing" />
      </NodeViewWrapper>
    )
  }

  const question = resolution && !('status' in resolution) ? resolution : undefined
  if (!question) {
    return (
      <NodeViewWrapper className={`my-4 ${selectionRing(selected)}`}>
        <QuestionPlaceholder block={block} message={`题目不可用（ID: ${questionId || '未设置'}）`} status="missing" />
      </NodeViewWrapper>
    )
  }

  const effectiveQuestion = localContent ? { ...question, ...localContent } : question

  const layoutEditor: QuestionLayoutEditor = {
    selected,
    contentWidthMm: paperContentWidthMm(paper),
    previewFigureWidth,
    commitFigureWidth,
  }

  return (
    <NodeViewWrapper className={selectionRing(selected)}>
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
              model={createQuestionRuntimeModel(block, effectiveQuestion)}
              continuation={item.continuation}
              regionItems={item.regionItems}
              layoutEditor={layoutEditor}
            />
            {index < questionFragments.length - 1 ? <PageTransition afterPageIndex={pageIndex} context={paginationContext!} /> : null}
          </div>
        )) : (
          <QuestionRuntimeContent block={block} model={createQuestionRuntimeModel(block, effectiveQuestion)} layoutEditor={layoutEditor} />
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

const BOX_INSERTABLE_TYPES: TeachingBlock['type'][] = ['paragraph', 'blockMath', 'figure', 'question', 'divider', 'spacer']

function replaceInlineRange(inlines: TeachingInline[], range: InlineRange, replacement: TeachingInline[]): TeachingInline[] {
  const full = { start: { inlineIndex: 0 }, end: { inlineIndex: inlines.length } }
  const before = sliceTeachingInlines(inlines, { start: full.start, end: range.start }).map((entry) => entry.inline)
  const after = sliceTeachingInlines(inlines, { start: range.end, end: full.end }).map((entry) => entry.inline)
  return [...before, ...replacement, ...after]
}

export function BoxNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const { resolveQuestion, resolveFigure } = useResolvers()
  const templateId = String(node.attrs.templateId || 'concept')
  const title = String(node.attrs.title || '')
  const icon = String(node.attrs.icon || '')
  const breakBehavior = String(node.attrs.breakBehavior || 'auto')
  const children = useMemo<BoxChildBlock[]>(() => {
    try {
      return JSON.parse(String(node.attrs.children || '[]'))
    } catch {
      return []
    }
  }, [node.attrs.children])

  const template = getBoxTemplateOrFallback(templateId)
  const boxBlock: BoxBlock = {
    type: 'box',
    id: String(node.attrs.blockId || ''),
    templateId,
    ...(title ? { title } : {}),
    ...(icon ? { icon } : {}),
    breakBehavior: breakBehavior as BoxBlock['breakBehavior'],
    children,
  }
  const paginationContext = usePaginationContext()
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
  }, [children, updateChildren])

  const renderChild = (child: BoxChildBlock, index: number) => {
    if (child.type !== 'paragraph') {
      return (
        <div
          key={`${child.id}:${index}`}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            emitBoxChildSelect({ blockId: child.id, parentBlockId: boxBlock.id })
          }}
        >
          <BlockRenderer
            block={child as TeachingBlock}
            resolvers={{ resolveQuestion, resolveFigure }}
          />
        </div>
      )
    }
    return (
      <div
        key={`${child.id}:${index}`}
        className="td-box-child-editor relative"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          emitBoxChildSelect({ blockId: child.id, parentBlockId: boxBlock.id })
        }}
      >
        <BlockInlineEditor
          inlines={child.content}
          variant="embedded"
          toolbar="floating"
          ariaLabel={`盒子内段落 ${index + 1}`}
          onChange={(content) => {
            updateChildren(children.map((item) => item.id === child.id ? { ...item, content } : item))
          }}
        />
      </div>
    )
  }

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

  return (
    <NodeViewWrapper className={`td-box my-5 ${selectionRing(selected)}`}>
      {boxFragments.length > 1 ? (
          boxFragments.map(({ item, pageIndex }, index) => (
            <div key={`${item.fragmentIndex}:${pageIndex}`}>
              <BoxFragmentRenderer
                block={boxBlock}
                item={item}
                resolvers={{ resolveQuestion, resolveFigure }}
                renderEditableParagraph={renderFragmentParagraph}
                renderInsertPoint={renderChildInsertPoint}
                onSelectChild={(blockId) => emitBoxChildSelect({ blockId, parentBlockId: boxBlock.id })}
              />
              {index < boxFragments.length - 1 ? <PageTransition afterPageIndex={pageIndex} context={paginationContext!} /> : null}
            </div>
          ))
      ) : (
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: `var(--box-${template.tone}-border)` }}>
          {(template.showHeader || title) ? (
            <div className="flex min-w-0 items-center gap-2 px-4 py-2.5" style={{ background: `var(--box-${template.tone}-header)` }}>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title || template.label}</span>
            </div>
          ) : null}
          <div className="px-4 py-3" style={{ background: `var(--box-${template.tone}-body)` }}>
            {children.length ? children.map((child, index) => (
              <div key={`box-child-slot:${child.id}`}>
                {renderChild(child, index)}
                <BlockInsertPoint
                  types={BOX_INSERTABLE_TYPES}
                  onInsert={(type) => insertChildAfter(child.id, type)}
                />
              </div>
            )) : <p className="text-sm text-zinc-400">（空盒子）</p>}
            <BlockInsertPoint
              types={BOX_INSERTABLE_TYPES}
              onInsert={(type) => insertChildAfter(undefined, type)}
            />
          </div>
        </div>
      )}
    </NodeViewWrapper>
  )
}

// ─── Divider NodeView ────────────────────────────────────────────────────────

export function DividerNodeView({ selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`my-5 ${selectionRing(selected)}`}>
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
    <NodeViewWrapper className={`${selectionRing(selected)}`}>
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

export function PageBreakNodeView({ selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`td-page-break-marker ${selected ? 'is-selected' : ''}`}>
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
    <NodeViewWrapper className={`td-raw-markdown my-3 ${selectionRing(selected)}`}>
      <MarkdownContent content={markdown} />
    </NodeViewWrapper>
  )
}

// ─── Unknown NodeView ────────────────────────────────────────────────────────

export function UnknownNodeView({ node, selected }: NodeViewProps) {
  const originalType = String(node.attrs.originalType || 'unknown')
  return (
    <NodeViewWrapper className={`my-3 ${selectionRing(selected)}`}>
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/30">
        <p className="text-xs text-zinc-400">
          未识别的块类型 &quot;{originalType}&quot;（已保留原始数据）
        </p>
      </div>
    </NodeViewWrapper>
  )
}
