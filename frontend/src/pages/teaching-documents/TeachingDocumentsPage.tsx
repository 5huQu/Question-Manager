import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, FilePenLine, Inbox, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { teachingDocumentsApi, type TeachingDocumentSummary } from '@/api/teachingDocuments'
import type { TeachingDocumentType } from '@/types/teachingDocument'
import { formatRelativeTime } from '@/utils/formatTime'

const documentTypeLabels: Record<TeachingDocumentType, string> = {
  exam: '试卷',
  lecture: '讲义',
  worksheet: '练习单',
}

export default function TeachingDocumentsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<TeachingDocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newDocumentType, setNewDocumentType] = useState<TeachingDocumentType>('lecture')
  const [query, setQuery] = useState('')
  const [documentType, setDocumentType] = useState<TeachingDocumentType | ''>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await teachingDocumentsApi.listDocuments()
      setItems(response.items)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return items.filter((item) => {
      if (documentType && item.documentType !== documentType) return false
      return !normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery)
    })
  }, [documentType, items, query])

  async function create(documentType: TeachingDocumentType) {
    setCreating(true)
    try {
      const record = await teachingDocumentsApi.createDocument({
        title: '未命名文档',
        documentType,
      })
      setCreateDialogOpen(false)
      navigate(`/teaching-documents/${encodeURIComponent(record.id)}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setCreating(false)
    }
  }

  async function rename(item: TeachingDocumentSummary) {
    const title = window.prompt('输入新的文档标题', item.title)?.trim()
    if (!title || title === item.title) return
    try {
      await teachingDocumentsApi.updateDocument(item.id, { expectedRevision: item.revision, title })
      await load()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    }
  }

  async function duplicate(item: TeachingDocumentSummary) {
    try {
      const copy = await teachingDocumentsApi.duplicateDocument(item.id)
      navigate(`/teaching-documents/${encodeURIComponent(copy.id)}`)
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : String(duplicateError))
    }
  }

  async function remove(item: TeachingDocumentSummary) {
    if (!window.confirm(`确定删除"${item.title}"？此操作不可撤销。`)) return
    try {
      await teachingDocumentsApi.deleteDocument(item.id)
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  function open(item: TeachingDocumentSummary) {
    navigate(`/teaching-documents/${encodeURIComponent(item.id)}`)
  }

  return (
    <main className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">文档</h1>
          <p className="mt-1 text-[13px] text-zinc-500">创建和管理题目文档。</p>
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => setCreateDialogOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-900/90 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90"
        >
          <Plus className="size-4" />
          新建文档
        </button>
      </div>

      {createDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={() => { if (!creating) setCreateDialogOpen(false) }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-document-title"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-900">
              <h2 id="create-document-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">新建文档</h2>
              <p className="mt-1 text-[13px] text-zinc-500">选择文档类型后即可进入编辑器。</p>
            </div>
            <div className="space-y-2 p-5">
              {(Object.entries(documentTypeLabels) as Array<[TeachingDocumentType, string]>).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={newDocumentType === type}
                  onClick={() => setNewDocumentType(type)}
                  className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                    newDocumentType === type
                      ? 'border-zinc-900 bg-zinc-50/50 dark:border-zinc-100 dark:bg-zinc-900/40'
                      : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/30'
                  }`}
                >
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
                  <span className="text-xs text-zinc-500">{type === 'lecture' ? '阅读讲义排版' : type === 'exam' ? '正式试卷排版' : '正式试卷排版'}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-900">
              <button type="button" disabled={creating} onClick={() => setCreateDialogOpen(false)} className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900">取消</button>
              <button type="button" disabled={creating} onClick={() => void create(newDocumentType)} className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-900/90 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90">
                {creating ? '创建中...' : `创建${documentTypeLabels[newDocumentType]}`}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">{error}</div>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 md:grid-cols-[minmax(240px,1fr)_160px]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            aria-label="搜索文档"
            className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
            placeholder="搜索文档名称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="文档类型筛选"
          className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition-colors focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
          value={documentType}
          onChange={(event) => setDocumentType(event.target.value as TeachingDocumentType | '')}
        >
          <option value="">全部文档类型</option>
          {Object.entries(documentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid min-w-[760px] grid-cols-[minmax(260px,1.5fr)_90px_140px_140px_112px] border-b border-zinc-200 bg-zinc-50/70 px-4 text-[12px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
          <span className="py-3">文档</span>
          <span className="py-3">类型</span>
          <span className="py-3">内容</span>
          <span className="py-3">更新时间</span>
          <span className="py-3 text-right">操作</span>
        </div>

        {loading ? (
          <div className="space-y-0">
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid min-w-[760px] grid-cols-[minmax(260px,1.5fr)_90px_140px_140px_112px] items-center border-b border-zinc-100 px-4 py-3.5 last:border-0 dark:border-zinc-900">
                <div className="flex items-center gap-3">
                  <span className="size-8 shrink-0 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
                  <div className="space-y-1.5">
                    <span className="block h-3.5 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                    <span className="block h-2.5 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                  </div>
                </div>
                <span className="h-5 w-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <span className="h-3 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <span className="h-3 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <span />
              </div>
            ))}
          </div>
        ) : filteredItems.length ? filteredItems.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => open(item)}
            onKeyDown={(event) => { if (event.key === 'Enter') open(item) }}
            className="grid min-w-[760px] cursor-pointer grid-cols-[minmax(260px,1.5fr)_90px_140px_140px_112px] items-center border-b border-zinc-100 px-4 transition-colors last:border-0 hover:bg-zinc-50/50 dark:border-zinc-900 dark:hover:bg-zinc-900/30"
          >
            <div className="flex min-w-0 items-center gap-3 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <FilePenLine className="size-4 text-zinc-500" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</span>
              </span>
            </div>
            <span>
              <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {documentTypeLabels[item.documentType]}
              </span>
            </span>
            <span className="text-xs text-zinc-500">{item.blockCount} 段内容 · {item.assetCount} 图</span>
            <span className="text-xs tabular-nums text-zinc-400" title={new Date(item.updatedAt).toLocaleString()}>
              {formatRelativeTime(item.updatedAt)}
            </span>
            <div className="flex justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
              <button type="button" aria-label={`重命名 ${item.title}`} className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" title="重命名" onClick={() => void rename(item)}>
                <Pencil className="size-4" />
              </button>
              <button type="button" aria-label={`创建 ${item.title} 的副本`} className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" title="创建副本" onClick={() => void duplicate(item)}>
                <Copy className="size-4" />
              </button>
              <button type="button" aria-label={`删除 ${item.title}`} className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30 dark:hover:text-red-400" title="删除" onClick={() => void remove(item)}>
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        )) : (
          <div className="flex flex-col items-center justify-center p-12">
            <div className="flex flex-col items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/10 px-16 py-10 dark:border-zinc-800">
              <Inbox className="size-8 text-zinc-300 dark:text-zinc-700" />
              <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">{items.length ? '未找到匹配文档' : '暂无文档'}</p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{items.length ? '请调整搜索词或文档类型筛选。' : '点击右上角“新建文档”开始创建。'}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
