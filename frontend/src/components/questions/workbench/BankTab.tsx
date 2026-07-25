import { useEffect, useMemo, useState } from 'react'
import { Plus, PlusSquare, Search, ShoppingBag, Tag, Trash2, X } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { learningTagsApi } from '@/api/learningTags'
import { Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionBankResponse, QuestionItem, TagLibraries } from '@/types'
import { addQuestionToBasket } from '@/utils/questionBasket'
import { BankFilterSidebar } from './BankFilterSidebar'
import { BankPagination } from './BankPagination'
import { QuestionBankDraftCard } from './QuestionBankDraftCard'

export function BankTab({
  questionBank,
  reload,
  loading,
  error,
  query,
  setQuery,
  stage,
  setStage,
  questionType,
  setQuestionType,
  difficulty,
  setDifficulty,
  knowledgePoint,
  setKnowledgePoint,
  solutionMethod,
  setSolutionMethod,
  page,
  setPage,
  onQuestionSaved,
}: {
  questionBank: QuestionBankResponse | null
  reload: () => void
  loading: boolean
  error: string
  query: string
  setQuery: (value: string) => void
  stage: string
  setStage: (value: string) => void
  questionType: string
  setQuestionType: (value: string) => void
  difficulty: string
  setDifficulty: (value: string) => void
  knowledgePoint: string[]
  setKnowledgePoint: (value: string[] | ((curr: string[]) => string[])) => void
  solutionMethod: string[]
  setSolutionMethod: (value: string[] | ((curr: string[]) => string[])) => void
  page: number
  setPage: (value: number | ((value: number) => number)) => void
  onQuestionSaved?: (item: QuestionItem) => void
}) {
  const tagLibraries = useAsync<TagLibraries>(() => learningTagsApi.getQuestionBankTagLibraries(), [])
  const libraries = useAsync(() => learningTagsApi.listLibraries(), [])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [classifying, setClassifying] = useState(false)
  const [classificationStatus, setClassificationStatus] = useState('')

  const rawItems = questionBank?.items ?? []
  const items = rawItems
  const activeItem = useMemo(() => items.find((item) => item.id === previewId) ?? items[0] ?? null, [items, previewId])
  const basketQuestionIds = useMemo(() => new Set((questionBank?.basket?.questions ?? []).map((entry) => entry.item.id)), [questionBank?.basket?.questions])
  const basketCount = questionBank?.basket?.questionCount ?? questionBank?.basket?.questions?.length ?? 0
  const totalItems = questionBank?.totalItems ?? 0
  const classificationPendingCount = questionBank?.classificationPendingCount ?? 0
  const hasActiveFilters = Boolean(query.trim() || stage || questionType || difficulty || knowledgePoint.length > 0 || solutionMethod.length > 0)
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

  const handleClearAllFilters = () => {
    setStage('')
    setQuestionType('')
    setDifficulty('')
    setKnowledgePoint([])
    setSolutionMethod([])
    setPage(1)
  }

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value)
    setPage(1)
  }

  useEffect(() => {
    if (!activeItem) {
      setPreviewId(null)
      return
    }
    if (!previewId || !items.some((item) => item.id === previewId)) setPreviewId(activeItem.id)
  }, [activeItem, items, previewId])

  useEffect(() => {
    function handleReset() {
      setQuery('')
      handleClearAllFilters()
    }
    window.addEventListener('question-bank-reset-filters', handleReset)
    return () => window.removeEventListener('question-bank-reset-filters', handleReset)
  }, [])

  async function addToBasket(id: string) {
    if (id.startsWith('mock_')) {
      alert('已将模拟题目加入试题篮 (静态操作)')
      return
    }
    await addQuestionToBasket(id)
    reload()
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function addSelectedToBasket() {
    for (const id of selectedIds) {
      await addToBasket(id)
    }
    setSelectedIds([])
  }

  async function classifyAllQuestions() {
    if (!classificationPendingCount || classifying) {
      if (!classifying) setClassificationStatus('没有需要分类的题目。')
      return
    }
    const confirmed = window.confirm(`确认对题库中尚未完成分类的 ${classificationPendingCount} 道题目执行数据分类？本操作只补充缺少的知识点、解题方法和难度。`)
    if (!confirmed) return
    setClassifying(true)
    setClassificationStatus('')
    try {
      const result = await questionBankApi.classifyAllItems()
      const report = result.report
      setClassificationStatus(`分类完成：已更新 ${report.updated}/${report.total} 题${report.failed ? `，失败 ${report.failed} 题` : ''}。`)
      reload()
    } catch (error) {
      setClassificationStatus(error instanceof Error ? error.message : '分类任务启动失败')
    } finally {
      setClassifying(false)
    }
  }

  useEffect(() => {
    const handleStartClassification = () => { void classifyAllQuestions() }
    window.addEventListener('question-bank-start-classification', handleStartClassification)
    return () => window.removeEventListener('question-bank-start-classification', handleStartClassification)
  }, [classifyAllQuestions])

  function selectAllCurrentPage() {
    const pageIds = items.map((item) => item.id)
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id))
    setSelectedIds(allSelected ? [] : pageIds)
  }

  return (
    <div className="mock-page-root flex h-[calc(100vh-7rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
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
        onClearAll={handleClearAllFilters}
      />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-zinc-50/10">
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Search className="size-3.5 shrink-0 text-zinc-400" />
            <input
              className="w-full border-none bg-transparent p-0 text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-300"
              placeholder="搜索题干、来源、标签..."
              value={query}
              onChange={(e) => updateFilter(setQuery, e.target.value)}
            />
          </div>
          <div className="hidden max-w-[220px] shrink-0 items-center gap-1.5 overflow-x-auto py-1 md:flex">
            {stage && (
              <span className="inline-flex items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {stage}
                <X className="size-2.5 cursor-pointer text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => updateFilter(setStage, '')} />
              </span>
            )}
            {questionType && (
              <span className="inline-flex items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {questionType}
                <X className="size-2.5 cursor-pointer text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => updateFilter(setQuestionType, '')} />
              </span>
            )}
            {difficulty && (
              <span className="inline-flex items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {difficulty}
                <X className="size-2.5 cursor-pointer text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => updateFilter(setDifficulty, '')} />
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
            <Button size="sm" asLink to="/questions/new" icon={Plus}>新增题目</Button>
            <Button size="sm" variant="outline" asLink to="/questions/basket" icon={ShoppingBag}>试题篮 ({basketCount})</Button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-16">
          {classificationStatus ? (
            <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
              {classificationStatus}
            </div>
          ) : null}
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">找到 {totalItems} 道试题</span>
            <button type="button" onClick={selectAllCurrentPage} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200">
              {items.length > 0 && items.every((item) => selectedIds.includes(item.id)) ? '清除选择' : '全选此页'}
            </button>
          </div>

          <div className="space-y-3.5 pb-6">
            {items.map((item) => {
              const selected = selectedIds.includes(item.id)
              const active = activeItem?.id === item.id
              const inBasket = basketQuestionIds.has(item.id)
              return (
                <QuestionBankDraftCard
                  key={item.id}
                  item={item}
                  isInBasket={inBasket}
                  isSelected={selected}
                  isActive={active}
                  onToggleBasket={addToBasket}
                  onSelect={toggleSelected}
                  onClick={() => {
                    setPreviewId(item.id)
                    toggleSelected(item.id)
                  }}
                  onQuestionSaved={onQuestionSaved}
                />
              )
            })}
          </div>

          {loading ? <Empty text={items.length ? '正在刷新题目...' : '正在读取题目...'} /> : null}
          {error ? <Empty text={`题目读取失败：${error}`} /> : null}
          {!items.length && !loading && !error ? <Empty text={hasActiveFilters ? '未找到匹配筛选条件的题目' : '题库中暂无题目'} /> : null}
        </div>

        {/* Unified Bottom Footer Control Center */}
        <footer className="absolute bottom-0 left-0 right-0 z-10 flex h-12 items-center border-t border-zinc-200/80 bg-white/70 px-4 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/70 select-none text-xs">
          <div className="flex-1 flex items-center justify-start">
            {selectedIds.length === 0 ? (
              <span className="text-zinc-500 dark:text-zinc-400 font-medium">找到 {totalItems} 道试题 · 每页 20 条</span>
            ) : (
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">已选择 {selectedIds.length} 项</span>
            )}
          </div>

          {selectedIds.length > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
              <button
                type="button"
                onClick={addSelectedToBasket}
                className="inline-flex items-center gap-1 rounded bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <PlusSquare className="size-3.5 shrink-0" />
                加入试题篮
              </button>
              <button
                type="button"
                disabled
                title="后端暂未提供批量标记接口"
                className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium text-zinc-400 opacity-60 cursor-not-allowed"
              >
                <Tag className="size-3.5 shrink-0" />
                批量标记
              </button>
              <button
                type="button"
                disabled
                title="后端暂未提供批量删除接口"
                className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium text-red-400 opacity-60 cursor-not-allowed"
              >
                <Trash2 className="size-3.5 shrink-0" />
                批量删除
              </button>
              <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 cursor-pointer"
              >
                取消选择
              </button>
            </div>
          )}

          <div className="flex-1 flex items-center justify-end">
            <BankPagination page={page} totalItems={totalItems} setPage={setPage} />
          </div>
        </footer>
      </main>
    </div>
  )
}
