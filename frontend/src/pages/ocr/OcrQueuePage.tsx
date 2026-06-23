import { useEffect, useState } from 'react'
import { RefreshCcw, Trash2, X } from 'lucide-react'
import { ocrApi } from '@/api/ocr'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrJobs } from '@/types'
import { OcrJobCard } from './OcrJobCard'
import { OcrHistoryRow } from './OcrHistoryRow'

export function OcrQueuePage() {
  const { data, error, loading, reload } = useAsync<OcrJobs>(() => ocrApi.getJobs(), [])
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => {
      reload({ silent: true })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [reload])

  const handleSelect = (runId: string) => {
    setSelectedRunIds(prev =>
      prev.includes(runId)
        ? prev.filter(id => id !== runId)
        : [...prev, runId]
    )
  }

  const handleSelectAll = () => {
    if (!data?.historyRuns) return
    const allIds = data.historyRuns.map(r => r.runId)
    if (selectedRunIds.length === allIds.length) {
      setSelectedRunIds([])
    } else {
      setSelectedRunIds(allIds)
    }
  }

  const handleBatchRerun = async () => {
    if (selectedRunIds.length === 0) return
    if (!window.confirm(`确定要批量完全重跑这 ${selectedRunIds.length} 个任务吗？`)) return
    setIsProcessing(true)
    try {
      await Promise.all(selectedRunIds.map(id => ocrApi.forceRerunOcr(id)))
      setSelectedRunIds([])
      reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setIsProcessing(false)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedRunIds.length === 0) return
    if (!window.confirm(`确定要批量删除这 ${selectedRunIds.length} 个任务吗？此操作不可逆。`)) return
    setIsProcessing(true)
    try {
      await Promise.all(selectedRunIds.map(id => pdfSlicerApi.deleteRun(id)))
      setSelectedRunIds([])
      reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <section className="mock-page-root min-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto bg-zinc-50/10 p-6 text-zinc-950 dark:bg-zinc-950/20 dark:text-zinc-50">
      <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">OCR 队列</h1>
          <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">跟踪识别任务、断点续跑和失败处理。</p>
        </div>
        <span className="inline-flex min-h-6 items-center rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">/tools/pdf-slicer/ocr-jobs</span>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {[
          ['OCR任务总数', data?.summary.totalJobs],
          ['排队中', data?.summary.queuedCount],
          ['运行中', data?.summary.runningCount],
          ['已完成', data?.summary.succeededCount],
          ['失败', data?.summary.failedCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-zinc-200 bg-white p-4 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value ?? 0}</p>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-900 dark:bg-zinc-900/10">
          <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">运行与排队中</h3>
          <Button size="sm" variant="outline" onClick={reload} icon={RefreshCcw}>刷新</Button>
        </div>
        <div className="p-4">
        {loading && !data ? (
          <Empty text="读取中..." />
        ) : error ? (
          <Empty text={error} />
        ) : !data?.currentRun && !data?.queuedRuns.length ? (
          <Empty text="当前没有正在运行或排队的 OCR 任务。" />
        ) : (
          <div className="space-y-6">
            {data.currentRun && (
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  正在运行
                </h4>
                <OcrJobCard run={data.currentRun} onReload={reload} />
              </div>
            )}

            {data.queuedRuns && data.queuedRuns.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  排队中 ({data.queuedRuns.length})
                </h4>
                <div className="grid gap-3 md:grid-cols-2">
                  {data.queuedRuns.map((run) => (
                    <OcrJobCard key={run.runId} run={run} onReload={reload} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-900 dark:bg-zinc-900/10">
          <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">过往 OCR 任务</h3>
        </div>
        <div className="p-4">
        {data?.historyRuns.length ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-zinc-50/70 dark:bg-zinc-900/40">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="h-10 w-10 px-4 text-center align-middle">
                    <input
                      type="checkbox"
                      checked={data.historyRuns.length > 0 && selectedRunIds.length === data.historyRuns.length}
                      onChange={handleSelectAll}
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 cursor-pointer"
                    />
                  </th>
                  <th className="h-10 max-w-[220px] px-4 text-left align-middle text-[12px] font-semibold text-zinc-500">试卷/任务名称</th>
                  <th className="h-10 px-4 text-left align-middle text-[12px] font-semibold text-zinc-500">分类/类型</th>
                  <th className="h-10 px-4 text-left align-middle text-[12px] font-semibold text-zinc-500">识别通道</th>
                  <th className="h-10 px-4 text-left align-middle text-[12px] font-semibold text-zinc-500">状态</th>
                  <th className="h-10 px-4 text-left align-middle text-[12px] font-semibold text-zinc-500">题数统计</th>
                  <th className="h-10 px-4 text-left align-middle text-[12px] font-semibold text-zinc-500">创建时间</th>
                  <th className="h-10 px-4 text-center align-middle text-[12px] font-semibold text-zinc-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.historyRuns.map((run) => (
                  <OcrHistoryRow
                    key={run.runId}
                    run={run}
                    onReload={reload}
                    isSelected={selectedRunIds.includes(run.runId)}
                    onSelect={handleSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="暂无历史 OCR 任务。" />
        )}
        </div>
      </section>

      {/* Floating Light Command Bar */}
      {selectedRunIds.length > 0 && (
        <div
          className="fixed bottom-6 bg-card text-card-foreground border border-zinc-200 dark:border-zinc-800 rounded-full px-4 py-2 flex items-center gap-3.5 z-50 shadow-md select-none text-xs animate-command-bar"
          style={{ left: 'calc(50% + var(--sidebar-width) / 2)' }}
        >
          <div className="flex items-center gap-1.5 pl-1 shrink-0">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-mono font-bold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
              {selectedRunIds.length}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">已选择</span>
          </div>

          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1 shrink-0" />

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleBatchRerun}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-zinc-900 text-zinc-50 hover:bg-zinc-900/90 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90 font-medium transition-colors shadow-sm whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className={`size-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
              <span>批量完全重跑</span>
            </button>

            <button
              onClick={handleBatchDelete}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-200 bg-red-50/20 text-red-700 hover:bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/30 transition-colors font-medium whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              <span>批量删除任务</span>
            </button>
          </div>

          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1 shrink-0" />

          <button
            onClick={() => setSelectedRunIds([])}
            disabled={isProcessing}
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            title="取消选择"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </section>
  )
}

export default OcrQueuePage
