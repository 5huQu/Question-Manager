import { RefreshCcw } from 'lucide-react'
import { Button, Empty, Panel } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { ocrApi } from '@/api/ocr'
import type { Dashboard, OcrJobs } from '@/types'
import { OcrJobCard } from '@/pages/ocr/OcrJobCard'

export function OcrTab({ dashboard, mockLogs }: { dashboard: Dashboard | null; mockLogs: string[] }) {
  const ocrJobs = useAsync<OcrJobs>(() => ocrApi.getJobs(), [])

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] h-[calc(100vh-9rem)] min-h-[580px] overflow-hidden">
      {/* Slices Pending OCR or Queue */}
      <div className="h-full overflow-auto space-y-4 pr-1 pb-4">
        <Panel title="当前识别任务" actions={
          <Button size="sm" variant="outline" icon={RefreshCcw} onClick={ocrJobs.reload}>刷新</Button>
        }>
          {ocrJobs.loading ? <Empty text="读取中..." /> : ocrJobs.error ? <Empty text={ocrJobs.error} /> : ocrJobs.data?.currentRun ? (
            <OcrJobCard run={ocrJobs.data.currentRun} onReload={ocrJobs.reload} />
          ) : (
            <Empty text="当前没有正在执行 OCR 识别。" />
          )}
        </Panel>

        <Panel title="OCR 任务排队中">
          <div className="space-y-3">
            {ocrJobs.data?.queuedRuns.map((run) => (
              <OcrJobCard key={run.runId} run={run} onReload={ocrJobs.reload} />
            ))}
            {(!ocrJobs.data?.queuedRuns || !ocrJobs.data.queuedRuns.length) && (
              <p className="text-center text-xs text-zinc-400 py-4">当前没有排队中的任务。</p>
            )}
          </div>
        </Panel>
      </div>

      {/* OCR Settings and Terminal logs */}
      <div className="h-full flex flex-col overflow-hidden">
        <Panel title="OCR 引擎日志 (实时滚动)">
          <div className="bg-zinc-950 font-mono text-[10px] text-zinc-300 p-3 rounded-xl min-h-[350px] max-h-[460px] overflow-auto space-y-1.5 shadow-inner leading-relaxed">
            {mockLogs.map((log, index) => {
              let color = 'text-zinc-400'
              if (log.includes('[SYSTEM]')) color = 'text-blue-400 font-semibold'
              if (log.includes('[SUCCESS]')) color = 'text-emerald-400 font-semibold'
              if (log.includes('[DEBUG]')) color = 'text-zinc-500'
              if (log.includes('[INFO]')) color = 'text-zinc-300'
              return (
                <div key={index} className={color}>
                  {log}
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </div>
  )
}
