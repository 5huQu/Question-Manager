import { useEffect, useState } from 'react'
import { Crop, LoaderCircle, PencilLine, Plus, RefreshCcw, ScanSearch, Trash2 } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { FigureCropDialog } from '@/components/questions/FigureDialogs'
import { EditDialog } from '@/components/questions/EditDialog'
import { QuestionMarkdownContent, SolutionDisclosure } from '@/components/questions/QuestionContent'
import { Badge, Button, Empty, SelectFilter, TagRow } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrSettings, QuestionBankResponse, QuestionFigure, QuestionItem, TagLibraries } from '@/types'
import { cleanupCodeLabel, cleanupFieldLabel, cleanupSnippet } from '@/utils/ocrCleanup'
import { addQuestionToActiveBasket } from '@/utils/questionBasket'
import { difficultyLabel10, displaySource } from '@/utils/questionDisplay'
import { richBlocksPlainText } from '@/components/RichContent'

export function WorkbenchQuestionCard({ item, onAddToBasket, onDelete, onReload, onQuestionSaved, formatIssueOnly = false }: { item: QuestionItem; onAddToBasket: (id: string) => void; onDelete: (id: string) => void; onReload: () => void; onQuestionSaved?: (item: QuestionItem) => void; formatIssueOnly?: boolean }) {
  const [cropOpen, setCropOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<QuestionItem>>(item)
  const formatIssue = item.formatIssue
  useEffect(() => {
    setDraft(item)
  }, [item])
  async function addFigure(payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return api<QuestionFigure>(`/api/question-bank/items/${encodeURIComponent(item.id)}/figures`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox }),
    })
  }
  async function deleteFigure(figureId: string) {
    await api(`/api/question-bank/items/${encodeURIComponent(item.id)}/figures/${encodeURIComponent(figureId)}`, { method: 'DELETE' })
  }
  async function updateFigure(figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return api<QuestionFigure>(`/api/question-bank/items/${encodeURIComponent(item.id)}/figures/${encodeURIComponent(figureId)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox }),
    })
  }
  function closeCropDialog(changed?: boolean) {
    setCropOpen(false)
    if (changed) onReload()
  }
  async function saveEditedQuestion(nextDraft = draft) {
    const saved = await api<QuestionItem>(`/api/question-bank/items/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ item: nextDraft }),
    })
    setDraft(saved)
    setEditing(false)
    if (onQuestionSaved) onQuestionSaved(saved)
    else onReload()
  }
  return (
    <article className="rounded-2xl border bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-zinc-900">#{item.serialNo ?? item.questionNo}</p>
            {[item.questionType || '未设题型', difficultyLabel10(item), item.stage].filter(t => t && t !== 'OCRT').map((t, i) => <Badge key={i}>{t}</Badge>)}
          </div>
          <TagRow label="知识点" tags={item.knowledgePoints?.length ? item.knowledgePoints : (item.chapter ? [item.chapter] : [])} />
          <TagRow label="解题方法" tags={item.solutionMethods ?? []} />
          <p className="text-xs text-zinc-500">试卷来源：{displaySource(item.sourceTitle || '')}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" icon={PencilLine} onClick={() => setEditing(true)}>编辑题目</Button>
          <Button size="sm" variant="outline" icon={Crop} onClick={() => setCropOpen(true)}>框选题图</Button>
          {!formatIssueOnly ? (
            <Button size="sm" variant="outline" onClick={() => onAddToBasket(item.id)}>加入试题篮</Button>
          ) : null}
          <Button size="sm" asLink variant="default" to={`/questions/${encodeURIComponent(item.id)}`}>进入详情</Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => onDelete(item.id)}>删除题目</Button>
        </div>
      </div>

      {formatIssue ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          <p className="font-semibold">格式问题：{cleanupFieldLabel(formatIssue.field)}：{cleanupCodeLabel(formatIssue.code)}</p>
          {formatIssue.context || formatIssue.snippet ? <p className="mt-1">片段：{cleanupSnippet(formatIssue.context || formatIssue.snippet)}</p> : null}
          {formatIssue.message ? <p className="mt-1">原因：{formatIssue.message}</p> : null}
        </div>
      ) : null}

      <div className="text-sm text-zinc-800 leading-relaxed">
        <QuestionMarkdownContent content={item.stemMarkdown || richBlocksPlainText(item.problemBlocks)} figures={item.figures} />
      </div>

      <SolutionDisclosure
        answerText={item.answerText || richBlocksPlainText(item.answerBlocks)}
        analysisMarkdown={item.analysisMarkdown || richBlocksPlainText(item.analysisBlocks)}
        figures={item.figures}
        className="border-t pt-4 mt-2"
      />
      {editing ? <EditDialog draft={draft} setDraft={setDraft} onClose={() => setEditing(false)} onSave={saveEditedQuestion} /> : null}
      {cropOpen ? <FigureCropDialog question={item} onClose={closeCropDialog} onDelete={deleteFigure} onSave={addFigure} onUpdate={updateFigure} /> : null}
    </article>
  )
}

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
  formatIssueOnly,
  setFormatIssueOnly,
  page,
  setPage,
  onQuestionSaved,
}: {
  questionBank: QuestionBankResponse | null
  selectedQuestionId?: string | null
  setSelectedQuestionId?: (id: string | null) => void
  selectedQuestion?: QuestionItem | null
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
  knowledgePoint: string
  setKnowledgePoint: (value: string) => void
  solutionMethod: string
  setSolutionMethod: (value: string) => void
  formatIssueOnly: boolean
  setFormatIssueOnly: (value: boolean) => void
  page: number
  setPage: (value: number | ((value: number) => number)) => void
  onQuestionSaved?: (item: QuestionItem) => void
}) {
  const tagLibraries = useAsync<TagLibraries>(() => api('/api/question-bank/tag-libraries'), [])
  const ocrSettings = useAsync<OcrSettings>(() => api('/api/tools/pdf-slicer/ocr-settings'), [])
  const [bulkRerunBusy, setBulkRerunBusy] = useState(false)
  const [bulkRerunNotice, setBulkRerunNotice] = useState('')

  const rawItems = questionBank?.items ?? []
  const items = rawItems
  const totalItems = questionBank?.totalItems ?? 0
  const totalPages = questionBank?.totalPages ?? 1
  const currentPage = questionBank?.page ?? page
  const hasActiveFilters = Boolean(query.trim() || stage || questionType || difficulty || knowledgePoint || solutionMethod)

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value)
    setPage(1)
  }

  async function bulkRerunOcr() {
    if (!formatIssueOnly || totalItems <= 0 || bulkRerunBusy) return
    const batchSize = Math.max(1, Number.parseInt(String(ocrSettings.data?.maxItems || '10'), 10) || 10)
    const confirmed = window.confirm(`将按当前筛选结果批量重新 OCR ${totalItems} 道格式问题题目。\n系统会沿用 OCR 设置中的每批题数，当前为每批 ${batchSize} 题。是否继续？`)
    if (!confirmed) return
    setBulkRerunBusy(true)
    setBulkRerunNotice('')
    try {
      const result = await api<{
        totalMatched: number
        eligibleCount: number
        skippedCount: number
        batchSize: number
        runCount: number
        failed?: Array<{ index: number; error: string }>
      }>('/api/question-bank/bulk-rerun-ocr', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          filters: {
            q: query.trim(),
            stage,
            questionType,
            difficulty,
            knowledgePoint,
            solutionMethod,
          },
        }),
      })
      const failedCount = result.failed?.length || 0
      setBulkRerunNotice(`已创建 ${result.runCount} 个 OCR 任务，共 ${result.eligibleCount} 题，按每批 ${result.batchSize} 题拆分。${result.skippedCount > 0 ? `另有 ${result.skippedCount} 题缺少原始分块，已跳过。` : ''}${failedCount > 0 ? `其中 ${failedCount} 批启动失败。` : ''}`)
    } catch (error) {
      setBulkRerunNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBulkRerunBusy(false)
    }
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
    reload()
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-9rem)] min-h-[580px] overflow-hidden">
      {/* Header & Filter Row */}
      <div className="flex flex-col gap-3 shrink-0 border-b pb-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-zinc-800">题目列表</h3>
          <div className="flex gap-2">
            {formatIssueOnly ? (
              <Button size="sm" variant="outline" icon={bulkRerunBusy ? LoaderCircle : ScanSearch} disabled={bulkRerunBusy || totalItems <= 0} onClick={bulkRerunOcr}>
                {bulkRerunBusy ? '批量启动中...' : '批量重新 OCR'}
              </Button>
            ) : null}
            <Button size="sm" variant={formatIssueOnly ? 'default' : 'outline'} icon={RefreshCcw} onClick={() => { setFormatIssueOnly(!formatIssueOnly); setPage(1); }}>只看格式问题</Button>
            <Button size="sm" variant="outline" onClick={() => { setQuery(''); setStage(''); setQuestionType(''); setDifficulty(''); setKnowledgePoint(''); setSolutionMethod(''); setFormatIssueOnly(false); setPage(1); }}>重置筛选</Button>
            <Button size="sm" asLink icon={Plus} to="/questions/new">新增题目</Button>
          </div>
        </div>
        {bulkRerunNotice ? <p className="text-xs text-zinc-500">{bulkRerunNotice}</p> : null}
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
          <input className="h-9 rounded-md border px-3 text-xs bg-zinc-50 focus:bg-white" placeholder="搜索题干/来源/标签..." value={query} onChange={(e) => updateFilter(setQuery, e.target.value)} />
          <SelectFilter label="全部学段" value={stage} options={tagLibraries.data?.stages ?? ['高一', '高二', '高三', '高中']} onChange={(value) => updateFilter(setStage, value)} />
          <SelectFilter label="全部题型" value={questionType} options={tagLibraries.data?.questionTypes ?? ['单选题', '多选题', '填空题', '解答题']} onChange={(value) => updateFilter(setQuestionType, value)} />
          <SelectFilter label="全部难度" value={difficulty} options={tagLibraries.data?.difficultyLabels ?? ['基础', '中等', '较难', '压轴']} onChange={(value) => updateFilter(setDifficulty, value)} />
          <SelectFilter label="全部知识点" value={knowledgePoint} options={tagLibraries.data?.knowledgePoints ?? []} onChange={(value) => updateFilter(setKnowledgePoint, value)} />
          <SelectFilter label="全部解题方法" value={solutionMethod} options={tagLibraries.data?.solutionMethods ?? []} onChange={(value) => updateFilter(setSolutionMethod, value)} />
        </div>
      </div>

      {/* Questions List */}
      <div className="flex-1 overflow-auto space-y-4 pr-1 pb-4">
        {items.map((item) => (
          <WorkbenchQuestionCard key={item.id} item={item} onAddToBasket={addToBasket} onDelete={deleteQuestion} onReload={reload} onQuestionSaved={onQuestionSaved} formatIssueOnly={formatIssueOnly} />
        ))}
        {loading ? <Empty text={items.length ? '正在刷新题目...' : '正在读取题目...'} /> : null}
        {error ? <Empty text={`题目读取失败：${error}`} /> : null}
        {!items.length && !loading && !error ? (
          <Empty text={formatIssueOnly ? '当前没有需要处理的格式问题题目' : hasActiveFilters ? '未找到匹配筛选条件的题目' : '题库中暂无题目'} />
        ) : null}
        {totalItems > 0 ? (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white/95 px-3 py-2 text-xs text-zinc-500 shadow-sm backdrop-blur">
            <span>第 {currentPage}/{totalPages} 页，共 {totalItems} 题</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={currentPage <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button>
              <Button size="sm" variant="outline" disabled={currentPage >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
