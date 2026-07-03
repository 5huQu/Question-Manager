import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Calendar,
  CheckCircle2,
  Download,
  FileCode2,
  FileDown,
  FileText,
  Info,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { collectionsApi } from '@/api/collections'
import { exportRecordsApi } from '@/api/exportRecords'
import { questionBankApi } from '@/api/questionBank'
import { getActiveCollectionId, notifyBasketUpdated } from '@/components/QuestionBasket'
import { QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { useAsync } from '@/hooks/useAsync'
import type { ExportRecord, QuestionItem } from '@/types'
import { richBlocksPlainText } from '@/components/RichContent'

type FormatFilter = 'All' | 'Markdown' | 'PDF' | 'LaTeX'
type OutlineItem = ExportRecord['items'][number] & {
  question?: QuestionItem
  error?: string
}
type OutlineState = {
  loading: boolean
  error: string
  items: OutlineItem[]
}

export function ExportRecordsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('All')
  const [activeRecord, setActiveRecord] = useState<ExportRecord | null>(null)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [isRestoring, setIsRestoring] = useState<string | null>(null)
  const [outlineByRecordId, setOutlineByRecordId] = useState<Record<string, OutlineState>>({})
  const outlineRequestsRef = useRef(new Set<string>())
  const [showDrawer, setShowDrawer] = useState(false)
  const [drawerRecord, setDrawerRecord] = useState<ExportRecord | null>(null)

  useEffect(() => {
    if (activeRecord) {
      setDrawerRecord(activeRecord)
      const frame = requestAnimationFrame(() => {
        setShowDrawer(true)
      })
      return () => cancelAnimationFrame(frame)
    } else {
      setShowDrawer(false)
      const timer = setTimeout(() => {
        setDrawerRecord(null)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [activeRecord])

  const { data, error, loading, setData } = useAsync<{ items: ExportRecord[] }>(
    () => exportRecordsApi.listExportRecords({ limit: 500 }),
    []
  )

  const records = data?.items ?? []
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const title = `${record.title || ''} ${record.filename || ''}`.toLowerCase()
      if (searchQuery && !title.includes(searchQuery.toLowerCase())) return false
      if (formatFilter !== 'All' && normalizeFormat(record.format) !== formatFilter) return false
      return true
    })
  }, [formatFilter, records, searchQuery])

  useEffect(() => {
    if (!activeRecord?.items?.length) return
    if (outlineRequestsRef.current.has(activeRecord.id)) return

    const recordId = activeRecord.id
    outlineRequestsRef.current.add(recordId)
    const snapshots = [...activeRecord.items].sort((left, right) => Number(left.exportOrder || 0) - Number(right.exportOrder || 0))
    setOutlineByRecordId((current) => ({
      ...current,
      [recordId]: current[recordId] ?? { loading: true, error: '', items: snapshots },
    }))

    Promise.all(snapshots.map(async (snapshot): Promise<OutlineItem> => {
      try {
        const question = await questionBankApi.getItem(snapshot.questionId)
        return { ...snapshot, question }
      } catch (error) {
        return { ...snapshot, error: error instanceof Error ? error.message : String(error) }
      }
    })).then((items) => {
      setOutlineByRecordId((current) => ({
        ...current,
        [recordId]: {
          loading: false,
          error: items.every((item) => item.error) ? '题目内容读取失败' : '',
          items,
        },
      }))
    }).catch((error) => {
      outlineRequestsRef.current.delete(recordId)
      setOutlineByRecordId((current) => ({
        ...current,
        [recordId]: {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          items: snapshots,
        },
      }))
    })
  }, [activeRecord])

  async function handleDelete(id: string, event?: MouseEvent) {
    event?.stopPropagation()
    const record = records.find((item) => item.id === id)
    if (!window.confirm('确定要删除这条导出记录吗？此操作不会影响已下载的本地文件。')) return
    setIsDeleting(id)
    try {
      await exportRecordsApi.deleteExportRecord(id)
      setData((current) => current ? { ...current, items: current.items.filter((item) => item.id !== id) } : current)
      if (activeRecord?.id === id) setActiveRecord(null)
    } catch (err) {
      alert(`删除记录失败: ${err instanceof Error ? err.message : String(err)}`)
      if (record) setActiveRecord(record)
    } finally {
      setIsDeleting(null)
    }
  }

  function handleDownload(record: ExportRecord, event?: MouseEvent) {
    event?.stopPropagation()
    if (record.status === 'failed' || !record.url) return
    window.open(record.url, '_blank', 'noopener,noreferrer')
  }

  async function handleRestoreToBasket(record: ExportRecord) {
    if (!record.items?.length) {
      alert('这条导出记录没有题目快照，无法回填到试题篮。')
      return
    }

    const collectionId = getActiveCollectionId()
    setIsRestoring(record.id)
    try {
      const current = await collectionsApi.getCollection(collectionId)
      if ((current.questionCount || 0) > 0) {
        const confirmed = window.confirm(
          `当前试题篮「${current.title || collectionId}」已有 ${current.questionCount} 道题。\n\n继续会清空当前试题篮，并用「${record.title || record.filename}」这条导出记录中的 ${record.items.length} 道题覆盖。是否继续？`
        )
        if (!confirmed) return
      }
      const syncTitle = window.confirm(
        `是否同时将当前试题篮名称改为「${record.title || record.filename}」？\n\n选择“确定”会同步名称；选择“取消”仅恢复题目。`
      )
      await exportRecordsApi.restoreToBasket(record.id, { collectionId, syncTitle })
      notifyBasketUpdated()
      alert(`已回填 ${record.items.length} 道题到试题篮。`)
    } catch (err) {
      alert(`回填失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsRestoring(null)
    }
  }

  return (
    <div className="mock-page-root flex min-h-[calc(100vh-6rem)] select-none flex-col gap-6 bg-zinc-50/20 p-6 dark:bg-zinc-950">
      <div className="flex flex-col items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:flex-row">
        <div className="flex w-full items-center gap-2 rounded border border-zinc-200 bg-zinc-50/50 px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-900 sm:w-80">
          <Search className="size-3.5 shrink-0 text-zinc-400" />
          <input
            type="text"
            placeholder="搜索试卷文档名称..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full border-none bg-transparent p-0 text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-300"
          />
        </div>

        <div className="flex w-full items-center gap-1.5 overflow-x-auto sm:w-auto">
          <span className="mr-1.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
            按格式筛选:
          </span>
          {(['All', 'Markdown', 'PDF', 'LaTeX'] as const).map((format) => (
            <button
              key={format}
              onClick={() => setFormatFilter(format)}
              className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                formatFilter === format
                  ? 'bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {format === 'All' ? '全部' : format}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/10">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
              <th className="p-3 max-w-[480px]">试卷文档名称</th>
              <th className="w-24 p-3 text-center">输出格式</th>
              <th className="w-20 p-3 text-center">包含题数</th>
              <th className="w-32 p-3">导出时间</th>
              <th className="w-24 p-3 text-center">状态</th>
              <th className="w-32 p-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-zinc-400">
                  正在读取试卷导出记录
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-zinc-400">
                  {error}
                </td>
              </tr>
            ) : filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-zinc-400">
                  暂无匹配的试卷导出记录
                </td>
              </tr>
            ) : (
              filteredRecords.map((record) => (
                <tr
                  key={record.id}
                  onClick={() => setActiveRecord(record)}
                  className="cursor-pointer border-b border-zinc-100 transition-colors hover:bg-zinc-50/50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
                >
                  <td className="p-3 text-left font-bold text-zinc-800 dark:text-zinc-200 max-w-[480px]">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate">{record.title || record.filename || '未命名导出'}</span>
                      <span className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                        {sourceTypeLabel(record.sourceType)}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-center">
                    <FormatBadge format={record.format} />
                  </td>
                  <td className="p-3 text-center font-mono font-semibold text-zinc-800 dark:text-zinc-300">
                    {record.questionCount ?? 0} 题
                  </td>
                  <td className="p-3 text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1 text-[11px]">
                      <Calendar className="size-3 text-zinc-400" />
                      {formatDate(record.createdAt)}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {record.status === 'failed' ? (
                      <span className="inline-flex min-w-12 items-center justify-center whitespace-nowrap rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                        失败
                      </span>
                    ) : (
                      <span className="inline-flex min-w-12 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                        <CheckCircle2 className="size-3" />
                        成功
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-center" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={(event) => handleDownload(record, event)}
                        disabled={record.status === 'failed' || !record.url}
                        className="rounded p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        title="下载此文件"
                      >
                        <Download className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setActiveRecord(record)}
                        className="rounded p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        title="详情预览"
                      >
                        <Info className="size-3.5" />
                      </button>
                      <button
                        onClick={(event) => handleDelete(record.id, event)}
                        disabled={isDeleting === record.id}
                        className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-950/20 dark:hover:text-red-400"
                        title="删除记录"
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

      {drawerRecord ? (
        <div
          onClick={() => setActiveRecord(null)}
          className={`fixed inset-0 z-50 flex justify-end bg-zinc-950/0 backdrop-blur-none transition-all duration-300 ${
            showDrawer ? 'bg-zinc-950/40 backdrop-blur-sm' : 'pointer-events-none'
          }`}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`flex h-full w-full max-w-xl flex-col justify-between border-l border-zinc-200 bg-white p-6 text-left shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 transform transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
              showDrawer ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
                <div className="space-y-1">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    <FileDown className="size-4 text-zinc-400" />
                    试卷大纲结构预览
                  </h3>
                  <p className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    档案编码：#{drawerRecord.id}
                  </p>
                </div>
                <button
                  onClick={() => setActiveRecord(null)}
                  className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950/20">
                <div>
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">文档名称</span>
                  <span className="mt-0.5 block truncate font-bold text-zinc-800 dark:text-zinc-200">{drawerRecord.title || drawerRecord.filename}</span>
                </div>
                <div>
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">输出类型</span>
                  <span className="mt-0.5 block font-semibold text-zinc-800 dark:text-zinc-200">{formatLabel(drawerRecord.format)}</span>
                </div>
                <div>
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">出卷日期</span>
                  <span className="mt-0.5 block font-semibold text-zinc-800 dark:text-zinc-200">{formatDate(drawerRecord.createdAt)}</span>
                </div>
              </div>
            </div>

            <div className="my-4 flex-1 space-y-3 overflow-y-auto pr-1">
              <h4 className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                收录的试题大纲 ({drawerRecord.questionCount} 道题)
              </h4>

              {drawerRecord.items?.length ? (
                <ExportOutlineList state={outlineByRecordId[drawerRecord.id]} fallbackItems={drawerRecord.items} />
              ) : (
                <div className="rounded border border-dashed border-zinc-200 py-8 text-center text-xs text-zinc-400 dark:border-zinc-800">
                  此历史记录包含的题目内容已在本地缓存中清空，可重新导出生成。
                </div>
              )}
            </div>

            <div className="flex gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => handleDownload(drawerRecord)}
                disabled={drawerRecord.status === 'failed' || !drawerRecord.url}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-zinc-900 py-2 text-xs font-semibold text-zinc-50 hover:bg-zinc-800 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <Download className="mr-1 size-3.5" />
                重新下载文件
              </button>
              <button
                type="button"
                onClick={() => handleRestoreToBasket(drawerRecord)}
                disabled={!drawerRecord.items?.length || isRestoring === drawerRecord.id}
                className="inline-flex items-center justify-center gap-1 rounded border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Undo2 className="size-3.5" />
                回填试题篮
              </button>
              <button
                type="button"
                onClick={() => setActiveRecord(null)}
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


function ExportOutlineList({ state, fallbackItems }: { state?: OutlineState; fallbackItems: ExportRecord['items'] }) {
  const rows = state?.items?.length ? state.items : fallbackItems
  return (
    <div className="space-y-3">
      {state?.loading ? (
        <div className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
          正在读取试题内容...
        </div>
      ) : null}
      {state?.error ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          {state.error}
        </div>
      ) : null}
      {rows.map((item, index) => (
        <ExportOutlineRow key={`${item.questionId}-${item.exportOrder}`} item={item} index={index} />
      ))}
    </div>
  )
}

function ExportOutlineRow({ item, index }: { item: OutlineItem; index: number }) {
  const question = item.question
  const stem = question ? (question.stemMarkdown || richBlocksPlainText(question.problemBlocks)) : ''
  const chapter = question?.chapter || question?.knowledgePoints?.[0] || ''
  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-100 bg-white p-3.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center justify-between gap-2 font-mono text-[9px] text-zinc-400 dark:text-zinc-500">
        <span className="min-w-0 truncate font-bold text-zinc-800 dark:text-zinc-300">
          第 {index + 1} 题{question?.questionType ? ` (${question.questionType})` : ''}
        </span>
        {chapter ? <span className="max-w-36 shrink-0 truncate">章节: {chapter}</span> : null}
      </div>
      <div className="truncate font-sans leading-relaxed text-zinc-800 dark:text-zinc-200">
        {question ? (
          <QuestionMarkdownContent content={stem || '题干为空'} figures={question?.figures} className="text-xs leading-relaxed" />
        ) : (
          <span className="text-zinc-400">{item.error ? '题目内容暂不可用' : '题目内容读取中...'}</span>
        )}
      </div>
    </div>
  )
}

function FormatBadge({ format }: { format: string }) {
  const normalized = normalizeFormat(format)
  const icon = {
    PDF: <FileText className="size-3 shrink-0 text-red-500" />,
    Markdown: <FileCode2 className="size-3 shrink-0 text-zinc-500" />,
    LaTeX: <FileCode2 className="size-3 shrink-0 text-emerald-500" />,
    All: <FileCode2 className="size-3 shrink-0 text-zinc-500" />,
  }[normalized]
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      {icon}
      {normalized}
    </span>
  )
}

function normalizeFormat(format: string): FormatFilter {
  const value = String(format || '').toLowerCase()
  if (value === 'pdf') return 'PDF'
  if (value === 'latex' || value === 'tex') return 'LaTeX'
  if (value === 'markdown' || value === 'md') return 'Markdown'
  return 'Markdown'
}

function formatLabel(format: string) {
  return normalizeFormat(format)
}

function formatDate(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function sourceTypeLabel(value: ExportRecord['sourceType']) {
  if (value === 'import_job') return '导入批次'
  if (value === 'run') return 'PDF 批次'
  return '试题篮'
}

export default ExportRecordsPage
