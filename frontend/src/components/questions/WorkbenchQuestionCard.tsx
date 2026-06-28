import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Calendar, Check, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsLeft, ChevronsRight, Crop, Grid, List, PencilLine, PlusSquare, Search, ShoppingBag, Tag, Trash2, X } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { learningTagsApi } from '@/api/learningTags'
import { FigureCropDialog } from '@/components/questions/FigureDialogs'
import { EditDialog } from '@/components/questions/EditDialog'
import { QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { Badge, Button, Empty, TagRow } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionBankResponse, QuestionItem, TagLibraries } from '@/types'
import { addQuestionToActiveBasket } from '@/utils/questionBasket'
import { difficultyLabel10, displaySource } from '@/utils/questionDisplay'
import { richBlocksPlainText } from '@/components/RichContent'

export function WorkbenchQuestionCard({
  item,
  onAddToBasket,
  onDelete,
  onReload,
  onQuestionSaved,
  isInBasket = false,
  showFigureAction = true,
}: {
  item: QuestionItem
  onAddToBasket: (id: string) => void
  onDelete: (id: string) => void
  onReload: () => void
  onQuestionSaved?: (item: QuestionItem) => void
  isInBasket?: boolean
  showFigureAction?: boolean
}) {
  const [cropOpen, setCropOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<QuestionItem>>(item)
  const [showAnalysis, setShowAnalysis] = useState(false)

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

  const stem = item.stemMarkdown || richBlocksPlainText(item.problemBlocks)
  const answer = item.answerText || richBlocksPlainText(item.answerBlocks)
  const analysis = item.analysisMarkdown || richBlocksPlainText(item.analysisBlocks)
  const chapter = item.chapter || item.knowledgePoints?.[0] || '未分类'
  const date = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ''

  const btnOutlineClass = "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white h-7 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 cursor-pointer shadow-xs"
  const btnDangerClass = "inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50/20 h-7 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-950 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/30 cursor-pointer shadow-xs"

  return (
    <article
      className="group relative flex flex-col gap-3 rounded-lg border bg-white p-5 text-left transition-all duration-150 border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700 dark:bg-zinc-950"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
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

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={btnOutlineClass}
          >
            <PencilLine className="size-3.5" />
            编辑
          </button>
          {showFigureAction ? (
            <button
              type="button"
              onClick={() => setCropOpen(true)}
              className={btnOutlineClass}
            >
              <Crop className="size-3.5" />
              框选题图
            </button>
          ) : null}
          <Link
            to={`/questions/${encodeURIComponent(item.id)}`}
            className={btnOutlineClass}
          >
            详情
          </Link>
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className={btnDangerClass}
          >
            <Trash2 className="size-3.5" />
            删除
          </button>
          <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500 ml-1">
            #{item.serialNo ?? item.questionNo ?? item.id.slice(0, 6)}
          </span>
        </div>
      </div>

      <div className="select-text font-sans text-xs leading-relaxed text-zinc-900 dark:text-zinc-100">
        <QuestionMarkdownContent content={stem || '题干为空'} figures={item.figures} />
      </div>

      {item.knowledgePoints && item.knowledgePoints.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {item.knowledgePoints.map((kp) => (
            <span
              key={kp}
              className="inline-flex items-center rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 border border-zinc-200/60 dark:bg-zinc-900/30 dark:text-zinc-400 dark:border-zinc-800/80"
            >
              {kp}
            </span>
          ))}
        </div>
      )}

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

      <div className={`mt-1 flex items-center justify-between pt-3 ${showAnalysis ? '' : 'border-t border-zinc-200 dark:border-zinc-800'}`}>
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
            className={btnOutlineClass}
          >
            {showAnalysis ? <><ChevronUp className="size-3.5" />收起解析</> : <><ChevronDown className="size-3.5" />查看解析</>}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onAddToBasket(item.id)
            }}
            className={`inline-flex items-center gap-1.5 rounded-md h-7 px-3 text-xs font-medium transition-all ${
              isInBasket
                ? 'border border-zinc-200 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
                : 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer'
            }`}
          >
            {isInBasket ? <><Check className="size-3.5" />已在试题篮</> : <><ShoppingBag className="size-3.5" />加入试题篮</>}
          </button>
        </div>
      </div>

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
  onQuestionSaved,
}: {
  item: QuestionItem
  isInBasket: boolean
  isSelected: boolean
  isActive: boolean
  onToggleBasket: (id: string) => void
  onSelect: (id: string) => void
  onClick: () => void
  onQuestionSaved?: (item: QuestionItem) => void
}) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<QuestionItem>>(item)
  const stem = item.stemMarkdown || richBlocksPlainText(item.problemBlocks)
  const answer = item.answerText || richBlocksPlainText(item.answerBlocks)
  const analysis = item.analysisMarkdown || richBlocksPlainText(item.analysisBlocks)
  const chapter = item.chapter || item.knowledgePoints?.[0] || '未分类'
  const date = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ''

  const btnOutlineClass = "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white h-7 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 cursor-pointer shadow-xs"

  useEffect(() => {
    setDraft(item)
  }, [item])

  async function saveEditedQuestion(nextDraft = draft) {
    const saved = await questionBankApi.updateItem(item.id, nextDraft)
    setDraft(saved)
    setEditing(false)
    onQuestionSaved?.(saved)
  }

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
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setEditing(true)
            }}
            className={btnOutlineClass}
          >
            <PencilLine className="size-3.5" />
            编辑
          </button>
          <Link
            to={`/questions/${encodeURIComponent(item.id)}`}
            onClick={(event) => event.stopPropagation()}
            className={btnOutlineClass}
          >
            详情
          </Link>
          <span className="ml-1 shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">#{item.serialNo ?? item.questionNo ?? item.id.slice(0, 6)}</span>
        </div>
      </div>

      <div className="select-text font-sans text-xs leading-relaxed text-zinc-900 dark:text-zinc-100">
        <QuestionMarkdownContent content={stem || '题干为空'} figures={item.figures} />
      </div>

      {item.knowledgePoints && item.knowledgePoints.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {item.knowledgePoints.map((kp) => (
            <span
              key={kp}
              className="inline-flex items-center rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 border border-zinc-200/60 dark:bg-zinc-900/30 dark:text-zinc-400 dark:border-zinc-800/80"
            >
              {kp}
            </span>
          ))}
        </div>
      )}

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

      <div className={`mt-1 flex items-center justify-between pt-3 ${showAnalysis ? '' : 'border-t border-zinc-200 dark:border-zinc-800'}`}>
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
            className={btnOutlineClass}
          >
            {showAnalysis ? <><ChevronUp className="size-3.5" />收起解析</> : <><ChevronDown className="size-3.5" />查看解析</>}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (!isInBasket) onToggleBasket(item.id)
            }}
            className={`inline-flex items-center gap-1.5 rounded-md h-7 px-3 text-xs font-medium transition-all ${
              isInBasket
                ? 'border border-zinc-200 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
                : 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer'
            }`}
          >
            {isInBasket ? <><Check className="size-3.5" />已在试题篮</> : <><ShoppingBag className="size-3.5" />加入试题篮</>}
          </button>
        </div>
      </div>
      {editing ? <EditDialog draft={draft} setDraft={setDraft} onClose={() => setEditing(false)} onSave={saveEditedQuestion} /> : null}
    </div>
  )
}


function CustomCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={`flex size-3.5 shrink-0 items-center justify-center rounded border transition-all duration-150 cursor-pointer ${
        checked || indeterminate
          ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900'
          : 'border-zinc-300 hover:border-zinc-400 bg-white dark:border-zinc-700 dark:hover:border-zinc-700 dark:bg-zinc-900'
      }`}
    >
      {checked && <Check className="size-2.5 stroke-[3px]" />}
      {!checked && indeterminate && <div className="h-[2px] w-1.5 bg-current rounded-xs" />}
    </button>
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
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const [stageExpanded, setStageExpanded] = useState(false)
  const [questionTypeExpanded, setQuestionTypeExpanded] = useState(true)
  const [difficultyExpanded, setDifficultyExpanded] = useState(false)
  const [kpExpanded, setKpExpanded] = useState(false)
  const [smExpanded, setSmExpanded] = useState(false)

  const [kpSearch, setKpSearch] = useState('')
  const [smSearch, setSmSearch] = useState('')

  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({})

  const rawItems = questionBank?.items ?? []
  const items = rawItems
  const activeItem = useMemo(() => items.find((item) => item.id === previewId) ?? items[0] ?? null, [items, previewId])
  const basketQuestionIds = useMemo(() => new Set((questionBank?.basket?.questions ?? []).map((entry) => entry.item.id)), [questionBank?.basket?.questions])
  const basketCount = questionBank?.basket?.questionCount ?? questionBank?.basket?.questions?.length ?? 0
  const totalItems = questionBank?.totalItems ?? 0
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

  // Listen for reset-filters event from the header actions
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
    <div className="mock-page-root flex h-[calc(100vh-7rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <aside className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-200 bg-zinc-50/30 p-4 text-left dark:border-zinc-800 dark:bg-zinc-950/20">
        {activeFiltersCount > 0 && (
          <div className="flex items-center justify-between rounded-md bg-zinc-100/50 px-2.5 py-1.5 text-xs border border-zinc-200/60 dark:bg-zinc-900/40 dark:border-zinc-800/60">
            <span className="text-zinc-500 dark:text-zinc-400 font-medium">已选 {activeFiltersCount} 个条件</span>
            <button
              onClick={handleClearAllFilters}
              className="font-bold text-zinc-900 hover:underline dark:text-zinc-100 cursor-pointer"
            >
              清空
            </button>
          </div>
        )}

        {/* 教学阶段 */}
        <div>
          <button
            type="button"
            onClick={() => setStageExpanded(!stageExpanded)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
          >
            <span>教学阶段</span>
            <ChevronDown className={`size-3.5 transition-transform duration-250 ${stageExpanded ? 'rotate-180' : ''}`} />
          </button>
          <div className={`grid transition-all duration-250 ease-in-out ${stageExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
            <div className="overflow-hidden">
              <div className="space-y-0.5 pl-2 pb-1">
                {['全部', ...stageOptions].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => updateFilter(setStage, opt === '全部' ? '' : opt)}
                    className={filterButtonClass((opt === '全部' && !stage) || stage === opt)}
                  >
                    <span>{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        {/* 试题题型 */}
        <div>
          <button
            type="button"
            onClick={() => setQuestionTypeExpanded(!questionTypeExpanded)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
          >
            <span>试题题型</span>
            <ChevronDown className={`size-3.5 transition-transform duration-250 ${questionTypeExpanded ? 'rotate-180' : ''}`} />
          </button>
          <div className={`grid transition-all duration-250 ease-in-out ${questionTypeExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
            <div className="overflow-hidden">
              <div className="space-y-0.5 pl-2 pb-1">
                {['全部', ...questionTypeOptions].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => updateFilter(setQuestionType, opt === '全部' ? '' : opt)}
                    className={filterButtonClass((opt === '全部' && !questionType) || questionType === opt)}
                  >
                    <span>{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        {/* 难度分级 */}
        <div>
          <button
            type="button"
            onClick={() => setDifficultyExpanded(!difficultyExpanded)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
          >
            <span>难度分级</span>
            <ChevronDown className={`size-3.5 transition-transform duration-250 ${difficultyExpanded ? 'rotate-180' : ''}`} />
          </button>
          <div className={`grid transition-all duration-250 ease-in-out ${difficultyExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
            <div className="overflow-hidden">
              <div className="space-y-0.5 pl-2 pb-1">
                {['全部', ...difficultyOptions].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => updateFilter(setDifficulty, opt === '全部' ? '' : opt)}
                    className={filterButtonClass((opt === '全部' && !difficulty) || difficulty === opt)}
                  >
                    <span>{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        {/* 知识点树形多选折叠组 */}
        <div>
          <button
            type="button"
            onClick={() => setKpExpanded(!kpExpanded)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
          >
            <span>知识点</span>
            <ChevronDown className={`size-3.5 transition-transform duration-250 ${kpExpanded ? 'rotate-180' : ''}`} />
          </button>

          <div className={`grid transition-all duration-250 ease-in-out ${kpExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
            <div className="overflow-hidden">
              <div className="space-y-2 pb-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 size-3 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="搜索知识点..."
                    value={kpSearch}
                    onChange={(e) => setKpSearch(e.target.value)}
                    className="w-full rounded-md border border-zinc-200 bg-white pl-7 pr-6 py-1 text-xs outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 focus:ring-0"
                  />
                  {kpSearch && (
                    <button
                      type="button"
                      onClick={() => setKpSearch('')}
                      className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-350"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>

                <div className="max-h-60 overflow-y-auto pr-1 space-y-2 select-none">
                  {kpChapters.map((chapter: any) => {
                    const filteredKps = chapter.knowledgePoints.filter((kp: any) =>
                      kp.name.toLowerCase().includes(kpSearch.toLowerCase())
                    )
                    const chapterMatches = chapter.name.toLowerCase().includes(kpSearch.toLowerCase())
                    const displayKps = chapterMatches ? chapter.knowledgePoints : filteredKps

                    if (kpSearch && displayKps.length === 0 && !chapterMatches) {
                      return null
                    }

                    const isExpanded = expandedChapters[chapter.code] ?? (kpSearch ? true : false)
                    const kpNames = chapter.knowledgePoints.map((kp: any) => kp.name)
                    const selectedChildren = chapter.knowledgePoints.filter((kp: any) =>
                      knowledgePoint.includes(kp.name)
                    )
                    const isAllSelected = selectedChildren.length === chapter.knowledgePoints.length
                    const isIndeterminate = selectedChildren.length > 0 && selectedChildren.length < chapter.knowledgePoints.length

                    const handleChapterToggle = () => {
                      if (isAllSelected) {
                        setKnowledgePoint((curr) => curr.filter((name) => !kpNames.includes(name)))
                      } else {
                        setKnowledgePoint((curr) => {
                          const next = [...curr]
                          kpNames.forEach((name: string) => {
                            if (!next.includes(name)) next.push(name)
                          })
                          return next
                        })
                      }
                      setPage(1)
                    }

                    return (
                      <div key={chapter.code} className="space-y-1">
                        <div className="flex items-center gap-1.5 py-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedChapters((prev) => ({
                                ...prev,
                                [chapter.code]: !(prev[chapter.code] ?? (kpSearch ? true : false)),
                              }))
                            }
                            className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                          >
                            <ChevronRight className={`size-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </button>
                          <CustomCheckbox
                            checked={isAllSelected}
                            indeterminate={isIndeterminate}
                            onChange={handleChapterToggle}
                          />
                          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate cursor-pointer" onClick={() =>
                              setExpandedChapters((prev) => ({
                                ...prev,
                                [chapter.code]: !(prev[chapter.code] ?? (kpSearch ? true : false)),
                              }))
                            } title={chapter.name}>
                            {chapter.name}
                          </span>
                        </div>

                        {isExpanded && displayKps.length > 0 && (
                          <div className="pl-6 space-y-1 border-l border-zinc-100 dark:border-zinc-800 ml-2">
                            {displayKps.map((kp: any) => {
                              const isSelected = knowledgePoint.includes(kp.name)
                              const handleKpToggle = () => {
                                if (isSelected) {
                                  setKnowledgePoint((curr) => curr.filter((name) => name !== kp.name))
                                } else {
                                  setKnowledgePoint((curr) => [...curr, kp.name])
                                }
                                setPage(1)
                              }

                              return (
                                <div key={kp.code} className="flex items-center gap-1.5 py-0.5">
                                  <CustomCheckbox checked={isSelected} onChange={handleKpToggle} />
                                  <span className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-1 leading-snug cursor-pointer" onClick={handleKpToggle} title={kp.name}>
                                    {kp.name}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {kpChapters.length === 0 && (
                    <div className="text-[10px] text-zinc-400 text-center py-2">暂无知识点库数据</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800" />

        {/* 解题方法分组多选折叠组 */}
        <div>
          <button
            type="button"
            onClick={() => setSmExpanded(!smExpanded)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-bold text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
          >
            <span>解题方法</span>
            <ChevronDown className={`size-3.5 transition-transform duration-250 ${smExpanded ? 'rotate-180' : ''}`} />
          </button>

          <div className={`grid transition-all duration-250 ease-in-out ${smExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
            <div className="overflow-hidden">
              <div className="space-y-2 pb-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 size-3 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="搜索方法..."
                    value={smSearch}
                    onChange={(e) => setSmSearch(e.target.value)}
                    className="w-full rounded-md border border-zinc-200 bg-white pl-7 pr-6 py-1 text-xs outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 focus:ring-0"
                  />
                  {smSearch && (
                    <button
                      type="button"
                      onClick={() => setSmSearch('')}
                      className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-300"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>

                <div className="max-h-60 overflow-y-auto pr-1 space-y-3 select-none">
                  {smGroups.map((group: any) => {
                    const displayTags = group.knowledgePoints.filter((tag: any) =>
                      tag.name.toLowerCase().includes(smSearch.toLowerCase())
                    )

                    if (displayTags.length === 0) {
                      return null
                    }

                    return (
                      <div key={group.code} className="space-y-1.5">
                        <div className="px-2 text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                          {group.name}
                        </div>
                        <div className="space-y-1 pl-2">
                          {displayTags.map((tag: any) => {
                            const isSelected = solutionMethod.includes(tag.name)
                            const handleTagToggle = () => {
                              if (isSelected) {
                                setSolutionMethod((curr) => curr.filter((name) => name !== tag.name))
                              } else {
                                setSolutionMethod((curr) => [...curr, tag.name])
                              }
                              setPage(1)
                            }

                            return (
                              <div key={tag.code} className="flex items-center gap-1.5 py-0.5">
                                <CustomCheckbox checked={isSelected} onChange={handleTagToggle} />
                                <span className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-1 leading-snug cursor-pointer" onClick={handleTagToggle} title={tag.name}>
                                  {tag.name}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {smGroups.length === 0 && (
                    <div className="text-[10px] text-zinc-400 text-center py-2">暂无解题方法数据</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

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

            <Button size="sm" variant="outline" asLink to="/questions/basket" icon={ShoppingBag}>试题篮 ({basketCount})</Button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-16">
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
          {/* Left Side: Stats or Multi-Select Actions (Left Column) */}
          <div className="flex-1 flex items-center justify-start">
            {selectedIds.length === 0 ? (
              <span className="text-zinc-500 dark:text-zinc-400 font-medium">找到 {totalItems} 道试题 · 每页 20 条</span>
            ) : (
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">已选择 {selectedIds.length} 项</span>
            )}
          </div>

          {/* Center Column: Batch Actions (Only show when selectedIds.length > 0) */}
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

          {/* Right Side: Page Controls (Right Column) */}
          <div className="flex-1 flex items-center justify-end">
          {(() => {
            const totalPages = Math.ceil(totalItems / 20);
            if (totalPages <= 1) return null;

            const startPage = Math.max(1, page - 2);
            const endPage = Math.min(totalPages, page + 2);
            const pages = [];
            for (let i = startPage; i <= endPage; i++) {
              pages.push(i);
            }

            return (
              <div className="flex items-center gap-1">
                {/* First Page */}
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="size-7 rounded border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 cursor-pointer transition-colors flex items-center justify-center"
                  title="第一页"
                >
                  <ChevronsLeft className="size-3.5" />
                </button>

                {/* Prev Page */}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="size-7 rounded border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 cursor-pointer transition-colors flex items-center justify-center"
                  title="上一页"
                >
                  <ChevronLeft className="size-3.5" />
                </button>

                {/* Page Numbers */}
                {pages.map((p) => {
                  const isActive = p === page;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`size-7 rounded border text-xs font-semibold transition-all cursor-pointer flex items-center justify-center ${
                        isActive
                          ? "bg-zinc-900 border-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 shadow-xs"
                          : "border-zinc-200 bg-white text-zinc-650 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}

                {/* Next Page */}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="size-7 rounded border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 cursor-pointer transition-colors flex items-center justify-center"
                  title="下一页"
                >
                  <ChevronRight className="size-3.5" />
                </button>

                {/* Last Page */}
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="size-7 rounded border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 cursor-pointer transition-colors flex items-center justify-center"
                  title="最后一页"
                >
                  <ChevronsRight className="size-3.5" />
                </button>
              </div>
            );
          })()}
          </div>
        </footer>
      </main>


    </div>
  )
}
