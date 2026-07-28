import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, FilePenLine, Inbox, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { teachingDocumentsApi, type TeachingDocumentSummary } from '@/api/teachingDocuments'
import { formatRelativeTime } from '@/utils/formatTime'

/** 简单下拉菜单（点击外部自动关闭） */
function Dropdown({ trigger, children, align = 'right' }: {
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((value) => !value)}>{trigger}</div>
      {open ? (
        <div
          className={`absolute z-50 mt-1 min-w-36 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 ${align === 'right' ? 'right-0' : 'left-0'}`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({ icon: Icon, label, danger, onClick }: {
  icon: typeof Pencil
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
        danger
          ? 'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
          : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}

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

  async function create() {
    setCreating(true)
    try {
      const record = await teachingDocumentsApi.createDocument({
        title: '未命名文档',
        documentType: 'lecture',
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
          onClick={() => void create()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-900/90 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90"
        >
          <Plus className="size-4" />
          新建文档
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid grid-cols-[minmax(260px,1.5fr)_140px_140px_56px] border-b border-zinc-200 bg-zinc-50/70 px-4 text-[12px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
          <span className="py-3">文档</span>
          <span className="py-3">内容</span>
          <span className="py-3">更新时间</span>
          <span className="py-3" />
        </div>

        {loading ? (
          <div className="space-y-0">
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid grid-cols-[minmax(260px,1.5fr)_140px_140px_56px] items-center border-b border-zinc-100 px-4 py-3.5 last:border-0 dark:border-zinc-900">
                <div className="flex items-center gap-3">
                  <span className="size-8 shrink-0 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
                  <div className="space-y-1.5">
                    <span className="block h-3.5 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                    <span className="block h-2.5 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                  </div>
                </div>
                <span className="h-3 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <span className="h-3 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <span />
              </div>
            ))}
          </div>
        ) : items.length ? items.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => open(item)}
            onKeyDown={(event) => { if (event.key === 'Enter') open(item) }}
            className="grid cursor-pointer grid-cols-[minmax(260px,1.5fr)_140px_140px_56px] items-center border-b border-zinc-100 px-4 transition-colors last:border-0 hover:bg-zinc-50/50 dark:border-zinc-900 dark:hover:bg-zinc-900/30"
          >
            <div className="flex min-w-0 items-center gap-3 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <FilePenLine className="size-4 text-zinc-500" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</span>
              </span>
            </div>
            <span className="text-xs text-zinc-500">{item.blockCount} 段内容 · {item.assetCount} 图</span>
            <span className="text-xs tabular-nums text-zinc-400" title={new Date(item.updatedAt).toLocaleString()}>
              {formatRelativeTime(item.updatedAt)}
            </span>
            <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
              <Dropdown
                align="right"
                trigger={
                  <button type="button" className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" title="更多操作">
                    <MoreHorizontal className="size-4" />
                  </button>
                }
              >
                <MenuItem icon={Pencil} label="重命名" onClick={() => void rename(item)} />
                <MenuItem icon={Copy} label="创建副本" onClick={() => void duplicate(item)} />
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-900" />
                <MenuItem icon={Trash2} label="删除" danger onClick={() => void remove(item)} />
              </Dropdown>
            </div>
          </div>
        )) : (
          <div className="flex flex-col items-center justify-center p-12">
            <div className="flex flex-col items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/10 px-16 py-10 dark:border-zinc-800">
              <Inbox className="size-8 text-zinc-300 dark:text-zinc-700" />
              <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">暂无文档</p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">点击右上角“新建文档”开始创建。</p>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
