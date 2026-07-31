import type { HTMLMotionProps } from 'motion/react'
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { BookOpen, Calendar } from 'lucide-react'
import { richBlocksPlainText } from '@/components/RichContent'
import { cn } from '@/lib/utils'
import type { QuestionItem } from '@/types'
import { difficultyLabel10, displaySource } from '@/utils/questionDisplay'
import { MarkdownWithInlineFigures, QuestionMarkdownContent } from '../QuestionContent'

export const questionCardOutlineButtonClass = 'question-card-action inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 shadow-xs hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:pointer-events-none disabled:opacity-30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
export const questionCardDangerButtonClass = 'question-card-action inline-flex h-7 items-center gap-1.5 rounded-md border border-red-200 bg-red-50/20 px-2.5 text-xs font-medium text-red-700 shadow-xs hover:bg-red-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-950 disabled:pointer-events-none disabled:opacity-30 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/30'
export const questionCardPrimaryButtonClass = 'question-card-action inline-flex h-7 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-xs font-medium text-zinc-50 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200'
export const questionCardCompletedButtonClass = 'question-card-action inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-100 px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'

export function resolveQuestionCardContent(item: QuestionItem) {
  return {
    stem: item.stemMarkdown || richBlocksPlainText(item.problemBlocks),
    answer: item.answerText || richBlocksPlainText(item.answerBlocks),
    analysis: item.analysisMarkdown || richBlocksPlainText(item.analysisBlocks),
    chapter: item.chapter || item.knowledgePoints?.[0] || '未分类',
    date: item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '',
    source: displaySource(item.sourceTitle || '') || '高中数学专项试卷',
    serial: item.serialNo ?? item.questionNo ?? item.id.slice(0, 6),
  }
}

export function QuestionCardFrame({
  children,
  className,
  selected = false,
  active = false,
  dragging = false,
  interactive = true,
  animateLayout = false,
  ...props
}: HTMLMotionProps<'article'> & {
  selected?: boolean
  active?: boolean
  dragging?: boolean
  interactive?: boolean
  animateLayout?: boolean
}) {
  const reducedMotion = useReducedMotion()
  return (
    <motion.article
      layout={animateLayout && !reducedMotion ? 'position' : undefined}
      transition={animateLayout && !reducedMotion ? { layout: { type: 'spring', bounce: 0, duration: 0.34 } } : undefined}
      className={cn(
        'question-card group relative flex flex-col gap-3 rounded-lg border bg-white p-5 text-left dark:bg-zinc-950',
        interactive && 'question-card--interactive',
        active && !selected && 'question-card--active',
        selected && 'question-card--selected',
        dragging && 'question-card--dragging',
        className,
      )}
      {...props}
    >
      {children}
    </motion.article>
  )
}

export function QuestionCardContextLabel({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold',
      muted
        ? 'border border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'
        : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900',
    )}>
      {children}
    </span>
  )
}

export function QuestionCardHeader({
  item,
  leading,
  actions,
}: {
  item: QuestionItem
  leading?: ReactNode
  actions?: ReactNode
}) {
  const content = resolveQuestionCardContent(item)
  const tags = [item.questionType || '未设题型', item.stage || '未设学段', content.chapter]
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {tags.map((tag, index) => (
            <span key={`${tag}-${index}`} className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {tag}
            </span>
          ))}
          <span className={cn(
            'inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold',
            String(difficultyLabel10(item)).includes('难')
              ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
          )}>
            难度: {difficultyLabel10(item)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {actions}
        <span className="ml-1 shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{content.serial}</span>
      </div>
    </div>
  )
}

export function QuestionCardStem({ item, content }: { item: QuestionItem; content?: string }) {
  const stem = content ?? resolveQuestionCardContent(item).stem
  return (
    <div className="select-text font-sans text-xs leading-relaxed text-zinc-900 dark:text-zinc-100">
      <QuestionMarkdownContent content={stem || '题干为空'} figures={item.figures} />
    </div>
  )
}

export function QuestionCardKnowledge({ item }: { item: QuestionItem }) {
  if (!item.knowledgePoints?.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {item.knowledgePoints.map((knowledgePoint) => (
        <span key={knowledgePoint} className="inline-flex items-center rounded border border-zinc-200/60 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/30 dark:text-zinc-400">
          {knowledgePoint}
        </span>
      ))}
    </div>
  )
}

export function QuestionCardSolution({ item, open }: { item: QuestionItem; open: boolean }) {
  const { answer, analysis } = resolveQuestionCardContent(item)
  return (
    <div className={cn('question-card-disclosure grid', open ? 'mt-2 grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0')} aria-hidden={!open}>
      <div className="min-h-0 overflow-hidden">
        <div className="space-y-3 rounded border-t border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
          <div>
            <span className="mb-1 block text-[9px] font-bold uppercase text-zinc-400 dark:text-zinc-500">【答案】</span>
            <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              <MarkdownWithInlineFigures content={answer || '暂无答案'} figures={item.figures} />
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[9px] font-bold uppercase text-zinc-400 dark:text-zinc-500">【解析】</span>
            <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              <MarkdownWithInlineFigures content={analysis || '暂无解析'} figures={item.figures} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function QuestionCardFooter({
  item,
  open,
  actions,
}: {
  item: QuestionItem
  open: boolean
  actions: ReactNode
}) {
  const { date, source } = resolveQuestionCardContent(item)
  return (
    <div className={cn('mt-1 flex flex-wrap items-center justify-between gap-3 pt-3', !open && 'border-t border-zinc-200 dark:border-zinc-800')}>
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
        {date ? <span className="flex items-center gap-1"><Calendar className="size-3" />{date}</span> : null}
        <span className="flex min-w-0 items-center gap-1"><BookOpen className="size-3 shrink-0" /><span className="truncate">{source}</span></span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div>
    </div>
  )
}
