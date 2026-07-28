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
      className={`group w-full rounded-lg border p-3 text-left transition-all ${
        isAdded
          ? 'border-zinc-100 bg-zinc-50/60 opacity-60 dark:border-zinc-800/60 dark:bg-zinc-900/30'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700'
      }`}
    >
      {/* 元信息行 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {item.questionNo || item.id.slice(0, 8)}
        </span>
        {item.stage ? (
          <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-px text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            {item.stage}
          </span>
        ) : null}
        {item.questionType ? (
          <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-px text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            {item.questionType}
          </span>
        ) : null}
        <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-px text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          {difficultyLabel10(item)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {isAdded ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <Check className="size-3" />已在文档中
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-50 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900">
              <Plus className="size-3" />添加
            </span>
          )}
        </span>
      </div>

      {/* 题干预览 */}
      <div className="mt-1.5 line-clamp-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
        <QuestionMarkdownContent content={stem} className="picker-card-stem" />
      </div>

      {/* 标签行 */}
      {(visibleTags.length > 0 || item.sourceTitle) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {visibleTags.map((tag) => (
            <span key={tag} className="rounded-full bg-zinc-100 px-2 py-px text-[10px] text-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-400">
              {tag}
            </span>
          ))}
          {extraTagCount > 0 ? (
            <span className="text-[10px] text-zinc-400">+{extraTagCount}</span>
          ) : null}
          {item.sourceTitle ? (
            <span className="ml-auto max-w-40 truncate text-[10px] text-zinc-400" title={item.sourceTitle}>
              {displaySource(item.sourceTitle)}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  )
}
