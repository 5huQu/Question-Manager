import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BadgeCheck, LoaderCircle, RefreshCcw, Tags } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { RunExportDialog } from '@/components/pdf-slicer/RunExportDialog'
import { WorkbenchQuestionCard } from '@/components/questions/WorkbenchQuestionCard'
import { Button, Empty, SelectFilter } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { ApiRun, QuestionItem, TagLibraries } from '@/types'
import { addQuestionToActiveBasket } from '@/utils/questionBasket'

export function RunQuestionsPage() {
  const { runId = '' } = useParams()
  const navigate = useNavigate()
  const decodedRunId = decodeURIComponent(runId)
  const [localItems, setLocalItems] = useState<QuestionItem[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('')
  const [questionType, setQuestionType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [knowledgePoint, setKnowledgePoint] = useState('')
  const [solutionMethod, setSolutionMethod] = useState('')

  const { data, error, loading, reload } = useAsync<{ run: ApiRun; items: QuestionItem[] }>(
    () => api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/questions`),
    [decodedRunId]
  )
  const tagLibraries = useAsync<TagLibraries>(() => api('/api/question-bank/tag-libraries'), [])

  useEffect(() => {
    if (data?.items) setLocalItems(data.items)
  }, [data?.items])

  function replaceQuestionInRun(next: QuestionItem) {
    setLocalItems((current) => current.map((item) => item.id === next.id ? next : item))
  }

  async function addToBasket(id: string) {
    if (id.startsWith('mock_')) {
      alert('已将模拟题目加入试题篮 (静态操作)')
      return
    }
    await addQuestionToActiveBasket(id)
  }

  async function deleteQuestion(id: string) {
    if (!window.confirm('确定删除这道题目？')) return
    if (id.startsWith('mock_')) {
      alert('模拟数据已删除 (静态操作)')
      return
    }
    await api(`/api/question-bank/items/${encodeURIComponent(id)}`, { method: 'DELETE' })
    setLocalItems((current) => current.filter((item) => item.id !== id))
  }

  async function classifyRunQuestions() {
    if (!items.length) return
    if (!window.confirm('确认对当前批次执行数据分类？本操作只更新知识点、解题方法和难度。')) return
    setClassifying(true)
    try {
      const result = await api<{ run: ApiRun; items: QuestionItem[]; report?: { total?: number; updated?: number; failed?: number } }>(
        `/api/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/classify`,
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify({}) }
      )
      setLocalItems(result.items)
      await reload()
      const report = result.report
      alert(`分类完成：已更新 ${report?.updated ?? result.items.length} / ${report?.total ?? result.items.length} 题${report?.failed ? `，失败 ${report.failed} 题` : ''}。`)
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setClassifying(false)
    }
  }

  if (loading) return <Empty text="读取中..." />
  if (error || !data) return <Empty text={error || '批次不存在或无题目数据'} />

  const run = data.run
  const items = localItems
  const filteredItems = items.filter((item) => {
    const q = query.trim().toLowerCase()
    const haystack = [
      item.stemMarkdown,
      item.answerText,
      item.analysisMarkdown,
      item.sourceTitle,
      item.chapter,
      ...(item.knowledgePoints ?? []),
      ...(item.solutionMethods ?? []),
    ].join('\n').toLowerCase()
    return (!q || haystack.includes(q))
      && (!stage || item.stage === stage)
      && (!questionType || item.questionType === questionType)
      && (!difficulty || item.difficultyLabel === difficulty)
      && (!knowledgePoint || (item.knowledgePoints ?? []).includes(knowledgePoint))
      && (!solutionMethod || (item.solutionMethods ?? []).includes(solutionMethod))
  })
  const hasActiveFilters = Boolean(query.trim() || stage || questionType || difficulty || knowledgePoint || solutionMethod)
  const allQuestionsBanked = items.length > 0 && items.every((item) => item.bankStatus === 'banked')

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b pb-3 shrink-0 border-zinc-200 dark:border-zinc-800">
        <div>
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">系统功能 / OCR 队列 / 批次详情</p>
          <h2 className="text-base font-bold mt-0.5 text-zinc-900 dark:text-zinc-50">
            {run.paperTitle || run.pdfName}
          </h2>
          <p className="text-[10px] text-zinc-400 mt-0.5">批次 ID: {run.runId}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={classifyRunQuestions}
            icon={classifying ? LoaderCircle : Tags}
            disabled={classifying || !items.length}
          >
            {classifying ? '分类中...' : '数据分类'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>导出批次</Button>
          <Button size="sm" variant="outline" onClick={() => navigate(-1)}>返回上一页</Button>
          <Button size="sm" variant="outline" onClick={reload} icon={RefreshCcw}>刷新</Button>
          {!allQuestionsBanked ? <Button size="sm" asLink icon={BadgeCheck} to={`/tools/pdf-slicer/runs/${decodedRunId}/pending-bank`}>查看待入库结果</Button> : null}
        </div>
      </div>
      {exportOpen ? <RunExportDialog run={run} onClose={() => setExportOpen(false)} /> : null}

      <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <input className="h-9 rounded-md border px-3 text-xs bg-zinc-50 focus:bg-white" placeholder="搜索本批次题目..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <SelectFilter label="全部学段" value={stage} options={tagLibraries.data?.stages ?? ['高一', '高二', '高三']} onChange={setStage} />
        <SelectFilter label="全部题型" value={questionType} options={tagLibraries.data?.questionTypes ?? ['单选题', '多选题', '填空题', '解答题']} onChange={setQuestionType} />
        <SelectFilter label="全部难度" value={difficulty} options={tagLibraries.data?.difficultyLabels ?? ['基础', '中等', '较难', '压轴']} onChange={setDifficulty} />
        <SelectFilter label="全部知识点" value={knowledgePoint} options={tagLibraries.data?.knowledgePoints ?? []} onChange={setKnowledgePoint} />
        <SelectFilter label="全部解题方法" value={solutionMethod} options={tagLibraries.data?.solutionMethods ?? []} onChange={setSolutionMethod} />
        {hasActiveFilters ? (
          <div className="lg:col-span-6 flex items-center justify-between text-xs text-zinc-500">
            <span>已筛选出 {filteredItems.length} / {items.length} 题</span>
            <button className="font-semibold text-zinc-800 hover:text-zinc-950" type="button" onClick={() => { setQuery(''); setStage(''); setQuestionType(''); setDifficulty(''); setKnowledgePoint(''); setSolutionMethod('') }}>重置筛选</button>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 pr-1 pb-4">
        {filteredItems.map((item) => (
          <WorkbenchQuestionCard
            key={item.id}
            item={item}
            onAddToBasket={addToBasket}
            onDelete={deleteQuestion}
            onReload={reload}
            onQuestionSaved={replaceQuestionInRun}
          />
        ))}
        {!items.length ? (
          <Empty text="该批次下暂无题目。请先在该批次中执行 OCR 或导入题目。" />
        ) : !filteredItems.length ? (
          <Empty text="未找到匹配筛选条件的题目。" />
        ) : null}
      </div>
    </section>
  )
}

export default RunQuestionsPage
