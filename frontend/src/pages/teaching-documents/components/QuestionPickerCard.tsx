/**
 * 题目选择卡片（轻量版）
 * 复用 QuestionBankDraftCard 视觉风格：元信息行 + 题干预览 + 操作按钮，
 * 去掉编辑/篮子/展开解析等重逻辑，专注于"选中即添加"场景。
 */

import { Check, Plus } from 'lucide-react'
import { QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import type { QuestionItem } from '@/types'
import { difficultyLabel10, displaySource } from '@/utils/questionDisplay'
import { richBlocksPlainText } from '@/components/RichContent'

export function QuestionPickerCard({
  item,
  isAdded,
  onPick,
}: {
  item: QuestionItem
  isAdded: boolean
  onPick: (item: QuestionItem) => void
}) {
  const stem = item.stemMarkdown || richBlocksPlainText(item.problemBlocks)
  const tags = [...(item.knowledgePoints || []), ...(item.solutionMethods || [])]
  const visibleTags = tags.slice(0, 3)
  const extraTagCount = tags.length - visibleTags.length

  return (
    <button
      type="button"
      disabled={isAdded}
      onClick={() => onPick(item)}
      className={`group relative w-full rounded-2xl p-3.5 text-left transition-all duration-200 ${
        isAdded
          ? 'border border-dashed border-black/8 bg-black/2 opacity-60 dark:border-white/10 dark:bg-white/2 cursor-not-allowed'
          : 'question-edit-glass-preview border border-black/6 bg-white/80 hover:bg-white hover:shadow-md hover:border-black/12 hover:-translate-y-0.5 dark:border-white/8 dark:bg-zinc-900/80 dark:hover:bg-zinc-900 dark:hover:border-white/16'
      }`}
    >
      {/* 元信息行 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
          {item.questionNo || item.id.slice(0, 8)}
        </span>
        {item.stage ? (
          <span className="rounded-full border border-black/5 bg-black/3 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/8 dark:bg-white/5 dark:text-zinc-300">
            {item.stage}
          </span>
        ) : null}
        {item.questionType ? (
          <span className="rounded-full border border-black/5 bg-black/3 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/8 dark:bg-white/5 dark:text-zinc-300">
            {item.questionType}
          </span>
        ) : null}
        <span className="rounded-full border border-black/5 bg-black/3 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/8 dark:bg-white/5 dark:text-zinc-300">
          {difficultyLabel10(item)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {isAdded ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100/80 px-2.5 py-1 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800/80 dark:text-zinc-500">
              <Check className="size-3" />已在文档中
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-zinc-50 shadow-xs transition-transform duration-200 group-hover:scale-105 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900">
              <Plus className="size-3" />添加
            </span>
          )}
        </span>
      </div>

      {/* 题干预览 */}
      <div className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
        <QuestionMarkdownContent content={stem} className="picker-card-stem" />
      </div>

      {/* 标签行 */}
      {(visibleTags.length > 0 || item.sourceTitle) ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-1 border-t border-black/4 dark:border-white/6">
          {visibleTags.map((tag) => (
            <span key={tag} className="rounded-full bg-zinc-100/70 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
              {tag}
            </span>
          ))}
          {extraTagCount > 0 ? (
            <span className="text-[10px] text-zinc-400">+{extraTagCount}</span>
          ) : null}
          {item.sourceTitle ? (
            <span className="ml-auto max-w-44 truncate text-[10px] text-zinc-400" title={item.sourceTitle}>
              {displaySource(item.sourceTitle)}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  )
}
