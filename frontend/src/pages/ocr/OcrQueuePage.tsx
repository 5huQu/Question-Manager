import { useEffect } from 'react'
import { RefreshCcw } from 'lucide-react'
import { api } from '@/api/client'
import { Button, Empty, PageTitle, Panel, SummaryGrid } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import type { OcrJobs, OcrProgress } from '@/types'
import { OcrJobCard } from './OcrJobCard'

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
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="当前 OCR" actions={<Button size="sm" variant="outline" onClick={reload} icon={RefreshCcw}>刷新</Button>}>
          {loading && !data ? <Empty text="读取中..." /> : error ? <Empty text={error} /> : data?.currentRun ? <OcrJobCard run={data.currentRun} onReload={reload} /> : <Empty text="当前没有正在执行的 OCR 任务。" />}
        </Panel>
        <Panel title="OCR 队列">
          {data?.queuedRuns.length ? data.queuedRuns.map((run) => <OcrJobCard key={run.runId} run={run} onReload={reload} />) : <Empty text="当前没有排队任务。" />}
        </Panel>
      </div>
      <Panel title="过往 OCR 任务">
        {data?.historyRuns.length ? <div className="grid gap-3 xl:grid-cols-2">{data.historyRuns.map((run) => <OcrJobCard key={run.runId} run={run} onReload={reload} />)}</div> : <Empty text="暂无历史 OCR 任务。" />}
      </Panel>
    </section>
  )
}

type CleanupRecord = NonNullable<NonNullable<OcrProgress['formatCleanup']>['records']>[number]


export default OcrQueuePage
