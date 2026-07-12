import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Database, LoaderCircle, RefreshCcw, Replace, Tags } from 'lucide-react'
import { collectionsApi } from '@/api/collections'
import { importV2Api, type ImportV2JobQuestionsResponse } from '@/api/importV2'
import { learningTagsApi } from '@/api/learningTags'
import { questionBankApi } from '@/api/questionBank'
import { getActiveCollectionId, basketUpdatedEvent, notifyBasketUpdated } from '@/components/QuestionBasket'
import { WorkbenchQuestionCard } from '@/components/questions/WorkbenchQuestionCard'
import { Button, Empty, Input, SelectFilter } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionItem, TagLibraries } from '@/types'
import { addQuestionToActiveBasket } from '@/utils/questionBasket'

export function ImportJobQuestionsPage() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const decodedJobId = decodeURIComponent(jobId)
  const [localItems, setLocalItems] = useState<QuestionItem[]>([])
  const [replacingBasket, setReplacingBasket] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('')
  const [questionType, setQuestionType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [knowledgePoint, setKnowledgePoint] = useState('')
  const [solutionMethod, setSolutionMethod] = useState('')

  const { data, error, loading, reload } = useAsync<ImportV2JobQuestionsResponse>(
    () => importV2Api.listImportJobQuestions(decodedJobId),
    [decodedJobId],
  )
  const tagLibraries = useAsync<TagLibraries>(() => learningTagsApi.getQuestionBankTagLibraries(), [])

  const activeBasketId = getActiveCollectionId()
  const basket = useAsync(() => collectionsApi.getCollection(activeBasketId), [activeBasketId])

  useEffect(() => {
    const handleUpdate = () => {
      basket.reload()
    }
    window.addEventListener(basketUpdatedEvent, handleUpdate)
    return () => window.removeEventListener(basketUpdatedEvent, handleUpdate)
  }, [basket.reload])

  useEffect(() => {
    if (data?.items) setLocalItems(data.items)
  }, [data?.items])

  const basketQuestionIds = useMemo(() => {
    return new Set((basket.data?.questions ?? []).map((entry) => entry.item.id))
  }, [basket.data?.questions])

  const primaryDocumentId = useMemo(() => {
    const documents = data?.documents ?? []
    return (documents.find((item) => item.role === 'full') || documents.find((item) => item.role === 'questions') || documents[0])?.sourceDocumentId || ''
  }, [data?.documents])

  function replaceQuestion(next: QuestionItem) {
    setLocalItems((current) => current.map((item) => item.id === next.id ? next : item))
  }

  async function addToBasket(id: string) {
    await addQuestionToActiveBasket(id)
  }

  async function deleteQuestion(id: string) {
    if (!window.confirm('确定删除这道题目？')) return
    await questionBankApi.deleteItem(id)
    setLocalItems((current) => current.filter((item) => item.id !== id))
  }

  async function classifyImportJobQuestions() {
    if (!localItems.length) return
    if (!window.confirm('确认对当前导入批次执行数据分类？本操作只更新知识点、解题方法和难度。')) return
    setClassifying(true)
    try {
      const result = await importV2Api.classifyImportJobQuestions(decodedJobId)
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

  async function replaceBasket(){
    if(!localItems.length||replacingBasket)return
    if(!window.confirm(`将用本批次的 ${localItems.length} 道题替换当前试卷篮中的全部题目，是否继续？`))return
    setReplacingBasket(true)
    try{await collectionsApi.replaceItems(activeBasketId,{questionIds:localItems.map((item)=>item.id),title:data?.importJob.paperTitle||data?.importJob.title||'导入批次试卷'});notifyBasketUpdated();await basket.reload();alert(`已将 ${localItems.length} 道题替换到当前试卷篮。`)}
    catch(error){alert(error instanceof Error?error.message:String(error))}
    finally{setReplacingBasket(false)}
  }

  if (loading) return <Empty text="读取中..." />
  if (error || !data) return <Empty text={error || '导入批次不存在或无题目数据'} />

  const importJob = data.importJob
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

  return (
    <section className="mock-page-root min-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto bg-zinc-50/30 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">资料导入 / 批次题目</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {importJob.paperTitle || importJob.title || '资料导入批次'}
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">批次 ID: {importJob.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={classifyImportJobQuestions}
            icon={classifying ? LoaderCircle : Tags}
            disabled={classifying || !items.length}
          >
            {classifying ? '分类中...' : '数据分类'}
          </Button>
          <Button size="sm" variant="outline" icon={replacingBasket?LoaderCircle:Replace} disabled={replacingBasket||!items.length} onClick={replaceBasket}>{replacingBasket?'替换中...':'替换到试卷篮'}</Button>
          <Button
            size="sm"
            variant="outline"
            icon={Database}
            onClick={() => primaryDocumentId
              ? navigate(`/tools/import/jobs/${encodeURIComponent(importJob.id)}/documents/${encodeURIComponent(primaryDocumentId)}`, { replace: true })
              : navigate('/tools/import', { replace: true })}
          >
            返回导入批次
          </Button>
          <Button size="sm" variant="outline" onClick={reload} icon={RefreshCcw}>刷新</Button>
        </div>
      </div>

      <div className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 sm:grid-cols-2 lg:grid-cols-6">
        <Input className="h-9 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 focus-visible:ring-1 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300" placeholder="搜索本批次题目..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <SelectFilter label="全部学段" value={stage} options={tagLibraries.data?.stages ?? ['高一', '高二', '高三']} onChange={setStage} />
        <SelectFilter label="全部题型" value={questionType} options={tagLibraries.data?.questionTypes ?? ['单选题', '多选题', '填空题', '解答题']} onChange={setQuestionType} />
        <SelectFilter label="全部难度" value={difficulty} options={tagLibraries.data?.difficultyLabels ?? ['基础', '中等', '较难', '压轴']} onChange={setDifficulty} />
        <SelectFilter label="全部知识点" value={knowledgePoint} options={tagLibraries.data?.knowledgePoints ?? []} onChange={setKnowledgePoint} />
        <SelectFilter label="全部解题方法" value={solutionMethod} options={tagLibraries.data?.solutionMethods ?? []} onChange={setSolutionMethod} />
        {hasActiveFilters ? (
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 lg:col-span-6">
            <span>已筛选出 {filteredItems.length} / {items.length} 题</span>
            <button className="font-semibold text-zinc-950 hover:underline dark:text-zinc-50" type="button" onClick={() => { setQuery(''); setStage(''); setQuestionType(''); setDifficulty(''); setKnowledgePoint(''); setSolutionMethod('') }}>重置筛选</button>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 pb-4 pr-1">
        {filteredItems.map((item) => (
          <WorkbenchQuestionCard
            key={item.id}
            item={item}
            onAddToBasket={addToBasket}
            onDelete={deleteQuestion}
            onReload={reload}
            onQuestionSaved={replaceQuestion}
            isInBasket={basketQuestionIds.has(item.id)}
            showFigureAction={false}
          />
        ))}
        {!items.length ? (
          <Empty text="该导入批次下暂无已入库题目。请先完成题目核对并确认入库。" />
        ) : !filteredItems.length ? (
          <Empty text="未找到匹配筛选条件的题目。" />
        ) : null}
      </div>
    </section>
  )
}

export default ImportJobQuestionsPage
