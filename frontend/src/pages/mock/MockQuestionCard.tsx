import { useState } from 'react'
import { ShoppingBag, Check, ChevronDown, ChevronUp, Calendar, BookOpen } from 'lucide-react'
import { MarkdownContent } from '@/components/MarkdownContent'
import { MockQuestion } from './mockData'

interface MockQuestionCardProps {
  question: MockQuestion
  isInBasket: boolean
  onToggleBasket: (id: string) => void
  onSelect?: (id: string) => void
  isSelected?: boolean
  showCheckbox?: boolean
  onClick?: () => void
}

export function MockQuestionCard({
  question,
  isInBasket,
  onToggleBasket,
  onSelect,
  isSelected,
  showCheckbox = false,
  onClick,
}: MockQuestionCardProps) {
  const [showAnalysis, setShowAnalysis] = useState(false)

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onSelect) {
      onSelect(question.id)
    }
  }

  return (
    <div
      onClick={onClick}
      className={`group relative border bg-white flex flex-col gap-3 transition-all duration-150 rounded-lg cursor-pointer text-left select-none ${
        isSelected
          ? 'border-zinc-400 bg-zinc-50/10 p-5 dark:border-zinc-600 dark:bg-zinc-900/10 shadow-xs'
          : 'border-zinc-200 dark:border-zinc-800 p-5 hover:border-zinc-300 dark:hover:border-zinc-700'
      }`}
    >
      {/* Top Header Row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {showCheckbox && onSelect && (
            <div
              onClick={handleCheckboxClick}
              className={`size-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                isSelected
                  ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900 ring-2 ring-zinc-950/10 dark:ring-zinc-50/10'
                  : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 group-hover:border-zinc-400'
              }`}
            >
              {isSelected && <Check className="size-3 stroke-[3]" />}
            </div>
          )}
          
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-650 dark:bg-zinc-800 dark:text-zinc-400">
              {question.questionType}
            </span>
            <span className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-650 dark:bg-zinc-800 dark:text-zinc-400">
              {question.stage}
            </span>
            <span className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-650 dark:bg-zinc-800 dark:text-zinc-400">
              {question.chapter}
            </span>
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${
                question.difficultyLabel === '难'
                  ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-650 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              难度: {question.difficultyLabel}
            </span>
          </div>
        </div>
        <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">
          #{question.id}
        </span>
      </div>

      {/* Question Stem Area */}
      <div className="text-xs text-zinc-900 leading-relaxed dark:text-zinc-150 font-sans select-text">
        <MarkdownContent content={question.stemMarkdown} />
      </div>

      {/* Expanded Analysis Area - Smooth transition container */}
      <div className={`grid transition-all duration-300 ease-in-out ${
        showAnalysis
          ? 'grid-rows-[1fr] opacity-100 mt-2'
          : 'grid-rows-[0fr] opacity-0 pointer-events-none'
      }`}>
        <div className="overflow-hidden">
          <div className="border-t border-zinc-150 pt-3 dark:border-zinc-800 space-y-3 bg-zinc-50/50 p-3 rounded dark:bg-zinc-900/30">
            <div>
              <span className="text-[9px] font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase block mb-1">【答案】</span>
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <MarkdownContent content={question.answerText} />
              </div>
            </div>
            <div>
              <span className="text-[9px] font-bold tracking-wider text-zinc-400 dark:text-zinc-500 uppercase block mb-1">【解析】</span>
              <div className="text-xs text-zinc-650 dark:text-zinc-300 leading-relaxed">
                <MarkdownContent content={question.analysisMarkdown} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="flex items-center justify-between pt-3 border-t border-zinc-150 dark:border-zinc-800 mt-1">
        <div className="flex items-center gap-3 text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
          <span className="flex items-center gap-1">
            <Calendar className="size-3 text-zinc-450" />
            {question.date}
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="size-3 text-zinc-450" />
            高中数学专项试卷
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowAnalysis(!showAnalysis)
            }}
            className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
            type="button"
          >
            {showAnalysis ? (
              <>
                <ChevronUp className="size-3" />
                收起解析
              </>
            ) : (
              <>
                <ChevronDown className="size-3" />
                查看解析
              </>
            )}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleBasket(question.id)
            }}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-bold transition-colors ${
              isInBasket
                ? 'bg-zinc-100 text-zinc-900 border border-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700'
                : 'bg-zinc-900 text-zinc-50 hover:bg-zinc-850 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200'
            }`}
            type="button"
          >
            {isInBasket ? (
              <>
                <Check className="size-3" />
                已在试题篮
              </>
            ) : (
              <>
                <ShoppingBag className="size-3" />
                加入试题篮
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
