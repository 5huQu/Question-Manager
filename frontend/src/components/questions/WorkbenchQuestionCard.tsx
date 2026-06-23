import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Crop, Grid, List, PencilLine, Search, ShoppingBag, Trash2, X } from 'lucide-react'
import { questionBankApi } from '@/api/questionBank'
import { learningTagsApi } from '@/api/learningTags'
import { FigureCropDialog } from '@/components/questions/FigureDialogs'
import { EditDialog } from '@/components/questions/EditDialog'
import { QuestionMarkdownContent, SolutionDisclosure } from '@/components/questions/QuestionContent'
import { Badge, Button, Empty, SelectFilter, TagRow } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { QuestionBankResponse, QuestionFigure, QuestionItem, TagLibraries } from '@/types'
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
  const [cropItem, setCropItem] = useState<QuestionItem | null>(null)
  const [editItem, setEditItem] = useState<QuestionItem | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<QuestionItem>>({})

  const rawItems = questionBank?.items ?? []
  const items = rawItems
  const activeItem = useMemo(() => items.find((item) => item.id === previewId) ?? items[0] ?? null, [items, previewId])
  const totalItems = questionBank?.totalItems ?? 0
  const totalPages = questionBank?.totalPages ?? 1
  const currentPage = questionBank?.page ?? page
  const hasActiveFilters = Boolean(query.trim() || stage || questionType || difficulty || knowledgePoint || solutionMethod)

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
  }

  async function deleteQuestion(id: string) {
    if (!window.confirm('确定删除这道题目？')) return
    if (id.startsWith('mock_')) {
      alert('模拟数据已删除 (静态操作)')
      return
    }
    await questionBankApi.deleteItem(id)
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

  function startEdit(item: QuestionItem) {
    setEditItem(item)
    setEditDraft(item)
  }

  async function saveEditedQuestion(nextDraft = editDraft) {
    if (!editItem) return
    const saved = await questionBankApi.updateItem(editItem.id, nextDraft)
    setEditItem(null)
    setEditDraft({})
    if (onQuestionSaved) onQuestionSaved(saved)
    else reload()
  }

  async function addFigure(payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    if (!cropItem) throw new Error('未选择题目')
    return questionBankApi.createFigure(cropItem.id, { usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox })
  }

  async function updateFigure(figureId: string, payload: { usage: string; optionLabel?: string; bbox: Record<string, number> }) {
    if (!cropItem) throw new Error('未选择题目')
    return questionBankApi.updateFigure(cropItem.id, figureId, { usage: payload.usage, optionLabel: payload.optionLabel, pageNumber: 1, bbox: payload.bbox })
  }

  async function deleteFigure(figureId: string) {
    if (!cropItem) return
    await questionBankApi.deleteFigure(cropItem.id, figureId)
  }

  return (
    <div className="mock-page-root flex h-[calc(100vh-7rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <aside className="w-52 shrink-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50/30 p-4 text-left dark:border-zinc-800 dark:bg-zinc-950/20">
        <div className="space-y-4">
          <div>
            <h3 className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">教学阶段</h3>
            <SelectFilter label="全部学段" value={stage} options={tagLibraries.data?.stages ?? ['高一', '高二', '高三', '高中']} onChange={(value) => updateFilter(setStage, value)} />
          </div>
          <div className="h-px bg-zinc-200 dark:bg-zinc-800" />
          <div>
            <h3 className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">试题题型</h3>
            <SelectFilter label="全部题型" value={questionType} options={tagLibraries.data?.questionTypes ?? ['单选题', '多选题', '填空题', '解答题']} onChange={(value) => updateFilter(setQuestionType, value)} />
          </div>
          <div className="h-px bg-zinc-200 dark:bg-zinc-800" />
          <div>
            <h3 className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">难度分级</h3>
            <SelectFilter label="全部难度" value={difficulty} options={tagLibraries.data?.difficultyLabels ?? ['基础', '中等', '较难', '压轴']} onChange={(value) => updateFilter(setDifficulty, value)} />
          </div>
          <div className="h-px bg-zinc-200 dark:bg-zinc-800" />
          <div>
            <h3 className="mb-2.5 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">知识与方法</h3>
            <div className="space-y-2">
              <SelectFilter label="全部知识点" value={knowledgePoint} options={tagLibraries.data?.knowledgePoints ?? []} onChange={(value) => updateFilter(setKnowledgePoint, value)} />
              <SelectFilter label="全部解题方法" value={solutionMethod} options={tagLibraries.data?.solutionMethods ?? []} onChange={(value) => updateFilter(setSolutionMethod, value)} />
            </div>
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
            <Button size="sm" variant="outline" asLink to="/questions/new">新增</Button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">找到 {totalItems} 道试题</span>
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">第 {currentPage} / {totalPages} 页</span>
          </div>

          {viewMode === 'card' ? (
            <div className="space-y-3.5 pb-20">
              {items.map((item) => {
                const selected = selectedIds.includes(item.id)
                const active = activeItem?.id === item.id
                return (
                  <article key={item.id} onClick={() => setPreviewId(item.id)} className={`group cursor-pointer rounded-lg border bg-white p-4 text-left shadow-sm transition-colors dark:bg-zinc-950 ${selected || active ? 'border-zinc-400 dark:border-zinc-600' : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50'}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={selected} onChange={() => toggleSelected(item.id)} onClick={(event) => event.stopPropagation()} className="mt-1 size-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-800" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] text-zinc-400">#{item.serialNo ?? item.questionNo ?? item.id}</span>
                          {[item.stage, item.questionType, difficultyLabel10(item)].filter(Boolean).map((tag, index) => <Badge key={`${tag}-${index}`}>{tag}</Badge>)}
                        </div>
                        <div className="line-clamp-2 text-sm leading-6 text-zinc-900 dark:text-zinc-100">
                          {previewText(item) || '题干为空'}
                        </div>
                        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">来源：{displaySource(item.sourceTitle || '')}</p>
                      </div>
                      <button type="button" onClick={(event) => { event.stopPropagation(); addToBasket(item.id) }} className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" title="加入试题篮">
                        <ShoppingBag className="size-3.5" />
                      </button>
                    </div>
                  </article>
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
                  {items.map((item) => (
                    <tr key={item.id} onClick={() => setPreviewId(item.id)} className={`cursor-pointer border-b border-zinc-100 transition-colors hover:bg-zinc-50/70 dark:border-zinc-900 dark:hover:bg-zinc-900/50 ${activeItem?.id === item.id ? 'bg-zinc-50 dark:bg-zinc-900/40' : ''}`}>
                      <td className="p-2" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} className="size-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-800" /></td>
                      <td className="p-2 font-mono text-[10px] text-zinc-400">#{item.serialNo ?? item.questionNo ?? item.id}</td>
                      <td className="p-2 text-zinc-600 dark:text-zinc-400">{item.stage || '-'}</td>
                      <td className="p-2 text-zinc-600 dark:text-zinc-400">{item.questionType || '-'}</td>
                      <td className="min-w-0 p-2"><div className="line-clamp-1 font-medium text-zinc-850 dark:text-zinc-200">{previewText(item) || '题干为空'}</div><div className="truncate text-[11px] text-zinc-400">{displaySource(item.sourceTitle || '')}</div></td>
                      <td className="p-2 text-center"><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{difficultyLabel10(item)}</span></td>
                      <td className="p-2 text-center" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => addToBasket(item.id)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"><ShoppingBag className="size-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {loading ? <Empty text={items.length ? '正在刷新题目...' : '正在读取题目...'} /> : null}
          {error ? <Empty text={`题目读取失败：${error}`} /> : null}
          {!items.length && !loading && !error ? <Empty text={hasActiveFilters ? '未找到匹配筛选条件的题目' : '题库中暂无题目'} /> : null}
        </div>

        {selectedIds.length > 0 ? (
          <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-950 shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-zinc-100 font-mono text-[10px] font-bold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{selectedIds.length}</span>
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">已选择</span>
            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
            <button type="button" onClick={addSelectedToBasket} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-1.5 font-semibold text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"><ShoppingBag className="size-3.5" />加入试题篮</button>
            <button type="button" onClick={() => setSelectedIds([])} className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><X className="size-3.5" /></button>
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

            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" icon={PencilLine} onClick={() => startEdit(activeItem)}>编辑</Button>
              <Button size="sm" variant="outline" icon={Crop} onClick={() => setCropItem(activeItem)}>框选题图</Button>
              <Button size="sm" variant="outline" asLink to={`/questions/${encodeURIComponent(activeItem.id)}`}>详情</Button>
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => deleteQuestion(activeItem.id)}>删除</Button>
            </div>
            <button type="button" onClick={() => addToBasket(activeItem.id)} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded bg-zinc-900 py-2 text-xs font-bold text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200">
              <ShoppingBag className="size-3.5" />
              加入试题篮
            </button>
          </>
        ) : <div className="flex flex-1 items-center justify-center text-xs text-zinc-400">选择题目查看公式排版渲染</div>}
      </section>

      {editItem ? <EditDialog draft={editDraft} setDraft={setEditDraft} onClose={() => setEditItem(null)} onSave={saveEditedQuestion} /> : null}
      {cropItem ? <FigureCropDialog question={cropItem} onClose={(changed) => { setCropItem(null); if (changed) reload() }} onDelete={deleteFigure} onSave={addFigure} onUpdate={updateFigure} /> : null}
    </div>
  )
}
