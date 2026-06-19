import { useEffect, useState } from 'react'
import { BadgeCheck, BookOpen, Check, LoaderCircle, RefreshCcw, ScanSearch, Trash2, X } from 'lucide-react'
import { api, jsonHeaders } from '@/api/client'
import { Badge, Button, MiniMetric } from '@/components/ui'
import type { ApiRun, OcrProgress } from '@/types'
import { fileRoleLabel, label, materialTypeLabel, statusVariant } from '@/utils/questionDisplay'
import { cleanupCodeLabel, cleanupFieldLabel, cleanupIssueRecords, cleanupQuestionLabel, cleanupReasonLabel, cleanupSnippet, isFormatReviewStatusMessage } from '@/utils/ocrCleanup'

export function OcrJobCard({ run, onReload }: { run: ApiRun; onReload: () => void }) {
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [action, setAction] = useState('')
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const visibleRun = progress?.run ?? run
  const materialType = visibleRun.materialType || 'unknown'
  const fileRole = visibleRun.fileRole || 'full'
  const generatedLabel = fileRole === 'solutions' ? '已生成解析' : fileRole === 'questions' ? '已生成题干' : '已生成题目'
  const busy = Boolean(action) || Boolean(progress?.formatCleanupActive)
  const cleanupReport = progress?.formatCleanup
  const modelNeededCount = Number(cleanupReport?.modelNeededCount || 0)
  const cleanupIssues = cleanupIssueRecords(cleanupReport)
  const cleanupErrorDuplicatedBySummary = modelNeededCount > 0 && isFormatReviewStatusMessage(visibleRun.ocrError)
  const generatedCount = Math.max(progress?.importedQuestions ?? 0, progress?.successfulDraftCount ?? 0, visibleRun.solutionItems || 0)
  const failedCount = Math.max(progress?.failedDraftCount ?? 0, progress ? progress.totalQuestions - generatedCount : 0, 0)
  const pendingBankCount = progress?.importedQuestions ?? visibleRun.importedQuestions ?? 0
  const allQuestionsBanked = pendingBankCount > 0 && (visibleRun.bankedQuestions ?? 0) >= pendingBankCount
  const canOpenPendingBank = fileRole !== 'solutions' && !allQuestionsBanked && (visibleRun.ocrStatus === 'succeeded' || pendingBankCount > 0)
  const showProgressBar = !allQuestionsBanked
  const canInterrupt = Boolean(progress?.active || progress?.formatCleanupActive || visibleRun.ocrStatus === 'running' || visibleRun.ocrStatus === 'queued')
  const canStartOcr = visibleRun.ocrStatus === 'idle' && !progress?.active && Math.max(visibleRun.processedQuestions ?? 0, progress?.draftCount ?? 0, progress?.importedQuestions ?? 0) <= 0
  async function loadProgress() {
    const next = await api<OcrProgress>(`/api/tools/pdf-slicer/runs/${run.runId}/ocr-progress`)
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
      await api(`/api/tools/pdf-slicer/runs/${run.runId}/start-ocr`, { method: 'POST' })
    })
  }
  async function rerun() {
    await runAction('完全重跑', async () => {
      await api(`/api/tools/pdf-slicer/runs/${run.runId}/force-rerun-ocr`, { method: 'POST' })
    })
  }
  async function resume() {
    await runAction('断点续跑', async () => {
      await api(`/api/tools/pdf-slicer/runs/${run.runId}/resume-ocr`, { method: 'POST' })
    })
  }
  async function cleanup() {
    await runAction('脚本格式清洗', async () => {
      await api(`/api/tools/pdf-slicer/runs/${run.runId}/format-cleanup`, { method: 'POST' })
    })
  }
  async function modelCleanup() {
    await runAction('模型格式清洗', async () => {
      await api(`/api/tools/pdf-slicer/runs/${run.runId}/format-cleanup`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ model: true }) })
    })
    setNotice('模型格式清洗已提交，日志会在下方更新。')
  }
  async function interrupt() {
    await runAction('强制中断', async () => {
      await api(`/api/tools/pdf-slicer/runs/${run.runId}/force-interrupt-ocr`, { method: 'POST' })
    })
  }
  async function deleteTask() {
    await runAction('删除任务', async () => {
      await api(`/api/tools/pdf-slicer/runs/${run.runId}`, { method: 'DELETE' })
    })
  }
  return (
    <article className="rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">{visibleRun.paperTitle || visibleRun.pdfName}</p>
            <Badge variant={materialType === 'lecture' ? 'warning' : materialType === 'exam' ? 'success' : 'default'}>{materialTypeLabel(materialType)}</Badge>
            <Badge variant={fileRole === 'solutions' ? 'warning' : fileRole === 'questions' ? 'default' : 'success'}>{fileRoleLabel(fileRole)}</Badge>
            <Badge variant={statusVariant(visibleRun.ocrStatus)}>{label(visibleRun.ocrStatus)}{progress?.active ? ' · 执行中' : ''}</Badge>
          </div>
          <p className="mt-1 break-all text-xs text-zinc-500">{run.runId}</p>
        </div>
      </div>
      {showProgressBar ? <div className="mt-4">
        <div className="flex justify-between text-sm font-medium text-zinc-500"><span>{visibleRun.processedQuestions ?? progress?.draftCount ?? 0}/{visibleRun.totalOcrQuestions ?? visibleRun.approvedQuestions}</span><span>{Math.round((visibleRun.progressPercent ?? 0) * 100)}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-zinc-950 transition-all" style={{ width: `${Math.round((visibleRun.progressPercent ?? 0) * 100)}%` }} /></div>
      </div> : null}
      {progress ? <div className="mt-4 grid gap-2 sm:grid-cols-3"><MiniMetric label="总题数" value={progress.totalQuestions} /><MiniMetric label={generatedLabel} value={generatedCount} /><MiniMetric label="失败题数" value={failedCount} /></div> : null}
      {(notice || progress?.formatCleanupActive) ? <div className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{(action || progress?.formatCleanupActive) ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}<span>{progress?.formatCleanupActive ? '模型格式清洗正在后台运行...' : notice}</span></div> : null}
      {canOpenPendingBank ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {fileRole === 'solutions'
            ? '解析文件 OCR 已完成。系统会在同组原卷完成后按题号自动合并。'
            : fileRole === 'questions'
              ? '原卷题干已生成。若同组解析文件也已完成，系统会自动合并后进入待入库确认。'
              : pendingBankCount > 0 && visibleRun.ocrStatus !== 'succeeded'
                ? `OCR 已生成 ${pendingBankCount} 道待入库题目，可先进入待入库确认页处理已生成内容。`
                : 'OCR 已生成待入库题目，请进入待入库确认页完成最后入库。'}
        </div>
      ) : null}
      {actionError ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div> : null}
      {modelNeededCount > 0 && !progress?.formatCleanupActive ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p className="font-semibold">题库当前仍有 {modelNeededCount} 题存在格式问题。</p>
          {cleanupIssues.length ? (
            <div className="mt-2 space-y-2">
              {cleanupIssues.slice(0, 5).map((record) => {
                const errors = record.renderErrors ?? []
                const labels = errors.length ? errors.slice(0, 3).map((error) => `${cleanupFieldLabel(error.field)}：${cleanupCodeLabel(error.code)}`) : (record.reasons ?? []).slice(0, 3).map(cleanupReasonLabel)
                const firstError = errors.find((error) => error.context || error.snippet)
                const firstSnippet = cleanupSnippet(firstError?.context || firstError?.snippet || '')
                return (
                  <div key={record.id || record.draft} className="rounded-lg border border-red-200 bg-white/70 px-2 py-1.5">
                    <p className="font-semibold">{cleanupQuestionLabel(record)}：{labels.join('；') || '格式异常'}</p>
                    {firstSnippet ? <p className="mt-1 text-xs leading-5 text-red-600">片段：{firstSnippet}</p> : null}
                    {record.modelError ? <p className="mt-1 text-xs leading-5 text-red-600">模型错误：{record.modelError}</p> : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {visibleRun.ocrError && !cleanupErrorDuplicatedBySummary ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{visibleRun.ocrError}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canStartOcr ? <Button size="sm" variant="outline" icon={action === '启动 OCR' ? LoaderCircle : ScanSearch} disabled={busy || progress?.active} onClick={start}>{action === '启动 OCR' ? '启动中...' : '开始 OCR'}</Button> : null}
        <Button size="sm" variant="outline" icon={action === '完全重跑' ? LoaderCircle : RefreshCcw} disabled={busy} onClick={rerun}>{action === '完全重跑' ? '重跑中...' : '完全重跑'}</Button>
        {visibleRun.ocrStatus === 'failed' ? <Button size="sm" variant="outline" icon={action === '断点续跑' ? LoaderCircle : RefreshCcw} disabled={busy} onClick={resume}>{action === '断点续跑' ? '续跑中...' : '断点续跑'}</Button> : null}
        <Button size="sm" variant="outline" icon={action === '脚本格式清洗' ? LoaderCircle : RefreshCcw} disabled={busy} onClick={cleanup}>{action === '脚本格式清洗' ? '清洗中...' : '格式清洗'}</Button>
        {modelNeededCount > 0 ? <Button size="sm" variant="danger" icon={(action === '模型格式清洗' || progress?.formatCleanupActive) ? LoaderCircle : RefreshCcw} disabled={busy} onClick={modelCleanup}>{(action === '模型格式清洗' || progress?.formatCleanupActive) ? '模型清洗中...' : '模型格式清洗'}</Button> : null}
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
