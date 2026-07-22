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
import { importJobDocumentPath } from './importV2Routes'

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
    <section className="mock-page-root min-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto bg-zinc-50/30 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 pb-16">
      {/* SF Glass Top Header */}
      <div className="sf-glass p-5 rounded-2xl flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-sm">
        <div>
          <p className="sf-subtitle text-xs">资料导入 / 批次题目结果</p>
          <h1 className="sf-title-large text-zinc-900 dark:text-zinc-50 mt-1">
            {importJob.paperTitle || importJob.title || '资料导入批次'}
          </h1>
          <p className="mt-1 text-[11px] text-zinc-400 font-mono">ID: {importJob.id}</p>
        </div>
        <div className="flex flex-wrap gap-2.5 items-center">
          <Button
            size="sm"
            variant="outline"
            onClick={classifyImportJobQuestions}
            icon={classifying ? LoaderCircle : Tags}
            disabled={classifying || !items.length}
            className="sf-pressable rounded-xl"
          >
            {classifying ? '分类中...' : '数据分类'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={replacingBasket ? LoaderCircle : Replace}
            disabled={replacingBasket || !items.length}
            onClick={replaceBasket}
            className="sf-pressable rounded-xl"
          >
            {replacingBasket ? '替换中...' : '替换到试卷篮'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={Database}
            onClick={() => primaryDocumentId
              ? navigate(importJobDocumentPath(importJob.id, primaryDocumentId), { replace: true })
              : navigate('/tools/import', { replace: true })}
            className="sf-pressable rounded-xl"
          >
            返回导入批次
          </Button>
          <Button size="sm" variant="outline" onClick={reload} icon={RefreshCcw} className="sf-pressable rounded-xl">
            刷新
          </Button>
        </div>
      </div>

      {/* SF Glass Search & Filter Panel */}
      <div className="sf-glass grid gap-3 rounded-2xl p-4 sm:grid-cols-2 lg:grid-cols-6 shadow-sm">
        <Input className="h-9 border-zinc-200/80 bg-white/80 dark:border-zinc-800/80 dark:bg-zinc-900/80 rounded-xl focus-visible:ring-1 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300 text-xs" placeholder="搜索本批次题目..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <SelectFilter label="全部学段" value={stage} options={tagLibraries.data?.stages ?? ['高一', '高二', '高三']} onChange={setStage} />
        <SelectFilter label="全部题型" value={questionType} options={tagLibraries.data?.questionTypes ?? ['单选题', '多选题', '填空题', '解答题']} onChange={setQuestionType} />
        <SelectFilter label="全部难度" value={difficulty} options={tagLibraries.data?.difficultyLabels ?? ['基础', '中等', '较难', '压轴']} onChange={setDifficulty} />
        <SelectFilter label="全部知识点" value={knowledgePoint} options={tagLibraries.data?.knowledgePoints ?? []} onChange={setKnowledgePoint} />
        <SelectFilter label="全部解题方法" value={solutionMethod} options={tagLibraries.data?.solutionMethods ?? []} onChange={setSolutionMethod} />
        {hasActiveFilters ? (
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 lg:col-span-6 pt-1">
            <span>已筛选出 {filteredItems.length} / {items.length} 题</span>
            <button className="font-semibold text-zinc-950 hover:underline dark:text-zinc-50 cursor-pointer" type="button" onClick={() => { setQuery(''); setStage(''); setQuestionType(''); setDifficulty(''); setKnowledgePoint(''); setSolutionMethod('') }}>重置筛选</button>
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
            showFigureAction
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
