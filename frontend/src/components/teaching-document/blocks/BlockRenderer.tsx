/**
 * 块级渲染器集合
 * 每个块渲染器添加 data-block-id / data-block-type 属性供未来分页引擎识别
 */

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import katex from 'katex'
import { AlertTriangle, BookOpen, Box, HelpCircle, ImageOff, Lightbulb, ListChecks, PenLine, Pencil } from 'lucide-react'
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
  TeachingBlock,
  UnknownBlock,
} from '@/types/teachingDocument'
import type { QuestionItem } from '@/types'
import { getBoxTemplateOrFallback } from '@/utils/teachingDocument/boxTemplates'
import {
  blockDomAttributes,
  inlineCursorLabel,
  TEACHING_DOM,
  type BoxFragmentPaginationItem,
  type InlineRange,
  type PaginatedQuestionRegionItem,
  type ParagraphBoxChildFragmentPaginationItem,
  type ParagraphFragmentPaginationItem,
  type QuestionBoxChildFragmentPaginationItem,
  type QuestionFragmentPaginationItem,
} from '@/utils/teachingDocument/layout'
import {
  createQuestionRuntimeModel,
  type QuestionRuntimeModel,
  type QuestionRuntimeRegion,
} from '@/utils/teachingDocument/layout/questionRegions'
import { assetUrl } from '@/utils/questionDisplay'
import { MarkdownContent } from '@/components/MarkdownContent'
import {
  ChoiceOptions,
  FigureGallery,
  MarkdownWithInlineFigures,
} from '@/components/questions/QuestionContent'
import { InlineContent } from './InlineContent'

// ─── Resolver 类型 ───────────────────────────────────────────────────────────

export interface TeachingDocumentResolvers {
  /** 根据 questionId 获取题目数据 */
  resolveQuestion?: (questionId: string) => QuestionResolution
  /** 根据资源引用解析为可显示 URL */
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  eagerImages?: boolean
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

function HeadingBlockView({ block }: { block: HeadingBlock }) {
  const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4'
  const sizeClass = {
    1: 'text-2xl font-bold mt-8 mb-4',
    2: 'text-xl font-semibold mt-6 mb-3',
    3: 'text-lg font-semibold mt-5 mb-2',
    4: 'text-base font-medium mt-4 mb-2',
  }[block.level]
  return (
    <Tag
      className={`td-heading ${sizeClass} text-zinc-900 dark:text-zinc-50`}
      data-block-id={block.id}
      data-block-type="heading"
    >
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
      data-block-id={block.id}
      data-block-type="paragraph"
    >
      <ParagraphBlockContent block={block} />
    </p>
  )
}

export function ParagraphFragmentRenderer({
  block,
  item,
  selected = false,
}: {
  block: ParagraphBlock
  item: ParagraphFragmentPaginationItem | ParagraphBoxChildFragmentPaginationItem
  selected?: boolean
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
      className={`td-paragraph-fragment td-block-shell ${selected ? 'td-block-selected' : ''}`}
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
      <p className={`td-paragraph ${marginClass} leading-7 text-zinc-800 dark:text-zinc-200`}>
        <ParagraphBlockContent block={block} range={item.range} />
      </p>
    </div>
  )
}

function BlockMathBlockView({ block }: { block: BlockMathBlock }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(block.latex, { displayMode: true, throwOnError: true, strict: false })
    } catch {
      return ''
    }
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
}: {
  block: FigureBlock
  resolveFigure?: (asset: FigureAssetRef) => FigureResolution
  eagerImages?: boolean
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

  const alignClass = { left: 'mr-auto', center: 'mx-auto', right: 'ml-auto' }[block.alignment]
  const widthStyle = block.widthRatio ? { width: `${block.widthRatio * 100}%` } : undefined

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
      className={`td-figure my-4 ${alignClass}`}
      style={widthStyle}
      data-block-id={block.id}
      data-block-type="figure"
      data-alignment={block.alignment}
      data-image-state={imageState}
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
          className={`block h-auto max-h-[70vh] w-full rounded-lg border border-zinc-200 object-contain transition-opacity dark:border-zinc-800 ${imageState === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
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

function questionLayoutOverride(layout: 'quad' | 'double' | 'single') {
  return layout === 'quad' ? 'four' : layout === 'double' ? 'two' : 'one'
}

function QuestionRegionContent({
  region,
  item,
}: {
  region: QuestionRuntimeRegion
  item?: PaginatedQuestionRegionItem
}) {
  if (region.kind === 'heading') return null
  if (region.kind === 'paragraph') {
    const range = item?.kind === 'question-paragraph-fragment' ? item.range : undefined
    return (
      <p className="td-question-paragraph my-2 text-sm leading-7 text-zinc-900 dark:text-zinc-100">
        <InlineContent inlines={region.paragraph.content} range={range} />
      </p>
    )
  }
  if (region.kind === 'markdown') {
    return <MarkdownContent className="text-sm leading-7" content={region.markdown} />
  }
  if (region.kind === 'math') {
    return <MarkdownContent className="text-sm leading-7" content={`$$${region.latex}$$`} />
  }
  if (region.kind === 'figure') {
    const visibleFigures = region.figures.filter((figure) => Boolean(figure.path))
    return visibleFigures.length ? (
      <FigureGallery figures={visibleFigures} className="my-3" />
    ) : (
      <div
        className="my-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"
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
          optionDomAttributes={(optionIndex) => ({
            [TEACHING_DOM.questionOptionIndex]: optionIndex,
            [TEACHING_DOM.questionOptionRow]: region.rowIndex,
          })}
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
      <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
        <span className="text-xs font-semibold text-zinc-500">参考答案：</span>
        <MarkdownWithInlineFigures
          className="mt-1 text-sm text-zinc-800 dark:text-zinc-200"
          content={region.markdown}
          figures={region.figures}
        />
      </div>
    )
  }
  return <span className="text-xs font-semibold text-zinc-500">{region.label}</span>
}

export function QuestionRuntimeContent({
  block,
  model,
  continuation = 'single',
  regionItems,
}: {
  block: QuestionBlock
  model: QuestionRuntimeModel
  continuation?: 'single' | 'start' | 'middle' | 'end'
  regionItems?: PaginatedQuestionRegionItem[]
}) {
  const marginClass = {
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

  return (
    <div
      className={`td-question ${marginClass}`}
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
      {regions.map((region) => {
        const item = itemByKey.get(region.key)
        return (
          <div
            className="td-question-region flow-root"
            key={`${region.key}:${item?.kind === 'question-paragraph-fragment' ? item.fragmentIndex : 0}`}
            {...{
              [TEACHING_DOM.questionRegion]: region.type,
              [TEACHING_DOM.questionRegionKey]: region.key,
              [TEACHING_DOM.questionRegionIndex]: region.index,
              [TEACHING_DOM.questionSplitPolicy]: region.splitPolicy,
              ...(region.kind === 'options-row'
                ? {
                    [TEACHING_DOM.questionOptionRow]: region.rowIndex,
                    [TEACHING_DOM.questionOptionStart]: region.optionStart,
                    [TEACHING_DOM.questionOptionEnd]: region.optionEnd,
                  }
                : {}),
            }}
          >
            {region.kind === 'heading' ? (
              <div className="mb-1.5 flex items-baseline gap-2">
                {model.displayNumber ? <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{model.displayNumber}.</span> : null}
                {model.score ? <span className="text-xs text-zinc-400">（{model.score} 分）</span> : null}
                {model.questionType ? <span className="text-xs text-zinc-400">{model.questionType}</span> : null}
              </div>
            ) : <QuestionRegionContent region={region} item={item} />}
          </div>
        )
      })}
    </div>
  )
}

function QuestionBlockView({ block, resolveQuestion }: { block: QuestionBlock; resolveQuestion?: (id: string) => QuestionResolution }) {
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

  return <QuestionRuntimeContent block={block} model={createQuestionRuntimeModel(block, question)} />
}

export function QuestionFragmentRenderer({
  block,
  question,
  item,
  selected = false,
}: {
  block: QuestionBlock
  question: QuestionItem
  item: QuestionFragmentPaginationItem
  selected?: boolean
}) {
  return (
    <div
      className={`td-question-fragment td-block-shell ${selected ? 'td-block-selected' : ''}`}
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
        model={createQuestionRuntimeModel(block, question)}
        continuation={item.continuation}
        regionItems={item.regionItems}
      />
    </div>
  )
}

export function QuestionPlaceholder({
  block,
  message,
  status,
  tone = 'neutral',
}: {
  block: QuestionBlock
  message: string
  status: 'loading' | 'error' | 'missing'
  tone?: 'neutral' | 'error'
}) {
  return (
    <div
      className={`td-question my-4 rounded-lg border border-dashed p-4 ${
        tone === 'error'
          ? 'border-red-300 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
          : 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30'
      }`}
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

function BoxFrame({
  block,
  continuation = 'single',
  children,
}: {
  block: BoxBlock
  continuation?: 'single' | 'start' | 'middle' | 'end'
  children: ReactNode
}) {
  const template = getBoxTemplateOrFallback(block.templateId)
  const iconName = block.icon || template.defaultIcon
  const marginAndRadius = {
    single: 'my-5 rounded-lg',
    start: 'mt-5 mb-0 rounded-t-lg',
    middle: 'my-0 rounded-none',
    end: 'mt-0 mb-5 rounded-b-lg',
  }[continuation]

  return (
    <div
      className={`td-box ${marginAndRadius} overflow-hidden border`}
      {...{
        [TEACHING_DOM.boxRoot]: '',
        [TEACHING_DOM.boxTemplate]: block.templateId,
      }}
      data-tone={template.tone}
      data-break-behavior={block.breakBehavior}
      style={{
        borderColor: `var(--box-${template.tone}-border)`,
      }}
    >
      {template.showHeader || block.title ? (
        <div
          className="td-box-header flex min-w-0 items-center gap-2 px-4 py-2.5"
          {...{ [TEACHING_DOM.boxHeader]: '' }}
          style={{ background: `var(--box-${template.tone}-header)` }}
        >
          <BoxIcon name={iconName} className="size-4 shrink-0" />
          <span className="truncate text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {block.title || template.label}
            {continuation === 'middle' || continuation === 'end' ? '（续）' : ''}
          </span>
        </div>
      ) : null}
      <div
        className="td-box-body px-4 py-3"
        {...{ [TEACHING_DOM.boxBody]: '' }}
        style={{ background: `var(--box-${template.tone}-body)` }}
      >
        {children}
      </div>
    </div>
  )
}

function BoxBlockView({
  block,
  resolvers,
  selectedBlockId,
  sourceIndex,
}: {
  block: BoxBlock
  resolvers: TeachingDocumentResolvers
  selectedBlockId?: string
  sourceIndex?: number
}) {
  return (
    <BoxFrame block={block}>
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
}: {
  block: BoxBlock
  item: BoxFragmentPaginationItem
  resolvers: TeachingDocumentResolvers
  selectedBlockId?: string
}) {
  return (
    <div
      className={`td-box-fragment td-block-shell ${selectedBlockId === block.id ? 'td-block-selected' : ''}`}
      {...{
        [TEACHING_DOM.fragment]: '',
        [TEACHING_DOM.fragmentType]: 'box',
        [TEACHING_DOM.fragmentIndex]: item.fragmentIndex,
        [TEACHING_DOM.fragmentContinuation]: item.continuation,
        [TEACHING_DOM.sourceBlockId]: block.id,
        [TEACHING_DOM.sourceIndex]: item.sourceIndex,
      }}
    >
      <BoxFrame block={block} continuation={item.continuation}>
        {item.childItems.map((childItem) => {
          const child = block.children[childItem.childIndex]
          if (!child || child.id !== childItem.childBlockId) return null
          if (childItem.kind === 'paragraph-child-fragment' && child.type === 'paragraph') {
            return (
              <ParagraphFragmentRenderer
                key={`paragraph-child:${childItem.childIndex}:${childItem.fragmentIndex}`}
                block={child}
                item={childItem}
                selected={selectedBlockId === child.id}
              />
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
                <QuestionPlaceholder
                  key={`question-child-fallback:${childItem.childIndex}`}
                  block={child}
                  message={status === 'loading'
                    ? '题目加载中…'
                    : status === 'error'
                      ? `题目加载失败：${resolution && 'message' in resolution ? resolution.message : '未知错误'}`
                      : `题目不可用（ID: ${child.questionId || '未设置'}）`}
                  status={status === 'loading' ? 'loading' : status === 'error' ? 'error' : 'missing'}
                  tone={status === 'error' ? 'error' : 'neutral'}
                />
              )
            }
            return (
              <div
                key={`question-child:${childItem.childIndex}:${childItem.fragmentIndex}`}
                className={`td-question-fragment td-block-shell ${selectedBlockId === child.id ? 'td-block-selected' : ''}`}
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
                  model={createQuestionRuntimeModel(child, resolution)}
                  continuation={childItem.continuation}
                  regionItems={childItem.regionItems}
                />
              </div>
            )
          }
          return (
            <BlockRenderer
              key={`whole-child:${childItem.childIndex}`}
              block={child as TeachingBlock}
              resolvers={resolvers}
              parentBlockId={block.id}
              sourceIndex={item.sourceIndex}
              childIndex={childItem.childIndex}
              selectedBlockId={selectedBlockId}
            />
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
      className="td-page-break my-6 flex items-center gap-3"
      data-block-id={block.id}
      data-block-type="pageBreak"
      data-break="page"
      aria-label="分页标记"
    >
      <div className="h-px flex-1 border-t border-dashed border-zinc-300 dark:border-zinc-700" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">分页</span>
      <div className="h-px flex-1 border-t border-dashed border-zinc-300 dark:border-zinc-700" />
    </div>
  )
}

function RawMarkdownBlockView({ block }: { block: RawMarkdownBlock }) {
  return (
    <div
      className="td-raw-markdown my-3"
      data-block-id={block.id}
      data-block-type="rawMarkdown"
    >
      <MarkdownContent content={block.markdown} />
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

// ─── 统一块分发 ──────────────────────────────────────────────────────────────

export function BlockRenderer({
  block,
  resolvers,
  parentBlockId,
  sourceIndex,
  childIndex,
  selectedBlockId,
}: {
  block: TeachingBlock
  resolvers: TeachingDocumentResolvers
  parentBlockId?: string
  sourceIndex?: number
  childIndex?: number
  selectedBlockId?: string
}) {
  let content: ReactNode
  switch (block.type) {
    case 'heading':
      content = <HeadingBlockView block={block} />
      break
    case 'paragraph':
      content = <ParagraphBlockView block={block} />
      break
    case 'blockMath':
      content = <BlockMathBlockView block={block} />
      break
    case 'figure':
      content = <FigureBlockView block={block} resolveFigure={resolvers.resolveFigure} eagerImages={resolvers.eagerImages} />
      break
    case 'question':
      content = <QuestionBlockView block={block} resolveQuestion={resolvers.resolveQuestion} />
      break
    case 'box':
      content = <BoxBlockView block={block} resolvers={resolvers} selectedBlockId={selectedBlockId} sourceIndex={sourceIndex} />
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
      content = <RawMarkdownBlockView block={block} />
      break
    case 'unknown':
      content = <UnknownBlockView block={block} />
      break
    default:
      return null
  }
  return (
    <div
      className={`td-block-shell ${selectedBlockId === block.id ? 'td-block-selected' : ''}`}
      {...blockDomAttributes(block, parentBlockId, sourceIndex, childIndex)}
    >
      {content}
    </div>
  )
}
