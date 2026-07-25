import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Calendar, ChevronDown, ChevronLeft, ChevronRight, Download, GripVertical, Trash2, ChevronUp, ShoppingBag, Award, Clock, Hash, Maximize2, ArrowUp, ArrowDown, ListChecks, Settings2, FileDown, FileText, FileCode2, HelpCircle, PencilLine, Save, Copy, EyeOff, NotebookPen, Search } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { collectionsApi } from '../api/collections'
import { layoutDraftsApi } from '../api/layoutDrafts'
import { questionBankApi } from '../api/questionBank'
import { useAsync } from '../hooks/useAsync'
import type { Basket, CollectionExport, CollectionSummary, QuestionItem, BasketQuestion } from '../types'
import { Button, Empty, Badge } from './ui'
import { MarkdownWithInlineFigures, QuestionMarkdownContent } from './questions/QuestionContent'
import { EditDialog } from './questions/EditDialog'
import { Modal } from './dialogs/Modal'
import { richBlocksPlainText } from './RichContent'
import { difficultyLabel10, displaySource } from '../utils/questionDisplay'

export const basketUpdatedEvent = 'question-basket-updated'
/** 全应用唯一的试题篮（默认集合），所有"加入试题篮"操作的固定目标。 */
export const DEFAULT_BASKET_ID = 'basket'

const basketCardOutlineButtonClass = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 shadow-xs transition-all hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:opacity-30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
const basketCardDangerButtonClass = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-red-200 bg-red-50/20 px-2.5 text-xs font-medium text-red-700 shadow-xs transition-all hover:bg-red-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-950 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/30'

export function notifyBasketUpdated() {
  window.dispatchEvent(new Event(basketUpdatedEvent))
}

export function stripLeadingQuestionNo(value: string, questionNo = '') {
  const text = String(value || '').trimStart()
  const escaped = String(questionNo || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (escaped) {
    const exactPattern = new RegExp(`^(?:第\\s*)?${escaped}\\s*(?:题)?\\s*[.．、:：）)]\\s*`)
    const exactCleaned = text.replace(exactPattern, '')
    if (exactCleaned !== text) return exactCleaned.trimStart()
  }
  return text
    .replace(/^第\s*\d{1,3}\s*题\s*/, '')
    .replace(/^\d{1,3}\s*(?:题)?\s*[.．、:：）)]\s*/, '')
    .trimStart()
}

export function getDefaultScore(questionType: string | null | undefined): number {
  if (!questionType) return 5
  const type = String(questionType)
  if (type.includes('单选') || type.includes('单项选择')) return 5
  if (type.includes('多选') || type.includes('多项选择')) return 6
  if (type.includes('填空')) return 5
  if (type.includes('解答') || type.includes('计算') || type.includes('证明') || type.includes('主观')) return 15
  return 5
}

export function QuestionBasket({ mode = 'drawer' }: { mode?: 'drawer' | 'page' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(true)
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null)
  const activeId = editingPaperId ?? DEFAULT_BASKET_ID
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [localTitle, setLocalTitle] = useState('')
  const [localSubtitle, setLocalSubtitle] = useState('')
  const [localTimeLimit, setLocalTimeLimit] = useState<string | number>('')
  const [pageExportFormat, setPageExportFormat] = useState<'Markdown' | 'PDF' | 'LaTeX'>('Markdown')
  const [pageVariant, setPageVariant] = useState<'student' | 'teacher' | 'error_notebook'>('teacher')
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<Set<string>>(() => new Set())
  const [editingItem, setEditingItem] = useState<QuestionItem | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<QuestionItem>>({})
  const [paperSaveAction, setPaperSaveAction] = useState<'save_clear' | 'save_copy' | 'save_as' | null>(null)
  const [paperTitleInput, setPaperTitleInput] = useState('')
  const [savingPaper, setSavingPaper] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const [showMoreSettings, setShowMoreSettings] = useState(false)
  const [showPaperLibrary, setShowPaperLibrary] = useState(false)
  const [paperSearch, setPaperSearch] = useState('')
  const [paperPage, setPaperPage] = useState(1)

  const collections = useAsync<{ items: CollectionSummary[] }>(() => {
    return collectionsApi.listCollections()
  }, [])

  const active = useAsync<Basket>(() => {
    return collectionsApi.getCollection(activeId)
  }, [activeId])
  const layoutDrafts = useAsync(() => layoutDraftsApi.list(activeId), [activeId])

  useEffect(() => {
    if (active.data) {
      setLocalTitle(active.data.title || '试卷')
      setLocalSubtitle(active.data.subtitle || '')
      setLocalTimeLimit(active.data.timeLimit || '')
    }
  }, [active.data])

  useEffect(() => {
    const refresh = () => {
      collections.reload()
      active.reload()
    }
    window.addEventListener(basketUpdatedEvent, refresh)
    return () => {
      window.removeEventListener(basketUpdatedEvent, refresh)
    }
  }, [collections.reload, active.reload])

  const totalScore = useMemo(() => {
    return active.data?.questions.reduce((sum, entry) => {
      const score = entry.score || getDefaultScore(entry.item.questionType)
      return sum + Number(score)
    }, 0) ?? 0
  }, [active.data])

  const activeQuestions = active.data?.questions || []

  const allExpanded = activeQuestions.length > 0 && activeQuestions.every((entry) => expandedQuestionIds.has(entry.relationId || entry.item.id))

  function toggleExpandAll() {
    if (allExpanded) {
      setExpandedQuestionIds(new Set())
    } else {
      setExpandedQuestionIds(new Set(activeQuestions.map((entry) => entry.relationId || entry.item.id)))
    }
  }

  const savedPapers = useMemo(() => {
    return (collections.data?.items ?? []).filter((item) => item.id !== DEFAULT_BASKET_ID)
  }, [collections.data])

  const filteredPapers = useMemo(() => {
    const keyword = paperSearch.trim().toLowerCase()
    if (!keyword) return savedPapers
    return savedPapers.filter((paper) => (paper.title || '').toLowerCase().includes(keyword))
  }, [savedPapers, paperSearch])

  const PAPER_PAGE_SIZE = 10
  const totalPaperPages = Math.max(1, Math.ceil(filteredPapers.length / PAPER_PAGE_SIZE))
  const safePaperPage = Math.min(paperPage, totalPaperPages)
  const pagedPapers = filteredPapers.slice((safePaperPage - 1) * PAPER_PAGE_SIZE, safePaperPage * PAPER_PAGE_SIZE)

  function openPaper(paperId: string) {
    setExpandedQuestionIds(new Set())
    setEditingPaperId(paperId)
  }

  function backToBasket() {
    setExpandedQuestionIds(new Set())
    setEditingPaperId(null)
  }

  async function deletePaper(paper: CollectionSummary) {
    if (!window.confirm(`确定删除试卷「${paper.title}」？\n\n删除后不可恢复，但不会影响题库中的题目。`)) return
    await collectionsApi.deleteCollection(paper.id)
    if (editingPaperId === paper.id) setEditingPaperId(null)
    collections.reload()
    notifyBasketUpdated()
  }

  function renderPaperRow(paper: CollectionSummary, onOpen: (paperId: string) => void) {
    const isActive = editingPaperId === paper.id
    return (
      <div key={paper.id} className={`group relative overflow-hidden rounded-lg border transition-all duration-150 ${isActive ? 'border-zinc-900 bg-zinc-50 shadow-sm dark:border-zinc-100 dark:bg-zinc-900/70' : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700'}`}>
        {isActive ? <span className="absolute inset-y-0 left-0 w-[3px] bg-zinc-900 dark:bg-zinc-100" /> : null}
        <div className="flex items-center">
          <button type="button" onClick={() => onOpen(paper.id)} title="打开并编辑这份试卷" className={`flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-2 text-left ${isActive ? 'pl-4' : 'pl-3.5'}`}>
            <FileText className={`size-4 shrink-0 ${isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500'}`} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13px] font-semibold leading-snug ${isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>{paper.title}</span>
              <span className="block text-[10px] text-zinc-400 dark:text-zinc-500">{paper.questionCount} 题 · {paper.totalScore || 0} 分{paper.updatedAt ? ` · ${new Date(paper.updatedAt).toLocaleDateString()}` : ''}</span>
            </span>
            {isActive ? (
              <span className="shrink-0 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">编辑中</span>
            ) : (
              <ChevronRight className="size-4 shrink-0 text-zinc-300 opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:text-zinc-600" />
            )}
          </button>
          <button type="button" onClick={() => void deletePaper(paper)} title="删除试卷" className="mr-2 shrink-0 rounded p-1.5 text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  function openPaperLibrary() {
    setPaperSearch('')
    setPaperPage(1)
    setShowPaperLibrary(true)
  }

  function showSaveNotice(message: string) {
    setSaveNotice(message)
    window.setTimeout(() => setSaveNotice(''), 3000)
  }

  function openSaveDialog(action: 'save_clear' | 'save_copy' | 'save_as') {
    setPaperTitleInput(localTitle.trim() || '试卷')
    setPaperSaveAction(action)
  }

  function closeSaveDialog() {
    if (savingPaper) return
    setPaperSaveAction(null)
  }

  async function confirmSavePaper() {
    if (!paperSaveAction || savingPaper) return
    const title = paperTitleInput.trim()
    if (!title) return
    setSavingPaper(true)
    try {
      const questionIds = activeQuestions.map((entry) => entry.item.id)
      const created = await collectionsApi.createCollection({ title, kind: 'paper' })
      await collectionsApi.replaceItems(created.id, { questionIds, title })
      if (localSubtitle || Number(localTimeLimit || 0)) {
        await collectionsApi.updateCollection(created.id, { subtitle: localSubtitle, timeLimit: Number(localTimeLimit || 0) })
      }
      if (paperSaveAction === 'save_clear' && !editingPaperId) {
        await collectionsApi.clearItems(DEFAULT_BASKET_ID)
      }
      setPaperSaveAction(null)
      showSaveNotice(`已保存试卷《${title}》`)
      notifyBasketUpdated()
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingPaper(false)
    }
  }

  async function overwriteSavePaper() {
    if (!editingPaperId || savingPaper) return
    setSavingPaper(true)
    try {
      await collectionsApi.updateCollection(editingPaperId, {
        title: localTitle,
        subtitle: localSubtitle,
        timeLimit: Number(localTimeLimit || 0),
      })
      showSaveNotice('已覆盖保存到原卷')
      notifyBasketUpdated()
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingPaper(false)
    }
  }

  async function patchCollection(patch: Record<string, unknown>) {
    await collectionsApi.updateCollection(activeId, patch)
    collections.reload()
    active.reload()
  }

  async function patchItem(relationId: string, patch: Record<string, unknown>) {
    await collectionsApi.updateItem(activeId, relationId, patch)
    notifyBasketUpdated()
  }

  async function removeItem(relationId: string) {
    await collectionsApi.removeItem(activeId, relationId)
    notifyBasketUpdated()
  }

  async function clearCollection() {
    if (!window.confirm(`确定要清空${editingPaperId ? '当前试卷' : '试题篮'}中的所有题目吗？`)) return
    await collectionsApi.clearItems(activeId)
    notifyBasketUpdated()
  }

  async function moveItem(relationId: string, direction: -1 | 1) {
    const questions = active.data?.questions ?? []
    const index = questions.findIndex((entry) => entry.relationId === relationId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= questions.length) return
    const next = [...questions]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    await collectionsApi.reorder(activeId, next.map((entry, order) => ({ relationId: entry.relationId, sortOrder: order })))
    notifyBasketUpdated()
  }

  function openEditor(item: QuestionItem) {
    setEditDraft(item)
    setEditingItem(item)
  }

  async function saveEditedQuestion(nextDraft = editDraft) {
    if (!editingItem) return
    await questionBankApi.updateItem(editingItem.id, nextDraft, editingItem.contentRevision)
    setEditingItem(null)
    notifyBasketUpdated()
  }

  async function exportCollection(format: 'markdown' | 'latex' | 'pdf', variant: 'student' | 'teacher' | 'error_notebook', template: 'worksheet' | 'exam' = 'worksheet') {

    if (format === 'markdown') {
      setCollapsed(true)
      navigate(`/questions/collections/${encodeURIComponent(activeId)}/markdown-preview?variant=${variant}`)
      return
    }
    if (exporting) return
    setExporting(true)
    try {
      const payload = await collectionsApi.exportCollection(activeId, { format, variant, template })
      if (payload.format === 'pdf' && payload.url) {
        window.open(payload.url, '_blank', 'noopener,noreferrer')
        return
      }
      if (payload.content) {
        const blob = new Blob([payload.content], { type: format === 'latex' ? 'application/x-tex;charset=utf-8' : 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = payload.filename
        link.click()
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  async function createLayoutDraft() {
    if (exporting || !active.data?.questionCount) return
    setExporting(true)
    try {
      const response = await layoutDraftsApi.create(activeId, { variant: pageVariant, templateId: 'exam' })
      navigate(`/questions/collections/${encodeURIComponent(activeId)}/layout-drafts/${encodeURIComponent(response.draftId)}`)
    } finally {
      setExporting(false)
    }
  }

  // Hide the floating drawer globally if we are on the dedicated basket page
  if (mode === 'drawer' && (location.pathname === '/questions/basket' || location.pathname === '/mock/basket')) {
    return null
  }

  // Render Page Mode
  if (mode === 'page') {
    return (
      <div className="mock-page-root relative flex min-h-[calc(100vh-6rem)] flex-col overflow-auto bg-zinc-50/20 select-none xl:h-[calc(100vh-6rem)] xl:flex-row xl:overflow-hidden dark:bg-zinc-950">
        <main className="flex min-h-[560px] min-w-0 flex-1 flex-col overflow-hidden border-b border-zinc-200 bg-zinc-50/10 xl:min-h-0 xl:border-b-0 xl:border-r dark:border-zinc-800">
          <div className="h-12 shrink-0 border-b border-zinc-200 bg-white flex items-center justify-between px-4 dark:bg-zinc-900 dark:border-zinc-800">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              试题大纲与分值分配 ({active.data?.questions.length ?? 0} 道试题)
            </span>
            <div className="flex items-center gap-2">
              {activeQuestions.length ? (
                <button onClick={toggleExpandAll} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 transition-colors">
                  {allExpanded ? <><ChevronUp className="size-3.5" />收起全部解析</> : <><ChevronDown className="size-3.5" />展开所有解析</>}
                </button>
              ) : null}
              <button onClick={() => navigate('/questions')} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 transition-colors">
                <ChevronLeft className="size-3.5" />
                返回题库
              </button>
              {active.data?.questions.length ? (
                <button onClick={clearCollection} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-200 bg-white text-zinc-500 hover:text-red-650 hover:bg-red-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-red-400 transition-colors">
                  <Trash2 className="size-3.5" />
                  清空列表
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!active.data?.questions.length ? (
              <div className="flex flex-col items-center justify-center h-64 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-400 text-xs bg-white dark:bg-zinc-900/20">
                <HelpCircle className="size-8 text-zinc-300 dark:text-zinc-700 mb-2" />
                <span>你的试题篮是空的</span>
                <button onClick={() => navigate('/questions')} className="mt-3 text-xs text-zinc-900 dark:text-zinc-100 font-semibold hover:underline">
                  前去题库管理添加题目
                </button>
              </div>
            ) : (
              <div className="space-y-3 pb-16">
                {active.data.questions.map((entry, index) => {
                  const itemKey = entry.relationId || entry.item.id
                  const showAnalysis = expandedQuestionIds.has(itemKey)
                  const stem = entry.item.stemMarkdown || richBlocksPlainText(entry.item.problemBlocks)
                  const answer = entry.item.answerText || richBlocksPlainText(entry.item.answerBlocks)
                  const analysis = entry.item.analysisMarkdown || richBlocksPlainText(entry.item.analysisBlocks)
                  const chapter = entry.item.chapter || entry.item.knowledgePoints?.[0] || '未分类'
                  const date = entry.item.updatedAt ? new Date(entry.item.updatedAt).toLocaleDateString() : ''

                  return (
                    <article
                      key={itemKey}
                      draggable
                      onDragStart={(event) => {
                        if ((event.target as HTMLElement).closest('button, input')) {
                          event.preventDefault()
                          return
                        }
                        setDraggedIndex(index)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragEnd={() => setDraggedIndex(null)}
                      onDrop={async (event) => {
                        event.preventDefault()
                        if (draggedIndex === null || draggedIndex === index) return
                        const questions = active.data?.questions ?? []
                        const next = [...questions]
                        const [item] = next.splice(draggedIndex, 1)
                        next.splice(index, 0, item)
                        await collectionsApi.reorder(activeId, next.map((question, order) => ({ relationId: question.relationId, sortOrder: order })))
                        notifyBasketUpdated()
                        setDraggedIndex(null)
                      }}
                      className={`group relative flex cursor-grab flex-col gap-3 rounded-lg border bg-white p-5 text-left transition-all duration-200 active:cursor-grabbing dark:bg-zinc-950 ${
                        draggedIndex === index
                          ? 'border-dashed border-zinc-400 bg-zinc-50 opacity-40 dark:border-zinc-600 dark:bg-zinc-900/10'
                          : 'border-zinc-200 hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:shadow-none'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <GripVertical className="size-4 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-500" />
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center rounded bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">第 {index + 1} 题</span>
                            {[entry.item.questionType || '未设题型', entry.item.stage || '未设学段', chapter].map((tag) => (
                              <span key={tag} className="inline-flex items-center rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                {tag}
                              </span>
                            ))}
                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold ${String(difficultyLabel10(entry.item)).includes('难') ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                              难度: {difficultyLabel10(entry.item)}
                            </span>
                          </div>
                        </div>
                        <span className="ml-1 shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                          #{entry.item.serialNo ?? entry.item.questionNo ?? entry.item.id.slice(0, 6)}
                        </span>
                      </div>

                      <div className="select-text font-sans text-xs leading-relaxed text-zinc-900 dark:text-zinc-100">
                        <QuestionMarkdownContent
                          content={stripLeadingQuestionNo(stem || '题干为空', entry.item.questionNo)}
                          figures={entry.item.figures}
                        />
                      </div>

                      {entry.item.knowledgePoints?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {entry.item.knowledgePoints.map((knowledgePoint) => (
                            <span key={knowledgePoint} className="inline-flex items-center rounded border border-zinc-200/60 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/30 dark:text-zinc-400">
                              {knowledgePoint}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className={`grid transition-all duration-300 ease-in-out ${showAnalysis ? 'mt-2 grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'}`}>
                        <div className="overflow-hidden">
                          <div className="space-y-3 rounded border-t border-zinc-200 bg-zinc-50/50 p-3 pt-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                            <div>
                              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">【答案】</span>
                              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                                <MarkdownWithInlineFigures content={answer || '暂无答案'} figures={entry.item.figures} />
                              </div>
                            </div>
                            <div>
                              <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">【解析】</span>
                              <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                                <MarkdownWithInlineFigures content={analysis || '暂无解析'} figures={entry.item.figures} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className={`mt-1 flex flex-wrap items-center justify-between gap-3 pt-3 ${showAnalysis ? '' : 'border-t border-zinc-200 dark:border-zinc-800'}`}>
                        <div className="flex items-center gap-3 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                          {date ? <span className="flex items-center gap-1"><Calendar className="size-3" />{date}</span> : null}
                          <span className="flex items-center gap-1"><BookOpen className="size-3" />{displaySource(entry.item.sourceTitle || '') || '高中数学专项试卷'}</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <label className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[10px] font-medium text-zinc-500 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                            分值
                            <input
                              type="number"
                              min="1"
                              max="100"
                              value={entry.score || ''}
                              placeholder={String(getDefaultScore(entry.item.questionType))}
                              onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                              className="w-8 border-0 bg-transparent p-0 text-center font-mono text-xs font-semibold text-zinc-800 outline-none focus:ring-0 dark:text-zinc-200"
                            />
                            分
                          </label>
                          <button type="button" onClick={() => openEditor(entry.item)} className={basketCardOutlineButtonClass}>
                            <PencilLine className="size-3.5" />编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedQuestionIds((current) => {
                              const next = new Set(current)
                              if (next.has(itemKey)) next.delete(itemKey)
                              else next.add(itemKey)
                              return next
                            })}
                            className={basketCardOutlineButtonClass}
                          >
                            {showAnalysis ? <><ChevronUp className="size-3.5" />收起解析</> : <><ChevronDown className="size-3.5" />查看解析</>}
                          </button>
                          <button type="button" onClick={() => entry.relationId && moveItem(entry.relationId, -1)} disabled={index === 0} className={basketCardOutlineButtonClass} title="上移">
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button type="button" onClick={() => entry.relationId && moveItem(entry.relationId, 1)} disabled={index === activeQuestions.length - 1} className={basketCardOutlineButtonClass} title="下移">
                            <ArrowDown className="size-3.5" />
                          </button>
                          <button type="button" onClick={() => entry.relationId && removeItem(entry.relationId)} className={basketCardDangerButtonClass}>
                            <Trash2 className="size-3.5" />移出试题篮
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </main>

        <aside className="flex w-full shrink-0 flex-col justify-between overflow-y-auto bg-white p-5 text-left xl:w-[360px] xl:border-l xl:border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="space-y-5">
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/70 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  {editingPaperId ? <FileText className="size-3.5" /> : <ShoppingBag className="size-3.5" />}
                  {editingPaperId ? '正在编辑试卷' : '试题篮 · 唯一暂存区'}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {editingPaperId ? (
                    <button type="button" onClick={backToBasket} title="返回试题篮" className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                      <ChevronLeft className="size-3" />
                      返回试题篮
                    </button>
                  ) : null}
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{active.data?.questionCount ?? 0}题</span>
                </div>
              </div>
              <div className="space-y-3 px-4 py-3.5">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">试卷大标题</span>
                  <input value={localTitle} onChange={(event) => setLocalTitle(event.target.value)} onBlur={() => localTitle !== active.data?.title && patchCollection({ title: localTitle })} className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200" placeholder="试卷" />
                </label>
                <div>
                  <button type="button" onClick={() => setShowMoreSettings((value) => !value)} className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                    <ChevronDown className={`size-3.5 transition-transform duration-200 ${showMoreSettings ? '' : '-rotate-90'}`} />
                    更多设置（副标题 · 考试时长）
                  </button>
                  {showMoreSettings ? (
                    <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">副标题与考试说明</span>
                        <textarea value={localSubtitle} onChange={(event) => setLocalSubtitle(event.target.value)} onBlur={() => localSubtitle !== (active.data?.subtitle || '') && patchCollection({ subtitle: localSubtitle })} rows={2} className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 font-sans text-xs text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200" placeholder="考试时间、分数、班级、姓名等信息栏说明" />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">考试时长（分钟）</span>
                        <input type="number" value={localTimeLimit} onChange={(event) => setLocalTimeLimit(event.target.value)} onBlur={() => Number(localTimeLimit) !== (active.data?.timeLimit || 0) && patchCollection({ timeLimit: Number(localTimeLimit || 0) })} className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200" />
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/50 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/30">
                {editingPaperId ? (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => void overwriteSavePaper()} disabled={savingPaper} className="flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-50 shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200">
                    <Save className="size-3.5" />
                    {savingPaper ? '保存中…' : '覆盖保存'}
                  </button>
                  <button type="button" onClick={() => openSaveDialog('save_as')} disabled={savingPaper || !activeQuestions.length} className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-xs transition-all hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Copy className="size-3.5" />
                    另存为新卷
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => openSaveDialog('save_clear')} disabled={savingPaper || !activeQuestions.length} className="flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-50 shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200">
                    <Save className="size-3.5" />
                    保存并清空
                  </button>
                  <button type="button" onClick={() => openSaveDialog('save_copy')} disabled={savingPaper || !activeQuestions.length} className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-xs transition-all hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Copy className="size-3.5" />
                    保存副本
                  </button>
                </div>
              )}
                <p className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                  {editingPaperId ? '题目修改已实时写入原卷；“覆盖保存”用于提交标题与考试设置。' : '保存时会创建一份独立试卷快照，试题篮是唯一暂存区。'}
                </p>
                {saveNotice ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{saveNotice}</span> : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">我的试卷</span>
                  <span className="font-mono text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">{savedPapers.length}</span>
                </div>
                {savedPapers.length ? (
                  <button type="button" onClick={openPaperLibrary} className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                    查看全部
                    <ChevronRight className="size-3" />
                  </button>
                ) : null}
              </div>
              {savedPapers.length ? (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
                  {savedPapers.map((paper) => renderPaperRow(paper, openPaper))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-[10px] leading-relaxed text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                  还没有保存的试卷。<br />整理好题目后点击上方“保存并清空”即可存档。
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/25">
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">答案及解析排版</span>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'student', icon: EyeOff, label: '不显示', desc: '学生版' },
                  { value: 'teacher', icon: BookOpen, label: '详尽解析', desc: '教师版' },
                  { value: 'error_notebook', icon: NotebookPen, label: '错题本', desc: '紧凑排版' },
                ] as const).map((option) => {
                  const selected = pageVariant === option.value
                  const Icon = option.icon
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPageVariant(option.value)}
                      className={`flex flex-col items-center gap-1 p-2.5 border rounded-lg transition-all duration-150 active:scale-[0.98] ${selected ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800'}`}
                    >
                      <Icon className={`size-5 ${selected ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500'}`} />
                      <span className={`text-[10px] leading-tight ${selected ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>{option.label}</span>
                      <span className="text-[9px] leading-tight text-zinc-400 dark:text-zinc-500">{option.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">输出目标格式</span>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={() => setPageExportFormat('Markdown')} className={`flex flex-col items-center gap-1.5 p-2.5 border rounded-lg transition-colors ${pageExportFormat === 'Markdown' ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60 font-semibold' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800'}`}>
                  <FileCode2 className={`size-5 ${pageExportFormat === 'Markdown' ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}`} />
                  <span className="text-[10px]">Markdown (.md)</span>
                </button>
                <button type="button" onClick={() => setPageExportFormat('PDF')} className={`flex flex-col items-center gap-1.5 p-2.5 border rounded-lg transition-colors ${pageExportFormat === 'PDF' ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60 font-semibold' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800'}`}>
                  <FileText className={`size-5 ${pageExportFormat === 'PDF' ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}`} />
                  <span className="text-[10px]">PDF 电子卷</span>
                </button>
                <button type="button" onClick={() => setPageExportFormat('LaTeX')} className={`flex flex-col items-center gap-1.5 p-2.5 border rounded-lg transition-colors ${pageExportFormat === 'LaTeX' ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60 font-semibold' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800'}`}>
                  <FileCode2 className={`size-5 ${pageExportFormat === 'LaTeX' ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}`} />
                  <span className="text-[10px]">LaTeX 源码</span>
                </button>
              </div>
            </div>

              <div className="grid grid-cols-3 divide-x divide-zinc-200/80 border-t border-zinc-200/80 pt-3 dark:divide-zinc-800 dark:border-zinc-800">
                <div className="px-1 text-center">
                  <span className="block text-sm font-bold text-zinc-800 dark:text-zinc-200">{active.data?.questionCount ?? 0}</span>
                  <span className="block text-[9px] text-zinc-400 dark:text-zinc-500">试题数</span>
                </div>
                <div className="px-1 text-center">
                  <span className="block font-mono text-sm font-bold text-zinc-800 dark:text-zinc-200">{totalScore}</span>
                  <span className="block text-[9px] text-zinc-400 dark:text-zinc-500">估算总分</span>
                </div>
                <div className="px-1 text-center">
                  <span className="block text-sm font-bold text-zinc-800 dark:text-zinc-200">{localTimeLimit || '-'}</span>
                  <span className="block text-[9px] text-zinc-400 dark:text-zinc-500">时长（分）</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
            {layoutDrafts.data?.items[0] ? <button
              onClick={() => navigate(`/questions/collections/${encodeURIComponent(activeId)}/layout-drafts/${encodeURIComponent(layoutDrafts.data!.items[0].id)}`)}
              className="mb-2 w-full text-xs text-zinc-600 underline underline-offset-2 dark:text-zinc-400"
            >继续上次排版：{layoutDrafts.data.items[0].name}</button> : null}
            <button
              onClick={() => void createLayoutDraft()}
              disabled={exporting || !active.data?.questionCount || pageVariant === 'error_notebook'}
              title={pageVariant === 'error_notebook' ? '错题本使用固定紧凑版式，可直接导出。' : undefined}
              className="mb-2 w-full flex items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white py-2.5 text-xs font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <Settings2 className="size-3.5" />
              排版并预览
            </button>
            <button
              onClick={() => exportCollection(pageExportFormat === 'Markdown' ? 'markdown' : pageExportFormat === 'LaTeX' ? 'latex' : 'pdf', pageVariant, 'exam')}
              disabled={exporting}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-50 text-xs font-semibold py-2.5 transition-colors disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 shadow-sm"
            >
              <FileDown className="size-3.5" />
              确认无误，导出试卷文档
            </button>
          </div>
        </aside>
        {editingItem ? <EditDialog draft={editDraft} setDraft={setEditDraft} onClose={() => setEditingItem(null)} onSave={saveEditedQuestion} /> : null}
        {paperSaveAction ? (
          <Modal
            title={paperSaveAction === 'save_as' ? '另存为新卷' : '保存为试卷'}
            desc="将当前题目保存为一份独立试卷，可随时在“我的试卷”中打开、修改或导出。"
            onClose={closeSaveDialog}
          >
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">试卷标题</span>
                <input
                  autoFocus
                  value={paperTitleInput}
                  onChange={(event) => setPaperTitleInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void confirmSavePaper() }}
                  placeholder="请输入试卷标题"
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200"
                />
              </label>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {paperSaveAction === 'save_clear'
                  ? '保存后试题篮将被清空，题目保留在这份试卷中，可随时从“我的试卷”重新打开。'
                  : paperSaveAction === 'save_copy'
                    ? '保存后试题篮中的题目保持不变，相当于为当前题目创建一份快照。'
                    : '将以当前试卷的题目创建一份新试卷，原试卷保持不变。'}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={closeSaveDialog} disabled={savingPaper}>取消</Button>
                <Button size="sm" onClick={() => void confirmSavePaper()} disabled={savingPaper || !paperTitleInput.trim()}>
                  {savingPaper ? '保存中…' : '保存试卷'}
                </Button>
              </div>
            </div>
          </Modal>
        ) : null}
        {showPaperLibrary ? (
          <Modal
            wide
            title="我的试卷"
            desc={`共 ${savedPapers.length} 份试卷${paperSearch.trim() ? `，匹配 ${filteredPapers.length} 份` : ''}，点击任意一份即可打开编辑。`}
            onClose={() => setShowPaperLibrary(false)}
          >
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                <input
                  autoFocus
                  value={paperSearch}
                  onChange={(event) => { setPaperSearch(event.target.value); setPaperPage(1) }}
                  placeholder="搜索试卷标题…"
                  className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200"
                />
              </div>

              {pagedPapers.length ? (
                <div className="space-y-2">
                  {pagedPapers.map((paper) => renderPaperRow(paper, (paperId) => { openPaper(paperId); setShowPaperLibrary(false) }))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                  未找到匹配「{paperSearch.trim()}」的试卷
                </div>
              )}

              <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-900">
                <span className="text-xs text-zinc-400 dark:text-zinc-500">第 {safePaperPage} / {totalPaperPages} 页 · 共 {filteredPapers.length} 份</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPaperPage(safePaperPage - 1)} disabled={safePaperPage <= 1}>上一页</Button>
                  <Button variant="outline" size="sm" onClick={() => setPaperPage(safePaperPage + 1)} disabled={safePaperPage >= totalPaperPages}>下一页</Button>
                </div>
              </div>
            </div>
          </Modal>
        ) : null}
      </div>
    )
  }

  // Render Drawer Mode
  return (
    <>
      {/* Background Backdrop Overlay */}
      {!collapsed && (
        <div
          onClick={() => setCollapsed(true)}
          className="fixed inset-0 z-40 bg-zinc-950/20 dark:bg-black/40 backdrop-blur-sm transition-opacity duration-300 opacity-100"
        />
      )}

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed right-0 top-1/2 -translate-y-1/2 bg-white dark:bg-zinc-900 border border-r-0 border-zinc-200 dark:border-zinc-800 shadow-xl hover:shadow-2xl rounded-l-2xl px-2.5 py-4 flex flex-col items-center gap-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all z-40 group cursor-pointer animate-in slide-in-from-right duration-250"
          title="展开试题篮"
        >
          <div className="relative">
            <ShoppingBag className="w-5 h-5 group-hover:scale-110 transition-transform" />
            {active.data?.questionCount ? (
              <span className="absolute -top-1.5 -right-2 w-[18px] h-[18px] bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
                {active.data.questionCount}
              </span>
            ) : null}
          </div>
          <div
            className="text-[11px] font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors"
            style={{ writingMode: 'vertical-rl' }}
          >
            试题篮
          </div>
        </button>
      )}

      <aside
        className={`fixed right-0 top-0 bottom-0 w-full sm:w-[440px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          collapsed ? 'translate-x-full' : 'translate-x-0'
        }`}
      >
        {/* Drawer Header */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 z-20 shrink-0">
          <div className="flex items-center gap-2.5 select-none">
            <div className="p-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <span className="font-bold text-zinc-800 dark:text-zinc-200 text-sm">试题篮工作台</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              title="全屏独立编辑"
              onClick={() => {
                setCollapsed(true)
                navigate('/questions/basket')
              }}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1"></div>
            <button
              className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              onClick={() => setCollapsed(true)}
              title="收起抽屉"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col relative bg-zinc-50/30 dark:bg-zinc-950/30 min-h-0">
          {/* Sticky Context Actions */}
          <div className="sticky top-0 z-10 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 p-4 space-y-3 shrink-0">
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-950/40 px-3 py-2">
              <ShoppingBag className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">试题篮</span>
              <span className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">唯一暂存区 · “加入试题篮”的题目都到这里</span>
            </div>

            {/* Editable Title/Subtitle Row in Drawer */}
            <div className="flex items-center justify-between gap-1.5 min-w-0 pt-1">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <input
                  className="w-1/2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2 py-1 text-xs font-semibold text-zinc-800 dark:text-zinc-200 focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 outline-none min-w-0"
                  value={localTitle}
                  onChange={(event) => setLocalTitle(event.target.value)}
                  onBlur={() => localTitle !== active.data?.title && patchCollection({ title: localTitle })}
                  placeholder="试卷标题"
                />
                <span className="text-zinc-300 dark:text-zinc-700 select-none shrink-0 font-medium text-xs">/</span>
                <input
                  className="w-1/2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 outline-none min-w-0"
                  value={localSubtitle}
                  onChange={(event) => setLocalSubtitle(event.target.value)}
                  onBlur={() => localSubtitle !== (active.data?.subtitle || '') && patchCollection({ subtitle: localSubtitle })}
                  placeholder="副标题..."
                />
              </div>
              {active.data?.questions.length ? (
                <button
                  onClick={clearCollection}
                  className="text-[10px] font-bold text-destructive hover:bg-destructive/10 hover:text-destructive px-2 py-1 rounded-md transition-colors cursor-pointer shrink-0 select-none border border-transparent hover:border-destructive/20"
                  title="清空所有题目"
                >
                  清空
                </button>
              ) : null}
            </div>

            {/* Stats Cards Row */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-zinc-50/40 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2 flex flex-col justify-center select-none">
                <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 mb-0.5">
                  <Hash className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">题数</span>
                </div>
                <div className="font-bold text-base text-zinc-900 dark:text-zinc-100 leading-none">{active.data?.questionCount ?? 0}</div>
              </div>
              <div className="bg-zinc-50/40 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2 flex flex-col justify-center select-none">
                <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 mb-0.5">
                  <Award className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">总分</span>
                </div>
                <div className="font-bold text-base text-zinc-900 dark:text-zinc-100 leading-none">{totalScore}</div>
              </div>
              <div className="bg-zinc-50/40 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2 flex flex-col justify-center focus-within:ring-1 ring-zinc-400 dark:ring-zinc-600 transition-all">
                <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 mb-0.5 select-none">
                  <Clock className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">时长(分)</span>
                </div>
                <input
                  type="number"
                  value={localTimeLimit}
                  onChange={(event) => setLocalTimeLimit(event.target.value)}
                  onBlur={() => Number(localTimeLimit) !== (active.data?.timeLimit || 0) && patchCollection({ timeLimit: Number(localTimeLimit || 0) })}
                  className="w-full bg-transparent font-bold text-base text-zinc-900 dark:text-zinc-100 leading-none outline-none p-0 border-none focus:ring-0"
                  placeholder="-"
                />
              </div>
            </div>
          </div>

          {/* Items List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-28">
            {active.loading && !active.data ? (
              <Empty text="读取中..." />
            ) : active.error ? (
              <Empty text={active.error} />
            ) : !activeQuestions.length ? (
              <Empty text="还没有题目。在题库中点击“加入试题篮”即可加入。" />
            ) : (
              activeQuestions.map((entry, index) => (
                <div key={entry.relationId || entry.item.id} className="space-y-2">
                  {entry.sectionName ? (
                    <div className="flex items-center gap-3 py-1 select-none">
                      <div className="h-px flex-1 bg-border/60"></div>
                      <div className="px-3 py-1 rounded-full border border-border bg-card text-[10px] font-bold text-muted-foreground shadow-sm">
                        {entry.sectionName}
                      </div>
                      <div className="h-px flex-1 bg-border/60"></div>
                    </div>
                  ) : null}

                  <div
                    draggable
                    onDragStart={(e) => {
                      setDraggedIndex(index)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                    }}
                    onDrop={async (e) => {
                      e.preventDefault()
                      if (draggedIndex === null || draggedIndex === index) return

                      const questions = active.data?.questions ?? []
                      const next = [...questions]
                      const [item] = next.splice(draggedIndex, 1)
                      next.splice(index, 0, item)

                      await collectionsApi.reorder(activeId, next.map((entry, order) => ({ relationId: entry.relationId, sortOrder: order })))
                      notifyBasketUpdated()
                      setDraggedIndex(null)
                    }}
                    onDragEnd={() => setDraggedIndex(null)}
                    className={`group bg-card rounded-lg border border-border p-3.5 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden flex gap-3 cursor-grab active:cursor-grabbing ${
                      draggedIndex === index ? 'opacity-40 border-dashed border-border bg-muted/30' : ''
                    }`}
                  >
                    {/* Left vertical marker line on hover */}
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-transparent group-hover:bg-zinc-900 dark:group-hover:bg-zinc-100 transition-colors"></div>

                    {/* Grab handle indicator */}
                    <div className="mt-0.5 text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors shrink-0 select-none">
                      <GripVertical className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-3">
                      <div className="flex items-start gap-1.5">
                        <span className="font-semibold text-muted-foreground/70 text-xs mt-0.5 shrink-0">{index + 1}.</span>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <QuestionMarkdownContent
                            content={stripLeadingQuestionNo(entry.item.stemMarkdown || '未命名题目', entry.item.questionNo)}
                            className="line-clamp-2 text-xs text-foreground leading-relaxed font-medium pointer-events-none select-none overflow-hidden max-w-full"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/60 pt-2.5 w-full">
                        <div className="flex items-center gap-2">
                          {entry.item.questionType && (
                            <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-medium border border-border select-none">
                              {entry.item.questionType}
                            </span>
                          )}

                          {entry.item.difficultyLabel && (
                            <Badge
                              variant={
                                entry.item.difficultyLabel.includes('难')
                                  ? 'danger'
                                  : entry.item.difficultyLabel.includes('中') || entry.item.difficultyLabel.includes('较')
                                    ? 'warning'
                                    : 'success'
                              }
                              className="rounded px-1.5 py-0.5"
                            >
                              {entry.item.difficultyLabel}
                            </Badge>
                          )}

                          <div className="flex items-center gap-1 border border-input rounded-md px-1.5 py-0.5 bg-background focus-within:border-ring transition-colors">
                            <input
                              type="number"
                              value={entry.score || ''}
                              placeholder={String(getDefaultScore(entry.item.questionType))}
                              onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                              className="w-8 text-center text-xs font-bold outline-none text-foreground bg-transparent border-none p-0 focus:ring-0"
                            />
                            <span className="text-[10px] text-muted-foreground select-none">分</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 bg-muted border border-border rounded-md p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => entry.relationId && moveItem(entry.relationId, -1)}
                            disabled={index === 0}
                            className="p-1 text-muted-foreground hover:bg-background hover:text-foreground rounded transition-colors disabled:opacity-20 cursor-pointer"
                            title="上移"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => entry.relationId && moveItem(entry.relationId, 1)}
                            disabled={index === activeQuestions.length - 1}
                            className="p-1 text-muted-foreground hover:bg-background hover:text-foreground rounded transition-colors disabled:opacity-20 cursor-pointer"
                            title="下移"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <div className="w-px h-3 bg-border mx-0.5 my-auto"></div>
                          <button
                            onClick={() => entry.relationId && removeItem(entry.relationId)}
                            className="p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded transition-colors cursor-pointer"
                            title="移除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Drawer Footer (Export Dropdown Menu) */}
        {active.data?.questions.length ? (
          <div className="p-4 bg-card/95 backdrop-blur-md border-t border-border absolute bottom-0 left-0 right-0 z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
            <button
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              disabled={exporting}
              className="w-full py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 font-semibold rounded-md shadow-sm transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? '正在生成...' : '导出练习单'}</span>
              <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-200 ${exportMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-4 left-4 bottom-16 z-40 rounded-lg border border-border bg-popover text-popover-foreground p-2 shadow-md animate-in fade-in slide-in-from-bottom-1 duration-150">
                  <div className="p-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 select-none font-medium">
                      Markdown 格式
                    </p>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <button
                        onClick={() => {
                          exportCollection('markdown', 'student')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"
                      >
                        <span>学生版</span>
                      </button>
                      <button
                        onClick={() => {
                          exportCollection('markdown', 'teacher')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"
                      >
                        <span>教师版</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-1 border-t border-border mt-1 font-medium">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 select-none font-semibold">试卷 PDF</p>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <button onClick={() => { exportCollection('pdf', 'student', 'exam'); setExportMenuOpen(false) }} className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"><span>学生版</span></button>
                      <button onClick={() => { exportCollection('pdf', 'teacher', 'exam'); setExportMenuOpen(false) }} className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"><span>教师版</span></button>
                    </div>
                  </div>

                  <div className="p-1 border-t border-border mt-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 select-none font-medium">
                      练习单 PDF
                    </p>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <button
                        onClick={() => {
                          exportCollection('pdf', 'student', 'worksheet')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"
                      >
                        <span>学生版</span>
                      </button>
                      <button
                        onClick={() => {
                          exportCollection('pdf', 'teacher', 'worksheet')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border cursor-pointer"
                      >
                        <span>教师版</span>
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
      </aside>
    </>
  )
}
