/**
 * 块级渲染器集合
 * 每个块渲染器添加 data-block-id / data-block-type 属性供未来分页引擎识别
 */

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, BookOpen, Box, CornerDownRight, HelpCircle, ImageOff, Lightbulb, ListChecks, PenLine, Pencil } from 'lucide-react'
import type {
  BlockMathBlock,
  BoxBlock,
  BoxChildBlock,
  DividerBlock,
  FigureAssetRef,
  FigureBlock,
  HeadingBlock,
  PageBreakBlock,
  ParagraphBlock,
  QuestionBlock,
  RawMarkdownBlock,
  SpacerBlock,
  TableBlock,
  TikzBlock,
  TeachingBlock,
  TeachingInline,
  TeachingTextStyle,
  UnknownBlock,
} from '@/types/teachingDocument'
import type { QuestionItem } from '@/types'
import { getBoxTemplateOrFallback } from '@/utils/teachingDocument/boxTemplates'
import { boxBodyStyle, boxFrameStyle } from '@/utils/teachingDocument/boxAppearance'
import { renderTeachingDocumentKatex } from '@/utils/teachingDocument/katexCache'
import {
  blockDomAttributes,
  inlineCursorLabel,
  sliceTeachingInlines,
  TEACHING_DOM,
  type BoxFragmentPaginationItem,
  type InlineRange,
  type PaginatedQuestionRegionItem,
  type ParagraphBoxChildFragmentPaginationItem,
  type ParagraphFragmentPaginationItem,
  type QuestionBoxChildFragmentPaginationItem,
  type QuestionFragmentPaginationItem,
} from '@/utils/teachingDocument/layout'
import { questionOptionInlineContentKey, stripGeneratedQuestionNumber } from '@/utils/teachingDocument/layout/questionRegions'
import {
  createQuestionRuntimeModel,
  type QuestionRuntimeModel,
  type QuestionRuntimeRegion,
  type QuestionFigureRegion,
  type QuestionAnswerSpaceRegion,
} from '@/utils/teachingDocument/layout/questionRegions'
import { DEFAULT_QUESTION_FIGURE_WIDTH_MM, resolveFigureLayout } from '@/utils/teachingDocument/figureLayoutPresets'
import { CSS_PIXELS_PER_MM } from '@/utils/teachingDocument/layout/paper'
import { rawMarkdownSegments } from '@/utils/teachingDocument/layout/rawMarkdownSegments'
import type { ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import { assetUrl } from '@/utils/questionDisplay'
import { fontStackById } from '@/utils/teachingDocument/lectureFonts'
import { MarkdownContent } from '@/components/MarkdownContent'
import {
  ChoiceOptions,
  FigureGallery,
  MarkdownWithInlineFigures,
} from '@/components/questions/QuestionContent'
import { InlineContent } from './InlineContent'
import { BlockInlineEditor } from '../BlockInlineEditor/BlockInlineEditor'
import { ImageResizeOverlay } from '../editor/ResizeHandles'
import {
  resolveBoxSkin,
  resolveHeadingSkin,
  resolveTeachingSkinDesignRenderState,
  resolveTeachingSkinVariantRequest,
  type TeachingSkinDesignVariantIds,
} from '@/utils/teachingDocument/skins'
import { skinBoxBodyStyle, skinBoxFrameStyle } from '@/utils/teachingDocument/boxAppearance'

// ─── Resolver 类型 ───────────────────────────────────────────────────────────

export interface TeachingDocumentResolvers {
  /** 根据 questionId 获取题目数据 */
  resolveQuestion?: (questionId: string) => QuestionResolution
  /** 根据资源引用解析为可显示 URL */
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  eagerImages?: boolean
  /** 纸张测量后固定的选项列数，保证分页和最终渲染一致。 */
  choiceLayoutOverrides?: ChoiceLayoutOverrides
  /** 尚未固定列数时，以真实 DOM 宽度进行首轮探测。 */
  probeChoiceLayouts?: boolean
  /** Ephemeral Skin Lab variant choice; never serialized into a document. */
  skinDesignVariantIds?: TeachingSkinDesignVariantIds
}

export type FigureResolution =
  | string
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'missing'; message?: string }

export type QuestionResolution =
  | QuestionItem
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing'; message?: string }
  | undefined

export interface QuestionLayoutEditor {
  selected: boolean
  contentWidthMm: number
  previewFigureWidth: (figureKey: string, widthMm: number) => void
  commitFigureWidth: (figureKey: string, widthMm: number) => void
  selectedFigureKey?: string
  onFigureSelect?: (figureKey: string) => void
}

// ─── 图标映射 ────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, typeof BookOpen> = {
  BookOpen,
  Lightbulb,
  PenLine,
  AlertTriangle,
  Pencil,
  ListChecks,
  Box,
}

function BoxIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && ICON_MAP[name]) || Box
  return <Icon className={className || 'size-4'} />
}

// ─── 各块渲染器 ──────────────────────────────────────────────────────────────

function HeadingBlockView({ block, numberLabel, skinDesignVariantIds }: { block: HeadingBlock; numberLabel?: string; skinDesignVariantIds?: TeachingSkinDesignVariantIds }) {
  const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4'
  const sizeClass = {
    1: 'text-2xl font-bold mt-8 mb-4',
    2: 'text-xl font-semibold mt-6 mb-3',
    3: 'text-lg font-semibold mt-5 mb-2',
    4: 'text-base font-medium mt-4 mb-2',
  }[block.level]
  const skin = resolveHeadingSkin(block.skin, block.level)
  const design = skin.status === 'resolved'
    ? resolveTeachingSkinDesignRenderState(skin.definition, resolveTeachingSkinVariantRequest(skin.skin, skin.definition.id, skinDesignVariantIds))
    : undefined
  return (
    <Tag
      className={`td-heading ${sizeClass} text-zinc-900 dark:text-zinc-50 ${skin.status === 'resolved' ? skin.definition.className : ''}`}
      style={{ ...textBlockStyle(block), ...(design?.cssVariables || {}) } as CSSProperties}
      data-block-id={block.id}
      data-block-type="heading"
      data-level={block.level}
      data-skin-id={skin.status === 'resolved' ? skin.definition.id : undefined}
      data-skin-state={block.skin ? skin.status : undefined}
    >
      {numberLabel ? <span className="td-heading-number" aria-hidden="true">{numberLabel} </span> : null}
      <InlineContent inlines={block.content} />
    </Tag>
  )
}

export function ParagraphBlockContent({ block, range }: { block: ParagraphBlock; range?: InlineRange }) {
  return <InlineContent inlines={block.content} range={range} />
}

function ParagraphBlockView({ block }: { block: ParagraphBlock }) {
  return (
    <p
      className="td-paragraph my-2.5 leading-7 text-zinc-800 dark:text-zinc-200"
      style={textBlockStyle(block)}
      data-block-id={block.id}
      data-block-type="paragraph"
    >
      {block.listStyle ? <span className="mr-2 inline-block select-none" aria-hidden="true">{block.listStyle === 'ordered' ? '1.' : '•'}</span> : null}
      <ParagraphBlockContent block={block} />
    </p>
  )
}

export function ParagraphFragmentRenderer({
  block,
  item,
  selected = false,
  flowWrapped = false,
}: {
  block: ParagraphBlock
  item: ParagraphFragmentPaginationItem | ParagraphBoxChildFragmentPaginationItem
  selected?: boolean
  /** 同页前方存在左右环绕图片时，段落必须留在普通文档流中。 */
  flowWrapped?: boolean
}) {
  const boxChildItem = 'parentBlockId' in item ? item : undefined
  const marginClass = {
    single: 'my-2.5',
    start: 'mt-2.5 mb-0',
    middle: 'my-0',
    end: 'mt-0 mb-2.5',
  }[item.continuation]
  return (
    <div
      className={`td-paragraph-fragment td-block-shell ${flowWrapped ? 'td-block-shell-flow-text' : ''} ${selected ? 'td-block-selected' : ''}`}
      {...{
        [TEACHING_DOM.fragment]: '',
        [TEACHING_DOM.fragmentType]: 'paragraph',
        [TEACHING_DOM.fragmentIndex]: item.fragmentIndex,
        [TEACHING_DOM.fragmentContinuation]: item.continuation,
        [TEACHING_DOM.sourceBlockId]: block.id,
        [TEACHING_DOM.sourceIndex]: boxChildItem?.sourcePath.sourceIndex,
        [TEACHING_DOM.parentBlockId]: boxChildItem?.parentBlockId,
        [TEACHING_DOM.childIndex]: boxChildItem?.childIndex,
      }}
      data-fragment-start={inlineCursorLabel(item.range.start)}
      data-fragment-end={inlineCursorLabel(item.range.end)}
    >
      <p className={`td-paragraph ${marginClass} leading-7 text-zinc-800 dark:text-zinc-200`} style={textBlockStyle(block)}>
        {block.listStyle ? <span className="mr-2 inline-block select-none" aria-hidden="true">{block.listStyle === 'ordered' ? '1.' : '•'}</span> : null}
        <ParagraphBlockContent block={block} range={item.range} />
      </p>
    </div>
  )
}

function textBlockStyle(block: Pick<HeadingBlock | ParagraphBlock, 'alignment' | 'indentLevel'>): CSSProperties {
  return {
    textAlign: block.alignment || 'left',
    ...(block.indentLevel ? { marginLeft: `${block.indentLevel * 1.5}em` } : {}),
  }
}

function BlockMathBlockView({ block }: { block: BlockMathBlock }) {
  const html = useMemo(() => {
    return renderTeachingDocumentKatex(block.latex, true)
  }, [block.latex])

  return (
    <div
      className="td-block-math my-4 overflow-x-auto text-center"
      data-block-id={block.id}
      data-block-type="blockMath"
      {...{
        [TEACHING_DOM.resource]: 'math',
        [TEACHING_DOM.resourceId]: block.id,
        [TEACHING_DOM.resourceStatus]: html ? 'ready' : 'error',
      }}
    >
      {html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="inline-block rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          <code>{block.latex || '公式为空'}</code>
          <span className="ml-2 text-xs text-amber-600">公式渲染失败</span>
        </span>
      )}
      {block.label ? <span className="float-right text-sm text-zinc-400">{block.label}</span> : null}
    </div>
  )
}

function FigureBlockView({
  block,
  resolveFigure,
  eagerImages,
  onSelect,
  flowWrapped = false,
}: {
  block: FigureBlock
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  eagerImages?: boolean
  onSelect?: () => void
  /** 外层块已承担左右浮动和间距，内部图片改为填满锚点宽度。 */
  flowWrapped?: boolean
}) {
  const asset = block.asset
  const hasRef = asset.type === 'legacyPath'
    ? asset.path.trim() !== ''
    : asset.type === 'documentAsset'
      ? asset.assetId.trim() !== ''
      : asset.questionId.trim() !== '' && asset.figureId.trim() !== ''
  const resolution = useMemo<FigureResolution>(() => {
    if (!hasRef) return { status: 'missing' }
    try {
      return resolveFigure ? resolveFigure(asset) : asset.type === 'legacyPath' ? assetUrl(asset.path) : ''
    } catch {
      return { status: 'error' }
    }
  }, [asset, hasRef, resolveFigure])
  const url = typeof resolution === 'string' ? resolution : ''
  const resolverStatus = typeof resolution === 'string'
    ? (resolution ? 'ready' : 'missing')
    : resolution.status
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'error'>(url ? 'loading' : 'error')
  const imageRef = useRef<HTMLImageElement>(null)

  useLayoutEffect(() => {
    if (!url) {
      setImageState('error')
      return
    }
    const image = imageRef.current
    setImageState(image?.complete
      ? image.naturalWidth > 0
        ? 'loaded'
        : 'error'
      : 'loading')
  }, [url])

  const layout = resolveFigureLayout({
    preset: block.layoutPreset,
    explicitWidthMm: block.widthMm,
    legacyAlignment: block.alignment,
    legacyWidthRatio: block.widthRatio,
    containerWidthMm: 160,
  })
  const alignClass = { left: 'mr-auto', center: 'mx-auto', right: 'ml-auto' }[layout.alignment]
  const widthStyle = { width: `${layout.widthMm * CSS_PIXELS_PER_MM}px`, maxWidth: '100%' }
  const groupItems = block.groupItems || []

  if (groupItems.length) {
    const columns = block.groupColumns || 2
    return (
      <div
        className={`td-figure-group ${flowWrapped ? '' : `my-4 ${alignClass}`}`}
        style={flowWrapped ? { width: '100%', maxWidth: '100%' } : widthStyle}
        data-block-id={block.id}
        data-block-type="figure"
        data-figure-columns={columns}
      >
        <div
          className="grid items-start"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: `${Math.max(0, block.groupGapMm ?? 4)}mm`,
          }}
        >
          {groupItems.map((item) => (
            <FigureBlockView
              key={item.id}
              block={{
                type: 'figure',
                id: item.id,
                asset: item.asset,
                alignment: 'center',
                layoutPreset: 'full-width',
                widthMm: 500,
                caption: item.caption,
                alt: item.alt,
              }}
              resolveFigure={resolveFigure}
              eagerImages={eagerImages}
              flowWrapped={flowWrapped}
            />
          ))}
        </div>
      </div>
    )
  }

  if (resolverStatus === 'loading') {
    return (
      <div
        className="td-figure my-4 flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/30"
        {...{
          [TEACHING_DOM.resource]: 'figure-resolver',
          [TEACHING_DOM.resourceId]: block.id,
          [TEACHING_DOM.resourceStatus]: 'loading',
        }}
      >
        图片资源解析中…
      </div>
    )
  }

  if (!hasRef || !url || imageState === 'error') {
    return (
      <div
        className="td-figure my-4 flex items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 py-8 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/30"
        data-block-id={block.id}
        data-block-type="figure"
        {...{
          [TEACHING_DOM.resource]: 'image',
          [TEACHING_DOM.resourceId]: block.id,
          [TEACHING_DOM.resourceStatus]: 'error',
        }}
      >
        <ImageOff className="mr-2 size-5" />
        <span className="text-sm">图片资源缺失</span>
      </div>
    )
  }

  return (
    <figure
      className={`td-figure ${flowWrapped ? '' : `my-4 ${alignClass}`} ${onSelect ? 'cursor-pointer' : ''}`}
      style={flowWrapped ? { width: '100%', maxWidth: '100%' } : widthStyle}
      data-block-id={block.id}
      data-block-type="figure"
      data-alignment={block.alignment}
      data-image-state={imageState}
      onClick={onSelect}
      {...{
        [TEACHING_DOM.resource]: 'image',
        [TEACHING_DOM.resourceId]: block.id,
        [TEACHING_DOM.resourceStatus]: imageState,
      }}
    >
      <div className="relative flex min-h-32 w-full items-center justify-center">
        {imageState === 'loading' ? (
          <div className="absolute inset-0 flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
            图片加载中…
          </div>
        ) : null}
        <img
          ref={imageRef}
          src={url}
          alt={block.alt || block.caption || '文档图片'}
          className={`block h-auto max-h-[70vh] w-full object-contain transition-opacity ${imageState === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
          loading={eagerImages ? 'eager' : 'lazy'}
          onLoad={() => setImageState('loaded')}
          onError={() => setImageState('error')}
        />
      </div>
      {block.caption ? (
        <figcaption className="mt-1.5 text-center text-xs text-zinc-500">{block.caption}</figcaption>
      ) : null}
    </figure>
  )
}

function TikzBlockView({ block, resolveFigure, eagerImages }: { block: TikzBlock; resolveFigure?: TeachingDocumentResolvers['resolveFigure']; eagerImages?: boolean }) {
  if (!block.svgAssetId) return <div className="my-4 rounded border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">TikZ 源码尚未生成预览。</div>
  return <FigureBlockView block={{ type: 'figure', id: block.id, asset: { type: 'documentAsset', assetId: block.svgAssetId }, alignment: block.alignment, layoutPreset: block.layoutPreset, widthMm: block.widthMm, alt: block.alt, caption: block.caption }} resolveFigure={resolveFigure} eagerImages={eagerImages} />
}

function questionLayoutOverride(layout: 'quad' | 'double' | 'single' | 'adaptive') {
  // adaptive：不传显式 layout，由 ChoiceOptions 根据实际 DOM 测量宽度自适应决定列数
  if (layout === 'adaptive') return undefined
  return layout === 'quad' ? 'four' : layout === 'double' ? 'two' : 'one'
}

function questionTypographyStyle(style?: TeachingTextStyle): CSSProperties | undefined {
  if (!style) return undefined
  const vars: Record<string, string> = {}
  const stack = fontStackById(style.font)
  if (stack) vars['--td-question-font'] = stack
  if (style.fontSize) vars['--td-question-size'] = `${style.fontSize}px`
  if (style.color) vars['--td-question-color'] = style.color
  if (style.fontWeight) vars['--td-question-weight'] = String(style.fontWeight)
  if (style.italic !== undefined) vars['--td-question-style'] = style.italic ? 'italic' : 'normal'
  return vars as CSSProperties
}

function replaceInlineRange(inlines: TeachingInline[], range: InlineRange, replacement: TeachingInline[]): TeachingInline[] {
  const full = { start: { inlineIndex: 0 }, end: { inlineIndex: inlines.length } }
  const before = sliceTeachingInlines(inlines, { start: full.start, end: range.start }).map((entry) => entry.inline)
  const after = sliceTeachingInlines(inlines, { start: range.end, end: full.end }).map((entry) => entry.inline)
  return [...before, ...replacement, ...after]
}

function QuestionRegionContent({
  region,
  item,
  layoutEditor,
  resolveFigure,
  choiceLayoutBlockId,
  editableQuestionText = false,
  joinWithAnalysis = false,
  onInlineContentChange,
}: {
  region: QuestionRuntimeRegion
  item?: PaginatedQuestionRegionItem
  layoutEditor?: QuestionLayoutEditor
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  choiceLayoutBlockId?: string
  editableQuestionText?: boolean
  /** 答案后紧接解析时，两者共用一个连续的蓝底容器。 */
  joinWithAnalysis?: boolean
  onInlineContentChange?: (key: string, content: TeachingInline[]) => void
}) {
  if (region.kind === 'heading') return null
  if (region.kind === 'paragraph') {
    const range = item?.kind === 'question-paragraph-fragment' ? item.range : undefined
    const inlines = range
      ? sliceTeachingInlines(region.paragraph.content, range).map((entry) => entry.inline)
      : region.paragraph.content
    if (editableQuestionText && inlines.length) {
      return (
        <div
          className="td-question-paragraph td-question-text my-2"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <BlockInlineEditor
            inlines={inlines}
            variant="embedded"
            toolbar="none"
            editorContext="question"
            ariaLabel="题目文字"
            onChange={(content) => {
              const persistedContent = region.generatedQuestionNumber
                ? stripGeneratedQuestionNumber(content, region.generatedQuestionNumber)
                : content
              onInlineContentChange?.(region.key, range
                ? replaceInlineRange(region.paragraph.content, range, persistedContent)
                : persistedContent)
            }}
          />
        </div>
      )
    }
    return (
      <p className="td-question-paragraph td-question-text my-2 text-sm leading-7 text-zinc-900 dark:text-zinc-100">
        <InlineContent inlines={region.paragraph.content} range={range} />
      </p>
    )
  }
  if (region.kind === 'markdown') {
    return <MarkdownContent className="td-question-markdown text-sm leading-7" content={region.markdown} />
  }
  if (region.kind === 'math') {
    return <MarkdownContent className="td-question-markdown text-sm leading-7" content={`$$${region.latex}$$`} />
  }
  if (region.kind === 'figure') {
    const figureRegion = region as QuestionFigureRegion
    const visibleFigures = region.figures.filter((figure) => Boolean(figure.path))
    const figureKey = figureRegion.figureKey || figureRegion.key
    const groupedKeys = figureRegion.groupFigureKeys || [figureKey]
    const groupWidthOverrides = figureRegion.groupFigureWidthOverrides || {}
    const figureWidths = groupedKeys.map((key) => groupWidthOverrides[key] ?? DEFAULT_QUESTION_FIGURE_WIDTH_MM)
    const figureAspectRatios = visibleFigures.map((figure) => {
      const width = Number(figure.width)
      const height = Number(figure.height)
      return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? width / height : 1
    })
    const resolvedLayout = resolveFigureLayout({
      preset: figureRegion.layoutPreset,
      explicitWidthMm: groupWidthOverrides[figureKey] ?? figureRegion.widthOverrideMm ?? DEFAULT_QUESTION_FIGURE_WIDTH_MM,
      legacyAlignment: figureRegion.alignmentOverride,
      containerWidthMm: layoutEditor?.contentWidthMm || 160,
    })
    const figureColumns = figureRegion.groupFigureKeys?.length || 1
    const textWrap = figureColumns === 1 ? figureRegion.textWrap || 'top-bottom' : 'top-bottom'
    const sideWrapped = textWrap === 'square-left' || textWrap === 'square-right'
    const contentWidthMm = layoutEditor?.contentWidthMm || 160
    const gapMm = Math.max(0, figureColumns - 1) * 4
    const equalHeightMm = figureRegion.groupMatchHeight ? (figureRegion.groupHeightMm || 50) : undefined
    const desiredGroupWidthMm = equalHeightMm
      ? equalHeightMm * figureAspectRatios.reduce((sum, ratio) => sum + ratio, 0) + gapMm
      : figureWidths.reduce((sum, width) => sum + width, 0) + gapMm
    const groupScale = Math.min(1, contentWidthMm / Math.max(desiredGroupWidthMm, 1))
    const groupedWidthMm = Math.min(contentWidthMm, desiredGroupWidthMm)
    const equalHeightPx = equalHeightMm ? equalHeightMm * groupScale * CSS_PIXELS_PER_MM : undefined
    const widthStyle = sideWrapped
      ? { width: '100%', maxWidth: '100%' }
      : { width: `${groupedWidthMm * CSS_PIXELS_PER_MM}px`, maxWidth: '100%' }
    const alignClass = { left: 'mr-auto', center: 'mx-auto', right: 'ml-auto' }[resolvedLayout.alignment]
    const trimTrailingSpacing = item?.kind === 'whole-question-region' && item.trimTrailingSpacing
    const figureSpacingClass = trimTrailingSpacing ? 'mt-3 mb-0' : 'my-3'
    if (figureRegion.asset) {
      return (
        <div className={`relative ${sideWrapped ? '' : `${figureSpacingClass} ${alignClass}`}`} style={widthStyle}>
          <FigureBlockView
            block={{ type: 'figure', id: figureRegion.figureKey || figureRegion.key, asset: figureRegion.asset, alignment: resolvedLayout.alignment, widthMm: resolvedLayout.widthMm }}
            resolveFigure={resolveFigure}
            onSelect={() => layoutEditor?.onFigureSelect?.(figureKey)}
            flowWrapped={sideWrapped}
          />
        </div>
      )
    }
    return visibleFigures.length ? (
      <div className={`relative ${sideWrapped ? '' : `${figureSpacingClass} ${alignClass}`}`} style={widthStyle}>
          <FigureGallery
            figures={visibleFigures}
            showCaption={false}
            naturalAspectRatio
            bare
            columns={figureColumns >= 2 && figureColumns <= 4 ? figureColumns as 2 | 3 | 4 : undefined}
            columnRatios={equalHeightMm ? figureAspectRatios : figureWidths}
            equalHeightPx={equalHeightPx}
            onSelect={(figure) => layoutEditor?.onFigureSelect?.(String(figure.id || figure.blockId || figureKey))}
          />
        {layoutEditor?.selected && !equalHeightMm ? (
          <ImageResizeOverlay
            currentWidthMm={resolvedLayout.widthMm}
            maxWidthMm={layoutEditor.contentWidthMm}
            onPreview={(widthMm) => layoutEditor.previewFigureWidth(figureKey, widthMm)}
            onCommit={(widthMm) => layoutEditor.commitFigureWidth(figureKey, widthMm)}
          />
        ) : null}
      </div>
    ) : (
      <div
        className={`${figureSpacingClass} rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300`}
        {...{
          [TEACHING_DOM.resource]: 'image',
          [TEACHING_DOM.resourceId]: region.missingFigureId || region.key,
          [TEACHING_DOM.resourceStatus]: 'missing',
        }}
      >
        题图资源缺失（{region.missingFigureId || '未提供资源路径'}）
      </div>
    )
  }
  if (region.kind === 'options-row') {
    return (
      <>
        <ChoiceOptions
          options={region.options}
          figures={region.figures}
          layout={questionLayoutOverride(region.layout)}
          optionIndexOffset={region.optionStart}
          showFigureCaptions={false}
          bareFigures
          choiceLayoutBlockId={choiceLayoutBlockId}
          className="td-question-options"
          optionDomAttributes={(optionIndex) => ({
            [TEACHING_DOM.questionOptionIndex]: optionIndex,
            [TEACHING_DOM.questionOptionRow]: region.rowIndex,
          })}
          inlineContent={region.inlineContent}
          editableText={editableQuestionText}
          onInlineContentChange={(label, content) => onInlineContentChange?.(questionOptionInlineContentKey(region.key, label), content)}
        />
        {region.figures.filter((figure) => !figure.path).map((figure, index) => (
          <div
            className="mt-2 rounded border border-dashed border-amber-300 px-2 py-1 text-xs text-amber-700 dark:border-amber-900 dark:text-amber-300"
            key={figure.id || figure.blockId || `missing-option-figure-${index}`}
            {...{
              [TEACHING_DOM.resource]: 'image',
              [TEACHING_DOM.resourceId]: figure.id || figure.blockId || `${region.key}:${index}`,
              [TEACHING_DOM.resourceStatus]: 'missing',
            }}
          >
            选项 {figure.optionLabel || ''} 的图片资源缺失
          </div>
        ))}
      </>
    )
  }
  if (region.kind === 'answer') {
    return (
      <div className={`td-question-answer mt-3 border border-blue-200/70 bg-blue-50/80 px-3 py-2 dark:border-blue-900/60 dark:bg-blue-950/30 ${joinWithAnalysis ? 'rounded-t-md border-b-0' : 'rounded-md'}`}>
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">参考答案：</span>
        {editableQuestionText && region.inlineContent ? (
          <div
            className="mt-1"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <BlockInlineEditor
              inlines={region.inlineContent}
              variant="embedded"
              toolbar="none"
              editorContext="question"
              ariaLabel="参考答案"
              onChange={(content) => onInlineContentChange?.(region.key, content)}
            />
          </div>
        ) : (
          <MarkdownWithInlineFigures
            className="mt-1 text-sm text-blue-950 dark:text-blue-100"
            content={region.markdown}
            figures={region.figures}
            showFigureCaptions={false}
            bareFigures
          />
        )}
      </div>
    )
  }
  if (region.kind === 'answer-space') {
    const spaceRegion = region as QuestionAnswerSpaceRegion
    const splitSegment = item?.kind === 'whole-question-region' ? item.answerSpaceSegment : undefined
    const heightPx = splitSegment ? (item?.height || 0) : spaceRegion.heightMm * CSS_PIXELS_PER_MM
    const patternStyle = spaceRegion.pattern === 'lines'
      ? { backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 27px, #d4d4d8 27px, #d4d4d8 28px)' }
      : spaceRegion.pattern === 'grid'
        ? { backgroundImage: 'linear-gradient(#e4e4e7 1px, transparent 1px), linear-gradient(90deg, #e4e4e7 1px, transparent 1px)', backgroundSize: '20px 20px' }
        : undefined
    return (
      <div
        className={`td-answer-space rounded border border-dashed border-zinc-200 dark:border-zinc-700 ${splitSegment ? '' : 'my-3'}`}
        style={{ height: `${heightPx}px`, ...patternStyle }}
        aria-hidden="true"
        {...{
          [TEACHING_DOM.resource]: 'answer-space',
          [TEACHING_DOM.resourceId]: region.key,
          [TEACHING_DOM.resourceStatus]: 'ready',
        }}
      />
    )
  }
  return <span className="text-xs font-semibold text-zinc-500">{region.label}</span>
}

export function QuestionRuntimeContent({
  block,
  model,
  continuation = 'single',
  trimEndChrome = false,
  regionItems,
  layoutEditor,
  resolveFigure,
  choiceLayoutBlockId,
  typography,
  editableQuestionText = false,
  onInlineContentChange,
}: {
  block: QuestionBlock
  model: QuestionRuntimeModel
  continuation?: 'single' | 'start' | 'middle' | 'end'
  trimEndChrome?: boolean
  regionItems?: PaginatedQuestionRegionItem[]
  layoutEditor?: QuestionLayoutEditor
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  choiceLayoutBlockId?: string
  typography?: TeachingTextStyle
  editableQuestionText?: boolean
  onInlineContentChange?: (key: string, content: TeachingInline[]) => void
}) {
  const marginClass = trimEndChrome && continuation === 'single'
    ? 'mt-4 mb-0'
    : {
    single: 'my-4',
    start: 'mt-4 mb-0',
    middle: 'my-0',
    end: 'mt-0 mb-4',
    }[continuation]
  const itemByKey = new Map(regionItems?.map((item) => [item.regionKey, item]))
  const regions = regionItems
    ? regionItems
        .map((item) => model.regions.find((region) => region.key === item.regionKey))
        .filter((region): region is QuestionRuntimeRegion => Boolean(region))
    : model.regions
  let flowWrapActive = false

  return (
    <div
      className={`td-question flow-root ${marginClass}`}
      style={questionTypographyStyle(typography)}
      data-question-continuation={continuation}
      {...{
        [TEACHING_DOM.questionRoot]: '',
        [TEACHING_DOM.questionSourceId]: model.questionId,
        [TEACHING_DOM.questionDisplayNumber]: model.displayNumber,
        [TEACHING_DOM.questionSplitPolicy]: 'regions',
        [TEACHING_DOM.resource]: 'question',
        [TEACHING_DOM.resourceId]: block.id,
        [TEACHING_DOM.resourceStatus]: 'ready',
      }}
    >
      {continuation === 'middle' || continuation === 'end' ? (
        <div className="mb-1 text-[10px] font-medium text-zinc-400">续题</div>
      ) : null}
      {regions.map((region, regionIndex) => {
        const item = itemByKey.get(region.key)
        const previousRegion = regions[regionIndex - 1]
        const nextRegion = regions[regionIndex + 1]
        const isAnalysis = region.type === 'analysis'
        const analysisStart = isAnalysis && previousRegion?.type !== 'analysis'
        const analysisEnd = isAnalysis && nextRegion?.type !== 'analysis'
        const analysisJoinsAnswer = analysisStart && previousRegion?.kind === 'answer'
        const isTextRegion = region.kind === 'paragraph' || region.kind === 'markdown'
        const isSideWrappedFigure = region.kind === 'figure'
          && !region.groupFigureKeys?.length
          && (region.textWrap === 'square-left' || region.textWrap === 'square-right')
        const flowWrappedText = flowWrapActive && isTextRegion
        const clearFlowWrap = flowWrapActive && !isTextRegion && !isSideWrappedFigure
        const regionStyle: CSSProperties | undefined = isSideWrappedFigure
          ? {
              float: region.textWrap === 'square-left' ? 'left' : 'right',
              clear: 'both',
              width: `${resolveFigureLayout({
                preset: region.layoutPreset,
                explicitWidthMm: region.widthOverrideMm ?? DEFAULT_QUESTION_FIGURE_WIDTH_MM,
                legacyAlignment: region.alignmentOverride,
                containerWidthMm: layoutEditor?.contentWidthMm || 160,
              }).widthMm * CSS_PIXELS_PER_MM}px`,
              maxWidth: '100%',
              margin: `0 ${region.textWrap === 'square-left' ? Math.max(0, region.wrapGapMm ?? 4) : 0}mm ${Math.max(0, region.wrapGapMm ?? 4)}mm ${region.textWrap === 'square-right' ? Math.max(0, region.wrapGapMm ?? 4) : 0}mm`,
            }
          : clearFlowWrap ? { clear: 'both' } : undefined
        flowWrapActive = isSideWrappedFigure
          ? true
          : isTextRegion && flowWrapActive
            ? true
            : false
        return (
          <div
            className={`td-question-region ${flowWrappedText ? 'td-question-region-flow-text' : 'flow-root'} ${isAnalysis ? `td-question-analysis-region border-x border-blue-200/70 bg-blue-50/80 px-3 py-2 dark:border-blue-900/60 dark:bg-blue-950/30 ${analysisStart && !analysisJoinsAnswer ? 'rounded-t-md border-t' : ''} ${analysisStart && analysisJoinsAnswer ? 'border-t-0' : ''} ${analysisEnd ? 'rounded-b-md border-b' : ''}` : ''}`}
            key={`${region.key}:${item?.kind === 'question-paragraph-fragment' ? item.fragmentIndex : 0}`}
            style={regionStyle}
            {...{
              [TEACHING_DOM.questionRegion]: region.type,
              [TEACHING_DOM.questionRegionKey]: region.key,
              [TEACHING_DOM.questionRegionIndex]: region.index,
              [TEACHING_DOM.questionSplitPolicy]: region.splitPolicy,
              'data-text-wrap': isSideWrappedFigure ? region.textWrap : undefined,
              ...(region.kind === 'options-row'
                ? {
                    [TEACHING_DOM.questionOptionRow]: region.rowIndex,
                    [TEACHING_DOM.questionOptionStart]: region.optionStart,
                    [TEACHING_DOM.questionOptionEnd]: region.optionEnd,
                  }
                : {}),
            }}
          >
            <QuestionRegionContent
              region={region}
              item={item}
              layoutEditor={layoutEditor}
              resolveFigure={resolveFigure}
              choiceLayoutBlockId={choiceLayoutBlockId}
              editableQuestionText={editableQuestionText}
              joinWithAnalysis={region.kind === 'answer' && nextRegion?.type === 'analysis'}
              onInlineContentChange={onInlineContentChange}
            />
          </div>
        )
      })}
    </div>
  )
}

function QuestionBlockView({ block, resolvers }: { block: QuestionBlock; resolvers: TeachingDocumentResolvers }) {
  const { resolveQuestion, resolveFigure, choiceLayoutOverrides, probeChoiceLayouts } = resolvers
  const resolution = resolveQuestion?.(block.questionId)

  if (resolution && 'status' in resolution && resolution.status === 'loading') {
    return <QuestionPlaceholder block={block} message="题目加载中…" status="loading" />
  }

  if (resolution && 'status' in resolution && resolution.status === 'error') {
    return <QuestionPlaceholder block={block} message={`题目加载失败：${resolution.message}`} status="error" tone="error" />
  }

  if (resolution && 'status' in resolution && resolution.status === 'missing') {
    return <QuestionPlaceholder block={block} message={resolution.message || `题目不存在（ID: ${block.questionId || '未设置'}）`} status="missing" />
  }

  const question = resolution && !('status' in resolution) ? resolution : undefined

  if (!question) {
    return <QuestionPlaceholder block={block} message={`题目不可用（ID: ${block.questionId || '未设置'}）`} status="missing" />
  }

  // 文档本地覆盖优先于题库内容
  const effectiveQuestion = block.localContent ? { ...question, ...block.localContent } : question

  return (
    <>
      {block.localContent ? (
        <div className="mt-4">
          <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50/60 px-1.5 py-0.5 text-[11px] font-normal tracking-wide text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">文档本地版本</span>
        </div>
      ) : null}
      <QuestionRuntimeContent block={block} model={createQuestionRuntimeModel(block, effectiveQuestion, { choiceLayoutOverrides, probeChoiceLayouts })} resolveFigure={resolveFigure} choiceLayoutBlockId={block.id} typography={block.display?.typography} />
    </>
  )
}

export function QuestionFragmentRenderer({
  block,
  question,
  item,
  selected = false,
  resolveFigure,
  choiceLayoutOverrides,
  probeChoiceLayouts,
  clearFlowWrap = false,
}: {
  block: QuestionBlock
  question: QuestionItem
  item: QuestionFragmentPaginationItem
  selected?: boolean
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  choiceLayoutOverrides?: ChoiceLayoutOverrides
  probeChoiceLayouts?: boolean
  /** 前方环绕图片后的独立题目 fragment 从图片下方开始。 */
  clearFlowWrap?: boolean
}) {
  return (
    <div
      className={`td-question-fragment td-block-shell ${selected ? 'td-block-selected' : ''}`}
      style={clearFlowWrap ? { clear: 'both' } : undefined}
      {...{
        [TEACHING_DOM.fragment]: '',
        [TEACHING_DOM.fragmentType]: 'question',
        [TEACHING_DOM.fragmentIndex]: item.fragmentIndex,
        [TEACHING_DOM.fragmentContinuation]: item.continuation,
        [TEACHING_DOM.sourceBlockId]: block.id,
        [TEACHING_DOM.sourceIndex]: item.sourceIndex,
        [TEACHING_DOM.questionSourceId]: item.questionId,
      }}
    >
      <QuestionRuntimeContent
        block={block}
        model={createQuestionRuntimeModel(block, block.localContent ? { ...question, ...block.localContent } : question, { choiceLayoutOverrides, probeChoiceLayouts })}
        continuation={item.continuation}
        trimEndChrome={item.trimEndChrome}
        regionItems={item.regionItems}
        resolveFigure={resolveFigure}
        choiceLayoutBlockId={block.id}
        typography={block.display?.typography}
      />
    </div>
  )
}

export function QuestionPlaceholder({
  block,
  message,
  status,
  tone = 'neutral',
  clearFlowWrap = false,
}: {
  block: QuestionBlock
  message: string
  status: 'loading' | 'error' | 'missing'
  tone?: 'neutral' | 'error'
  clearFlowWrap?: boolean
}) {
  return (
    <div
      className={`td-question my-4 rounded-lg border border-dashed p-4 ${
        tone === 'error'
          ? 'border-red-300 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
          : 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30'
      }`}
      style={clearFlowWrap ? { clear: 'both' } : undefined}
      data-block-id={block.id}
      data-block-type="question"
      data-question-state={tone}
      {...{
        [TEACHING_DOM.questionRoot]: '',
        [TEACHING_DOM.questionSourceId]: block.questionId,
        [TEACHING_DOM.questionSplitPolicy]: 'never',
        [TEACHING_DOM.resource]: 'question',
        [TEACHING_DOM.resourceId]: block.id,
        [TEACHING_DOM.resourceStatus]: status,
      }}
    >
      <div className={`flex items-center gap-2 text-sm ${tone === 'error' ? 'text-red-700 dark:text-red-400' : 'text-zinc-400'}`}>
        <HelpCircle className="size-4 shrink-0" />
        <span>{message}</span>
      </div>
    </div>
  )
}

function BoxTitleText({
  block,
  templateLabel,
  continuation,
  editable,
  onEditTitle,
}: {
  block: BoxBlock
  templateLabel: string
  continuation: 'single' | 'start' | 'middle' | 'end'
  editable?: boolean
  onEditTitle?: (boxId: string, title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const suffix = continuation === 'middle' || continuation === 'end' ? '（续）' : ''

  function startEdit() {
    setDraft(block.title || templateLabel)
    setEditing(true)
  }
  function commit() {
    setEditing(false)
    onEditTitle?.(block.id, draft.trim())
  }

  if (editing && editable) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit() }
          else if (event.key === 'Escape') { event.preventDefault(); setEditing(false) }
        }}
        onBlur={commit}
        aria-label="卡片标题"
        placeholder={templateLabel}
        className="min-w-0 flex-1 truncate bg-transparent text-sm font-semibold text-zinc-700 outline-none placeholder:font-normal placeholder:text-zinc-400 dark:text-zinc-200"
      />
    )
  }
  return (
    <span
      onDoubleClick={editable ? (event) => { event.stopPropagation(); startEdit() } : undefined}
      title={editable ? '单击选中卡片，双击编辑标题' : undefined}
      className={`truncate text-sm font-semibold text-zinc-700 dark:text-zinc-200 ${editable ? 'cursor-text rounded decoration-zinc-300 underline-offset-2 hover:underline dark:decoration-zinc-600' : ''}`}
    >
      {block.title || templateLabel}
      {suffix}
    </span>
  )
}

function BoxFrame({
  block,
  continuation = 'single',
  children,
  titleEditable,
  onEditTitle,
  onHeaderPointerDown,
  skinDesignVariantIds,
}: {
  block: BoxBlock
  continuation?: 'single' | 'start' | 'middle' | 'end'
  children: ReactNode
  titleEditable?: boolean
  onEditTitle?: (boxId: string, title: string) => void
  onHeaderPointerDown?: () => void
  skinDesignVariantIds?: TeachingSkinDesignVariantIds
}) {
  const template = getBoxTemplateOrFallback(block.templateId)
  const skin = resolveBoxSkin(block.skin, block.templateId)
  const skinActive = skin.status === 'resolved'
  const design = skinActive
    ? resolveTeachingSkinDesignRenderState(skin.definition, resolveTeachingSkinVariantRequest(skin.skin, skin.definition.id, skinDesignVariantIds))
    : undefined
  const iconName = block.icon || template.defaultIcon
  const hasHeader = Boolean(template.showHeader || block.title)
  const isContinuationHeader = continuation === 'middle' || continuation === 'end'
  const showContinuationLabel = continuation === 'start' || continuation === 'middle'

  return (
    <div
      className={`td-box overflow-hidden border ${skinActive ? skin.definition.className : ''}`}
      {...{
        [TEACHING_DOM.boxRoot]: '',
        [TEACHING_DOM.boxTemplate]: block.templateId,
      }}
      data-tone={template.tone}
      data-break-behavior={block.breakBehavior}
      data-continuation={continuation}
      data-skin-id={skinActive ? skin.definition.id : undefined}
      data-skin-state={block.skin ? skin.status : undefined}
      style={{ ...(skinActive ? skinBoxFrameStyle(block.appearance, template) : boxFrameStyle(block.appearance, template)), ...(design?.cssVariables || {}) } as CSSProperties}
    >
      {isContinuationHeader ? (
        /* 续页栏：弱化标题，无图标、无 accent 线、无底色 */
        hasHeader ? (
          <div
            className="td-box-continuation-header"
            {...{ [TEACHING_DOM.boxHeader]: '' }}
          >
            <span className="truncate">
              {block.title || template.label}（续）
            </span>
          </div>
        ) : null
      ) : (
        /* 完整标题栏：single / start */
        hasHeader ? (
          <div
            className="td-box-header flex min-w-0 items-center gap-2 px-4 py-2.5"
            {...{ [TEACHING_DOM.boxHeader]: '' }}
            style={skinActive ? undefined : { background: `var(--box-${template.tone}-header)` }}
            onPointerDown={(event) => {
              if (!onHeaderPointerDown) return
              event.stopPropagation()
              onHeaderPointerDown()
            }}
          >
            <BoxIcon name={iconName} className="size-4 shrink-0" />
            <BoxTitleText block={block} templateLabel={template.label} continuation={continuation} editable={titleEditable} onEditTitle={onEditTitle} />
          </div>
        ) : null
      )}
      {hasHeader ? (
        <div
          className="td-box-continuation-header td-box-continuation-probe"
          {...{ [TEACHING_DOM.boxContinuationHeaderProbe]: '' }}
        >
          <span className="truncate">{block.title || template.label}（续）</span>
        </div>
      ) : null}
      <div
        className="td-box-body px-4 py-3"
        {...{ [TEACHING_DOM.boxBody]: '' }}
        style={skinActive ? skinBoxBodyStyle(block.appearance, template) : boxBodyStyle(block.appearance, template)}
      >
        {children}
        <div
          className="td-box-continuation-label td-box-continuation-probe"
          aria-hidden="true"
          {...{ [TEACHING_DOM.boxContinuationLabelProbe]: '' }}
        >
          ▸ 续下页
        </div>
        {showContinuationLabel ? (
          <div className="td-box-continuation-label" aria-hidden="true">
            ▸ 续下页
          </div>
        ) : null}
      </div>
    </div>
  )
}

function BoxBlockView({
  block,
  resolvers,
  selectedBlockId,
  sourceIndex,
  boxTitleEditable,
  onEditBoxTitle,
}: {
  block: BoxBlock
  resolvers: TeachingDocumentResolvers
  selectedBlockId?: string
  sourceIndex?: number
  boxTitleEditable?: boolean
  onEditBoxTitle?: (boxId: string, title: string) => void
}) {
  return (
    <BoxFrame block={block} titleEditable={boxTitleEditable} onEditTitle={onEditBoxTitle} skinDesignVariantIds={resolvers.skinDesignVariantIds}>
      {block.children.map((child, index) => (
        <BlockRenderer
          key={`${child.id}:${index}`}
          block={child as TeachingBlock}
          resolvers={resolvers}
          parentBlockId={block.id}
          sourceIndex={sourceIndex}
          childIndex={index}
          selectedBlockId={selectedBlockId}
        />
      ))}
      {!block.children.length ? (
        <p className="text-sm text-zinc-400">（空盒子）</p>
      ) : null}
    </BoxFrame>
  )
}

export function BoxFragmentRenderer({
  block,
  item,
  resolvers,
  selectedBlockId,
  showStrategyBadge,
  renderEditableParagraph,
  renderInsertPoint,
  onSelectChild,
  titleEditable,
  onEditBoxTitle,
  onSelectBox,
  clearFlowWrap = false,
}: {
  block: BoxBlock
  item: BoxFragmentPaginationItem
  resolvers: TeachingDocumentResolvers
  selectedBlockId?: string
  /** 编辑视图显示当前分页策略徽章 */
  showStrategyBadge?: boolean
  /** 编辑视图可将分页后的段落片段替换成局部行内编辑器 */
  renderEditableParagraph?: (block: ParagraphBlock, item: ParagraphBoxChildFragmentPaginationItem) => ReactNode
  /** 编辑视图在一个完整子块结束处显示盒内插入点 */
  renderInsertPoint?: (afterChildId: string) => ReactNode
  /** 编辑视图点击盒内题目/子块时通知外层选中源子块 */
  onSelectChild?: (childId: string) => void
  /** 分页编辑器中，盒子标题可在选中后双击编辑。 */
  titleEditable?: boolean
  onEditBoxTitle?: (boxId: string, title: string) => void
  /** 分页编辑器中，点击盒子标题栏时选中盒子。 */
  onSelectBox?: () => void
  clearFlowWrap?: boolean
}) {
  return (
    <div
      className={`td-box-fragment td-block-shell relative ${selectedBlockId === block.id ? 'td-block-selected' : ''}`}
      style={clearFlowWrap ? { clear: 'both' } : undefined}
      {...{
        [TEACHING_DOM.fragment]: '',
        [TEACHING_DOM.fragmentType]: 'box',
        [TEACHING_DOM.fragmentIndex]: item.fragmentIndex,
        [TEACHING_DOM.fragmentContinuation]: item.continuation,
        [TEACHING_DOM.sourceBlockId]: block.id,
        [TEACHING_DOM.sourceIndex]: item.sourceIndex,
      }}
    >
      {showStrategyBadge && item.continuation === 'single' && block.breakBehavior && block.breakBehavior !== 'auto' ? (
        <span className="td-box-strategy-badge absolute right-2 top-1" data-edit-only="">
          {block.breakBehavior}
        </span>
      ) : null}
      <BoxFrame
        block={block}
        continuation={item.continuation}
        titleEditable={titleEditable}
        onEditTitle={onEditBoxTitle}
        onHeaderPointerDown={onSelectBox}
        skinDesignVariantIds={resolvers.skinDesignVariantIds}
      >
        {item.childItems.map((childItem) => {
          const child = block.children[childItem.childIndex]
          if (!child || child.id !== childItem.childBlockId) return null
          if (childItem.kind === 'paragraph-child-fragment' && child.type === 'paragraph') {
            return (
              <div key={`paragraph-child:${childItem.childIndex}:${childItem.fragmentIndex}`}>
                {renderEditableParagraph
                  ? renderEditableParagraph(child, childItem)
                  : (
                    <ParagraphFragmentRenderer
                      block={child}
                      item={childItem}
                      selected={selectedBlockId === child.id}
                    />
                  )}
                {(childItem.continuation === 'single' || childItem.continuation === 'end')
                  ? renderInsertPoint?.(child.id)
                  : null}
              </div>
            )
          }
          if (childItem.kind === 'question-child-fragment' && child.type === 'question') {
            const resolution = resolvers.resolveQuestion?.(childItem.questionId)
            if (!resolution || 'status' in resolution) {
              // resolver 失效：渲染稳定占位，不回退 BlockRenderer 整题，
              // 避免多 fragment 场景下同一题在每页重复整题。
              if (childItem.fragmentIndex > 0) return null
              const status = resolution && 'status' in resolution ? resolution.status : 'missing'
              return (
                <div
                  key={`question-child-fallback:${childItem.childIndex}`}
                  onClick={(event) => {
                    if (!onSelectChild) return
                    event.stopPropagation()
                    onSelectChild(child.id)
                  }}
                >
                  <QuestionPlaceholder
                    block={child}
                    message={status === 'loading'
                      ? '题目加载中…'
                      : status === 'error'
                        ? `题目加载失败：${resolution && 'message' in resolution ? resolution.message : '未知错误'}`
                        : `题目不可用（ID: ${child.questionId || '未设置'}）`}
                    status={status === 'loading' ? 'loading' : status === 'error' ? 'error' : 'missing'}
                    tone={status === 'error' ? 'error' : 'neutral'}
                  />
                </div>
              )
            }
            return (
              <div
                key={`question-child:${childItem.childIndex}:${childItem.fragmentIndex}`}
                className={`td-question-fragment td-block-shell ${selectedBlockId === child.id ? 'td-block-selected' : ''}`}
                onClick={(event) => {
                  if (!onSelectChild) return
                  event.stopPropagation()
                  onSelectChild(child.id)
                }}
                {...{
                  [TEACHING_DOM.fragment]: '',
                  [TEACHING_DOM.fragmentType]: 'question',
                  [TEACHING_DOM.fragmentIndex]: childItem.fragmentIndex,
                  [TEACHING_DOM.fragmentContinuation]: childItem.continuation,
                  [TEACHING_DOM.sourceBlockId]: child.id,
                  [TEACHING_DOM.sourceIndex]: item.sourceIndex,
                  [TEACHING_DOM.parentBlockId]: block.id,
                  [TEACHING_DOM.childIndex]: childItem.childIndex,
                  [TEACHING_DOM.questionSourceId]: childItem.questionId,
                }}
              >
                <QuestionRuntimeContent
                  block={child}
                  model={createQuestionRuntimeModel(child, child.localContent ? { ...resolution, ...child.localContent } : resolution, {
                    choiceLayoutOverrides: resolvers.choiceLayoutOverrides,
                    probeChoiceLayouts: resolvers.probeChoiceLayouts,
                  })}
                  continuation={childItem.continuation}
                  regionItems={childItem.regionItems}
                  resolveFigure={resolvers.resolveFigure}
                  choiceLayoutBlockId={child.id}
                  typography={child.display?.typography}
                />
              </div>
            )
          }
          if (childItem.kind === 'raw-markdown-child-fragment' && child.type === 'rawMarkdown') {
            return (
              <div
                key={`raw-markdown-child:${childItem.childIndex}:${childItem.fragmentIndex}`}
                onClick={(event) => {
                  if (!onSelectChild) return
                  event.stopPropagation()
                  onSelectChild(child.id)
                }}
              >
                <RawMarkdownBlockView
                  block={child}
                  segmentStart={childItem.segmentStart}
                  segmentEnd={childItem.segmentEnd}
                />
                {(childItem.continuation === 'single' || childItem.continuation === 'end')
                  ? renderInsertPoint?.(child.id)
                  : null}
              </div>
            )
          }
          return (
            <div
              key={`whole-child:${childItem.childIndex}`}
              onClick={(event) => {
                if (!onSelectChild) return
                event.stopPropagation()
                onSelectChild(child.id)
              }}
            >
              <BlockRenderer
                block={child as TeachingBlock}
                resolvers={resolvers}
                parentBlockId={block.id}
                sourceIndex={item.sourceIndex}
                childIndex={childItem.childIndex}
                selectedBlockId={selectedBlockId}
              />
            </div>
          )
        })}
      </BoxFrame>
    </div>
  )
}

function DividerBlockView({ block }: { block: DividerBlock }) {
  return (
    <hr
      className="td-divider my-5 border-t border-zinc-200 dark:border-zinc-800"
      data-block-id={block.id}
      data-block-type="divider"
    />
  )
}

function SpacerBlockView({ block }: { block: SpacerBlock }) {
  return (
    <div
      className="td-spacer"
      style={{ height: `${block.heightEm}em` }}
      data-block-id={block.id}
      data-block-type="spacer"
      aria-hidden="true"
    />
  )
}

function PageBreakBlockView({ block }: { block: PageBreakBlock }) {
  return (
    <div
      className="td-page-break td-page-break-marker"
      data-block-id={block.id}
      data-block-type="pageBreak"
      data-break="page"
      aria-label="手动换页符"
    >
      <div className="td-page-break-marker-line">
        <span />
        <span className="td-page-break-marker-label">
          <CornerDownRight className="size-3" />
          换页
          <span className="font-normal text-zinc-400">下一项从新页开始</span>
        </span>
        <span />
      </div>
    </div>
  )
}

function RawMarkdownBlockView({ block, overflowWarning, segmentStart = 0, segmentEnd }: {
  block: RawMarkdownBlock
  overflowWarning?: string
  segmentStart?: number
  segmentEnd?: number
}) {
  const segments = rawMarkdownSegments(block.markdown)
  return (
    <div
      className="td-raw-markdown my-3"
      data-block-id={block.id}
      data-block-type="rawMarkdown"
    >
      {segments.slice(segmentStart, segmentEnd ?? segments.length).map((segment, index) => (
        <div key={segmentStart + index} {...{ [TEACHING_DOM.rawMarkdownSegment]: segmentStart + index }}>
          <MarkdownContent content={segment} />
        </div>
      ))}
      {overflowWarning ? (
        <div
          className="td-rawmarkdown-overflow-warning mt-2 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          data-rawmarkdown-overflow="true"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{overflowWarning}</span>
        </div>
      ) : null}
    </div>
  )
}

function TableBlockView({ block }: { block: TableBlock }) {
  const bodyRows = block.hasHeader ? block.rows.slice(1) : block.rows
  const renderCells = (row: TableBlock['rows'][number], header = false) => row.map((cell, index) => {
    const Cell = header ? 'th' : 'td'
    return <Cell key={index} className="border border-zinc-300 px-2 py-1.5 text-left align-top dark:border-zinc-700"><InlineContent inlines={cell.content} /></Cell>
  })
  return (
    <div className="td-table my-5 overflow-x-auto" data-block-id={block.id} data-block-type="table">
      <table className="w-full table-fixed border-collapse text-sm">
        {block.hasHeader && block.rows[0] ? <thead className="bg-zinc-100 dark:bg-zinc-800"><tr>{renderCells(block.rows[0], true)}</tr></thead> : null}
        {bodyRows.length ? <tbody>{bodyRows.map((row, index) => <tr key={index}>{renderCells(row)}</tr>)}</tbody> : null}
      </table>
    </div>
  )
}

function UnknownBlockView({ block }: { block: UnknownBlock }) {
  return (
    <div
      className="td-unknown my-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/30"
      data-block-id={block.id}
      data-block-type="unknown"
      data-original-type={block.originalType}
    >
      <p className="text-xs text-zinc-400">
        未识别的块类型 &quot;{block.originalType}&quot;（已保留原始数据）
      </p>
    </div>
  )
}

// ─── rawMarkdown 表格静态检测 ────────────────────────────────────────────────

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** 确定性检测 markdown 源码中是否包含 GFM 表格（无需 DOM）。 */
export function rawMarkdownContainsTable(markdown: string): boolean {
  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].includes('|') && TABLE_SEPARATOR_RE.test(lines[index + 1])) return true
  }
  return false
}

// ─── 统一块分发 ──────────────────────────────────────────────────────────────

export function BlockRenderer({
  block,
  resolvers,
  parentBlockId,
  sourceIndex,
  childIndex,
  selectedBlockId,
  rawMarkdownOverflowWarning,
  boxTitleEditable,
  onEditBoxTitle,
  headingLabel,
  flowWrappedText = false,
}: {
  block: TeachingBlock
  resolvers: TeachingDocumentResolvers
  parentBlockId?: string
  sourceIndex?: number
  childIndex?: number
  selectedBlockId?: string
  /** 分页诊断产生的 rawMarkdown 超页警告文本（仅 paper surface 传入）。 */
  rawMarkdownOverflowWarning?: string
  /** 仅画布选中盒子本身时为真，允许点击标题行内编辑 */
  boxTitleEditable?: boolean
  onEditBoxTitle?: (boxId: string, title: string) => void
  /** 文档级章节编号引擎派生的标题前缀，不写入标题正文。 */
  headingLabel?: string
  /** 前方左右环绕图片尚在当前文档流内，文本块需要允许逐行绕排。 */
  flowWrappedText?: boolean
}) {
  const figureTextWrap = block.type === 'figure' ? block.textWrap || 'top-bottom' : 'top-bottom'
  const figureSideWrapped = figureTextWrap === 'square-left' || figureTextWrap === 'square-right'
  const supportsFlowWrap = block.type === 'heading' || block.type === 'paragraph'
  const figureShellStyle: CSSProperties | undefined = block.type === 'figure'
    ? figureSideWrapped
      ? (() => {
          const layout = resolveFigureLayout({
            preset: block.layoutPreset,
            explicitWidthMm: block.widthMm,
            legacyAlignment: block.alignment,
            legacyWidthRatio: block.widthRatio,
            containerWidthMm: 160,
          })
          const gapMm = Math.max(0, block.wrapGapMm ?? 4)
          return {
            float: figureTextWrap === 'square-left' ? 'left' : 'right',
            clear: 'both',
            width: `${layout.widthMm * CSS_PIXELS_PER_MM}px`,
            maxWidth: '100%',
            margin: `0 ${figureTextWrap === 'square-left' ? gapMm : 0}mm ${gapMm}mm ${figureTextWrap === 'square-right' ? gapMm : 0}mm`,
          }
        })()
      : { clear: 'both' }
    : flowWrappedText && supportsFlowWrap
      ? undefined
      : supportsFlowWrap
        ? undefined
        : { clear: 'both' }
  let content: ReactNode
  switch (block.type) {
    case 'heading':
      content = <HeadingBlockView block={block} numberLabel={headingLabel} skinDesignVariantIds={resolvers.skinDesignVariantIds} />
      break
    case 'paragraph':
      content = <ParagraphBlockView block={block} />
      break
    case 'blockMath':
      content = <BlockMathBlockView block={block} />
      break
    case 'table':
      content = <TableBlockView block={block} />
      break
    case 'figure':
      content = <FigureBlockView block={block} resolveFigure={resolvers.resolveFigure} eagerImages={resolvers.eagerImages} flowWrapped={figureSideWrapped} />
      break
    case 'tikz':
      content = <TikzBlockView block={block} resolveFigure={resolvers.resolveFigure} eagerImages={resolvers.eagerImages} />
      break
    case 'question':
      content = <QuestionBlockView block={block} resolvers={resolvers} />
      break
    case 'box':
      content = <BoxBlockView block={block} resolvers={resolvers} selectedBlockId={selectedBlockId} sourceIndex={sourceIndex} boxTitleEditable={boxTitleEditable} onEditBoxTitle={onEditBoxTitle} />
      break
    case 'divider':
      content = <DividerBlockView block={block} />
      break
    case 'spacer':
      content = <SpacerBlockView block={block} />
      break
    case 'pageBreak':
      content = <PageBreakBlockView block={block} />
      break
    case 'rawMarkdown':
      content = <RawMarkdownBlockView block={block} overflowWarning={rawMarkdownOverflowWarning} />
      break
    case 'unknown':
      content = <UnknownBlockView block={block} />
      break
    default:
      return null
  }
  return (
    <div
      className={`td-block-shell ${figureSideWrapped ? 'td-block-shell-wrapped' : ''} ${flowWrappedText && supportsFlowWrap ? 'td-block-shell-flow-text' : ''} ${selectedBlockId === block.id ? 'td-block-selected' : ''}`}
      style={figureShellStyle}
      data-text-wrap={block.type === 'figure' ? figureTextWrap : undefined}
      {...blockDomAttributes(block, parentBlockId, sourceIndex, childIndex, {
        rawMarkdownContainsTable: block.type === 'rawMarkdown'
          ? rawMarkdownContainsTable(block.markdown)
          : undefined,
      })}
    >
      {content}
    </div>
  )
}
