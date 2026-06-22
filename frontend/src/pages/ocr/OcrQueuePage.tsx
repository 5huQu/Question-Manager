import { useEffect } from 'react'
import { RefreshCcw } from 'lucide-react'
import { api } from '@/api/client'
import { Button, Empty, PageTitle, Panel, SummaryGrid } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrJobs } from '@/types'
import { OcrJobCard } from './OcrJobCard'
import { OcrHistoryRow } from './OcrHistoryRow'

export function OcrQueuePage() {
  const { data, error, loading, reload } = useAsync<OcrJobs>(() => api('/api/tools/pdf-slicer/ocr-jobs'), [])
  useEffect(() => {
    const timer = window.setInterval(() => {
      reload({ silent: true })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [reload])
  return (
    <section className="space-y-4">
      <PageTitle title="OCR 队列" desc="跟踪识别任务、断点续跑和失败处理。" path="/tools/pdf-slicer/ocr-jobs" />
      <SummaryGrid items={[['OCR任务总数', data?.summary.totalJobs], ['排队中', data?.summary.queuedCount], ['运行中', data?.summary.runningCount], ['已完成', data?.summary.succeededCount], ['失败', data?.summary.failedCount]]} />

      <Panel title="运行与排队中" actions={<Button size="sm" variant="outline" onClick={reload} icon={RefreshCcw}>刷新</Button>}>
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
                <h4 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
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
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
      </Panel>

      <Panel title="过往 OCR 任务">
        {data?.historyRuns.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 hover:bg-transparent">
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground max-w-[220px]">试卷/任务名称</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">分类/类型</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">识别通道</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">状态</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">题数统计</th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">创建时间</th>
                  <th className="h-10 px-4 text-center align-middle font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.historyRuns.map((run) => (
                  <OcrHistoryRow key={run.runId} run={run} onReload={reload} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="暂无历史 OCR 任务。" />
        )}
      </Panel>
    </section>
  )
}

export default OcrQueuePage
