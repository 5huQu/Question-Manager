import { useEffect, useState, useMemo } from 'react'
import {
  DownloadCloud,
  Search,
  Trash2,
  ExternalLink,
  FileText,
  FileCode,
  FileSpreadsheet,
  AlertCircle,
  RefreshCcw,
  ShoppingBag,
  Scissors,
  Undo2
} from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { getActiveCollectionId, notifyBasketUpdated } from '@/components/QuestionBasket'
import { Button, Empty, PageTitle, Badge } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { Basket, ExportRecord } from '@/types'

// Helper to format bytes to human readable format
function formatBytes(bytes: number) {
  if (bytes === 0 || !bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Helper to format date strings
function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

// Helper to translate and format export variant values
function formatVariant(variantStr: string) {
  if (!variantStr) return '默认'
  const lower = variantStr.toLowerCase()
  const parts: string[] = []

  if (lower.includes('exam')) {
    parts.push('试卷')
  } else if (lower.includes('worksheet')) {
    parts.push('练习单')
  }

  if (lower.includes('teacher')) {
    parts.push('教师版')
  } else if (lower.includes('student')) {
    parts.push('学生版')
  }

  if (parts.length > 0) return parts.join(' · ')

  // Return mapping for common simple cases
  if (lower === 'student') return '学生版'
  if (lower === 'teacher') return '教师版'
  return variantStr
}

export function ExportRecordsPage() {
  const [query, setQuery] = useState('')
  const [sourceType, setSourceType] = useState<'collection' | 'run' | ''>('')
  const [limit, setLimit] = useState<number>(100)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [isRestoring, setIsRestoring] = useState<string | null>(null)

  // Construct URL with query parameters
  const requestUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (sourceType) params.set('sourceType', sourceType)
    params.set('limit', String(limit))
    return `/api/question-bank/export-records?${params.toString()}`
  }, [query, sourceType, limit])

  // Fetch export records data using the async hook
  const { data, error, loading, reload, setData } = useAsync<{ items: ExportRecord[] }>(
    () => api(requestUrl),
    [requestUrl]
  )

  const items = data?.items || []

  // Compute local stats from the fetched records
  const stats = useMemo(() => {
    let total = items.length
    let succeeded = 0
    let failed = 0
    let pdfCount = 0
    let latexCount = 0
    let mdCount = 0
    let totalQuestions = 0

    items.forEach((item) => {
      if (item.status === 'failed') {
        failed++
      } else {
        succeeded++
        totalQuestions += item.questionCount || 0
      }

      const format = String(item.format).toLowerCase()
      if (format === 'pdf') pdfCount++
      else if (format === 'latex' || format === 'tex') latexCount++
      else if (format === 'markdown' || format === 'md') mdCount++
    })

    return { total, succeeded, failed, pdfCount, latexCount, mdCount, totalQuestions }
  }, [items])

  // Handle delete request
  async function handleDelete(recordId: string, filename: string) {
    if (!window.confirm(`确定要删除导出记录吗？\n文件名: ${filename}\n(提示: 此操作仅删除记录，不会删除实际生成的导出文件)`)) {
      return
    }

    setIsDeleting(recordId)
    try {
      await api(`/api/question-bank/export-records/${encodeURIComponent(recordId)}`, {
        method: 'DELETE',
      })

      // Update state locally
      setData((current) => {
        if (!current) return current
        return {
          ...current,
          items: current.items.filter((item) => item.id !== recordId),
        }
      })
    } catch (err: any) {
      alert(`删除记录失败: ${err?.message || err}`)
    } finally {
      setIsDeleting(null)
    }
  }

  // Handle manual download/open
  function handleOpen(url: string) {
    if (!url) return
    window.open(url, '_blank')
  }

  async function handleRestoreToBasket(item: ExportRecord) {
    if (!item.items?.length) {
      alert('这条导出记录没有题目快照，无法回填到试题篮。')
      return
    }
    const collectionId = getActiveCollectionId()
    setIsRestoring(item.id)
    try {
      const current = await api<Basket>(`/api/question-bank/collections/${encodeURIComponent(collectionId)}`)
      if ((current.questionCount || 0) > 0) {
        const confirmed = window.confirm(
          `当前试题篮「${current.title || collectionId}」已有 ${current.questionCount} 道题。\n\n继续会清空当前试题篮，并用「${item.title || item.filename}」这条导出记录中的 ${item.items.length} 道题覆盖。是否继续？`
        )
        if (!confirmed) return
      }
      const syncTitle = window.confirm(
        `是否同时将当前试题篮名称改为「${item.title || item.filename}」？\n\n选择“确定”会同步名称；选择“取消”仅恢复题目。`
      )
      await api(`/api/question-bank/export-records/${encodeURIComponent(item.id)}/restore-to-basket`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ collectionId, syncTitle }),
      })
      notifyBasketUpdated()
      alert(`已回填 ${item.items.length} 道题到试题篮。`)
    } catch (err: any) {
      alert(`回填失败: ${err?.message || err}`)
    } finally {
      setIsRestoring(null)
    }
  }

  return (
    <section className="space-y-6 max-w-7xl mx-auto">
      {/* Title Header */}
      <PageTitle
        title="导出记录"
        desc="查看与管理试题篮（组卷）及 PDF 切分批次的导出历史，支持快速预览及下载。"
        path="/exports"
      />

      {/* Stats Summary Dashboard */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
        <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">总导出记录</span>
          <span className="text-2xl font-bold mt-2 text-zinc-900 dark:text-zinc-50">{stats.total} 次</span>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">导出成功 / 失败</span>
          <span className="text-2xl font-bold mt-2 text-zinc-900 dark:text-zinc-50 flex items-center gap-1.5">
            <span className="text-emerald-600 dark:text-emerald-505">{stats.succeeded}</span>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <span className={stats.failed > 0 ? 'text-red-600 dark:text-red-500' : 'text-zinc-500'}>{stats.failed}</span>
          </span>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">导出总题目数</span>
          <span className="text-2xl font-bold mt-2 text-zinc-900 dark:text-zinc-50">{stats.totalQuestions} 题</span>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">格式分布</span>
          <span className="text-[13px] font-semibold mt-2 text-zinc-900 dark:text-zinc-50 flex flex-wrap gap-2">
            <span className="flex items-center gap-1"><Badge variant="danger">PDF</Badge> <span className="text-xs text-zinc-500 font-medium">{stats.pdfCount}</span></span>
            <span className="flex items-center gap-1"><Badge variant="default">LaTeX</Badge> <span className="text-xs text-zinc-500 font-medium">{stats.latexCount}</span></span>
            <span className="flex items-center gap-1"><Badge variant="success">MD</Badge> <span className="text-xs text-zinc-500 font-medium">{stats.mdCount}</span></span>
          </span>
        </div>
        <div className="hidden lg:flex bg-white dark:bg-zinc-900 p-4.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex-col justify-between col-span-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">系统连接</span>
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mt-3">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>双端运行正常</span>
          </span>
        </div>
      </div>

      {/* Filter and Content Panel */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        {/* Filter Bar */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center flex-1">
            {/* Keyword Search */}
            <div className="relative min-w-[200px] md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
              <input
                type="text"
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
                placeholder="搜索标题、文件名、格式..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {/* Source Type Filter */}
            <select
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as any)}
            >
              <option value="">所有来源</option>
              <option value="collection">试题篮 (组卷)</option>
              <option value="run">PDF 切分批次</option>
            </select>

            {/* Limit Selector */}
            <select
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 text-sm focus:ring-1 focus:ring-zinc-400 focus:outline-none dark:focus:ring-zinc-700"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value="50">显示最近 50 条</option>
              <option value="100">显示最近 100 条</option>
              <option value="200">显示最近 200 条</option>
              <option value="500">显示最近 500 条</option>
            </select>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery('')
                setSourceType('')
                setLimit(100)
                reload()
              }}
              icon={RefreshCcw}
            >
              重置
            </Button>
          </div>
        </div>

        {/* Records Table/List */}
        <div className="overflow-x-auto">
          {loading && !data ? (
            <div className="py-20 text-center"><Empty text="读取数据中..." /></div>
          ) : error ? (
            <div className="py-20 text-center text-red-500"><Empty text={`加载出错: ${error}`} /></div>
          ) : items.length === 0 ? (
            <div className="py-20"><Empty text="暂无符合条件的导出记录。" /></div>
          ) : (
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-zinc-150 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 font-semibold bg-zinc-50/30 dark:bg-zinc-900/10">
                  <th className="py-3.5 px-4 font-semibold w-[22%]">导出标题 / 文件名</th>
                  <th className="py-3.5 px-4 font-semibold w-[14%]">来源</th>
                  <th className="py-3.5 px-4 font-semibold w-[10%]">导出格式</th>
                  <th className="py-3.5 px-4 font-semibold w-[12%]">导出版本</th>
                  <th className="py-3.5 px-4 font-semibold w-[8%] text-center">题目数量</th>
                  <th className="py-3.5 px-4 font-semibold w-[10%]">文件大小</th>
                  <th className="py-3.5 px-4 font-semibold w-[13%]">导出时间</th>
                  <th className="py-3.5 px-4 font-semibold w-[11%] text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {items.map((item) => {
                  const format = String(item.format).toLowerCase()

                  // Pick format badge details
                  let formatBadge = <Badge variant="default">{item.format}</Badge>
                  let FormatIcon = FileCode
                  if (format === 'pdf') {
                    formatBadge = <Badge variant="danger">PDF</Badge>
                    FormatIcon = FileText
                  } else if (format === 'latex' || format === 'tex') {
                    formatBadge = <Badge variant="default">LaTeX</Badge>
                    FormatIcon = FileSpreadsheet
                  } else if (format === 'markdown' || format === 'md') {
                    formatBadge = <Badge variant="success">Markdown</Badge>
                    FormatIcon = FileCode
                  }

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/10 transition-colors group"
                    >
                      {/* Name / Title */}
                      <td className="py-3 px-4 min-w-0">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" title={item.title}>
                          {item.title || '未命名导出'}
                        </div>
                        <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5" title={item.filename}>
                          {item.filename}
                        </div>
                      </td>

                      {/* Source */}
                      <td className="py-3 px-4">
                        {item.sourceType === 'collection' ? (
                          <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                            <span className="p-1 rounded bg-teal-50 dark:bg-teal-950/30 text-teal-600 dark:text-teal-400 shrink-0">
                              <ShoppingBag className="size-3.5" />
                            </span>
                            <div className="min-w-0">
                              <span className="text-xs font-semibold block leading-tight">试题篮</span>
                              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate block" title={item.collectionId}>
                                {item.collectionId}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                            <span className="p-1 rounded bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 shrink-0">
                              <Scissors className="size-3.5" />
                            </span>
                            <div className="min-w-0">
                              <span className="text-xs font-semibold block leading-tight">PDF 切分批次</span>
                              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate block" title={item.runId}>
                                {item.runId}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Format */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <FormatIcon className={`size-4 shrink-0 ${
                            format === 'pdf' ? 'text-red-500' : format === 'markdown' || format === 'md' ? 'text-emerald-500' : 'text-blue-500'
                          }`} />
                          {formatBadge}
                        </div>
                      </td>

                      {/* Variant */}
                      <td className="py-3 px-4 text-zinc-600 dark:text-zinc-300">
                        <span className="text-xs font-medium bg-zinc-100 dark:bg-zinc-800/40 px-2 py-0.5 rounded-md border border-zinc-200/40 dark:border-zinc-700/20 whitespace-nowrap">
                          {formatVariant(item.variant)}
                        </span>
                      </td>

                      {/* Question count */}
                      <td className="py-3 px-4 text-center font-semibold text-zinc-700 dark:text-zinc-300">
                        {item.questionCount ?? 0}
                      </td>

                      {/* File size */}
                      <td className="py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium">
                        {item.status === 'failed' ? '-' : formatBytes(item.contentLength)}
                      </td>

                      {/* Export time */}
                      <td className="py-3 px-4 text-zinc-400 dark:text-zinc-500">
                        {formatDate(item.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Restore to basket */}
                          <button
                            type="button"
                            onClick={() => handleRestoreToBasket(item)}
                            disabled={item.status === 'failed' || !item.items?.length || isRestoring === item.id}
                            className="p-1.5 rounded-lg border transition-all text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:border-emerald-200 dark:hover:border-emerald-900/30 border-zinc-200 dark:border-zinc-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            title={item.items?.length ? '回填并覆盖当前试题篮' : '这条记录没有题目快照，无法回填'}
                          >
                            <Undo2 className="size-4" />
                          </button>

                          {/* Open/Download */}
                          <button
                            type="button"
                            onClick={() => handleOpen(item.url)}
                            disabled={item.status === 'failed' || !item.url}
                            className={`p-1.5 rounded-lg border transition-all text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-zinc-200 dark:border-zinc-800 disabled:opacity-30 disabled:pointer-events-none cursor-pointer`}
                            title={item.status === 'failed' ? `导出失败: ${item.error}` : '查看/下载文件'}
                          >
                            {item.status === 'failed' ? (
                              <AlertCircle className="size-4 text-red-505" />
                            ) : (
                              <ExternalLink className="size-4" />
                            )}
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id, item.filename || item.title)}
                            disabled={isDeleting === item.id}
                            className="p-1.5 rounded-lg border transition-all text-zinc-500 dark:text-zinc-500 hover:text-red-655 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 hover:border-red-200 dark:hover:border-red-900/30 border-zinc-200 dark:border-zinc-800 cursor-pointer"
                            title="删除此记录"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}

export default ExportRecordsPage
