import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Calendar, Check, CheckCircle, ChevronDown, ChevronUp, Crop, Grid, List, PencilLine, PlusSquare, Search, ShoppingBag, Tag, Trash2, X } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { learningTagsApi } from '@/api/learningTags'
import { FigureCropDialog } from '@/components/questions/FigureDialogs'
import { EditDialog } from '@/components/questions/EditDialog'
import { QuestionMarkdownContent, SolutionDisclosure } from '@/components/questions/QuestionContent'
import { Badge, Button, Empty, TagRow } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionBankResponse, QuestionItem, TagLibraries } from '@/types'
import { addQuestionToActiveBasket } from '@/utils/questionBasket'
import { difficultyLabel10, displaySource } from '@/utils/questionDisplay'
import { richBlocksPlainText } from '@/components/RichContent'

export function WorkbenchQuestionCard({ item, onAddToBasket, onDelete, onReload, onQuestionSaved }: { item: QuestionItem; onAddToBasket: (id: string) => void; onDelete: (id: string) => void; onReload: () => void; onQuestionSaved?: (item: QuestionItem) => void }) {
  const [cropOpen, setCropOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<QuestionItem>>(item)
  useEffect(() => {
    setDraft(item)
  }, [item])
  async function addFigure(payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return questionBankApi.createFigure(item.id, { usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox })
  }
  async function deleteFigure(figureId: string) {
    await questionBankApi.deleteFigure(item.id, figureId)
  }
  async function updateFigure(figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    return questionBankApi.updateFigure(item.id, figureId, { usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox })
  }
  function closeCropDialog(changed?: boolean) {
    setCropOpen(false)
    if (changed) onReload()
  }
  async function saveEditedQuestion(nextDraft = draft) {
    const saved = await questionBankApi.updateItem(item.id, nextDraft)
    setDraft(saved)
    setEditing(false)
    if (onQuestionSaved) onQuestionSaved(saved)
    else onReload()
  }
  return (
    <article className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-foreground">#{item.serialNo ?? item.questionNo}</p>
            {[item.questionType || '未设题型', difficultyLabel10(item), item.stage].filter(t => t && t !== 'OCRT').map((t, i) => <Badge key={i}>{t}</Badge>)}
          </div>
          <TagRow label="知识点" tags={item.knowledgePoints?.length ? item.knowledgePoints : (item.chapter ? [item.chapter] : [])} />
          <TagRow label="解题方法" tags={item.solutionMethods ?? []} />
          <p className="text-xs text-muted-foreground">来源：{displaySource(item.sourceTitle || '')}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" icon={PencilLine} onClick={() => setEditing(true)}>编辑</Button>
          <Button size="sm" variant="outline" icon={Crop} onClick={() => setCropOpen(true)}>框选题图</Button>
          <Button size="sm" variant="outline" onClick={() => onAddToBasket(item.id)}>加入试题篮</Button>
          <Button size="sm" asLink variant="outline" to={`/questions/${encodeURIComponent(item.id)}`}>详情</Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => onDelete(item.id)}>删除</Button>
        </div>
      </div>

      <div className="text-sm leading-relaxed text-foreground">
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

function previewText(item: QuestionItem) {
  return (item.stemMarkdown || richBlocksPlainText(item.problemBlocks) || '')
    .replace(/\$\$?([\s\S]*?)\$\$?/g, ' $1 ')
    .replace(/[\n\r]+/g, ' ')
    .trim()
}

function QuestionBankDraftCard({
  item,
  isInBasket,
  isSelected,
  isActive,
  onToggleBasket,
  onSelect,
  onClick,
}: {
  item: QuestionItem
  isInBasket: boolean
  isSelected: boolean
  isActive: boolean
  onToggleBasket: (id: string) => void
  onSelect: (id: string) => void
  onClick: () => void
}) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const stem = item.stemMarkdown || richBlocksPlainText(item.problemBlocks)
  const answer = item.answerText || richBlocksPlainText(item.answerBlocks)
  const analysis = item.analysisMarkdown || richBlocksPlainText(item.analysisBlocks)
  const chapter = item.chapter || item.knowledgePoints?.[0] || '未分类'
  const date = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ''

  return (
    <div
      onClick={onClick}
      className={`group relative flex cursor-pointer select-none flex-col gap-3 rounded-lg border bg-white text-left transition-all duration-150 dark:bg-zinc-950 ${
        isSelected || isActive
          ? 'border-zinc-400 bg-zinc-50/10 p-5 shadow-xs dark:border-zinc-600 dark:bg-zinc-900/10'
          : 'border-zinc-200 p-5 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            onClick={(event) => {
              event.stopPropagation()
              onSelect(item.id)
            }}
            className={`flex size-4 shrink-0 items-center justify-center rounded border transition-all ${
              isSelected
                ? 'border-zinc-900 bg-zinc-900 text-white ring-2 ring-zinc-950/10 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 dark:ring-zinc-50/10'
                : 'border-zinc-300 bg-white group-hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900'
            }`}
          >
            {isSelected ? <Check className="size-3 stroke-[3]" /> : null}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {[item.questionType || '未设题型', item.stage || '未设学段', chapter].map((tag) => (
              <span key={tag} className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {tag}
              </span>
            ))}
            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${String(difficultyLabel10(item)).includes('难') ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
              难度: {difficultyLabel10(item)}
            </span>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{item.serialNo ?? item.questionNo ?? item.id.slice(0, 6)}</span>
      </div>

      <div className="select-text font-sans text-xs leading-relaxed text-zinc-900 dark:text-zinc-100">
        <QuestionMarkdownContent content={stem || '题干为空'} figures={item.figures} />
      </div>

      <div className={`grid transition-all duration-300 ease-in-out ${showAnalysis ? 'mt-2 grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="space-y-3 rounded border-t border-zinc-200 bg-zinc-50/50 p-3 pt-3 dark:border-zinc-800 dark:bg-zinc-900/30">
            <div>
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">【答案】</span>
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                <QuestionMarkdownContent content={answer || '暂无答案'} figures={item.figures} />
              </div>
            </div>
            <div>
              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">【解析】</span>
              <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <QuestionMarkdownContent content={analysis || '暂无解析'} figures={item.figures} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <div className="flex items-center gap-3 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
          {date ? <span className="flex items-center gap-1"><Calendar className="size-3 text-zinc-400" />{date}</span> : null}
          <span className="flex items-center gap-1"><BookOpen className="size-3 text-zinc-400" />{displaySource(item.sourceTitle || '') || '高中数学专项试卷'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setShowAnalysis((value) => !value)
            }}
            className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {showAnalysis ? <><ChevronUp className="size-3" />收起解析</> : <><ChevronDown className="size-3" />查看解析</>}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (!isInBasket) onToggleBasket(item.id)
            }}
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-bold transition-colors ${
              isInBasket
                ? 'border border-zinc-200 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
                : 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200'
            }`}
          >
            {isInBasket ? <><Check className="size-3" />已在试题篮</> : <><ShoppingBag className="size-3" />加入试题篮</>}
          </button>
        </div>
      </div>
    </div>
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
  page: number
  setPage: (value: number | ((value: number) => number)) => void
  onQuestionSaved?: (item: QuestionItem) => void
}) {
  const tagLibraries = useAsync<TagLibraries>(() => learningTagsApi.getQuestionBankTagLibraries(), [])
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const rawItems = questionBank?.items ?? []
  const items = rawItems
  const activeItem = useMemo(() => items.find((item) => item.id === previewId) ?? items[0] ?? null, [items, previewId])
  const basketQuestionIds = useMemo(() => new Set((questionBank?.basket?.questions ?? []).map((entry) => entry.item.id)), [questionBank?.basket?.questions])
  const basketCount = questionBank?.basket?.questionCount ?? questionBank?.basket?.questions?.length ?? 0
  const totalItems = questionBank?.totalItems ?? 0
  const hasActiveFilters = Boolean(query.trim() || stage || questionType || difficulty || knowledgePoint || solutionMethod)
  const stageOptions = tagLibraries.data?.stages?.length ? tagLibraries.data.stages : ['高一', '高二', '高三', '高中']
  const questionTypeOptions = tagLibraries.data?.questionTypes?.length ? tagLibraries.data.questionTypes : ['单选题', '多选题', '填空题', '解答题']
  const difficultyOptions = tagLibraries.data?.difficultyLabels?.length ? tagLibraries.data.difficultyLabels : ['基础', '中等', '较难', '压轴']

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

  // Listen for reset-filters event from the header actions
  useEffect(() => {
    function handleReset() {
      setQuery('')
      setStage('')
      setQuestionType('')
      setDifficulty('')
      setKnowledgePoint('')
      setSolutionMethod('')
      setPage(1)
    }
    window.addEventListener('question-bank-reset-filters', handleReset)
    return () => window.removeEventListener('question-bank-reset-filters', handleReset)
  }, [setQuery, setStage, setQuestionType, setDifficulty, setKnowledgePoint, setSolutionMethod, setPage])

  async function addToBasket(id: string) {
    if (id.startsWith('mock_')) {
      alert('已将模拟题目加入试题篮 (静态操作)')
      return
    }
    await addQuestionToActiveBasket(id)
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

  function selectAllCurrentPage() {
    const pageIds = items.map((item) => item.id)
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id))
    setSelectedIds(allSelected ? [] : pageIds)
  }

  function filterButtonClass(active: boolean) {
    return `flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs transition-colors ${
      active
        ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
        : 'text-zinc-500 hover:bg-zinc-100/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/40 dark:hover:text-zinc-200'
    }`
  }

  return (
    <div className="mock-page-root flex h-[calc(100vh-7rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <aside className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-200 bg-zinc-50/30 p-4 text-left dark:border-zinc-800 dark:bg-zinc-950/20">
        <div>
          <h3 className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">教学阶段</h3>
          <div className="space-y-0.5">
            {['全部', ...stageOptions].map((option) => (
              <button key={option} onClick={() => updateFilter(setStage, option === '全部' ? '' : option)} className={filterButtonClass((option === '全部' && !stage) || stage === option)}>
                <span>{option}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />
        <div>
          <h3 className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">试题题型</h3>
          <div className="space-y-0.5">
            {['全部', ...questionTypeOptions].map((option) => (
              <button key={option} onClick={() => updateFilter(setQuestionType, option === '全部' ? '' : option)} className={filterButtonClass((option === '全部' && !questionType) || questionType === option)}>
                <span>{option}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />
        <div>
          <h3 className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">难度分级</h3>
          <div className="space-y-0.5">
            {['全部', ...difficultyOptions].map((option) => (
              <button key={option} onClick={() => updateFilter(setDifficulty, option === '全部' ? '' : option)} className={filterButtonClass((option === '全部' && !difficulty) || difficulty === option)}>
                <span>{option}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50/10 dark:border-zinc-800">
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
            {[
              ['stage', stage, setStage],
              ['questionType', questionType, setQuestionType],
              ['difficulty', difficulty, setDifficulty],
              ['knowledgePoint', knowledgePoint, setKnowledgePoint],
              ['solutionMethod', solutionMethod, setSolutionMethod],
            ].map(([key, value, setter]) => value ? (
              <span key={String(key)} className="inline-flex items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {String(value)}
                <X className="size-2.5 cursor-pointer text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => updateFilter(setter as (value: string) => void, '')} />
              </span>
            ) : null)}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
            <div className="flex items-center rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-900">
              <button type="button" onClick={() => setViewMode('card')} className={`rounded-sm p-1 transition-colors ${viewMode === 'card' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-400 hover:text-zinc-600'}`} title="卡片列表">
                <Grid className="size-3" />
              </button>
              <button type="button" onClick={() => setViewMode('list')} className={`rounded-sm p-1 transition-colors ${viewMode === 'list' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-400 hover:text-zinc-600'}`} title="表格视图">
                <List className="size-3" />
              </button>
            </div>
            <Button size="sm" variant="outline" asLink to="/questions/basket" icon={ShoppingBag}>试题篮 ({basketCount})</Button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">找到 {totalItems} 道试题</span>
            <button type="button" onClick={selectAllCurrentPage} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200">
              {items.length > 0 && items.every((item) => selectedIds.includes(item.id)) ? '清除选择' : '全选此页'}
            </button>
          </div>

          {viewMode === 'card' ? (
            <div className="space-y-3.5 pb-20">
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
                  />
                )
              })}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white pb-20 dark:border-zinc-800 dark:bg-zinc-950">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <th className="w-8 p-2" />
                    <th className="w-20 p-2 font-mono text-[10px]">ID</th>
                    <th className="w-20 p-2">学段</th>
                    <th className="w-20 p-2">题型</th>
                    <th className="p-2">题干与来源</th>
                    <th className="w-20 p-2 text-center">难度</th>
                    <th className="w-20 p-2 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const inBasket = basketQuestionIds.has(item.id)
                    return (
                    <tr key={item.id} onClick={() => { setPreviewId(item.id); toggleSelected(item.id) }} className={`cursor-pointer border-b border-zinc-100 transition-colors hover:bg-zinc-50/70 dark:border-zinc-900 dark:hover:bg-zinc-900/50 ${activeItem?.id === item.id || selectedIds.includes(item.id) ? 'bg-zinc-50 dark:bg-zinc-900/40' : ''}`}>
                      <td className="p-2" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} className="size-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-800" /></td>
                      <td className="p-2 font-mono text-[10px] text-zinc-400">#{item.serialNo ?? item.questionNo ?? item.id}</td>
                      <td className="p-2 text-zinc-600 dark:text-zinc-400">{item.stage || '-'}</td>
                      <td className="p-2 text-zinc-600 dark:text-zinc-400">{item.questionType || '-'}</td>
                      <td className="min-w-0 p-2"><div className="line-clamp-1 font-medium text-zinc-850 dark:text-zinc-200">{previewText(item) || '题干为空'}</div><div className="truncate text-[11px] text-zinc-400">{displaySource(item.sourceTitle || '')}</div></td>
                      <td className="p-2 text-center"><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{difficultyLabel10(item)}</span></td>
                      <td className="p-2 text-center" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => { if (!inBasket) addToBasket(item.id) }} className={`rounded p-1 ${inBasket ? 'text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'}`} title={inBasket ? '已在试题篮中' : '加入试题篮'}><ShoppingBag className="size-3.5" /></button></td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {loading ? <Empty text={items.length ? '正在刷新题目...' : '正在读取题目...'} /> : null}
          {error ? <Empty text={`题目读取失败：${error}`} /> : null}
          {!items.length && !loading && !error ? <Empty text={hasActiveFilters ? '未找到匹配筛选条件的题目' : '题库中暂无题目'} /> : null}
        </div>

        {selectedIds.length > 0 ? (
          <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 select-none items-center gap-3.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-950 shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-mono text-[10px] font-bold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{selectedIds.length}</span>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-zinc-500 dark:text-zinc-400">已选择</span>
            <div className="h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-800" />
            <button type="button" onClick={addSelectedToBasket} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-zinc-900 px-4 py-1.5 font-semibold text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"><PlusSquare className="size-3.5 shrink-0" />加入试题篮</button>
            <button type="button" disabled title="后端暂未提供批量标记接口" className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 font-medium text-zinc-400 opacity-60"><Tag className="size-3.5 shrink-0" />批量标记</button>
            <button type="button" disabled title="后端暂未提供批量删除接口" className="inline-flex shrink-0 cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 font-medium text-red-400 opacity-60"><Trash2 className="size-3.5 shrink-0" />批量删除</button>
            <button type="button" onClick={() => setSelectedIds([])} className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><X className="size-3.5" /></button>
          </div>
        ) : null}
      </main>

      <section className="flex w-[360px] shrink-0 select-text flex-col gap-4 overflow-y-auto border-l border-zinc-200 bg-white p-5 text-left dark:border-zinc-800 dark:bg-zinc-950">
        {activeItem ? (
          <>
            <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">排版渲染即时预览</span>
              <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-zinc-800">ID: #{activeItem.serialNo ?? activeItem.questionNo ?? activeItem.id}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded border border-zinc-200/70 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30"><span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">章节分类</span><span className="mt-0.5 block truncate font-bold text-zinc-850 dark:text-zinc-200">{activeItem.chapter || '未设置'}</span></div>
              <div className="rounded border border-zinc-200/70 bg-zinc-50/50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30"><span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">题型难度</span><span className="mt-0.5 block font-bold text-zinc-850 dark:text-zinc-200">{activeItem.questionType || '未设题型'} ({difficultyLabel10(activeItem)})</span></div>
            </div>

            <div className="flex-1 space-y-4">
              <div className="space-y-1.5"><span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-600">【题干】</span><div className="rounded border border-zinc-200/60 bg-zinc-50/20 p-3 text-xs leading-relaxed text-zinc-900 dark:border-zinc-900 dark:bg-zinc-950/10 dark:text-zinc-100"><QuestionMarkdownContent content={activeItem.stemMarkdown || richBlocksPlainText(activeItem.problemBlocks)} figures={activeItem.figures} /></div></div>
              <div className="h-px bg-zinc-200/60 dark:bg-zinc-800" />
              <div className="space-y-1.5"><span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-600">【参考答案】</span><div className="rounded border border-zinc-200/60 bg-zinc-50/20 p-3 text-xs font-semibold leading-relaxed text-zinc-900 dark:border-zinc-900 dark:bg-zinc-950/10 dark:text-zinc-100"><QuestionMarkdownContent content={activeItem.answerText || richBlocksPlainText(activeItem.answerBlocks)} figures={activeItem.figures} /></div></div>
              <div className="h-px bg-zinc-200/60 dark:bg-zinc-800" />
              <div className="space-y-1.5"><span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-600">【详细解析】</span><div className="rounded border border-zinc-200/60 bg-zinc-50/20 p-3 text-xs leading-relaxed text-zinc-700 dark:border-zinc-900 dark:bg-zinc-950/10 dark:text-zinc-300"><QuestionMarkdownContent content={activeItem.analysisMarkdown || richBlocksPlainText(activeItem.analysisBlocks)} figures={activeItem.figures} /></div></div>
            </div>

            <div className="space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">知识点分类</span>
              <div className="flex flex-wrap gap-1">
                {(activeItem.knowledgePoints?.length ? activeItem.knowledgePoints : (activeItem.chapter ? [activeItem.chapter] : [])).map((tag) => <span key={tag} className="inline-block rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => { if (!basketQuestionIds.has(activeItem.id)) addToBasket(activeItem.id) }}
              className={`mt-1 flex w-full items-center justify-center gap-1.5 rounded py-2 text-xs font-bold transition-colors ${
                basketQuestionIds.has(activeItem.id)
                  ? 'border border-zinc-200 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200'
              }`}
            >
              {basketQuestionIds.has(activeItem.id) ? <CheckCircle className="size-3.5 text-emerald-600" /> : <ShoppingBag className="size-3.5" />}
              {basketQuestionIds.has(activeItem.id) ? '已在试题篮中' : '加入试题篮'}
            </button>
          </>
        ) : <div className="flex flex-1 items-center justify-center text-xs text-zinc-400">选择题目查看公式排版渲染</div>}
      </section>
    </div>
  )
}
