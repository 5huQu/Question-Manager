/**
 * 题目选择抽屉（右侧大抽屉）
 * 点击"添加题目"后弹出，左侧筛选栏（复用 BankFilterSidebar）+ 右侧题目卡片列表。
 * 遵循 Apple Design 动效规范：springPanel 滑入，尊重 prefers-reduced-motion。
 */

import { useEffect, useMemo, useState } from 'react'
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
  }), [page, query, stage, questionType, difficulty, knowledgePoint, solutionMethod])

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
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds])

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

  return (
    <AnimatePresence>
      {open ? (
        <div className="absolute inset-0 z-40">
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-zinc-950/20 backdrop-blur-[2px]"
          />

          {/* 抽屉面板 */}
          <motion.aside
            initial={reduced ? { opacity: 0 } : { x: 680, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { x: 680, opacity: 0 }}
            transition={springPanel}
            className="absolute inset-y-0 right-0 flex w-[min(680px,100%)] flex-col border-l border-zinc-200/80 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/95"
          >
            {/* 顶栏 */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">从题库添加题目</span>
                {activeFiltersCount > 0 ? (
                  <span className="rounded-full bg-zinc-100 px-2 py-px text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {activeFiltersCount} 个筛选条件
                  </span>
                ) : null}
                {totalItems > 0 ? (
                  <span className="text-[11px] text-zinc-400">{totalItems} 道题目</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
                title="关闭"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* 内容区：筛选栏 + 结果列表 */}
            <div className="flex min-h-0 flex-1">
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

              {/* 结果区 */}
              <div className="flex min-w-0 flex-1 flex-col">
                {/* 搜索框 */}
                <div className="shrink-0 border-b border-zinc-100 p-3 dark:border-zinc-900">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="搜索题干关键词…"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') handleSearch() }}
                      className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-14 text-xs text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-600"
                    />
                    <button
                      type="button"
                      onClick={handleSearch}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-50 transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      搜索
                    </button>
                  </div>
                </div>

                {/* 卡片列表 */}
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {bank.loading && !items.length ? (
                    <div className="flex h-40 items-center justify-center text-xs text-zinc-400">
                      <LoaderCircle className="mr-2 size-4 animate-spin" />正在读取题目…
                    </div>
                  ) : bank.error ? (
                    <div className="flex h-40 items-center justify-center text-xs text-red-600 dark:text-red-400">
                      题目读取失败：{bank.error}
                    </div>
                  ) : items.length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-1 text-zinc-400">
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
                        isAdded={excludeSet.has(item.id)}
                        onPick={onPick}
                      />
                    ))
                  )}
                  {bank.loading && items.length > 0 ? (
                    <div className="flex items-center justify-center py-2 text-[11px] text-zinc-400">
                      <LoaderCircle className="mr-1.5 size-3 animate-spin" />正在刷新…
                    </div>
                  ) : null}
                </div>

                {/* 分页 */}
                {totalPages > 1 ? (
                  <div className="flex shrink-0 items-center justify-center gap-2 border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-900">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      <ChevronLeft className="size-3" />上一页
                    </button>
                    <span className="text-[11px] tabular-nums text-zinc-500">{page} / {totalPages}</span>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
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
    </AnimatePresence>
  )
}
