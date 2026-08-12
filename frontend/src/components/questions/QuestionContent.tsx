import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, X } from 'lucide-react'
import { MarkdownContent } from '@/components/MarkdownContent'
import { RichContent, richBlocksPlainText } from '@/components/RichContent'
import { LargeImageDialog } from '@/components/dialogs/Modal'
import { Button } from '@/components/ui'
import type { ChoiceOption, QuestionFigure, RichBlock } from '@/types'
import type { TeachingInline } from '@/types/teachingDocument'
import { BlockInlineEditor } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'
import { choiceLayoutForTexts } from '@/utils/choiceLayout'
import { assetUrl, figureAlt, figureCaption, figuresByUsage, parseChoiceQuestion } from '@/utils/questionDisplay'

const DOC2X_FIGURE_MARKER = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/g

function withoutInlineFigureMarkers(value: string) {
  DOC2X_FIGURE_MARKER.lastIndex = 0
  return String(value || '').replace(DOC2X_FIGURE_MARKER, '').trim()
}

function inlineFigureIds(content: string) {
  DOC2X_FIGURE_MARKER.lastIndex = 0
  return new Set(Array.from(String(content || '').matchAll(DOC2X_FIGURE_MARKER), (match) => match[1]))
}

function figureMarkerIds(figure: QuestionFigure) {
  return [figure.id, figure.blockId].map((value) => String(value || '').trim()).filter(Boolean)
}

function isInlineFigure(figure: QuestionFigure, inlineIds: Set<string>) {
  return figureMarkerIds(figure).some((id) => inlineIds.has(id))
}

function InlineFigure({ figure, index, showCaption = true, bare = false }: { figure: QuestionFigure; index: number; showCaption?: boolean; bare?: boolean }) {
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState(false)
  return (
    <>
      <figure className={`my-3 w-full max-w-[26rem] ${bare ? '' : 'overflow-hidden rounded-lg border bg-white'}`}>
        <button className={`flex w-full cursor-zoom-in justify-center text-left ${bare ? '' : 'h-48 bg-white p-2'}`} onClick={() => !error && setPreview(true)} type="button">
          {error ? (
            <div className="flex h-32 w-full items-center justify-center bg-zinc-50 text-xs text-zinc-400">
              图片加载失败
            </div>
          ) : (
            <img
              alt={figureAlt(figure, index)}
              className={`block w-full object-contain ${bare ? 'h-auto' : 'h-full bg-white'}`}
              src={assetUrl(String(figure.path || ''))}
              onError={() => setError(true)}
            />
          )}
        </button>
        {showCaption ? (
          <figcaption className="border-t px-2.5 py-1.5 text-xs text-zinc-500">{figureCaption(figure, index)}</figcaption>
        ) : null}
      </figure>
      {preview && !error ? <LargeImageDialog caption={figureCaption(figure, index)} imageUrl={assetUrl(String(figure.path || ''))} onClose={() => setPreview(false)} title="题图预览" /> : null}
    </>
  )
}

/** Render Doc2X figures exactly where their source Markdown placed them. */
export function MarkdownWithInlineFigures({
  content,
  figures = [],
  className = '',
  showFigureCaptions = true,
  bareFigures = false,
}: {
  content: string
  figures?: QuestionFigure[]
  className?: string
  showFigureCaptions?: boolean
  /** 讲义和打印预览直接呈现原图，不额外包一层白底卡片。 */
  bareFigures?: boolean
}) {
  const source = String(content || '')
  const figureById = new Map<string, QuestionFigure>()
  for (const figure of figures.filter((item) => item.path)) {
    for (const id of figureMarkerIds(figure)) figureById.set(id, figure)
  }
  const nodes: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0
  DOC2X_FIGURE_MARKER.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER.exec(source))) {
    const before = source.slice(cursor, match.index)
    if (before.trim()) nodes.push(<MarkdownContent className={className} content={before} key={`text-${index}`} />)
    const figure = figureById.get(match[1])
    if (figure) nodes.push(
      <InlineFigure
        figure={figure}
        index={index}
        key={`figure-${match[1]}-${index}`}
        showCaption={showFigureCaptions}
        bare={bareFigures}
      />,
    )
    cursor = match.index + match[0].length
    index += 1
  }
  const remainder = source.slice(cursor)
  if (remainder.trim() || !nodes.length) nodes.push(<MarkdownContent className={className} content={remainder || source} key={`text-${index}`} />)
  return <>{nodes}</>
}

export function SolutionDisclosure({
  stemMarkdown = '',
  answerText = '',
  analysisMarkdown = '',
  answerBlocks = [],
  analysisBlocks = [],
  figures = [],
  className = '',
}: {
  stemMarkdown?: string
  answerText?: string
  analysisMarkdown?: string
  answerBlocks?: RichBlock[]
  analysisBlocks?: RichBlock[]
  figures?: QuestionFigure[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const analysisFigures = figuresByUsage(figures, 'analysis')
  const answerMarkdown = answerText || richBlocksPlainText(answerBlocks)
  const analysisText = analysisMarkdown || richBlocksPlainText(analysisBlocks)
  const hasAnswer = answerMarkdown.trim().length > 0
  const hasAnalysis = analysisText.trim().length > 0
  const answerInlineIds = inlineFigureIds(answerMarkdown)
  const analysisInlineIds = inlineFigureIds(analysisText)
  const stemInlineIds = inlineFigureIds(stemMarkdown)
  const inlineIds = new Set([...stemInlineIds, ...answerInlineIds, ...analysisInlineIds])
  return (
    <div className={className}>
      <div className="flex justify-end">
        <Button variant="default" icon={open ? X : BookOpen} onClick={() => setOpen(!open)}>{open ? '收起答案解析' : '展开答案解析'}</Button>
      </div>
      <div className={`grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100 translate-y-0' : 'grid-rows-[0fr] opacity-0 -translate-y-1'}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="mt-3 space-y-3">
            <section className="rounded-xl border bg-zinc-50 p-3">
              <p className="mb-1 text-xs text-zinc-500">答案</p>
              {hasAnswer ? <MarkdownWithInlineFigures className="text-sm leading-6" content={answerMarkdown} figures={figures} /> : <span className="text-xs text-zinc-400">暂无答案</span>}
            </section>
            <section className="rounded-xl border bg-zinc-50 p-3">
              <p className="mb-1 text-xs text-zinc-500">解析</p>
              {hasAnalysis ? <MarkdownWithInlineFigures className="text-sm leading-6" content={analysisText} figures={figures} /> : <span className="text-xs text-zinc-400">暂无解析</span>}
              <FigureGallery figures={analysisFigures.filter((figure) => !isInlineFigure(figure, inlineIds))} className="mt-3" />
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

export function QuestionContent({ blocks, figures = [], className = '', prefix }: { blocks: RichBlock[]; figures?: QuestionFigure[]; className?: string; prefix?: string }) {
  return (
    <div className={`question-content ${className}`}>
      <RichContent blocks={blocks} figures={figures} prefix={prefix} />
    </div>
  )
}

export function QuestionMarkdownContent({ content, figures = [], className = '', prefix }: { content: string; figures?: QuestionFigure[]; className?: string; prefix?: string }) {
  const stemFigures = figuresByUsage(figures, 'stem')
  const optionFigures = figuresByUsage(figures, 'options')
  const parsedChoice = parseChoiceQuestion(content)
  const stemContent = parsedChoice?.stem || content
  const inlineIds = inlineFigureIds(content)
  // A marker is an explicit placement request and wins over a stale usage
  // field. This also prevents an already-inline image from appearing again in
  // the fallback gallery below.
  const visibleFigures = figures.filter((figure) => (
    figure.path
      && !String(figure.path).trim().startsWith('<')
      && (stemFigures.includes(figure) || isInlineFigure(figure, inlineIds))
  ))
  return (
    <div className={`question-content ${className}`}>
      {prefix ? <p className="mb-2 text-xs font-semibold text-zinc-500">{prefix}</p> : null}
      <MarkdownWithInlineFigures content={stemContent} figures={visibleFigures} />
      {parsedChoice ? <ChoiceOptions options={parsedChoice.options} figures={optionFigures} /> : null}
      {parsedChoice?.remainder ? <MarkdownWithInlineFigures className="mt-3" content={parsedChoice.remainder} figures={visibleFigures} /> : null}
      {visibleFigures.length ? <FigureGallery figures={visibleFigures.filter((figure) => !isInlineFigure(figure, inlineIds))} className="mt-3" /> : null}
    </div>
  )
}

export function QuestionDocumentMarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  const source = String(content || '')
  const boundaries = Array.from(source.matchAll(/^(?:##\s+|\*\*\d+\.\*\*)/gm)).map((match) => Number(match.index))
  const starts = Array.from(new Set([0, ...boundaries])).sort((left, right) => left - right)
  const segments = starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length).trim()).filter(Boolean)
  return (
    <div className={className}>
      {segments.map((segment, index) => /^\*\*\d+\.\*\*/.test(segment)
        ? <QuestionMarkdownContent content={segment} key={index} />
        : <MarkdownContent content={segment} key={index} />)}
    </div>
  )
}

export function ChoiceOptions({
  options,
  figures = [],
  className = '',
  layout: layoutOverride,
  optionIndexOffset = 0,
  optionDomAttributes,
  showFigureCaptions = true,
  bareFigures = false,
  choiceLayoutBlockId,
  inlineContent,
  editableText = false,
  onInlineContentChange,
}: {
  options: ChoiceOption[]
  figures?: QuestionFigure[]
  className?: string
  layout?: 'four' | 'two' | 'one'
  optionIndexOffset?: number
  optionDomAttributes?: (optionIndex: number) => Record<string, string | number | undefined>
  showFigureCaptions?: boolean
  /** 直接以原图比例渲染，供讲义等纸面文档使用。 */
  bareFigures?: boolean
  /** 讲义测量树使用，关联本次实际测得的列数与题目块。 */
  choiceLayoutBlockId?: string
  inlineContent?: Record<string, TeachingInline[]>
  editableText?: boolean
  onInlineContentChange?: (label: string, content: TeachingInline[]) => void
}) {
  const hasFigures = figures.some((figure) => Boolean(figure.path))

  // ─── 自适应测量：无显式 layout 时，根据实际渲染宽度决定列数 ───
  const containerRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const [adaptiveColumns, setAdaptiveColumns] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (layoutOverride) return
    if (hasFigures || options.length !== 4) {
      // 含图选项或非 4 选项：直接单列，无需测量
      setAdaptiveColumns(1)
      return
    }
    const container = containerRef.current
    const probe = probeRef.current
    if (!container || !probe) return

    const measure = () => {
      const containerWidth = container.clientWidth
      if (containerWidth <= 0) return
      const naturalWidths = Array.from(probe.children).map(
        (child) => (child as HTMLElement).getBoundingClientRect().width,
      )
      const maxWidth = Math.max(...naturalWidths, 0)
      const columnGap = 16 // .choice-options gap: 0.75rem 1rem
      const fits = (columns: number) => columns * maxWidth + (columns - 1) * columnGap <= containerWidth
      setAdaptiveColumns(fits(4) ? 4 : fits(2) ? 2 : 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(probe)
    // 字体加载完成后重新测量（字体切换 / 异步字体加载）
    const fonts = document.fonts
    if (fonts?.ready) {
      fonts.ready.then(() => measure()).catch(() => undefined)
    }
    return () => observer.disconnect()
  }, [layoutOverride, options, hasFigures])

  // ─── 布局决策：显式指定 > 测量结果 > 启发式回退 ───
  const resolvedLayout = layoutOverride
    || (adaptiveColumns === 4 ? 'four' : adaptiveColumns === 2 ? 'two' : adaptiveColumns === 1 ? 'one' : null)
    || (choiceLayoutForTexts(options.map((option) => option.content), hasFigures) === 'quad' ? 'four'
      : choiceLayoutForTexts(options.map((option) => option.content), hasFigures) === 'double' ? 'two' : 'one')

  const isAdaptive = !layoutOverride && adaptiveColumns !== null
  const layoutClass = resolvedLayout === 'four' ? 'quad' : resolvedLayout === 'two' ? 'double' : 'single'

  return (
    <div
      ref={containerRef}
      className={`choice-options ${isAdaptive ? '' : `choice-options-${layoutClass}`} ${className}`.trim()}
      data-layout={isAdaptive ? `adaptive-${adaptiveColumns}` : resolvedLayout}
      data-teaching-question-choice-layout={isAdaptive ? `adaptive-${adaptiveColumns}` : resolvedLayout}
      data-teaching-question-choice-layout-block-id={choiceLayoutBlockId}
      style={isAdaptive ? {
        gridTemplateColumns: adaptiveColumns === 4
          ? 'repeat(4, minmax(0, 1fr))'
          : adaptiveColumns === 2
            ? 'repeat(2, minmax(0, 1fr))'
            : 'minmax(0, 1fr)',
      } : undefined}
    >
      {/* 隐藏测量探针：以自然宽度渲染各选项，供自适应算法读取实际渲染宽度 */}
      {!layoutOverride && !hasFigures && options.length === 4 ? (
        <div
          ref={probeRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-0 top-0 flex w-max"
          style={{ gap: '1rem' }}
        >
          {options.map((option) => (
            <div className="choice-option" key={`probe-${option.label}`} style={{ width: 'max-content' }}>
              <span className="choice-label">{option.label}</span>
              <div className="choice-markdown" style={{ width: 'max-content' }}>
                <MarkdownContent content={withoutInlineFigureMarkers(option.content)} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {options.map((option, index) => (
        <div
          className="choice-option"
          key={option.label}
          {...optionDomAttributes?.(optionIndexOffset + index)}
        >
          <span className="choice-label">{option.label}</span>
          <div className="min-w-0">
            {editableText && inlineContent?.[option.label] ? (
              <BlockInlineEditor
                inlines={inlineContent[option.label]}
                variant="embedded"
                toolbar="none"
                editorContext="question"
                ariaLabel={`选项 ${option.label}`}
                onChange={(content) => onInlineContentChange?.(option.label, content)}
              />
            ) : (
              <MarkdownWithInlineFigures
                className="choice-markdown"
                content={option.content}
                figures={figures.filter((figure) => String(figure.optionLabel || '').toUpperCase() === option.label)}
                showFigureCaptions={showFigureCaptions}
                bareFigures={bareFigures}
              />
            )}
            <FigureGallery
              figures={figures.filter((figure) => (
                String(figure.optionLabel || '').toUpperCase() === option.label
                // Editable teaching-document option blocks are rendered by
                // Tiptap rather than the inline figure renderer, so retain
                // their gallery image until that surface gains marker support.
                && (Boolean(editableText && inlineContent?.[option.label]) || !isInlineFigure(figure, inlineFigureIds(option.content)))
              ))}
              className="mt-2"
              compact
              showCaption={showFigureCaptions}
              naturalAspectRatio={bareFigures}
              bare={bareFigures}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function FigureGallery({
  figures,
  className = '',
  compact = false,
  showCaption = true,
  naturalAspectRatio = false,
  bare = false,
  onSelect,
}: {
  figures: QuestionFigure[]
  className?: string
  compact?: boolean
  showCaption?: boolean
  /** 文档排版中的明确尺寸覆盖使用图片原始比例，默认图库行为保持不变。 */
  naturalAspectRatio?: boolean
  /** 不渲染卡片容器，直接展示原图。 */
  bare?: boolean
  onSelect?: (figure: QuestionFigure) => void
}) {
  const [preview, setPreview] = useState<QuestionFigure | null>(null)
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const visible = figures.filter((figure) => figure.path && !String(figure.path).trim().startsWith('<'))
  if (!visible.length) return null
  return (
    <>
      <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'} ${className}`}>
        {visible.map((figure, index) => {
          const resourceId = String(figure.id || figure.blockId || figure.path || index)
          const resourceKey = `${resourceId}:${String(figure.path || '')}`
          const hasFailed = failed.has(resourceKey)
          return (
          <figure
            key={resourceKey}
            className={`${bare ? '' : 'overflow-hidden rounded-lg border bg-white'} ${naturalAspectRatio ? 'w-full' : ''} ${compact ? 'max-w-40' : 'max-w-[26rem]'}`}
            data-teaching-resource="image"
            data-teaching-resource-id={resourceId}
            data-teaching-resource-status={hasFailed ? 'error' : 'ready'}
          >
            <button className={`flex w-full justify-center text-left ${bare ? '' : 'bg-white p-2'} ${naturalAspectRatio || bare ? 'h-auto min-h-0' : compact ? 'h-32' : 'h-44'} ${hasFailed ? 'cursor-default' : onSelect ? 'cursor-pointer' : 'cursor-zoom-in'}`} onClick={() => {
              if (hasFailed) return
              if (onSelect) onSelect(figure)
              else setPreview(figure)
            }} type="button">
              {hasFailed ? (
                  <span className={`flex w-full items-center justify-center bg-zinc-50 text-xs text-zinc-400 ${naturalAspectRatio ? 'min-h-32' : 'h-full'}`}>
                  图片加载失败
                </span>
              ) : (
                <img
                  alt={figureAlt(figure, index)}
                  className={`block w-full object-contain ${bare ? '' : 'bg-white'} ${naturalAspectRatio || bare ? 'h-auto' : 'h-full'}`}
                  src={assetUrl(String(figure.path || ''))}
                  onError={() => setFailed((current) => new Set(current).add(resourceKey))}
                />
              )}
            </button>
            {showCaption ? (
              <figcaption className="border-t px-2.5 py-1.5 text-xs text-zinc-500">{figureCaption(figure, index)}</figcaption>
            ) : null}
          </figure>
          )
        })}
      </div>
      {preview ? (
        <LargeImageDialog
          caption={figureCaption(preview, Math.max(visible.findIndex((figure) => figure === preview), 0))}
          imageUrl={assetUrl(String(preview.path || ''))}
          onClose={() => setPreview(null)}
          title="题图预览"
        />
      ) : null}
    </>
  )
}

export function FigureResourceList({ figures }: { figures: QuestionFigure[] }) {
  return (
    <section className="rounded-xl border bg-zinc-50 p-3">
      <p className="mb-2 text-xs text-zinc-500">题图资源</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {figures.map((figure, index) => (
          <div key={figure.id || index} className="flex items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-2 text-xs">
            <span className="font-medium">{figureCaption(figure, index)}</span>
            <span className="text-zinc-500">{figure.path ? '已生成' : '无文件'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
