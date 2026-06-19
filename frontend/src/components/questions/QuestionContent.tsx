import { useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { MarkdownContent } from '@/components/MarkdownContent'
import { RichContent, richBlocksPlainText } from '@/components/RichContent'
import { LargeImageDialog } from '@/components/dialogs/Modal'
import { Button } from '@/components/ui'
import type { ChoiceOption, QuestionFigure, RichBlock } from '@/types'
import { choiceLayoutForTexts } from '@/utils/choiceLayout'
import { assetUrl, figureAlt, figureCaption, figuresByUsage, parseChoiceQuestion } from '@/utils/questionDisplay'

export function SolutionDisclosure({
  answerText = '',
  analysisMarkdown = '',
  answerBlocks = [],
  analysisBlocks = [],
  figures = [],
  className = '',
}: {
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
              {hasAnswer ? <MarkdownContent className="text-sm leading-6" content={answerMarkdown} /> : <span className="text-xs text-zinc-400">暂无答案</span>}
            </section>
            <section className="rounded-xl border bg-zinc-50 p-3">
              <p className="mb-1 text-xs text-zinc-500">解析</p>
              {hasAnalysis ? <MarkdownContent className="text-sm leading-6" content={analysisText} /> : <span className="text-xs text-zinc-400">暂无解析</span>}
              <FigureGallery figures={analysisFigures} className="mt-3" />
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
  const visibleFigures = stemFigures.filter((figure) => figure.path)
  const parsedChoice = parseChoiceQuestion(content)
  return (
    <div className={`question-content ${className}`}>
      {prefix ? <p className="mb-2 text-xs font-semibold text-zinc-500">{prefix}</p> : null}
      <MarkdownContent content={parsedChoice?.stem || content} />
      {parsedChoice ? <ChoiceOptions options={parsedChoice.options} figures={optionFigures} /> : null}
      {parsedChoice?.remainder ? <MarkdownContent className="mt-3" content={parsedChoice.remainder} /> : null}
      {visibleFigures.length ? <FigureGallery figures={visibleFigures} className="mt-3" /> : null}
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

export function ChoiceOptions({ options, figures = [] }: { options: ChoiceOption[]; figures?: QuestionFigure[] }) {
  const layout = choiceLayoutForTexts(options.map((option) => option.content), figures.some((figure) => Boolean(figure.path)))
  return (
    <div className={`choice-options choice-options-${layout}`} data-layout={layout}>
      {options.map((option) => (
        <div className="choice-option" key={option.label}>
          <span className="choice-label">{option.label}</span>
          <div className="min-w-0">
            <MarkdownContent className="choice-markdown" content={option.content} />
            <FigureGallery figures={figures.filter((figure) => String(figure.optionLabel || '').toUpperCase() === option.label)} className="mt-2" compact />
          </div>
        </div>
      ))}
    </div>
  )
}

export function FigureGallery({ figures, className = '', compact = false }: { figures: QuestionFigure[]; className?: string; compact?: boolean }) {
  const [preview, setPreview] = useState<QuestionFigure | null>(null)
  const visible = figures.filter((figure) => figure.path)
  if (!visible.length) return null
  return (
    <>
      <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'} ${className}`}>
        {visible.map((figure, index) => (
          <figure key={figure.id || `${figure.path}-${index}`} className={`overflow-hidden rounded-lg border bg-white ${compact ? 'max-w-40' : 'max-w-64'}`}>
            <button className="block w-full cursor-zoom-in bg-white text-left" onClick={() => setPreview(figure)} type="button">
              <img alt={figureAlt(figure, index)} className="block h-auto w-full bg-white" src={assetUrl(String(figure.path || ''))} />
            </button>
            <figcaption className="border-t px-2.5 py-1.5 text-xs text-zinc-500">{figureCaption(figure, index)}</figcaption>
          </figure>
        ))}
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
