import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BadgeCheck, FileJson, LoaderCircle, ScanSearch } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { Badge, Button, Panel } from '@/components/ui'
import { Modal } from '@/components/dialogs/Modal'
import { RichContent } from '@/components/RichContent'
import { MetricBox } from '@/components/dashboard/MetricBox'
import { OcrEngineStatus } from '@/components/dashboard/OcrEngineStatus'
import { SliceReviewDialog } from '@/pages/pdf-slicer/SliceReviewDialog'
import type { ApiRun, Dashboard, OcrSettings, QuestionBankResponse, SliceReviewItem } from '@/types'
import { label, statusVariant } from '@/utils/questionDisplay'

export function OverviewTab({
  dashboard,
  questionBank,
  ocrSettings,
  onReload,
  setActiveTab
}: {
  dashboard: Dashboard | null;
  questionBank: QuestionBankResponse | null;
  ocrSettings: OcrSettings | null;
  onReload?: () => void;
  setActiveTab: (tab: 'overview' | 'slicer' | 'ocr' | 'bank') => void
}) {
  const navigate = useNavigate()
  const [actionRun, setActionRun] = useState<ApiRun | null>(null)
  const [reviewRun, setReviewRun] = useState<ApiRun | null>(null)
  const [busyAction, setBusyAction] = useState<'' | 'ocr' | 'manual'>('')
  const [actionError, setActionError] = useState('')
  const runs = dashboard?.runs ?? []
  const bankItems = questionBank?.items ?? []
  const displayItems = bankItems

  const basketCount = questionBank?.basket?.questionCount ?? 0
  const bankCount = questionBank?.totalItems ?? bankItems.length
  const canViewResult = (run: ApiRun) => {
    const pendingBankCount = run.importedQuestions ?? 0
    const generatedCount = Math.max(pendingBankCount, run.solutionItems ?? 0)
    const ocrCompleteByImport = generatedCount > 0 && generatedCount >= Math.max(run.approvedQuestions || run.totalQuestions || 0, 1)
    return run.ocrStatus === 'succeeded' || ocrCompleteByImport || (pendingBankCount > 0 && (run.bankedQuestions ?? 0) >= pendingBankCount)
  }

  async function getApprovedResultIds(run: ApiRun) {
    const payload = await api<{ items: SliceReviewItem[] }>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(run.runId)}/slice-review/items`)
    return (payload.items ?? [])
      .filter((item) => item.reviewStatus !== 'rejected')
      .map((item) => item.resultId)
  }

  async function startImport(run: ApiRun, mode: 'ocr' | 'manual') {
    setBusyAction(mode)
    setActionError('')
    try {
      const approvedResultIds = await getApprovedResultIds(run)
      if (!approvedResultIds.length) {
        setActionError('该批次暂无可导入的题块，请先完成切题复核。')
        return
      }
      await api('/api/tools/pdf-slicer/runs/quick-review', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ runId: run.runId, approvedResultIds, autoStartOcr: mode === 'ocr' }),
      })
      setActionRun(null)
      onReload?.()
      if (mode === 'manual') {
        navigate(`/questions/new?target=paper&method=direct&source=slices&runId=${encodeURIComponent(run.runId)}&prompt=paper`)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '操作失败，请稍后重试。')
    } finally {
      setBusyAction('')
    }
  }

  function openRun(run: ApiRun) {
    if (canViewResult(run)) {
      navigate(`/tools/pdf-slicer/runs/${encodeURIComponent(run.runId)}/questions`)
      return
    }
    setActionError('')
    setActionRun(run)
  }

  return (
    <div className="space-y-5">
      {/* Visual Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left Side: Recent Batches */}
        <div className="lg:col-span-2 space-y-3">
          <Panel
            title="活跃切片与识别批次"
            actions={
              <button
                className="text-xs font-bold text-zinc-400 dark:text-zinc-500 hover:text-foreground dark:hover:text-foreground hover:underline transition-colors cursor-pointer flex items-center gap-1 focus:outline-none"
                onClick={() => setActiveTab('slicer')}
              >
                <span>查看全部</span>
                <ArrowRight className="size-3" />
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-150 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10 text-zinc-500 dark:text-zinc-400 font-semibold">
                    <th className="p-3 w-[45%]">批次名称 / 文件名</th>
                    <th className="p-3 w-[15%]">状态</th>
                    <th className="p-3 w-[22%]">题块</th>
                    <th className="p-3 w-[18%]">更新时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {runs.slice(0, 5).map((run) => (
                    <tr
                      key={run.runId}
                      className="hover:bg-zinc-50/60 dark:hover:bg-zinc-850/20 transition-colors group"
                    >
                      <td className="min-w-0 p-3">
                        <button
                          className="block max-w-full truncate text-left font-semibold text-zinc-900 transition-colors hover:text-foreground hover:underline focus:outline-none dark:text-zinc-100 dark:hover:text-foreground"
                          title={run.paperTitle || run.pdfName}
                          onClick={() => openRun(run)}
                        >
                          {run.paperTitle || run.pdfName}
                        </button>
                        <div className="mt-1 truncate text-[0.78rem] font-medium leading-5 text-zinc-450 dark:text-zinc-500">{run.pdfName}</div>
                      </td>
                      <td className="p-3">
                        <Badge variant={statusVariant(run.sliceStatus)}>{label(run.sliceStatus)}</Badge>
                      </td>
                      <td className="p-3 font-semibold text-zinc-700 dark:text-zinc-300">
                        {run.totalQuestions}
                      </td>
                      <td className="p-3 text-zinc-450 dark:text-zinc-500 font-medium">
                        {new Date(run.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                  {!runs.length && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-zinc-400 dark:text-zinc-500">暂无活跃运行批次</td>
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

          <Panel
            title="最近录入记录"
            actions={
              <button
                className="text-xs font-bold text-zinc-400 dark:text-zinc-500 hover:text-foreground dark:hover:text-foreground hover:underline transition-colors cursor-pointer flex items-center gap-1 focus:outline-none"
                onClick={() => setActiveTab('bank')}
              >
                <span>前往题库</span>
                <ArrowRight className="size-3" />
              </button>
            }
          >
            <div className="space-y-3 max-h-[220px] overflow-auto pr-0.5">
              {displayItems.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 border-b border-zinc-100 dark:border-zinc-800/60 pb-3 last:border-b-0 last:pb-0 group/item p-1 hover:bg-zinc-50/40 dark:hover:bg-zinc-950/20 rounded-xl transition-all"
                >
                  <div className="mt-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200/50 dark:border-zinc-700/30 px-1.5 py-0.5 text-[9px] font-mono font-bold text-zinc-550 dark:text-zinc-400 shrink-0 select-none">
                    #{item.questionNo}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-zinc-850 dark:text-zinc-250 line-clamp-2 max-h-12 overflow-hidden leading-relaxed font-medium group-hover/item:text-foreground dark:group-hover/item:text-foreground group-hover/item:underline transition-colors">
                      <RichContent blocks={item.problemBlocks} className="text-xs text-zinc-800 dark:text-zinc-200" />
                    </div>
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1.5 truncate font-medium">{item.sourceTitle || '未知来源'}</p>
                  </div>
                </div>
              ))}
              {!displayItems.length && (
                <p className="text-center text-zinc-400 dark:text-zinc-500 py-6 text-xs">当前题库无记录</p>
              )}
            </div>
          </Panel>
        </div>
      </div>
      {actionRun ? (
        <Modal
          title="批次尚未完成"
          desc={`请选择下一步处理：${actionRun.paperTitle || actionRun.pdfName}`}
          onClose={() => setActionRun(null)}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              <div className="flex flex-wrap items-center gap-3">
                <span>题块：<strong className="text-zinc-900 dark:text-zinc-100">{actionRun.totalQuestions}</strong></span>
                <span>待复核：<strong className="text-zinc-900 dark:text-zinc-100">{actionRun.unreviewedQuestions ?? 0}</strong></span>
                <span>已通过：<strong className="text-zinc-900 dark:text-zinc-100">{actionRun.approvedQuestions ?? 0}</strong></span>
              </div>
            </div>
            {actionError ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                className="sm:col-span-2"
                icon={BadgeCheck}
                variant={(actionRun.unreviewedQuestions ?? 0) > 0 ? 'default' : 'outline'}
                onClick={() => {
                  setReviewRun(actionRun)
                  setActionRun(null)
                }}
              >
                {(actionRun.unreviewedQuestions ?? 0) > 0 ? '前往复核题块（未完成复核）' : '查看题块'}
              </Button>
              <Button
                icon={busyAction === 'ocr' ? LoaderCircle : ScanSearch}
                variant="outline"
                disabled={Boolean(busyAction)}
                onClick={() => startImport(actionRun, 'ocr')}
              >
                开始OCR导入
              </Button>
              <Button
                icon={busyAction === 'manual' ? LoaderCircle : FileJson}
                variant="outline"
                disabled={Boolean(busyAction)}
                onClick={() => startImport(actionRun, 'manual')}
              >
                开始手动导入
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {reviewRun ? (
        <SliceReviewDialog
          run={reviewRun}
          readonly={(reviewRun.unreviewedQuestions ?? 0) <= 0}
          onClose={() => setReviewRun(null)}
          onSubmitted={() => {
            setReviewRun(null)
            onReload?.()
          }}
        />
      ) : null}
    </div>
  )
}
