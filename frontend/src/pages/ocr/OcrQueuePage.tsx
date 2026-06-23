import { useEffect } from 'react'
import { RefreshCcw } from 'lucide-react'
import { ocrApi } from '@/api/ocr'
import { Button, Empty } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrJobs } from '@/types'
import { OcrJobCard } from './OcrJobCard'
import { OcrHistoryRow } from './OcrHistoryRow'

export function OcrQueuePage() {
  const { data, error, loading, reload } = useAsync<OcrJobs>(() => ocrApi.getJobs(), [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      reload({ silent: true })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [reload])
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
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/70">
          <h3 className="text-sm font-semibold">运行与排队中</h3>
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
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/70">
          <h3 className="text-sm font-semibold">过往 OCR 任务</h3>
        </div>
        <div className="p-4">
        {data?.historyRuns.length ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 hover:bg-transparent dark:border-zinc-800 dark:bg-zinc-900/70">
                  <th className="h-10 max-w-[220px] px-4 text-left align-middle font-medium text-zinc-500 dark:text-zinc-400">试卷/任务名称</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-zinc-500 dark:text-zinc-400">分类/类型</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-zinc-500 dark:text-zinc-400">识别通道</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-zinc-500 dark:text-zinc-400">状态</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-zinc-500 dark:text-zinc-400">题数统计</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-zinc-500 dark:text-zinc-400">创建时间</th>
                  <th className="h-10 px-4 text-center align-middle font-medium text-zinc-500 dark:text-zinc-400">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.historyRuns.map((run) => (
                  <OcrHistoryRow key={run.runId} run={run} onReload={reload} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="暂无历史 OCR 任务。" />
        )}
        </div>
      </section>
    </section>
  )
}

export default OcrQueuePage
