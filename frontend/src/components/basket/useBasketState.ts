import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { collectionsApi } from '../../api/collections'
import { layoutDraftsApi } from '../../api/layoutDrafts'
import { questionBankApi } from '../../api/questionBank'
import { useAsync } from '../../hooks/useAsync'
import type { Basket, CollectionSummary, QuestionItem } from '../../types'
import { basketUpdatedEvent, DEFAULT_BASKET_ID, getDefaultScore, notifyBasketUpdated } from './constants'

export function useBasketState(options?: { initialPaperId?: string | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(true)
  const [editingPaperId, setEditingPaperId] = useState<string | null>(options?.initialPaperId ?? null)
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

  async function handleDragDrop(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const questions = active.data?.questions ?? []
    const next = [...questions]
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    await collectionsApi.reorder(activeId, next.map((entry, order) => ({ relationId: entry.relationId, sortOrder: order })))
    notifyBasketUpdated()
    setDraggedIndex(null)
  }

  const isBasketPage = location.pathname === '/questions/basket' || location.pathname === '/mock/basket'

  return {
    navigate,
    collapsed, setCollapsed,
    editingPaperId, activeId,
    exportMenuOpen, setExportMenuOpen,
    exporting,
    draggedIndex, setDraggedIndex,
    localTitle, setLocalTitle,
    localSubtitle, setLocalSubtitle,
    localTimeLimit, setLocalTimeLimit,
    pageExportFormat, setPageExportFormat,
    pageVariant, setPageVariant,
    expandedQuestionIds, setExpandedQuestionIds,
    editingItem, setEditingItem,
    editDraft, setEditDraft,
    paperSaveAction,
    paperTitleInput, setPaperTitleInput,
    savingPaper,
    saveNotice,
    showMoreSettings, setShowMoreSettings,
    collections, active, layoutDrafts,
    totalScore, activeQuestions, allExpanded,
    savedPapers,
    isBasketPage,
    toggleExpandAll,
    openPaper, backToBasket, deletePaper,
    openSaveDialog, closeSaveDialog, confirmSavePaper, overwriteSavePaper,
    patchCollection, patchItem, removeItem, clearCollection, moveItem,
    openEditor, saveEditedQuestion,
    exportCollection, createLayoutDraft,
    handleDragDrop,
  }
}

export type BasketState = ReturnType<typeof useBasketState>
