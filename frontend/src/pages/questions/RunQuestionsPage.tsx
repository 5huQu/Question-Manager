import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BadgeCheck, LoaderCircle, RefreshCcw, Tags } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { RunExportDialog } from '@/components/pdf-slicer/RunExportDialog'
import { WorkbenchQuestionCard } from '@/components/questions/WorkbenchQuestionCard'
import { Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { ApiRun, QuestionItem } from '@/types'
import { addQuestionToActiveBasket } from '@/utils/questionBasket'

export function RunQuestionsPage() {
  const { runId = '' } = useParams()
  const navigate = useNavigate()
  const decodedRunId = decodeURIComponent(runId)
  const [localItems, setLocalItems] = useState<QuestionItem[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const [classifying, setClassifying] = useState(false)

  const { data, error, loading, reload } = useAsync<{ run: ApiRun; items: QuestionItem[] }>(
    () => api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(decodedRunId)}/questions`),
    [decodedRunId]
  )

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
    if (!window.confirm('确认对当前批次执行数据分类？本操作只更新知识点、解题方法和难度，不执行格式清洗。')) return
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

      <div className="space-y-4 pr-1 pb-4">
        {items.map((item) => (
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
          <Empty text="该批次下暂无题目。请先在该批次中执行 OCR 或格式清洗导入题目。" />
        ) : null}
      </div>
    </section>
  )
}

export default RunQuestionsPage
