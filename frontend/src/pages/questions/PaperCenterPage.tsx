import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock,
  FolderOpen,
  LoaderCircle,
  PencilLine,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { collectionsApi } from '@/api/collections'
import { DEFAULT_BASKET_ID } from '@/components/basket/constants'
import { QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { richBlocksPlainText } from '@/components/RichContent'
import type { Basket, BasketQuestion, CollectionSummary } from '@/types'

type DrawerDetailState = {
  loading: boolean
  error: string
  data: Basket | null
}

export function PaperCenterPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [papers, setPapers] = useState<CollectionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [activePaper, setActivePaper] = useState<CollectionSummary | null>(null)
  const [showDrawer, setShowDrawer] = useState(false)
  const [drawerPaper, setDrawerPaper] = useState<CollectionSummary | null>(null)
  const [drawerDetail, setDrawerDetail] = useState<DrawerDetailState>({ loading: false, error: '', data: null })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    collectionsApi.listCollections()
      .then((res) => {
        if (cancelled) return
        setPapers((res.items ?? []).filter((item) => item.id !== DEFAULT_BASKET_ID))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (activePaper) {
      setDrawerPaper(activePaper)
      const frame = requestAnimationFrame(() => {
        setShowDrawer(true)
      })
      return () => cancelAnimationFrame(frame)
    } else {
      setShowDrawer(false)
      const timer = setTimeout(() => {
        setDrawerPaper(null)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [activePaper])

  useEffect(() => {
    if (!drawerPaper) {
      setDrawerDetail({ loading: false, error: '', data: null })
      return
    }
    let cancelled = false
    setDrawerDetail({ loading: true, error: '', data: null })
    collectionsApi.getCollection(drawerPaper.id)
      .then((basket) => {
        if (!cancelled) setDrawerDetail({ loading: false, error: '', data: basket })
      })
      .catch((err) => {
        if (!cancelled) setDrawerDetail({ loading: false, error: err instanceof Error ? err.message : String(err), data: null })
      })
    return () => { cancelled = true }
  }, [drawerPaper?.id])

  const filteredPapers = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    if (!keyword) return papers
    return papers.filter((paper) => `${paper.title || ''} ${paper.subtitle || ''}`.toLowerCase().includes(keyword))
  }, [papers, searchQuery])

  const outlineQuestions = useMemo(() => {
    const questions = drawerDetail.data?.questions ?? []
    return [...questions].sort((left, right) => Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0))
  }, [drawerDetail.data])

  async function handleDelete(paper: CollectionSummary, event?: MouseEvent) {
    event?.stopPropagation()
    if (!window.confirm(`确定删除试卷「${paper.title}」？\n\n删除后不可恢复，但不会影响题库中的题目。`)) return
    setIsDeleting(paper.id)
    try {
      await collectionsApi.deleteCollection(paper.id)
      setPapers((current) => current.filter((item) => item.id !== paper.id))
      if (activePaper?.id === paper.id) setActivePaper(null)
    } catch (err) {
      alert(`删除试卷失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsDeleting(null)
    }
  }

  function openInWorkbench(paper: CollectionSummary) {
    navigate(`/questions/basket?paper=${encodeURIComponent(paper.id)}`)
  }

  return (
    <div className="mock-page-root flex min-h-[calc(100vh-6rem)] select-none flex-col gap-6 bg-zinc-50/20 p-6 dark:bg-zinc-950">
      <div className="flex flex-col items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:flex-row">
        <div className="flex w-full items-center gap-2 rounded border border-zinc-200 bg-zinc-50/50 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-900 sm:w-80">
          <Search className="size-3.5 shrink-0 text-zinc-400" />
          <input
            type="text"
            placeholder="搜索试卷标题..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full border-none bg-transparent p-0 text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-300"
          />
        </div>
        <span className="whitespace-nowrap text-[11px] text-zinc-500 dark:text-zinc-400">
          显示 {filteredPapers.length} / {papers.length} 份试卷
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/10">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
              <th className="max-w-[480px] p-3">试卷名称</th>
              <th className="w-20 p-3 text-center">题数</th>
              <th className="w-24 p-3 text-center">估算总分</th>
              <th className="w-24 p-3 text-center">时长</th>
              <th className="w-32 p-3">更新时间</th>
              <th className="w-28 p-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-zinc-400">
                  正在读取试卷列表
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-zinc-400">
                  {error}
                </td>
              </tr>
            ) : filteredPapers.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-zinc-400">
                  {searchQuery.trim() ? '没有匹配当前搜索的试卷' : '还没有保存的试卷，可在组卷工作台中将题目保存为试卷'}
                </td>
              </tr>
            ) : (
              filteredPapers.map((paper) => (
                <tr
                  key={paper.id}
                  onClick={() => setActivePaper(paper)}
                  className="cursor-pointer border-b border-zinc-100 transition-colors hover:bg-zinc-50/50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
                >
                  <td className="max-w-[480px] p-3 text-left">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="size-3.5 shrink-0 text-zinc-400" />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-zinc-800 dark:text-zinc-200">{paper.title || '未命名试卷'}</div>
                        {paper.subtitle ? <div className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">{paper.subtitle}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-center font-mono font-semibold text-zinc-800 dark:text-zinc-300">
                    {paper.questionCount ?? 0} 题
                  </td>
                  <td className="p-3 text-center font-mono font-semibold text-zinc-800 dark:text-zinc-300">
                    {paper.totalScore || 0} 分
                  </td>
                  <td className="p-3 text-center text-zinc-500 dark:text-zinc-400">
                    {paper.timeLimit ? `${paper.timeLimit} 分钟` : '-'}
                  </td>
                  <td className="p-3 text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1 text-[11px]">
                      <Clock className="size-3 text-zinc-400" />
                      {formatDate(paper.updatedAt || paper.createdAt)}
                    </span>
                  </td>
                  <td className="p-3 text-center" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => openInWorkbench(paper)}
                        className="rounded p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        title="在组卷工作台打开编辑"
                      >
                        <PencilLine className="size-3.5" />
                      </button>
                      <button
                        onClick={(event) => void handleDelete(paper, event)}
                        disabled={isDeleting === paper.id}
                        className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-950/20 dark:hover:text-red-400"
                        title="删除试卷"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {drawerPaper ? (
        <div
          onClick={() => setActivePaper(null)}
          className={`fixed inset-0 z-50 flex justify-end bg-zinc-950/0 backdrop-blur-none transition-all duration-300 ${
            showDrawer ? 'bg-zinc-950/40 backdrop-blur-sm' : 'pointer-events-none'
          }`}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`flex h-full w-full max-w-xl transform flex-col justify-between border-l border-zinc-200 bg-white p-6 text-left shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] dark:border-zinc-800 dark:bg-zinc-900 ${
              showDrawer ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
                <div className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    <FolderOpen className="size-4 text-zinc-400" />
                    试卷大纲预览
                  </h3>
                  <p className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    试卷编码：#{drawerPaper.id}
                  </p>
                </div>
                <button
                  onClick={() => setActivePaper(null)}
                  className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950/20">
                <div>
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">试卷名称</span>
                  <span className="mt-0.5 block truncate font-bold text-zinc-800 dark:text-zinc-200">{drawerPaper.title || '未命名试卷'}</span>
                </div>
                <div>
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">题数 / 总分</span>
                  <span className="mt-0.5 block font-semibold text-zinc-800 dark:text-zinc-200">{drawerPaper.questionCount ?? 0} 题 · {drawerPaper.totalScore || 0} 分</span>
                </div>
                <div>
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">创建日期</span>
                  <span className="mt-0.5 block font-semibold text-zinc-800 dark:text-zinc-200">{formatDate(drawerPaper.createdAt)}</span>
                </div>
              </div>
            </div>

            <div className="my-4 flex-1 space-y-3 overflow-y-auto pr-1">
              <h4 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                收录的试题大纲 ({drawerPaper.questionCount ?? 0} 道题)
              </h4>

              {drawerDetail.loading ? (
                <div className="flex items-center gap-2 rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  正在读取试题内容...
                </div>
              ) : drawerDetail.error ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                  {drawerDetail.error}
                </div>
              ) : outlineQuestions.length ? (
                <div className="space-y-3">
                  {outlineQuestions.map((entry, index) => (
                    <PaperOutlineRow key={entry.relationId || entry.item.id} entry={entry} index={index} />
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-zinc-200 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800">
                  这份试卷还没有收录题目。
                </div>
              )}
            </div>

            <div className="flex gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => openInWorkbench(drawerPaper)}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-zinc-900 py-2 text-xs font-semibold text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <PencilLine className="mr-1 size-3.5" />
                打开编辑
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(drawerPaper)}
                disabled={isDeleting === drawerPaper.id}
                className="inline-flex items-center justify-center gap-1 rounded border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-30 dark:border-red-900/30 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/20"
              >
                <Trash2 className="size-3.5" />
                删除试卷
              </button>
              <button
                type="button"
                onClick={() => setActivePaper(null)}
                className="inline-flex items-center justify-center gap-1 rounded border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                关闭预览
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PaperOutlineRow({ entry, index }: { entry: BasketQuestion; index: number }) {
  const question = entry.item
  const stem = question ? (question.stemMarkdown || richBlocksPlainText(question.problemBlocks)) : ''
  const meta = [entry.score != null ? `${entry.score} 分` : '', entry.sectionName || ''].filter(Boolean).join(' · ')
  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-100 bg-white p-3.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center justify-between gap-2 font-mono text-[9px] text-zinc-400 dark:text-zinc-500">
        <span className="min-w-0 truncate font-bold text-zinc-800 dark:text-zinc-300">
          第 {index + 1} 题{question?.questionType ? ` (${question.questionType})` : ''}
        </span>
        {meta ? <span className="shrink-0">{meta}</span> : null}
      </div>
      <div className="truncate font-sans leading-relaxed text-zinc-800 dark:text-zinc-200">
        <QuestionMarkdownContent content={stem || '题干为空'} figures={question?.figures} className="text-xs leading-relaxed" />
      </div>
    </div>
  )
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default PaperCenterPage
