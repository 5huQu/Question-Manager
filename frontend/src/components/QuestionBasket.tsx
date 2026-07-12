import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Download, FilePlus2, GripVertical, Trash2, ChevronUp, ShoppingBag, Award, Clock, Hash, Maximize2, ArrowUp, ArrowDown, ListChecks, Settings2, FileDown, FileText, FileCode2, Sparkles, HelpCircle } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { collectionsApi } from '../api/collections'
import { layoutDraftsApi } from '../api/layoutDrafts'
import { useAsync } from '../hooks/useAsync'
import type { Basket, CollectionExport, CollectionSummary, QuestionItem, BasketQuestion } from '../types'
import { Button, Empty, Badge } from './ui'
import { QuestionMarkdownContent } from './questions/QuestionContent'

const activeBasketStorageKey = 'question-manager.activeCollectionId'
export const basketUpdatedEvent = 'question-basket-updated'

export function getActiveCollectionId() {
  return localStorage.getItem(activeBasketStorageKey) || 'basket'
}

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
  const [activeId, setActiveId] = useState(getActiveCollectionId)
  const [newTitle, setNewTitle] = useState('')
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [localTitle, setLocalTitle] = useState('')
  const [localSubtitle, setLocalSubtitle] = useState('')
  const [localTimeLimit, setLocalTimeLimit] = useState<string | number>('')
  const [pageExportFormat, setPageExportFormat] = useState<'Markdown' | 'PDF'>('Markdown')
  const [pageVariant, setPageVariant] = useState<'student' | 'teacher'>('teacher')

  const collections = useAsync<{ items: CollectionSummary[] }>(() => {
    return collectionsApi.listCollections()
  }, [])

  const active = useAsync<Basket>(() => {
    return collectionsApi.getCollection(activeId)
  }, [activeId])
  const layoutDrafts = useAsync(() => layoutDraftsApi.list(activeId), [activeId])

  useEffect(() => {
    if (active.data) {
      setLocalTitle(active.data.title || '')
      setLocalSubtitle(active.data.subtitle || '')
      setLocalTimeLimit(active.data.timeLimit || '')
    }
  }, [active.data])

  useEffect(() => {
    localStorage.setItem(activeBasketStorageKey, activeId)
  }, [activeId])

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

  async function createPaper() {
    const title = newTitle.trim() || `试卷 ${new Date().toLocaleDateString()}`
    const created = await collectionsApi.createCollection({ title, kind: 'paper' })
    setNewTitle('')
    setActiveId(created.id)
    collections.reload()
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
    if (!window.confirm('确定要清空当前试卷/试题篮中的所有题目吗？')) return
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

  async function exportCollection(format: 'markdown' | 'pdf', variant: 'student' | 'teacher', template: 'worksheet' | 'exam' = 'worksheet') {

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
      <div className="mock-page-root flex h-[calc(100vh-6rem)] overflow-hidden bg-zinc-50/20 dark:bg-zinc-950 relative select-none">
        <main className="flex-1 flex flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/10">
          <div className="h-12 shrink-0 border-b border-zinc-200 bg-white flex items-center justify-between px-4 dark:bg-zinc-900 dark:border-zinc-800">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              试题大纲与分值分配 ({active.data?.questions.length ?? 0} 道试题)
            </span>
            <div className="flex items-center gap-2">
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
                {active.data.questions.map((entry, index) => (
                  <div
                    key={entry.relationId || entry.item.id}
                    draggable
                    onDragStart={(event) => {
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
                    className={`border border-zinc-200 bg-white rounded-lg p-4 dark:border-zinc-800 dark:bg-zinc-900/30 flex items-start gap-4 text-left group hover:border-zinc-300 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-grab active:cursor-grabbing ${draggedIndex === index ? 'opacity-40 border-dashed border-zinc-400 bg-zinc-50 dark:bg-zinc-900/10' : ''}`}
                  >
                    <div className="flex flex-col items-center gap-1.5 pt-0.5 shrink-0 select-none">
                      <span className="flex size-6 items-center justify-center rounded bg-zinc-900 text-xs font-mono font-bold text-white dark:bg-zinc-100 dark:text-zinc-950">
                        {index + 1}
                      </span>
                      <div className="text-zinc-300 dark:text-zinc-700 mt-2 opacity-50 group-hover:opacity-100 transition-opacity">
                        <GripVertical className="size-4" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                        <span>{entry.item.questionType} · {entry.item.chapter || '未分类'} · {entry.item.difficultyLabel || '难度待定'}</span>
                        <span>ID: #{entry.item.id}</span>
                      </div>
                      <div className="text-xs text-zinc-900 dark:text-zinc-100 leading-relaxed font-sans max-h-24 overflow-hidden text-ellipsis cursor-pointer" onClick={() => navigate(`/questions/${encodeURIComponent(entry.item.id)}`)}>
                        <QuestionMarkdownContent content={stripLeadingQuestionNo(entry.item.stemMarkdown || '未命名题目', entry.item.questionNo)} />
                      </div>
                      <div className="flex items-center justify-between pt-2.5 border-t border-zinc-100 dark:border-zinc-800 mt-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">设定分值:</span>
                          <div className="flex items-center border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-1 py-0.5">
                            <input
                              type="number"
                              min="1"
                              max="100"
                              value={entry.score || ''}
                              placeholder={String(getDefaultScore(entry.item.questionType))}
                              onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                              className="w-10 border-none bg-transparent text-center font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200 focus:ring-0 p-0 outline-none"
                            />
                            <span className="text-[9px] text-zinc-400 font-medium px-1">分</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => entry.relationId && moveItem(entry.relationId, -1)} disabled={index === 0} className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-20 dark:hover:bg-zinc-800" title="上移">
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button onClick={() => entry.relationId && moveItem(entry.relationId, 1)} disabled={index === activeQuestions.length - 1} className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 disabled:opacity-20 dark:hover:bg-zinc-800" title="下移">
                            <ArrowDown className="size-3.5" />
                          </button>
                          <button onClick={() => entry.relationId && removeItem(entry.relationId)} className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors" title="从试题篮移出">
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>

        <aside className="w-[360px] shrink-0 border-l border-zinc-200 bg-white p-5 flex flex-col justify-between overflow-y-auto dark:border-zinc-800 dark:bg-zinc-950 text-left">
          <div className="space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
              <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
                <Settings2 className="size-3.5" />
                组卷输出参数
              </span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">配置参数</span>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">当前试卷</span>
              <select className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-200" value={activeId} onChange={(event) => setActiveId(event.target.value)}>
                {(collections.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.title} ({item.questionCount}题)</option>)}
              </select>
            </label>

            {showCreateInput ? (
              <div className="flex gap-2">
                <input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} className="min-w-0 flex-1 text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 outline-none" placeholder="输入试卷名称" />
                <button type="button" onClick={() => { createPaper(); setShowCreateInput(false) }} className="rounded bg-zinc-900 px-3 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">确定</button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowCreateInput(true)} className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <FilePlus2 className="size-3.5" />
                新建试卷
              </button>
            )}

            <label className="space-y-1.5 block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">试卷大标题 (Header)</span>
              <input value={localTitle} onChange={(event) => setLocalTitle(event.target.value)} onBlur={() => localTitle !== active.data?.title && patchCollection({ title: localTitle })} className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-200" placeholder="请输入试卷标题" />
            </label>

            <label className="space-y-1.5 block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">副标题与考试说明 (Info block)</span>
              <textarea value={localSubtitle} onChange={(event) => setLocalSubtitle(event.target.value)} onBlur={() => localSubtitle !== (active.data?.subtitle || '') && patchCollection({ subtitle: localSubtitle })} rows={2} className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-200 resize-none font-sans" placeholder="考试时间、分数、班级、姓名等信息栏说明" />
            </label>

            <label className="space-y-1.5 block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">考试时长 (分钟)</span>
              <input type="number" value={localTimeLimit} onChange={(event) => setLocalTimeLimit(event.target.value)} onBlur={() => Number(localTimeLimit) !== (active.data?.timeLimit || 0) && patchCollection({ timeLimit: Number(localTimeLimit || 0) })} className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-900 dark:focus:border-zinc-200" />
            </label>

            <label className="space-y-1.5 block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">答案及解析排版</span>
              <select value={pageVariant} onChange={(event) => setPageVariant(event.target.value as 'student' | 'teacher')} className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200 outline-none cursor-pointer">
                <option value="student">不显示 (学生版)</option>
                <option value="teacher">显示详尽解析 (教师版)</option>
              </select>
            </label>

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
                <button type="button" disabled className="flex flex-col items-center gap-1.5 p-2.5 border rounded-lg border-zinc-200 bg-zinc-50 text-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <FileCode2 className="size-5" />
                  <span className="text-[10px]">LaTeX 源码</span>
                </button>
              </div>
            </div>

            <div className="border border-zinc-200 bg-zinc-50/50 p-4 rounded-lg dark:border-zinc-800 dark:bg-zinc-900/20 text-xs space-y-2">
              <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                <Sparkles className="size-3 text-zinc-400" />
                试卷质量审查
              </h4>
              <div className="flex items-center justify-between text-zinc-500"><span>试题数量:</span><span className="font-bold text-zinc-800 dark:text-zinc-200">{active.data?.questionCount ?? 0} 道</span></div>
              <div className="flex items-center justify-between text-zinc-500"><span>估算总分:</span><span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">{totalScore} 分</span></div>
              <div className="flex items-center justify-between text-zinc-500"><span>考试时长:</span><span className="font-semibold text-zinc-800 dark:text-zinc-200">{localTimeLimit || '-'} 分钟</span></div>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
            {layoutDrafts.data?.items[0] ? <button
              onClick={() => navigate(`/questions/collections/${encodeURIComponent(activeId)}/layout-drafts/${encodeURIComponent(layoutDrafts.data!.items[0].id)}`)}
              className="mb-2 w-full text-xs text-zinc-600 underline underline-offset-2 dark:text-zinc-400"
            >继续上次排版：{layoutDrafts.data.items[0].name}</button> : null}
            <button
              onClick={() => void createLayoutDraft()}
              disabled={exporting || !active.data?.questionCount}
              className="mb-2 w-full flex items-center justify-center gap-1.5 rounded-md border border-zinc-300 bg-white py-2.5 text-xs font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <Settings2 className="size-3.5" />
              排版并预览
            </button>
            <button
              onClick={() => exportCollection(pageExportFormat === 'Markdown' ? 'markdown' : 'pdf', pageVariant, 'exam')}
              disabled={exporting}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-50 text-xs font-semibold py-2.5 transition-colors disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 shadow-sm"
            >
              <FileDown className="size-3.5" />
              确认无误，导出试卷文档
            </button>
          </div>
        </aside>
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
            {showCreateInput ? (
              <div className="flex gap-2 relative">
                <input
                  autoFocus
                  className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 outline-none transition-all"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      createPaper()
                      setShowCreateInput(false)
                    } else if (e.key === 'Escape') {
                      setShowCreateInput(false)
                    }
                  }}
                  placeholder="输入试卷名称，回车保存..."
                />
                <button
                  onClick={() => {
                    createPaper()
                    setShowCreateInput(false)
                  }}
                  className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 rounded-xl text-xs font-semibold transition-all shadow-sm cursor-pointer"
                >
                  确定
                </button>
                <button
                  onClick={() => setShowCreateInput(false)}
                  className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 hover:bg-zinc-100 rounded-xl text-xs transition-all cursor-pointer"
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="flex gap-2 relative">
                <div className="relative flex-1">
                  <select
                    className="w-full appearance-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 pl-3 pr-8 py-2 text-sm text-zinc-800 dark:text-zinc-200 font-semibold focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 outline-none transition-all cursor-pointer"
                    value={activeId}
                    onChange={(event) => setActiveId(event.target.value)}
                  >
                    {(collections.data?.items ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} ({item.questionCount}题)
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>
                <button
                  className="p-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-all shadow-sm shrink-0 cursor-pointer"
                  title="新建试卷"
                  onClick={() => setShowCreateInput(true)}
                >
                  <FilePlus2 className="w-5 h-5" />
                </button>
              </div>
            )}

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
              <Empty text="还没有题目。在题库中点击“加入试题篮”即可加入当前试卷。" />
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
                      <div
                        className="flex items-start gap-1.5 cursor-pointer hover:opacity-85 transition-opacity"
                        onClick={() => {
                          setCollapsed(true)
                          navigate(`/questions/${encodeURIComponent(entry.item.id)}`)
                        }}
                      >
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
