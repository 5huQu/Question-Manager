import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Download, FilePlus2, GripVertical, Trash2, ChevronUp, ShoppingBag, Award, Clock, Hash, Maximize2, ArrowUp, ArrowDown, ListChecks } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api, jsonHeaders } from '../api/client'
import { useAsync } from '../hooks/useAsync'
import type { Basket, CollectionExport, CollectionSummary } from '../types'
import { Button, Empty } from './ui'
import { QuestionMarkdownContent } from './questions/QuestionContent'

const activeBasketStorageKey = 'question-manager.activeCollectionId'
export const basketUpdatedEvent = 'question-basket-updated'

export function getActiveCollectionId() {
  return localStorage.getItem(activeBasketStorageKey) || 'basket'
}

export function notifyBasketUpdated() {
  window.dispatchEvent(new Event(basketUpdatedEvent))
}

function stripLeadingQuestionNo(value: string, questionNo = '') {
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

  const collections = useAsync<{ items: CollectionSummary[] }>(() => api('/api/question-bank/collections'), [])
  const active = useAsync<Basket>(() => api(`/api/question-bank/collections/${encodeURIComponent(activeId)}`), [activeId])

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
    return () => window.removeEventListener(basketUpdatedEvent, refresh)
  }, [collections.reload, active.reload])

  const totalScore = useMemo(() => {
    return active.data?.questions.reduce((sum, entry) => {
      const score = entry.score || getDefaultScore(entry.item.questionType)
      return sum + Number(score)
    }, 0) ?? 0
  }, [active.data])

  async function createPaper() {
    const title = newTitle.trim() || `试卷 ${new Date().toLocaleDateString()}`
    const created = await api<Basket>('/api/question-bank/collections', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ title, kind: 'paper' }),
    })
    setNewTitle('')
    setActiveId(created.id)
    collections.reload()
  }

  async function patchCollection(patch: Record<string, unknown>) {
    await api(`/api/question-bank/collections/${encodeURIComponent(activeId)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(patch),
    })
    collections.reload()
    active.reload()
  }

  async function patchItem(relationId: string, patch: Record<string, unknown>) {
    await api(`/api/question-bank/collections/${encodeURIComponent(activeId)}/items/${encodeURIComponent(relationId)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(patch),
    })
    notifyBasketUpdated()
  }

  async function removeItem(relationId: string) {
    await api(`/api/question-bank/collections/${encodeURIComponent(activeId)}/items/${encodeURIComponent(relationId)}`, { method: 'DELETE' })
    notifyBasketUpdated()
  }

  async function clearCollection() {
    if (!window.confirm('确定要清空当前试卷/试题篮中的所有题目吗？')) return
    await api(`/api/question-bank/collections/${encodeURIComponent(activeId)}/items`, { method: 'DELETE' })
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
    await api(`/api/question-bank/collections/${encodeURIComponent(activeId)}/reorder`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ items: next.map((entry, order) => ({ relationId: entry.relationId, sortOrder: order })) }),
    })
    notifyBasketUpdated()
  }

  async function exportCollection(format: 'markdown' | 'pdf', variant: 'student' | 'teacher') {
    if (format === 'markdown') {
      setCollapsed(true)
      navigate(`/questions/collections/${encodeURIComponent(activeId)}/markdown-preview?variant=${variant}`)
      return
    }
    if (exporting) return
    setExporting(true)
    try {
      const payload = await api<CollectionExport>(`/api/question-bank/collections/${encodeURIComponent(activeId)}/export`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ format, variant }),
      })
      const link = document.createElement('a')
      if (payload.format === 'pdf' && payload.url) {
        link.href = payload.url
        link.download = payload.filename
        link.click()
        return
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  // Hide the floating drawer globally if we are on the dedicated basket page
  if (mode === 'drawer' && location.pathname === '/questions/basket') {
    return null
  }

  // Render Page Mode
  if (mode === 'page') {
    return (
      <div className="flex-1 overflow-auto p-4 md:p-8 bg-zinc-50/50 dark:bg-zinc-950/50">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Page Header & Stats */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1 space-y-5 w-full">
              <div>
                <input
                  type="text"
                  value={localTitle}
                  onChange={(event) => setLocalTitle(event.target.value)}
                  onBlur={() => localTitle !== active.data?.title && patchCollection({ title: localTitle })}
                  className="text-2xl font-bold bg-transparent border-none outline-none w-full text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-blue-105 dark:focus:ring-blue-900/30 rounded-lg px-2 py-1 -ml-2 transition-all"
                  placeholder="试卷标题"
                />
                <input
                  type="text"
                  value={localSubtitle}
                  onChange={(event) => setLocalSubtitle(event.target.value)}
                  onBlur={() => localSubtitle !== (active.data?.subtitle || '') && patchCollection({ subtitle: localSubtitle })}
                  className="text-sm bg-transparent border-none outline-none w-full text-zinc-500 dark:text-zinc-400 placeholder-zinc-400 mt-1 focus:ring-2 focus:ring-blue-105 dark:focus:ring-blue-900/30 rounded-md px-2 py-1 -ml-2 transition-all"
                  placeholder="添加副标题..."
                />
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="px-4 py-2.5 bg-blue-50/50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-400 rounded-xl border border-blue-100/50 dark:border-blue-800/30 flex items-center gap-3 select-none">
                  <div className="p-2 bg-white dark:bg-blue-950 rounded-lg shadow-sm text-blue-600 dark:text-blue-500"><Hash className="w-4 h-4" /></div>
                  <div>
                    <div className="text-xs font-medium opacity-80">题数</div>
                    <div className="font-bold text-lg leading-none mt-0.5">{active.data?.questionCount ?? 0}</div>
                  </div>
                </div>

                <div className="px-4 py-2.5 bg-amber-50/50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400 rounded-xl border border-amber-100/50 dark:border-amber-800/30 flex items-center gap-3 select-none">
                  <div className="p-2 bg-white dark:bg-amber-950 rounded-lg shadow-sm text-amber-600 dark:text-amber-500"><Award className="w-4 h-4" /></div>
                  <div>
                    <div className="text-xs font-medium opacity-80">总分</div>
                    <div className="font-bold text-lg leading-none mt-0.5">{totalScore}</div>
                  </div>
                </div>

                <div className="px-4 py-2.5 bg-emerald-50/50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-100/50 dark:border-emerald-800/30 flex items-center gap-3 focus-within:ring-2 ring-emerald-200 dark:ring-emerald-900/50 transition-all">
                  <div className="p-2 bg-white dark:bg-emerald-950 rounded-lg shadow-sm text-emerald-600 dark:text-emerald-500"><Clock className="w-4 h-4" /></div>
                  <div>
                    <div className="text-xs font-medium opacity-80 select-none">时长(分钟)</div>
                    <input
                      type="number"
                      value={localTimeLimit}
                      onChange={(event) => setLocalTimeLimit(event.target.value)}
                      onBlur={() => Number(localTimeLimit) !== (active.data?.timeLimit || 0) && patchCollection({ timeLimit: Number(localTimeLimit || 0) })}
                      className="font-bold text-lg leading-none mt-0.5 w-16 bg-transparent border-none p-0 outline-none focus:ring-0 text-emerald-700 dark:text-emerald-400"
                      placeholder="-"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 w-full md:w-48 shrink-0 relative">
              <button
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                disabled={exporting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-950 hover:bg-zinc-900 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-950 disabled:opacity-50 rounded-xl font-medium shadow-sm shadow-zinc-950/20 dark:shadow-white/10 transition-all text-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{exporting ? '正在生成...' : '导出试卷'}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${exportMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {exportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
                  <div className="absolute right-0 left-0 top-11 z-40 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="p-1">
                      <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1">Markdown 格式</p>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <button
                          onClick={() => { exportCollection('markdown', 'student'); setExportMenuOpen(false); }}
                          className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 cursor-pointer"
                        >
                          <span>学生版</span>
                        </button>
                        <button
                          onClick={() => { exportCollection('markdown', 'teacher'); setExportMenuOpen(false); }}
                          className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 cursor-pointer"
                        >
                          <span>教师版</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-1 border-t border-zinc-100 dark:border-zinc-800 mt-1">
                      <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1">练习单 PDF</p>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <button
                          onClick={() => { exportCollection('pdf', 'student'); setExportMenuOpen(false); }}
                          className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 cursor-pointer"
                        >
                          <span>学生版</span>
                        </button>
                        <button
                          onClick={() => { exportCollection('pdf', 'teacher'); setExportMenuOpen(false); }}
                          className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 cursor-pointer"
                        >
                          <span>教师版</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <button
                onClick={() => navigate('/questions')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-xl font-medium transition-all text-sm cursor-pointer bg-white dark:bg-zinc-900"
              >
                <ChevronLeft className="w-4 h-4" /> 返回题库
              </button>

              {active.data?.questions.length ? (
                <button
                  onClick={clearCollection}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-red-200 hover:bg-red-50 hover:border-red-300 text-red-600 dark:border-red-900/30 dark:hover:bg-red-950/20 dark:text-red-400 rounded-xl font-medium transition-all text-sm cursor-pointer bg-white dark:bg-zinc-900"
                >
                  <Trash2 className="w-4 h-4" /> 清空试卷
                </button>
              ) : null}
            </div>
          </div>

          {/* Questions List (Full Page) */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex justify-between items-center select-none">
              <h3 className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-zinc-400" /> 试题列表
              </h3>
            </div>

            <div className="p-4 space-y-2">
              {!active.data?.questions.length ? (
                <Empty text="还没有题目。在题库中点击“加入试题篮”即可加入当前试卷。" />
              ) : (
                active.data.questions.map((entry, index) => (
                  <div key={entry.relationId || entry.item.id} className="space-y-2">
                    {entry.sectionName ? (
                      <div className="group flex items-center gap-3 px-4 py-2.5 bg-zinc-50/80 dark:bg-zinc-800/50 rounded-xl border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                        <GripVertical className="w-4 h-4 text-zinc-300 dark:text-zinc-600 cursor-grab" />
                        <div className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm flex-1">
                          {entry.sectionName}
                        </div>
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

                        await api(`/api/question-bank/collections/${encodeURIComponent(activeId)}/reorder`, {
                          method: 'PATCH',
                          headers: jsonHeaders,
                          body: JSON.stringify({ items: next.map((entry, order) => ({ relationId: entry.relationId, sortOrder: order })) }),
                        })
                        notifyBasketUpdated()
                        setDraggedIndex(null)
                      }}
                      onDragEnd={() => setDraggedIndex(null)}
                      className={`group flex items-start gap-4 px-4 py-4 rounded-xl border border-transparent hover:bg-white dark:hover:bg-zinc-900 hover:border-zinc-200 dark:hover:border-zinc-700 hover:shadow-sm transition-all ${draggedIndex === index ? 'opacity-40 border-dashed border-zinc-300 dark:border-zinc-700' : ''}`}
                    >
                      <div className="mt-1 cursor-grab text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400 shrink-0">
                        <GripVertical className="w-4 h-4" />
                      </div>

                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => navigate(`/questions/${encodeURIComponent(entry.item.id)}`)}
                      >
                        <div className="flex gap-2.5">
                          <span className="font-bold text-zinc-400 dark:text-zinc-500 mt-0.5 text-sm shrink-0">{index + 1}.</span>
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <QuestionMarkdownContent
                              content={stripLeadingQuestionNo(entry.item.stemMarkdown || '未命名题目', entry.item.questionNo)}
                              className="text-zinc-800 dark:text-zinc-200 leading-relaxed text-sm font-medium"
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2 pl-6">
                          {entry.item.questionType && (
                            <span className="px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium border border-zinc-200/50 dark:border-zinc-700/50">
                              {entry.item.questionType}
                            </span>
                          )}
                          {entry.item.difficultyLabel && (
                            <span className={`px-2 py-1 rounded-md text-xs font-medium border ${
                              entry.item.difficultyLabel.includes('难')
                                ? 'bg-red-50 text-red-700 border-red-200/50 dark:bg-red-900/20 dark:text-red-400'
                                : entry.item.difficultyLabel.includes('中') || entry.item.difficultyLabel.includes('较')
                                  ? 'bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-400'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-400'
                            }`}>
                              {entry.item.difficultyLabel}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-3 shrink-0">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 focus-within:border-blue-400 dark:focus-within:border-blue-500 transition-colors">
                          <input
                            type="number"
                            value={entry.score || ''}
                            placeholder={String(getDefaultScore(entry.item.questionType))}
                            onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                            className="w-10 text-center text-sm font-bold text-zinc-800 dark:text-zinc-100 bg-transparent outline-none border-none p-0 focus:ring-0"
                          />
                          <span className="text-xs text-zinc-400 dark:text-zinc-505 font-medium select-none">分</span>
                        </div>

                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-lg p-0.5">
                          <button
                            onClick={() => entry.relationId && moveItem(entry.relationId, -1)}
                            disabled={index === 0}
                            className="p-1.5 text-zinc-400 hover:text-zinc-800 hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-20 cursor-pointer"
                            title="上移"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => entry.relationId && moveItem(entry.relationId, 1)}
                            disabled={index === active.data.questions.length - 1}
                            className="p-1.5 text-zinc-400 hover:text-zinc-800 hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-20 cursor-pointer"
                            title="下移"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 my-auto mx-0.5"></div>
                          <button
                            onClick={() => entry.relationId && removeItem(entry.relationId)}
                            className="p-1.5 text-zinc-400 hover:text-red-650 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 rounded-md transition-colors cursor-pointer"
                            title="移除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
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
          className="fixed right-0 top-1/2 -translate-y-1/2 bg-white dark:bg-zinc-900 border border-r-0 border-zinc-200 dark:border-zinc-800 shadow-xl hover:shadow-2xl rounded-l-2xl px-2.5 py-4 flex flex-col items-center gap-3 text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all z-40 group cursor-pointer animate-in slide-in-from-right duration-250"
          title="展开试题篮"
        >
          <div className="relative">
            <ShoppingBag className="w-5 h-5 group-hover:scale-110 transition-transform" />
            {active.data?.questionCount ? (
              <span className="absolute -top-1.5 -right-2 w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white dark:ring-zinc-900">
                {active.data.questionCount}
              </span>
            ) : null}
          </div>
          <div
            className="text-[11px] font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
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
            <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <span className="font-bold text-zinc-800 dark:text-zinc-200 text-sm">试题篮工作台</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="p-2 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 rounded-lg transition-colors cursor-pointer"
              title="全屏独立编辑"
              onClick={() => {
                setCollapsed(true)
                navigate('/questions/basket')
              }}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-zinc-200 dark:border-zinc-700 mx-1"></div>
            <button
              className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
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
                  className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 outline-none transition-all"
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
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-all shadow-sm cursor-pointer"
                >
                  确定
                </button>
                <button
                  onClick={() => setShowCreateInput(false)}
                  className="px-3 py-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 hover:bg-zinc-50 rounded-xl text-xs transition-all cursor-pointer"
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="flex gap-2 relative">
                <div className="relative flex-1">
                  <select
                    className="w-full appearance-none rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 pl-3 pr-8 py-2 text-sm text-zinc-800 dark:text-zinc-200 font-semibold focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 focus:border-blue-300 dark:focus:border-blue-700 outline-none transition-all"
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
                  className="p-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-800 rounded-xl transition-all shadow-sm shrink-0 cursor-pointer"
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
                  className="w-1/2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2 py-1 text-xs font-semibold text-zinc-800 dark:text-zinc-200 focus:ring-1 focus:ring-blue-400 outline-none min-w-0"
                  value={localTitle}
                  onChange={(event) => setLocalTitle(event.target.value)}
                  onBlur={() => localTitle !== active.data?.title && patchCollection({ title: localTitle })}
                  placeholder="试卷标题"
                />
                <span className="text-zinc-305 dark:text-zinc-700 select-none shrink-0 font-medium text-xs">/</span>
                <input
                  className="w-1/2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/50 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 focus:ring-1 focus:ring-blue-400 outline-none min-w-0"
                  value={localSubtitle}
                  onChange={(event) => setLocalSubtitle(event.target.value)}
                  onBlur={() => localSubtitle !== (active.data?.subtitle || '') && patchCollection({ subtitle: localSubtitle })}
                  placeholder="副标题..."
                />
              </div>
              {active.data?.questions.length ? (
                <button
                  onClick={clearCollection}
                  className="text-[10px] font-bold text-red-500 hover:text-red-650 hover:bg-red-50 dark:hover:bg-red-950/30 px-2 py-1 rounded-md transition-colors cursor-pointer shrink-0 select-none border border-transparent hover:border-red-200 dark:hover:border-red-900/50"
                  title="清空所有题目"
                >
                  清空
                </button>
              ) : null}
            </div>

            {/* Stats Cards Row */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100/50 dark:border-blue-800/30 rounded-xl p-2 flex flex-col justify-center select-none">
                <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400 mb-0.5">
                  <Hash className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">题数</span>
                </div>
                <div className="font-bold text-base text-zinc-800 dark:text-zinc-200 leading-none">{active.data?.questionCount ?? 0}</div>
              </div>
              <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100/50 dark:border-amber-800/30 rounded-xl p-2 flex flex-col justify-center select-none">
                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mb-0.5">
                  <Award className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">总分</span>
                </div>
                <div className="font-bold text-base text-zinc-800 dark:text-zinc-200 leading-none">{totalScore}</div>
              </div>
              <div className="bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100/50 dark:border-emerald-800/30 rounded-xl p-2 flex flex-col justify-center focus-within:ring-2 ring-emerald-200 dark:ring-emerald-900/50 transition-all">
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 mb-0.5 select-none">
                  <Clock className="w-3 h-3" />
                  <span className="text-[10px] font-semibold">时长(分)</span>
                </div>
                <input
                  type="number"
                  value={localTimeLimit}
                  onChange={(event) => setLocalTimeLimit(event.target.value)}
                  onBlur={() => Number(localTimeLimit) !== (active.data?.timeLimit || 0) && patchCollection({ timeLimit: Number(localTimeLimit || 0) })}
                  className="w-full bg-transparent font-bold text-base text-zinc-800 dark:text-zinc-200 leading-none outline-none p-0 border-none focus:ring-0"
                  placeholder="-"
                />
              </div>
            </div>
          </div>

          {/* Items List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 pb-28">
            {active.loading && !active.data ? (
              <Empty text="读取中..." />
            ) : active.error ? (
              <Empty text={active.error} />
            ) : !active.data?.questions.length ? (
              <Empty text="还没有题目。在题库中点击“加入试题篮”即可加入当前试卷。" />
            ) : (
              active.data.questions.map((entry, index) => (
                <div key={entry.relationId || entry.item.id} className="space-y-2">
                  {entry.sectionName ? (
                    <div className="flex items-center gap-3 py-1 select-none">
                      <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></div>
                      <div className="px-3 py-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 shadow-sm">
                        {entry.sectionName}
                      </div>
                      <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></div>
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

                      await api(`/api/question-bank/collections/${encodeURIComponent(activeId)}/reorder`, {
                        method: 'PATCH',
                        headers: jsonHeaders,
                        body: JSON.stringify({ items: next.map((entry, order) => ({ relationId: entry.relationId, sortOrder: order })) }),
                      })
                      notifyBasketUpdated()
                      setDraggedIndex(null)
                    }}
                    onDragEnd={() => setDraggedIndex(null)}
                    className={`group bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 shadow-sm hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all relative overflow-hidden flex gap-3 ${
                      draggedIndex === index ? 'opacity-40 border-dashed border-zinc-300 dark:border-zinc-700' : ''
                    }`}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-transparent group-hover:bg-blue-500 transition-colors"></div>

                    <div className="mt-0.5 cursor-grab text-zinc-300 hover:text-zinc-650 dark:text-zinc-600 dark:hover:text-zinc-405 shrink-0 select-none">
                      <GripVertical className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-3">
                      <div
                        className="flex items-start gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => {
                          setCollapsed(true)
                          navigate(`/questions/${encodeURIComponent(entry.item.id)}`)
                        }}
                      >
                        <span className="font-semibold text-zinc-400 dark:text-zinc-500 text-xs mt-0.5 shrink-0">{index + 1}.</span>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <QuestionMarkdownContent
                            content={stripLeadingQuestionNo(entry.item.stemMarkdown || '未命名题目', entry.item.questionNo)}
                            className="line-clamp-2 text-xs text-zinc-805 dark:text-zinc-200 leading-relaxed font-medium pointer-events-none select-none overflow-hidden max-w-full"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-zinc-105 dark:border-zinc-800 pt-2.5 w-full">
                        <div className="flex items-center gap-2">
                          {entry.item.questionType && (
                            <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-805 text-zinc-600 dark:text-zinc-400 text-[10px] font-medium border border-zinc-200/50 dark:border-zinc-700/50 select-none">
                              {entry.item.questionType}
                            </span>
                          )}
                          <div className="flex items-center gap-1 border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 py-0.5 bg-zinc-50 dark:bg-zinc-950 focus-within:border-blue-400 transition-colors">
                            <input
                              type="number"
                              value={entry.score || ''}
                              placeholder={String(getDefaultScore(entry.item.questionType))}
                              onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                              className="w-8 text-center text-xs font-bold outline-none text-zinc-800 dark:text-zinc-100 bg-transparent border-none p-0 focus:ring-0"
                            />
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 select-none">分</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-lg p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => entry.relationId && moveItem(entry.relationId, -1)}
                            disabled={index === 0}
                            className="p-1 text-zinc-400 hover:bg-white dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors disabled:opacity-20 cursor-pointer"
                            title="上移"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => entry.relationId && moveItem(entry.relationId, 1)}
                            disabled={index === active.data.questions.length - 1}
                            className="p-1 text-zinc-400 hover:bg-white dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors disabled:opacity-20 cursor-pointer"
                            title="下移"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <div className="w-px h-3 bg-zinc-200 dark:bg-zinc-600 mx-0.5 my-auto"></div>
                          <button
                            onClick={() => entry.relationId && removeItem(entry.relationId)}
                            className="p-1 text-zinc-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500 rounded transition-colors cursor-pointer"
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
          <div className="p-4 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 absolute bottom-0 left-0 right-0 z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
            <button
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              disabled={exporting}
              className="w-full py-3 bg-zinc-950 hover:bg-zinc-900 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-950 disabled:opacity-50 font-semibold rounded-xl shadow-sm shadow-zinc-950/20 dark:shadow-white/10 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? '正在生成...' : '导出练习单'}</span>
              <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-200 ${exportMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {exportMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
                <div className="absolute right-4 left-4 bottom-16 z-40 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 animate-in fade-in slide-in-from-bottom-1 duration-150">
                  <div className="p-1">
                    <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2 py-1 select-none">
                      Markdown 格式
                    </p>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <button
                        onClick={() => {
                          exportCollection('markdown', 'student')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 cursor-pointer"
                      >
                        <span>学生版</span>
                      </button>
                      <button
                        onClick={() => {
                          exportCollection('markdown', 'teacher')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 cursor-pointer"
                      >
                        <span>教师版</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-1 border-t border-zinc-100 dark:border-zinc-800 mt-1">
                    <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-505 uppercase tracking-wider px-2 py-1 select-none font-medium">
                      练习单 PDF
                    </p>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <button
                        onClick={() => {
                          exportCollection('pdf', 'student')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 cursor-pointer"
                      >
                        <span>学生版</span>
                      </button>
                      <button
                        onClick={() => {
                          exportCollection('pdf', 'teacher')
                          setExportMenuOpen(false)
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 cursor-pointer"
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
