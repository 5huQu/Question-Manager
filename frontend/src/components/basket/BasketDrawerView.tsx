import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ChevronDown,
  ChevronUp,
  FileStack,
  GripVertical,
  Maximize2,
  NotebookPen,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react'
import { springPanel } from '@/components/teaching-document/motion'
import { QuestionMarkdownContent } from '../questions/QuestionContent'
import { Empty } from '../ui'
import { getDefaultScore, stripLeadingQuestionNo } from './constants'
import type { BasketState } from './useBasketState'

export function BasketDrawerView({
  state,
  onSnapshotsOpenChange,
}: {
  state: BasketState
  onSnapshotsOpenChange: (open: boolean) => void
}) {
  const reduced = useReducedMotion()
  const {
    navigate,
    collapsed, setCollapsed,
    draggedIndex, setDraggedIndex,
    active,
    totalScore, activeQuestions,
    patchItem, removeItem, clearCollection, moveItem,
    importToTeachingDocument,
    handleDragDrop,
  } = state

  if (typeof document === 'undefined') return null

  return (
    <>
      {/* 折叠时在屏幕右侧显示的悬浮按钮 */}
      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="question-edit-glass-dialog fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-2.5 rounded-l-2xl border-r-0 border-black/10 bg-white/90 px-2.5 py-4 shadow-xl backdrop-blur-xl transition-transform hover:scale-105 hover:bg-white active:scale-95 dark:border-white/12 dark:bg-zinc-900/90 dark:hover:bg-zinc-900"
          title="展开试题篮"
        >
          <div className="relative">
            <ShoppingBag className="size-5 text-zinc-700 transition-transform group-hover:scale-110 dark:text-zinc-200" />
            {active.data?.questionCount ? (
              <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-zinc-900 px-1 font-mono text-[10px] font-bold text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-900">
                {active.data.questionCount}
              </span>
            ) : null}
          </div>
          <div
            className="text-[11px] font-bold tracking-widest text-zinc-500 transition-colors dark:text-zinc-400"
            style={{ writingMode: 'vertical-rl' }}
          >
            试题篮
          </div>
        </button>
      )}

      {/* 展开时使用 createPortal 渲染置顶抽屉 */}
      {createPortal(
        <AnimatePresence>
          {!collapsed ? (
            <div className="fixed inset-0 z-[100] overflow-hidden">
              {/* 全屏高斯模糊背景遮罩 */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setCollapsed(true)}
                className="fixed inset-0 bg-black/35 backdrop-blur-md transition-opacity dark:bg-black/55"
              />

              {/* 屏幕右侧直达滑出面板（宽度加宽至 580px，!rounded-none 贴合边缘） */}
              <motion.aside
                initial={reduced ? { opacity: 0 } : { x: 580, opacity: 0 }}
                animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { x: 580, opacity: 0 }}
                transition={springPanel}
                style={{ borderRadius: 0 }}
                className="question-edit-glass-dialog fixed inset-y-0 right-0 z-[100] flex w-[min(580px,100vw)] flex-col !rounded-none border-l border-black/10 bg-white/95 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 dark:border-white/12 dark:bg-zinc-950/95"
              >
                {/* 顶栏 Header */}
                <div className="flex h-13 shrink-0 items-center justify-between border-b border-black/6 px-4 dark:border-white/8">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg border border-black/6 bg-black/3 p-1.5 text-zinc-700 dark:border-white/8 dark:bg-white/5 dark:text-zinc-200">
                      <ShoppingBag className="size-4" />
                    </div>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">试题篮</span>
                    <span className="rounded-full border border-black/5 bg-black/3 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-white/8 dark:bg-white/5 dark:text-zinc-300">
                      {activeQuestions.length} 道题目 · 共 {totalScore} 分
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
                      title="查看组卷快照"
                      onClick={() => onSnapshotsOpenChange(true)}
                    >
                      <FileStack className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
                      title="全屏独立工作台"
                      onClick={() => {
                        setCollapsed(true)
                        navigate('/questions/basket')
                      }}
                    >
                      <Maximize2 className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
                      onClick={() => setCollapsed(true)}
                      title="收起试题篮"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>

                {/* 清空操作与提示行 */}
                {activeQuestions.length > 0 && (
                  <div className="flex shrink-0 items-center justify-between border-b border-black/6 bg-zinc-50/40 px-4 py-2 dark:border-white/8 dark:bg-zinc-900/40">
                    <span className="text-[11px] font-medium text-zinc-400">已加入试题篮的题目可拖拽排序，生成讲义或试卷</span>
                    <button
                      type="button"
                      onClick={clearCollection}
                      className="rounded px-2 py-0.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                      title="清空试题篮"
                    >
                      清空试题篮
                    </button>
                  </div>
                )}

                {/* 题目列表 */}
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  {active.loading && !active.data ? (
                    <Empty text="读取中…" />
                  ) : active.error ? (
                    <Empty text={active.error} />
                  ) : !activeQuestions.length ? (
                    <Empty text={'试题篮为空。在题库中点击“加入试题篮”即可添加题目。'} />
                  ) : (
                    activeQuestions.map((entry, index) => (
                      <div key={entry.relationId || entry.item.id} className="space-y-2">
                        {entry.sectionName ? (
                          <div className="flex items-center gap-3 py-1 select-none">
                            <div className="h-px flex-1 bg-black/6 dark:bg-white/8" />
                            <div className="rounded-full border border-black/6 bg-white px-3 py-0.5 text-[10px] font-bold text-zinc-500 shadow-2xs dark:border-white/8 dark:bg-zinc-900 dark:text-zinc-400">
                              {entry.sectionName}
                            </div>
                            <div className="h-px flex-1 bg-black/6 dark:bg-white/8" />
                          </div>
                        ) : null}

                        <div
                          draggable
                          onDragStart={(e) => {
                            setDraggedIndex(index)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={async (e) => {
                            e.preventDefault()
                            if (draggedIndex === null || draggedIndex === index) return
                            await handleDragDrop(draggedIndex, index)
                          }}
                          onDragEnd={() => setDraggedIndex(null)}
                          className={`group relative flex cursor-grab items-start gap-3 rounded-2xl p-3.5 transition-all duration-200 active:cursor-grabbing ${
                            draggedIndex === index
                              ? 'border border-dashed border-black/10 bg-black/2 opacity-40 dark:border-white/10 dark:bg-white/2'
                              : 'question-edit-glass-preview border border-black/6 bg-white/80 hover:bg-white hover:shadow-md hover:border-black/12 dark:border-white/8 dark:bg-zinc-900/80 dark:hover:bg-zinc-900 dark:hover:border-white/16'
                          }`}
                        >
                          {/* 拖拽手柄 */}
                          <div className="mt-1 text-zinc-300 transition-colors group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-400">
                            <GripVertical className="size-4" />
                          </div>

                          <div className="min-w-0 flex-1 space-y-2">
                            {/* 元信息行与分值设置 */}
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                {index + 1}.
                              </span>
                              {entry.item.questionType && (
                                <span className="rounded-full border border-black/5 bg-black/3 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/8 dark:bg-white/5 dark:text-zinc-300">
                                  {entry.item.questionType}
                                </span>
                              )}
                              {entry.item.difficultyLabel && (
                                <span className="rounded-full border border-black/5 bg-black/3 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/8 dark:bg-white/5 dark:text-zinc-300">
                                  {entry.item.difficultyLabel}
                                </span>
                              )}

                              {/* 分值输入框 */}
                              <div className="ml-auto flex items-center gap-1 rounded-md border border-zinc-200 bg-white/80 px-1.5 py-0.5 dark:border-zinc-800 dark:bg-zinc-900/80">
                                <input
                                  type="number"
                                  value={entry.score || ''}
                                  placeholder={String(getDefaultScore(entry.item.questionType))}
                                  onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                                  className="w-8 text-right font-mono text-xs font-semibold text-zinc-800 outline-none dark:text-zinc-200"
                                />
                                <span className="text-[10px] font-medium text-zinc-400">分</span>
                              </div>

                              {/* 动作按钮 (上移/下移/删除) */}
                              <div className="flex items-center gap-0.5 rounded-lg border border-black/6 bg-black/3 p-0.5 dark:border-white/8 dark:bg-white/5">
                                <button
                                  type="button"
                                  onClick={() => entry.relationId && moveItem(entry.relationId, -1)}
                                  disabled={index === 0}
                                  className="rounded p-1 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                  title="上移"
                                >
                                  <ChevronUp className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => entry.relationId && moveItem(entry.relationId, 1)}
                                  disabled={index === activeQuestions.length - 1}
                                  className="rounded p-1 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                  title="下移"
                                >
                                  <ChevronDown className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => entry.relationId && removeItem(entry.relationId)}
                                  className="rounded p-1 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
                                  title="移除"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* 题干预览 */}
                            <div className="line-clamp-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                              <QuestionMarkdownContent
                                content={stripLeadingQuestionNo(entry.item.stemMarkdown || '未命名题目', entry.item.questionNo)}
                                className="picker-card-stem"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* 底部生成试卷按钮栏 */}
                {activeQuestions.length > 0 && (
                  <div className="flex shrink-0 items-center gap-2.5 border-t border-black/8 bg-white/95 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/95">
                    <button
                      type="button"
                      onClick={() => void importToTeachingDocument()}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 text-xs font-semibold text-white shadow-xs transition-all hover:bg-zinc-800 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      <NotebookPen className="size-4" />
                      生成讲义/试卷文档
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCollapsed(true)
                        navigate('/questions/basket')
                      }}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-zinc-300/80 bg-zinc-100 px-3.5 text-xs font-semibold text-zinc-800 shadow-2xs transition-all hover:border-zinc-400 hover:bg-zinc-200 active:scale-[0.98] dark:border-zinc-700/80 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
                      title="打开完整组卷工作台"
                    >
                      <Maximize2 className="size-3.5" />
                      完整工作台
                    </button>
                  </div>
                )}
              </motion.aside>
            </div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
