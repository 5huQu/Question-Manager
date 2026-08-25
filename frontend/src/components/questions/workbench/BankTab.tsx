import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, CheckCircle2, LoaderCircle, PanelLeft, Plus, PlusSquare, Search, ShoppingBag, Tag, Trash2, X } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { learningTagsApi } from '@/api/learningTags'
import { Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionBankResponse, QuestionItem, TagLibraries } from '@/types'
import type { QuestionBankClassificationTask } from '@/api/questionBank'
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [classificationStatus, setClassificationStatus] = useState('')
  const [classificationTask, setClassificationTask] = useState<QuestionBankClassificationTask | null>(null)
  const [showClassificationProgress, setShowClassificationProgress] = useState(false)

  const rawItems = questionBank?.items ?? []
  const items = rawItems
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
    function handleReset() {
      setQuery('')
      handleClearAllFilters()
    }
    window.addEventListener('question-bank-reset-filters', handleReset)
    return () => window.removeEventListener('question-bank-reset-filters', handleReset)
  }, [])

  useEffect(() => {
    let active = true
    void questionBankApi.getActiveClassificationTask()
      .then(({ task }) => {
        if (!active || !task) return
        setClassificationTask(task)
        setClassifying(true)
      })
      .catch(() => undefined)
    return () => { active = false }
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

  async function deleteSelectedItems() {
    if (!selectedIds.length || deleting) return
    const confirmed = window.confirm(`确定删除已选中的 ${selectedIds.length} 道题目吗？题目会同时从所有试题篮中移除，且无法恢复。`)
    if (!confirmed) return
    setDeleting(true)
    try {
      await questionBankApi.deleteItems(selectedIds)
      setSelectedIds([])
      reload()
    } catch (error) {
      alert(error instanceof Error ? `批量删除失败：${error.message}` : '批量删除失败，请稍后重试。')
    } finally {
      setDeleting(false)
    }
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
    setShowClassificationProgress(true)
    try {
      const result = await questionBankApi.classifyAllItems()
      setClassificationTask(result.task)
      setClassificationStatus('分类任务已启动，正在等待题目处理...')
    } catch (error) {
      setClassificationStatus(error instanceof Error ? error.message : '分类任务启动失败')
      setClassifying(false)
    }
  }

  useEffect(() => {
    if (!classificationTask || ['succeeded', 'failed'].includes(classificationTask.status)) return
    const timer = window.setInterval(() => {
      void questionBankApi.getClassificationTask(classificationTask.id).then(({ task }) => {
        setClassificationTask(task)
        setClassificationStatus(task.status === 'running' ? `分类进度：${task.completed}/${task.total || '...'}（成功 ${task.updated}，失败 ${task.failed}）` : '分类任务排队中...')
        if (['succeeded', 'failed'].includes(task.status)) {
          window.clearInterval(timer)
          setClassifying(false)
          setClassificationStatus(task.status === 'succeeded'
            ? `分类完成：已更新 ${task.updated}/${task.total} 题。`
            : `分类结束：已更新 ${task.updated}/${task.total} 题${task.failed ? `，失败 ${task.failed} 题` : '。'}`)
          reload()
        }
      }).catch(() => undefined)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [classificationTask, reload])

  useEffect(() => {
    const handleStartClassification = () => { void classifyAllQuestions() }
    window.addEventListener('question-bank-start-classification', handleStartClassification)
    return () => window.removeEventListener('question-bank-start-classification', handleStartClassification)
  }, [classifyAllQuestions])

  useEffect(() => {
    const handleShowClassificationProgress = () => {
      if (classificationTask) setShowClassificationProgress(true)
    }
    window.addEventListener('question-bank-show-classification-progress', handleShowClassificationProgress)
    return () => window.removeEventListener('question-bank-show-classification-progress', handleShowClassificationProgress)
  }, [classificationTask])

  useEffect(() => {
    if (!classificationTask) return
    window.dispatchEvent(new CustomEvent('question-bank-classification-task-updated', { detail: { task: classificationTask } }))
  }, [classificationTask])

  function selectAllCurrentPage() {
    const pageIds = items.map((item) => item.id)
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id))
    setSelectedIds(allSelected ? [] : pageIds)
  }

  const taskProgress = classificationTask?.total
    ? Math.min(100, Math.round((classificationTask.completed / classificationTask.total) * 100))
    : 0
  const taskState = classificationTask?.status ?? 'queued'
  const taskStateLabel = taskState === 'queued' ? '等待启动' : taskState === 'running' ? '正在分类' : taskState === 'succeeded' ? '分类完成' : '分类异常'
  const TaskStateIcon = taskState === 'running' || taskState === 'queued'
    ? LoaderCircle
    : taskState === 'succeeded'
      ? CheckCircle2
      : AlertTriangle

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 gap-4 overflow-hidden text-zinc-950 dark:text-zinc-50">
      <AnimatePresence initial={false}>
        {sidebarOpen ? (
          <motion.div
            key="bank-filter-sidebar-animated"
            initial={{ opacity: 0, width: 0, x: -12 }}
            animate={{ opacity: 1, width: 'auto', x: 0 }}
            exit={{ opacity: 0, width: 0, x: -12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280, opacity: { duration: 0.18 } }}
            className="hidden shrink-0 lg:block overflow-hidden h-full"
          >
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
          </motion.div>
        ) : null}
      </AnimatePresence>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="question-edit-glass-toolbar flex h-11 shrink-0 items-center justify-between gap-3 rounded-2xl px-3 border border-black/6 dark:border-white/8 backdrop-blur-md shadow-xs mb-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className={`relative flex size-7 items-center justify-center rounded-lg transition-all duration-150 ${
                sidebarOpen
                  ? 'bg-black/10 text-zinc-900 dark:bg-white/15 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100'
              }`}
              title={sidebarOpen ? "收起筛选栏" : "展开筛选栏"}
            >
              <PanelLeft className="size-4" />
              {!sidebarOpen && activeFiltersCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex size-2 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100 ring-2 ring-white dark:ring-zinc-950" />
              )}
            </button>
            <div className="flex flex-1 items-center gap-2 px-2.5 py-1 rounded-lg bg-black/4 dark:bg-white/6 border border-black/5 dark:border-white/8 max-w-md">
              <Search className="size-3.5 shrink-0 text-zinc-400" />
              <input
                className="w-full border-none bg-transparent p-0 text-xs text-zinc-800 outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-200"
                placeholder="搜索题干、来源、标签..."
                value={query}
                onChange={(e) => updateFilter(setQuery, e.target.value)}
              />
              {query ? (
                <button type="button" onClick={() => updateFilter(setQuery, '')} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="hidden max-w-[240px] shrink-0 items-center gap-1.5 overflow-x-auto py-1 md:flex">
            {stage && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-black/6 bg-black/4 dark:border-white/8 dark:bg-white/6 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:text-zinc-300">
                {stage}
                <X className="size-2.5 cursor-pointer text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => updateFilter(setStage, '')} />
              </span>
            )}
            {questionType && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-black/6 bg-black/4 dark:border-white/8 dark:bg-white/6 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:text-zinc-300">
                {questionType}
                <X className="size-2.5 cursor-pointer text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => updateFilter(setQuestionType, '')} />
              </span>
            )}
            {difficulty && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-black/6 bg-black/4 dark:border-white/8 dark:bg-white/6 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:text-zinc-300">
                {difficulty}
                <X className="size-2.5 cursor-pointer text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => updateFilter(setDifficulty, '')} />
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-l border-black/6 pl-3 dark:border-white/8">
            <Button size="sm" asLink to="/questions/new" icon={Plus}>新增题目</Button>
            <Button size="sm" variant="outline" asLink to="/questions/basket" icon={ShoppingBag}>试题篮 ({basketCount})</Button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-16">
          {classificationStatus && !showClassificationProgress ? (
            <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
              {classificationStatus}
            </div>
          ) : null}
          {classificationTask?.failures.length && !showClassificationProgress ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <div className="font-semibold">失败题目（{classificationTask.failures.length}）</div>
              <div className="mt-1 space-y-0.5">{classificationTask.failures.slice(0, 8).map((failure) => <div key={failure.id} className="truncate">{failure.id}：{failure.error}</div>)}</div>
              {classificationTask.failures.length > 8 ? <div className="mt-1 text-[10px]">其余失败题目可按 ID 搜索查看。</div> : null}
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
              const inBasket = basketQuestionIds.has(item.id)
              return (
                <QuestionBankDraftCard
                  key={item.id}
                  item={item}
                  isInBasket={inBasket}
                  isSelected={selected}
                  onToggleBasket={addToBasket}
                  onSelect={toggleSelected}
                  onClick={() => {
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

        {showClassificationProgress && classificationTask ? (
          <div className="absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12 sm:items-center sm:p-6">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="classification-progress-title"
              className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            >
              <header className="flex items-start justify-between gap-4 border-b border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-900 dark:bg-zinc-900/10">
                <div className="flex min-w-0 items-center gap-2.5">
                  <TaskStateIcon className={`size-4 shrink-0 ${taskState === 'running' || taskState === 'queued' ? 'animate-spin text-zinc-500' : taskState === 'succeeded' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`} />
                  <div>
                    <h2 id="classification-progress-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">题库数据分类</h2>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{taskStateLabel} · 任务 {classificationTask.id}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowClassificationProgress(false)} className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50" aria-label="关闭分类进度">
                  <X className="size-4" />
                </button>
              </header>

              <div className="space-y-5 p-5">
                <div>
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">已处理 {classificationTask.completed} / {classificationTask.total || '…'} 题</span>
                    <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">{classificationTask.total ? `${taskProgress}%` : '准备中'}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className={`h-full rounded-full transition-all duration-500 ${taskState === 'failed' ? 'bg-red-500' : taskState === 'succeeded' ? 'bg-emerald-500' : 'bg-zinc-900 dark:bg-zinc-100'}`} style={{ width: `${taskState === 'succeeded' ? 100 : taskProgress}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"><p className="text-[11px] text-zinc-500">待处理</p><p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{Math.max(0, classificationTask.total - classificationTask.completed)}</p></div>
                  <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"><p className="text-[11px] text-zinc-500">已更新</p><p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{classificationTask.updated}</p></div>
                  <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"><p className="text-[11px] text-zinc-500">失败</p><p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{classificationTask.failed}</p></div>
                </div>

                {classificationTask.error ? <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{classificationTask.error}</span></div> : null}
                {classificationTask.failures.length ? <div className="rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400"><p className="font-semibold">失败题目（{classificationTask.failures.length}）</p><div className="mt-1.5 space-y-1">{classificationTask.failures.slice(0, 5).map((failure) => <p key={failure.id} className="truncate">{failure.id}：{failure.error}</p>)}</div>{classificationTask.failures.length > 5 ? <p className="mt-1.5 text-[11px]">其余失败题目可按 ID 搜索查看。</p> : null}</div> : null}
              </div>

              <footer className="flex justify-end border-t border-zinc-100 bg-zinc-50/10 px-5 py-3 dark:border-zinc-900 dark:bg-zinc-900/5">
                <Button size="sm" variant="outline" onClick={() => setShowClassificationProgress(false)}>{['queued', 'running'].includes(taskState) ? '后台继续执行' : '关闭'}</Button>
              </footer>
            </section>
          </div>
        ) : null}

        {/* Unified Bottom Footer Control Center */}
        <footer className="question-edit-glass-footer absolute bottom-0 left-0 right-0 z-20 flex h-12 items-center justify-between rounded-xl border border-black/8 dark:border-white/10 px-4 backdrop-blur-xl shadow-md select-none text-xs bg-white/85 dark:bg-zinc-950/85">
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
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <PlusSquare className="size-3.5 shrink-0" />
                加入试题篮
              </button>
              <button
                type="button"
                disabled
                title="后端暂未提供批量标记接口"
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-400 opacity-60 cursor-not-allowed"
              >
                <Tag className="size-3.5 shrink-0" />
                批量标记
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void deleteSelectedItems()}
                title="删除已选题目"
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/20"
              >
                <Trash2 className="size-3.5 shrink-0" />
                {deleting ? '正在删除' : '批量删除'}
              </button>
              <div className="h-4 w-px bg-black/10 dark:bg-white/10 mx-1" />
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
