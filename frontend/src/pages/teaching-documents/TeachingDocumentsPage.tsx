import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpenText, Copy, FilePenLine, FilePlus2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { teachingDocumentsApi, type TeachingDocumentSummary } from '@/api/teachingDocuments'

const TYPE_LABEL = { lecture: '讲义', worksheet: '练习单', exam: '试卷' } as const

export default function TeachingDocumentsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<TeachingDocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

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

  async function create(documentType: TeachingDocumentSummary['documentType']) {
    setCreating(true)
    try {
      const record = await teachingDocumentsApi.createDocument({
        title: `未命名${TYPE_LABEL[documentType]}`,
        documentType,
      })
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
    if (!window.confirm(`确定删除“${item.title}”？文档资源文件将保留，不会立即清理。`)) return
    try {
      await teachingDocumentsApi.deleteDocument(item.id)
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  return (
    <main className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">讲义文档</h1>
          <p className="mt-1 text-[13px] text-zinc-500">管理结构化讲义、练习单和试卷内容；页面排版由独立排版模块负责。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['lecture', 'worksheet', 'exam'] as const).map((type) => (
            <button
              key={type}
              type="button"
              disabled={creating}
              onClick={() => void create(type)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              <FilePlus2 className="size-4" />
              新建{TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid grid-cols-[minmax(280px,1.5fr)_120px_120px_170px_150px] border-b border-zinc-200 bg-zinc-50/70 px-4 text-xs font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
          <span className="py-3">文档</span><span className="py-3">类型</span><span className="py-3">内容</span><span className="py-3">更新时间</span><span className="py-3 text-right">操作</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-sm text-zinc-500">正在读取讲义文档…</div>
        ) : items.length ? items.map((item) => (
          <div key={item.id} className="grid grid-cols-[minmax(280px,1.5fr)_120px_120px_170px_150px] items-center border-b border-zinc-100 px-4 last:border-0 hover:bg-zinc-50/50 dark:border-zinc-900 dark:hover:bg-zinc-900/30">
            <button type="button" className="flex min-w-0 items-center gap-3 py-3 text-left" onClick={() => navigate(`/teaching-documents/${encodeURIComponent(item.id)}`)}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"><FilePenLine className="size-4 text-zinc-500" /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-0.5 block text-[11px] text-zinc-400">revision {item.revision}</span></span>
            </button>
            <span className="text-sm text-zinc-600 dark:text-zinc-300">{TYPE_LABEL[item.documentType]}</span>
            <span className="text-xs text-zinc-500">{item.blockCount} 块 · {item.assetCount} 图</span>
            <span className="text-xs text-zinc-500">{new Date(item.updatedAt).toLocaleString()}</span>
            <div className="flex justify-end gap-1">
              <button type="button" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="打开" onClick={() => navigate(`/teaching-documents/${encodeURIComponent(item.id)}`)}><BookOpenText className="size-4" /></button>
              <button type="button" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="重命名" onClick={() => void rename(item)}><Pencil className="size-4" /></button>
              <button type="button" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="复制" onClick={() => void duplicate(item)}><Copy className="size-4" /></button>
              <button type="button" className="rounded-md p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" title="删除" onClick={() => void remove(item)}><Trash2 className="size-4" /></button>
            </div>
          </div>
        )) : (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <MoreHorizontal className="size-8 text-zinc-300" />
            <p className="mt-3 text-sm font-medium">暂无讲义文档</p>
            <p className="mt-1 text-xs text-zinc-500">从右上角新建讲义、练习单或试卷。</p>
          </div>
        )}
      </div>
    </main>
  )
}
