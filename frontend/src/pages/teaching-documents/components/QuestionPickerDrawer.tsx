/**
 * 题目选择抽屉（右侧大抽屉）
 * 点击"添加题目"后弹出，左侧筛选栏（复用 BankFilterSidebar）+ 右侧题目卡片列表。
 * 遵循 Apple Design 动效规范：springPanel 滑入，尊重 prefers-reduced-motion。
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight, LoaderCircle, Search, X } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { learningTagsApi } from '@/api/learningTags'
import { BankFilterSidebar } from '@/components/questions/workbench/BankFilterSidebar'
import { springPanel } from '@/components/teaching-document/motion'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionBankResponse, QuestionItem, TagLibraries } from '@/types'
import { QuestionPickerCard } from './QuestionPickerCard'

const PAGE_SIZE = 12

export function QuestionPickerDrawer({
  open,
  onClose,
  onPick,
  excludeIds = [],
}: {
  open: boolean
  onClose: () => void
  onPick: (question: QuestionItem) => void
  excludeIds?: string[]
}) {
  const reduced = useReducedMotion()
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [stage, setStage] = useState('')
  const [questionType, setQuestionType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [knowledgePoint, setKnowledgePoint] = useState<string[]>([])
  const [solutionMethod, setSolutionMethod] = useState<string[]>([])
  const [page, setPage] = useState(1)

  // 抽屉关闭时重置筛选状态
  useEffect(() => {
    if (!open) {
      setQuery('')
      setSearchInput('')
      setStage('')
      setQuestionType('')
      setDifficulty('')
      setKnowledgePoint([])
      setSolutionMethod([])
      setPage(1)
    }
  }, [open])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.document.addEventListener('keydown', handleKey)
    return () => window.document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const params = useMemo(() => ({
    page,
    pageSize: PAGE_SIZE,
    q: query.trim() || undefined,
    stage: stage || undefined,
    questionType: questionType || undefined,
    difficulty: difficulty || undefined,
    knowledgePoint: knowledgePoint.join(',') || undefined,
    solutionMethod: solutionMethod.join(',') || undefined,
    excludeIds: excludeIds.length ? excludeIds : undefined,
  }), [page, query, stage, questionType, difficulty, knowledgePoint, solutionMethod, excludeIds])

  const bank = useAsync<QuestionBankResponse | null>(
    () => (open ? questionBankApi.listItems(params) : Promise.resolve(null)),
    [params, open],
  )
  const tagLibraries = useAsync<TagLibraries | null>(
    () => (open ? learningTagsApi.getQuestionBankTagLibraries() : Promise.resolve(null)),
    [open],
  )
  const libraries = useAsync<{ libraries: any[] } | null>(
    () => (open ? learningTagsApi.listLibraries() : Promise.resolve(null)),
    [open],
  )

  const stageOptions = tagLibraries.data?.stages?.length ? tagLibraries.data.stages : ['高一', '高二', '高三', '高中']
  const questionTypeOptions = tagLibraries.data?.questionTypes?.length ? tagLibraries.data.questionTypes : ['单选题', '多选题', '填空题', '解答题']
  const difficultyOptions = tagLibraries.data?.difficultyLabels?.length ? tagLibraries.data.difficultyLabels : ['基础', '中等', '较难', '压轴']

  const kpChapters = useMemo(() => {
    const kps = (libraries.data?.libraries ?? []).filter((lib: any) => lib.libraryType === 'knowledge_point')
    return kps.flatMap((lib: any) => lib.chapters)
  }, [libraries.data])

  const smGroups = useMemo(() => {
    const sms = (libraries.data?.libraries ?? []).filter((lib: any) => lib.libraryType === 'method_tag')
    return sms.flatMap((lib: any) => lib.chapters)
  }, [libraries.data])

  const activeFiltersCount = (stage ? 1 : 0) + (questionType ? 1 : 0) + (difficulty ? 1 : 0) + knowledgePoint.length + solutionMethod.length

  const items = bank.data?.items ?? []
  const totalItems = bank.data?.totalItems ?? 0
  const totalPages = bank.data?.totalPages ?? 1

  function handleClearAll() {
    setStage('')
    setQuestionType('')
    setDifficulty('')
    setKnowledgePoint([])
    setSolutionMethod([])
    setPage(1)
  }

  function handleSearch() {
    setQuery(searchInput)
    setPage(1)
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[100] overflow-hidden">
          {/* 页面置顶全屏高斯模糊背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/35 backdrop-blur-md transition-opacity dark:bg-black/55"
          />

          {/* 屏幕右侧直达滑出面板（style={{ borderRadius: 0 }} + !rounded-none 彻底去除外侧圆角） */}
          <motion.aside
            initial={reduced ? { opacity: 0 } : { x: 760, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { x: 760, opacity: 0 }}
            transition={springPanel}
            style={{ borderRadius: 0 }}
            className="question-edit-glass-dialog fixed inset-y-0 right-0 z-[100] flex w-[min(760px,100vw)] flex-col !rounded-none border-l border-black/10 bg-white/95 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 dark:border-white/12 dark:bg-zinc-950/95"
          >
            {/* 顶栏 */}
            <div className="flex h-13 shrink-0 items-center justify-between border-b border-black/6 px-4 dark:border-white/8">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">从题库添加题目</span>
                {activeFiltersCount > 0 ? (
                  <span className="rounded-full border border-black/5 bg-black/3 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/8 dark:bg-white/5 dark:text-zinc-300">
                    {activeFiltersCount} 个筛选条件
                  </span>
                ) : null}
                {totalItems > 0 ? (
                  <span className="text-[11px] font-medium text-zinc-400">{totalItems} 道题目</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                title="关闭"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* 内容区：筛选栏 + 结果列表 */}
            <div className="flex min-h-0 flex-1">
              <div className="question-edit-glass-aside flex shrink-0 border-r border-black/6 dark:border-white/8 bg-zinc-50/50 dark:bg-zinc-900/50">
                <BankFilterSidebar
                  stage={stage}
                  setStage={setStage}
                  questionType={questionType}
                  setQuestionType={setQuestionType}
                  difficulty={difficulty}
                  setDifficulty={setDifficulty}
                  knowledgePoint={knowledgePoint}
                  setKnowledgePoint={setKnowledgePoint}
                  solutionMethod={solutionMethod}
                  setSolutionMethod={setSolutionMethod}
                  setPage={setPage}
                  stageOptions={stageOptions}
                  questionTypeOptions={questionTypeOptions}
                  difficultyOptions={difficultyOptions}
                  kpChapters={kpChapters}
                  smGroups={smGroups}
                  activeFiltersCount={activeFiltersCount}
                  onClearAll={handleClearAll}
                />
              </div>

              {/* 结果区 */}
              <div className="flex min-w-0 flex-1 flex-col">
                {/* 搜索框 */}
                <div className="shrink-0 border-b border-black/6 p-3 dark:border-white/8">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="搜索题干关键词…"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') handleSearch() }}
                      className="h-9 w-full rounded-xl border border-black/8 bg-white/80 pl-9 pr-16 text-xs text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-white/10"
                    />
                    <button
                      type="button"
                      onClick={handleSearch}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-50 shadow-xs transition-colors hover:bg-zinc-700 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      搜索
                    </button>
                  </div>
                </div>

                {/* 卡片列表 */}
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  {bank.loading && !items.length ? (
                    <div className="flex h-40 items-center justify-center text-xs font-medium text-zinc-400">
                      <LoaderCircle className="mr-2 size-4 animate-spin" />正在读取题目…
                    </div>
                  ) : bank.error ? (
                    <div className="flex h-40 items-center justify-center text-xs font-medium text-red-600 dark:text-red-400">
                      题目读取失败：{bank.error}
                    </div>
                  ) : items.length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-zinc-400">
                      <span className="text-xs">未找到匹配的题目</span>
                      {activeFiltersCount > 0 || query ? (
                        <button type="button" onClick={() => { handleClearAll(); setQuery(''); setSearchInput('') }} className="text-[11px] font-medium text-zinc-600 hover:underline dark:text-zinc-300">
                          清除全部筛选条件
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    items.map((item) => (
                      <QuestionPickerCard
                        key={item.id}
                        item={item}
                        onPick={onPick}
                      />
                    ))
                  )}
                  {bank.loading && items.length > 0 ? (
                    <div className="flex items-center justify-center py-2 text-[11px] font-medium text-zinc-400">
                      <LoaderCircle className="mr-1.5 size-3 animate-spin" />正在刷新…
                    </div>
                  ) : null}
                </div>

                {/* 分页 */}
                {totalPages > 1 ? (
                  <div className="question-edit-glass-tabs flex shrink-0 items-center justify-center gap-3 border-t border-black/6 px-4 py-2.5 backdrop-blur-xl bg-white/80 dark:border-white/8 dark:bg-zinc-950/80">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-black/8 bg-white/80 px-2.5 text-[11px] font-medium text-zinc-700 transition-all hover:bg-white disabled:opacity-30 dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-900 active:scale-95"
                    >
                      <ChevronLeft className="size-3" />上一页
                    </button>
                    <span className="text-[11px] font-medium tabular-nums text-zinc-500">{page} / {totalPages}</span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-black/8 bg-white/80 px-2.5 text-[11px] font-medium text-zinc-700 transition-all hover:bg-white disabled:opacity-30 dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-900 active:scale-95"
                    >
                      下一页<ChevronRight className="size-3" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
