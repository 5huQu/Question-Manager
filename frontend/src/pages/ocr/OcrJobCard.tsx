import { useEffect, useState } from 'react'
import { BadgeCheck, BookOpen, Check, LoaderCircle, RefreshCcw, ScanSearch, Trash2, X } from 'lucide-react'
import { ocrApi } from '@/api/ocr'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { Badge, Button, MiniMetric } from '@/components/ui'
import type { ApiRun, OcrProgress } from '@/types'
import { fileRoleLabel, label, materialTypeLabel, statusVariant } from '@/utils/questionDisplay'

export function OcrJobCard({ run, onReload }: { run: ApiRun; onReload: () => void }) {
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [action, setAction] = useState('')
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const visibleRun = progress?.run ?? run
  const materialType = visibleRun.materialType || 'unknown'
  const fileRole = visibleRun.fileRole || 'full'
  const generatedLabel = fileRole === 'solutions' ? '已生成解析' : fileRole === 'questions' ? '已生成题干' : '已生成题目'
  const busy = Boolean(action)
  const generatedCount = Math.max(progress?.importedQuestions ?? 0, progress?.successfulDraftCount ?? 0, visibleRun.solutionItems || 0)
  const failedCount = Math.max(progress?.failedDraftCount ?? 0, 0)
  const pendingCount = Math.max(progress?.pendingDraftCount ?? Math.max((progress?.draftCount ?? 0) - generatedCount - failedCount, 0), 0)
  const pendingBankCount = progress?.importedQuestions ?? visibleRun.importedQuestions ?? 0
  const allQuestionsBanked = pendingBankCount > 0 && (visibleRun.bankedQuestions ?? 0) >= pendingBankCount
  const canOpenPendingBank = fileRole !== 'solutions' && !allQuestionsBanked && (visibleRun.ocrStatus === 'succeeded' || pendingBankCount > 0)
  const ocrCompleteByImport = generatedCount > 0 && generatedCount >= Math.max(visibleRun.approvedQuestions || visibleRun.totalQuestions || 0, 1)
  const displayOcrStatus = (visibleRun.ocrStatus === 'succeeded' || ocrCompleteByImport || allQuestionsBanked) ? 'succeeded' : visibleRun.ocrStatus
  const showProgressBar = displayOcrStatus !== 'succeeded' && !allQuestionsBanked
  const canInterrupt = Boolean(progress?.active || visibleRun.ocrStatus === 'running' || visibleRun.ocrStatus === 'queued')
  const canStartOcr = visibleRun.ocrStatus === 'idle' && !progress?.active && Math.max(visibleRun.processedQuestions ?? 0, progress?.draftCount ?? 0, progress?.importedQuestions ?? 0) <= 0
  const providerLabel = visibleRun.ocrProvider === 'doc2x' ? 'Doc2X' : visibleRun.ocrProvider === 'glm' ? 'GLM-OCR' : '历史 OCR'
  const providerPhase = visibleRun.ocrProviderPhase
  const providerPhaseLabel: Record<string, string> = {
    starting: '准备任务', preupload: '申请上传', uploading: '上传 PDF', parsing: '云端解析', normalizing: '拆分题目', downloading_assets: '下载题图', importing: '导入题库', interrupted: '已中断', succeeded: '已完成', failed: '失败',
  }
  async function loadProgress() {
    const next = await ocrApi.getOcrProgress(run.runId)
    setProgress(next)
  }
  useEffect(() => {
    loadProgress().catch(() => undefined)
    const timer = window.setInterval(() => loadProgress().catch(() => undefined), 2000)
    return () => window.clearInterval(timer)
  }, [run.runId])
  async function runAction(label: string, task: () => Promise<void>) {
    setAction(label)
    setNotice(`${label}中...`)
    setActionError('')
    try {
      await task()
      await loadProgress().catch(() => undefined)
      onReload()
      setNotice(`${label}已完成`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setActionError(message)
      setNotice('')
    } finally {
      setAction('')
    }
  }
  async function start() {
    await runAction('启动 OCR', async () => {
      await ocrApi.startOcr(run.runId)
    })
  }
  async function rerun() {
    await runAction('完全重跑', async () => {
      await ocrApi.forceRerunOcr(run.runId)
    })
  }
  async function resume() {
    await runAction('断点续跑', async () => {
      await ocrApi.resumeOcr(run.runId)
    })
  }
  async function interrupt() {
    await runAction('强制中断', async () => {
      await ocrApi.forceInterruptOcr(run.runId)
    })
  }
  async function deleteTask() {
    await runAction('删除任务', async () => {
      await pdfSlicerApi.deleteRun(run.runId)
    })
  }
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">{visibleRun.paperTitle || visibleRun.pdfName}</p>
            <Badge variant={materialType === 'lecture' ? 'warning' : materialType === 'exam' ? 'success' : 'default'}>{materialTypeLabel(materialType)}</Badge>
            <Badge variant={fileRole === 'solutions' ? 'warning' : fileRole === 'questions' ? 'default' : 'success'}>{fileRoleLabel(fileRole)}</Badge>
            <Badge variant={visibleRun.ocrProvider === 'doc2x' ? 'warning' : visibleRun.ocrProvider === 'glm' ? 'success' : 'default'}>{providerLabel}</Badge>
            <Badge variant={statusVariant(displayOcrStatus)}>{label(displayOcrStatus)}{progress?.active ? ' · 执行中' : ''}</Badge>
          </div>
          <p className="mt-1 break-all text-xs text-zinc-500 dark:text-zinc-400">{run.runId}</p>
        </div>
      </div>
      {showProgressBar ? <div className="mt-4">
        <div className="flex justify-between text-sm font-medium text-zinc-500 dark:text-zinc-400"><span>{providerPhase ? `${providerLabel} · ${providerPhaseLabel[providerPhase] || providerPhase}` : `${visibleRun.processedQuestions ?? progress?.draftCount ?? 0}/${visibleRun.totalOcrQuestions ?? visibleRun.approvedQuestions}`}</span><span>{Math.round((visibleRun.progressPercent ?? 0) * 100)}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-50" style={{ width: `${Math.round((visibleRun.progressPercent ?? 0) * 100)}%` }} /></div>
      </div> : null}
      {progress ? <div className="mt-4 grid gap-2 sm:grid-cols-3"><MiniMetric label="总题数" value={progress.totalQuestions} /><MiniMetric label={generatedLabel} value={generatedCount} /><MiniMetric label={progress.active ? '待处理题数' : '失败题数'} value={progress.active ? pendingCount : failedCount} /></div> : null}
      {notice ? <div className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200">{action ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}<span>{notice}</span></div> : null}
      {canOpenPendingBank ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {fileRole === 'questions'
              ? '原卷题干已生成。若同组解析文件也已完成，系统会自动合并后进入待入库确认。'
                : pendingBankCount > 0 && displayOcrStatus !== 'succeeded'
                ? `OCR 已生成 ${pendingBankCount} 道待入库题目，可先进入待入库确认页处理已生成内容。`
                : 'OCR 已生成待入库题目，请进入待入库确认页完成最后入库。'}
        </div>
      ) : null}
      {actionError ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div> : null}
      {visibleRun.ocrError ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{visibleRun.ocrError}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canStartOcr ? <Button size="sm" variant="outline" icon={action === '启动 OCR' ? LoaderCircle : ScanSearch} disabled={busy || progress?.active} onClick={start}>{action === '启动 OCR' ? '启动中...' : '开始 OCR'}</Button> : null}
        <Button size="sm" variant="outline" icon={action === '完全重跑' ? LoaderCircle : RefreshCcw} disabled={busy} onClick={rerun}>{action === '完全重跑' ? '重跑中...' : '完全重跑'}</Button>
        {visibleRun.ocrStatus === 'failed' ? <Button size="sm" variant="outline" icon={action === '断点续跑' ? LoaderCircle : RefreshCcw} disabled={busy} onClick={resume}>{action === '断点续跑' ? '续跑中...' : '断点续跑'}</Button> : null}
        {canInterrupt ? <Button size="sm" variant="danger" icon={action === '强制中断' ? LoaderCircle : X} disabled={busy} onClick={interrupt}>{action === '强制中断' ? '中断中...' : '强制中断'}</Button> : null}
        <Button size="sm" variant="danger" icon={action === '删除任务' ? LoaderCircle : Trash2} disabled={busy} onClick={deleteTask}>{action === '删除任务' ? '删除中...' : '删除任务'}</Button>
        {allQuestionsBanked
          ? <Button size="sm" asLink icon={BookOpen} to={`/tools/pdf-slicer/runs/${run.runId}/questions`}>查看批次结果</Button>
          : <Button size="sm" asLink variant="outline" icon={BookOpen} to={`/tools/pdf-slicer/runs/${run.runId}/questions`}>查看识别题目</Button>}
        {canOpenPendingBank ? <Button size="sm" asLink icon={BadgeCheck} to={`/tools/pdf-slicer/runs/${run.runId}/pending-bank`}>进入待入库确认</Button> : null}
      </div>
    </article>
  )
}
