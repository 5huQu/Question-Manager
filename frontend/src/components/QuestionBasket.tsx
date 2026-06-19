import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Download, FilePlus2, GripVertical, Trash2, ChevronUp, ShoppingBag, Award, Clock, Hash } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, jsonHeaders } from '../api/client'
import { useAsync } from '../hooks/useAsync'
import type { Basket, CollectionExport, CollectionSummary } from '../types'
import { Button, Empty } from './ui'
import { MarkdownContent } from './MarkdownContent'

const activeBasketStorageKey = 'question-workbench.activeCollectionId'
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

export function QuestionBasket() {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(true)
  const [activeId, setActiveId] = useState(getActiveCollectionId)
  const [newTitle, setNewTitle] = useState('')
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

  const totalScore = useMemo(() => active.data?.questions.reduce((sum, entry) => sum + Number(entry.score || 0), 0) ?? 0, [active.data])

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

  return (
    <>
      {/* Background Backdrop Overlay */}
      <div
        onClick={() => setCollapsed(true)}
        className={`fixed inset-0 z-40 bg-zinc-950/20 dark:bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
        }`}
      />

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex h-24 w-10 flex-col items-center justify-center gap-1.5 rounded-l-xl border border-r-0 border-zinc-200 bg-white shadow-lg hover:shadow-xl hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-all cursor-pointer group"
          title="展开试题篮"
        >
          <div className="relative">
            <ShoppingBag className="size-4.5 text-zinc-500 dark:text-zinc-400 group-hover:scale-110 transition-transform" />
            {active.data?.questionCount ? (
              <span className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-900">
                {active.data.questionCount}
              </span>
            ) : null}
          </div>
          <span className="text-[9px] font-bold tracking-widest text-zinc-400 dark:text-zinc-500 uppercase [writing-mode:vertical-rl] select-none">
            试题篮
          </span>
        </button>
      )}
      <aside className={`fixed right-0 top-0 bottom-0 z-50 flex w-[420px] flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 transition-transform duration-300 ease-in-out ${collapsed ? 'translate-x-full' : 'translate-x-0'}`}>
        <div className="flex h-14 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-4 text-zinc-500" />
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">试题篮工作台</p>
          </div>
          <button className="flex size-8 items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 shadow-sm transition-all dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 cursor-pointer" onClick={() => setCollapsed(!collapsed)} title={collapsed ? '展开试题篮' : '收起试题篮'}>
            {collapsed ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50/30 dark:bg-zinc-900/10 space-y-3">
            <div className="relative flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-700"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="新建试卷名称..."
              />
              <Button size="sm" icon={FilePlus2} onClick={createPaper} className="shadow-sm">新建</Button>
            </div>
            <div className="relative">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">当前试卷</span>
              <div className="relative flex items-center">
                <select
                  className="h-9 w-full appearance-none rounded-lg border border-zinc-200 bg-white pl-3 pr-8 text-xs font-medium text-zinc-800 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:border-zinc-700"
                  value={activeId}
                  onChange={(event) => setActiveId(event.target.value)}
                >
                  {(collections.data?.items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.title}（{item.questionCount}题）</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
                  <ChevronDown className="size-4" />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3.5 border-b border-zinc-200 dark:border-zinc-800 p-4">
            {active.loading && !active.data ? <Empty text="读取中..." /> : active.error ? <Empty text={active.error} /> : active.data ? (
              <>
                <div className="flex items-center gap-1.5 min-w-0">
                  <input
                    className="w-1/2 rounded-md border-b border-transparent bg-transparent dark:!bg-transparent px-1 py-0.5 text-sm font-bold text-zinc-800 dark:text-zinc-100 hover:border-zinc-200 focus:border-zinc-400 focus:bg-white dark:focus:!bg-zinc-950 focus:px-1.5 transition-all outline-none min-w-0"
                    value={localTitle}
                    onChange={(event) => setLocalTitle(event.target.value)}
                    onBlur={() => localTitle !== active.data?.title && patchCollection({ title: localTitle })}
                    placeholder="试卷标题"
                  />
                  <span className="text-zinc-300 dark:text-zinc-700 select-none shrink-0 font-medium text-xs">---</span>
                  <input
                    className="w-1/2 rounded-md border-b border-transparent bg-transparent dark:!bg-transparent px-1 py-0.5 text-xs text-zinc-500 dark:text-zinc-400 hover:border-zinc-200 focus:border-zinc-400 focus:bg-white dark:focus:!bg-zinc-950 focus:px-1.5 transition-all outline-none min-w-0"
                    value={localSubtitle}
                    onChange={(event) => setLocalSubtitle(event.target.value)}
                    onBlur={() => localSubtitle !== (active.data?.subtitle || '') && patchCollection({ subtitle: localSubtitle })}
                    placeholder="添加副标题..."
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] pt-1">
                  <div className="flex flex-col rounded-lg bg-blue-50/40 border border-blue-100/50 p-2 dark:bg-blue-950/30 dark:border-blue-900/30">
                    <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                      <Hash className="size-3" />
                      <span>题数</span>
                    </div>
                    <p className="mt-1 text-sm font-bold text-zinc-800 dark:text-zinc-200">{active.data.questionCount}</p>
                  </div>

                  <div className="flex flex-col rounded-lg bg-amber-50/40 border border-amber-100/50 p-2 dark:bg-amber-950/30 dark:border-amber-900/30">
                    <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                      <Award className="size-3" />
                      <span>总分</span>
                    </div>
                    <p className="mt-1 text-sm font-bold text-zinc-800 dark:text-zinc-200">{totalScore}</p>
                  </div>

                  <label className="flex flex-col rounded-lg bg-emerald-50/40 border border-emerald-100/50 p-2 cursor-pointer dark:bg-emerald-950/30 dark:border-emerald-900/30 focus-within:border-emerald-400 transition-colors">
                    <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      <Clock className="size-3" />
                      <span>时长(分)</span>
                    </div>
                    <input
                      type="number"
                      className="mt-0.5 w-full bg-transparent dark:!bg-transparent border-none dark:!border-none text-sm font-bold text-zinc-800 dark:text-zinc-200 outline-none"
                      value={localTimeLimit}
                      onChange={(event) => setLocalTimeLimit(event.target.value)}
                      onBlur={() => Number(localTimeLimit) !== (active.data?.timeLimit || 0) && patchCollection({ timeLimit: Number(localTimeLimit || 0) })}
                      placeholder="-"
                    />
                  </label>
                </div>

                <div className="relative pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Download}
                    disabled={exporting}
                    onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    className="w-full justify-between shadow-sm"
                  >
                    <span>{exporting ? '正在生成...' : '导出当前练习单'}</span>
                    <ChevronDown className={`size-3.5 transition-transform duration-200 ${exportMenuOpen ? 'rotate-180' : ''}`} />
                  </Button>

                  {exportMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
                      <div className="absolute right-0 left-0 mt-1.5 z-40 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 animate-in fade-in slide-in-from-top-1 duration-150">
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
                </div>
              </>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3.5 space-y-3">
            {!active.data?.questions.length ? (
              <Empty text="还没有题目。题库中点击“加入试题篮”即可加入当前试卷。" />
            ) : (
              <div className="space-y-3.5 pb-8">
                {active.data.questions.map((entry, index) => (
                  <div key={entry.relationId || entry.item.id} className="space-y-2">
                    {entry.sectionName ? (
                      <div className="flex items-center gap-2 py-1">
                        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                        <div className="max-w-[220px] truncate rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-center text-[11px] font-semibold text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                          {entry.sectionName}
                        </div>
                        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                      </div>
                    ) : null}
                  <article
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
                    className={`group relative rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-sm hover:shadow-md transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-950 overflow-hidden w-full min-w-0 ${draggedIndex === index ? 'opacity-40 border-dashed border-zinc-300 dark:border-zinc-700' : ''}`}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-zinc-200 group-hover:bg-zinc-400 dark:bg-zinc-800 dark:group-hover:bg-zinc-700 transition-colors" />

                    <div className="flex items-start gap-2.5 pl-1.5 min-w-0 w-full">
                      <div className="mt-0.5 cursor-grab text-zinc-300 hover:text-zinc-500 transition-colors shrink-0">
                        <GripVertical className="size-3.5" />
                      </div>

                      <div
                        className="min-w-0 flex-1 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => {
                          setCollapsed(true)
                          navigate(`/questions/${encodeURIComponent(entry.item.id)}`)
                        }}
                      >
                        <div className="flex items-start gap-1 min-w-0 w-full overflow-hidden">
                          <span className="font-semibold text-zinc-500 dark:text-zinc-400 shrink-0 select-none mt-0.5">{index + 1}.</span>
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <MarkdownContent
                              content={stripLeadingQuestionNo(entry.item.stemMarkdown || '未命名题目', entry.item.questionNo)}
                              className="line-clamp-2 text-zinc-800 dark:text-zinc-200 leading-relaxed font-medium pointer-events-none select-none overflow-hidden max-w-full"
                            />
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {entry.item.questionType && (
                            <span className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 select-none">
                              {entry.item.questionType}
                            </span>
                          )}
                          {entry.item.difficultyLabel && (
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium select-none ${
                              entry.item.difficultyLabel.includes('难')
                                ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                                : entry.item.difficultyLabel.includes('中') || entry.item.difficultyLabel.includes('较')
                                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                            }`}>
                              {entry.item.difficultyLabel}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        className="flex size-7 items-center justify-center rounded-lg bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 hover:text-red-700 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30 dark:hover:bg-red-950/50 transition-colors shrink-0 cursor-pointer"
                        onClick={() => entry.relationId && removeItem(entry.relationId)}
                        title="移除"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-2.5 pl-1.5 min-w-0 w-full">
                      <div className="flex flex-1 items-center gap-2 min-w-0">
                        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 px-2 py-0.5 focus-within:border-zinc-400 dark:focus-within:border-zinc-700 transition-colors">
                          <input
                            className="w-10 bg-transparent dark:!bg-transparent text-[11px] font-bold text-zinc-800 dark:text-zinc-200 outline-none text-center placeholder-zinc-400"
                            value={entry.score || ''}
                            onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                            placeholder="分值"
                          />
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 select-none pr-1">分</span>
                        </div>
                      </div>

                      <div className="flex gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 p-0.5 shrink-0">
                        <button
                          className="flex size-6 items-center justify-center rounded-md hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                          onClick={() => entry.relationId && moveItem(entry.relationId, -1)}
                          disabled={index === 0}
                          title="上移"
                        >
                          <ChevronUp className="size-3.5" />
                        </button>
                        <button
                          className="flex size-6 items-center justify-center rounded-md hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                          onClick={() => entry.relationId && moveItem(entry.relationId, 1)}
                          disabled={index === active.data.questions.length - 1}
                          title="下移"
                        >
                          <ChevronDown className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </article>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
