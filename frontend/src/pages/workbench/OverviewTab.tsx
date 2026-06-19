import { LoaderCircle, Wifi } from 'lucide-react'
import { Badge, Button, Panel } from '@/components/ui'
import { RichContent } from '@/components/RichContent'
import { MetricBox } from '@/components/dashboard/MetricBox'
import { OcrEngineStatus } from '@/components/dashboard/OcrEngineStatus'
import type { Dashboard, OcrSettings, QuestionBankResponse } from '@/types'
import { label, statusVariant } from '@/utils/questionDisplay'

export function OverviewTab({ dashboard, questionBank, ocrSettings, setActiveTab }: { dashboard: Dashboard | null; questionBank: QuestionBankResponse | null; ocrSettings: OcrSettings | null; setActiveTab: (tab: 'overview' | 'slicer' | 'ocr' | 'bank') => void }) {
  const runs = dashboard?.runs ?? []
  const bankItems = questionBank?.items ?? []
  const displayItems = bankItems

  const basketCount = questionBank?.basket?.questionCount ?? 0
  const bankCount = questionBank?.totalItems ?? bankItems.length

  return (
    <div className="space-y-5 h-[calc(100vh-9rem)] min-h-[580px] overflow-auto pr-1">
      {/* Visual Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricBox
          title="系统总批次"
          value={dashboard?.queueSummary.totalRuns ?? runs.length}
          subtitle="包含运行、完成与异常"
          color="zinc"
        />
        <MetricBox
          title="待切题批次"
          value={dashboard?.queueSummary.sliceQueued ?? runs.filter(r => r.sliceStatus === 'slicing').length}
          subtitle="已上传暂无切片"
          color="amber"
        />
        <MetricBox
          title="OCR 队列运行"
          value={(dashboard?.queueSummary.ocrQueued ?? 0) + (dashboard?.queueSummary.ocrRunning ?? 0)}
          subtitle="正在识别的任务"
          color="indigo"
        />
        <MetricBox
          title="题库已导入"
          value={bankCount}
          subtitle={`试题篮中已有 ${basketCount} 题`}
          color="emerald"
        />
      </div>



      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left Side: Recent Batches */}
        <div className="lg:col-span-2 space-y-3">
          <Panel title="活跃切片与识别批次" actions={
            <button className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer text-left" onClick={() => setActiveTab('slicer')}>查看全部 &rarr;</button>
          }>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b bg-zinc-50 text-zinc-500 font-semibold">
                    <th className="p-2.5">批次名称 / 文件名</th>
                    <th className="p-2.5">状态</th>
                    <th className="p-2.5">题块 (复核/通过)</th>
                    <th className="p-2.5">更新时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runs.slice(0, 5).map((run) => (
                    <tr key={run.runId} className="hover:bg-zinc-50/50">
                      <td className="p-2.5">
                        <div className="font-semibold text-zinc-900 truncate max-w-[280px]" title={run.paperTitle || run.pdfName}>{run.paperTitle || run.pdfName}</div>
                        <div className="text-[10px] text-zinc-400 mt-0.5 truncate max-w-[280px]">{run.pdfName}</div>
                      </td>
                      <td className="p-2.5">
                        <Badge variant={statusVariant(run.sliceStatus)}>{label(run.sliceStatus)}</Badge>
                      </td>
                      <td className="p-2.5 font-medium">
                        {run.totalQuestions} ({run.unreviewedQuestions}/{run.approvedQuestions})
                      </td>
                      <td className="p-2.5 text-zinc-500">
                        {new Date(run.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                  {!runs.length && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-zinc-400">暂无活跃运行批次</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* Right Side: Quick Setup & Status */}
        <div className="space-y-4">
          <Panel title="OCR 引擎配置">
            <OcrEngineStatus ocrSettings={ocrSettings} />
          </Panel>

          <Panel title="最近录入记录" actions={
            <button className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer text-left" onClick={() => setActiveTab('bank')}>前往题库 &rarr;</button>
          }>
            <div className="space-y-2.5 max-h-[180px] overflow-auto">
              {displayItems.slice(0, 4).map((item) => (
                <div key={item.id} className="flex items-start gap-2.5 border-b pb-2 last:border-b-0 last:pb-0">
                  <div className="mt-0.5 rounded bg-zinc-100 px-1 py-0.5 text-[9px] font-semibold text-zinc-600">#{item.questionNo}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-zinc-800 dark:text-zinc-50 line-clamp-2 max-h-12 overflow-hidden leading-snug">
                      <RichContent blocks={item.problemBlocks} className="text-xs text-zinc-800 dark:text-zinc-50" />
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5 truncate">{item.sourceTitle || '未知来源'}</p>
                  </div>
                </div>
              ))}
              {(!displayItems.length) && (
                <p className="text-center text-zinc-400 py-4 text-xs">当前题库无记录</p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
