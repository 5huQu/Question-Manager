import { useState } from 'react'
import { BadgeCheck, BookOpen, LoaderCircle, RefreshCcw, Trash2 } from 'lucide-react'
import { ocrApi } from '@/api/ocr'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { Badge, Button } from '@/components/ui'
import type { ApiRun } from '@/types'
import { fileRoleLabel, label, materialTypeLabel, statusVariant } from '@/utils/questionDisplay'

export function OcrHistoryRow({
  run,
  onReload,
  isSelected = false,
  onSelect
}: {
  run: ApiRun;
  onReload: () => void;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const [action, setAction] = useState('')
  const [actionError, setActionError] = useState('')

  const fileRole = run.fileRole || 'full'
  const materialType = run.materialType || 'unknown'

  const pendingBankCount = run.importedQuestions ?? 0
  const bankedQuestions = run.bankedQuestions ?? 0
  const allQuestionsBanked = pendingBankCount > 0 && bankedQuestions >= pendingBankCount
  const canOpenPendingBank = fileRole !== 'solutions' && !allQuestionsBanked && (run.ocrStatus === 'succeeded' || pendingBankCount > 0)

  const displayOcrStatus = (run.ocrStatus === 'succeeded' || allQuestionsBanked) ? 'succeeded' : run.ocrStatus
  const providerLabel = run.ocrProvider === 'doc2x' ? 'Doc2X' : run.ocrProvider === 'glm' ? 'GLM-OCR' : '历史 OCR'

  const busy = Boolean(action)

  async function runAction(labelStr: string, task: () => Promise<void>) {
    setAction(labelStr)
    setActionError('')
    try {
      await task()
      onReload()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setActionError(message)
    } finally {
      setAction('')
    }
  }

  async function rerun() {
    if (!window.confirm('确定要完全重跑此任务吗？')) return
    await runAction('完全重跑', async () => {
      await ocrApi.forceRerunOcr(run.runId)
    })
  }

  async function deleteTask() {
    if (!window.confirm('确定要删除此任务吗？此操作不可逆。')) return
    await runAction('删除任务', async () => {
      await pdfSlicerApi.deleteRun(run.runId)
    })
  }

  const generatedCount = fileRole === 'solutions' ? (run.solutionItems || 0) : (run.importedQuestions || 0)
  const total = run.totalQuestions || 0
  const banked = run.bankedQuestions || 0

  const parts = run.runId.split('_')
  const shortRunId = parts.length > 2 ? parts.slice(0, 3).join('_') : run.runId

  return (
    <tr className={`border-b transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 ${
      isSelected
        ? 'bg-zinc-50/40 border-zinc-900 dark:bg-zinc-900/40 dark:border-zinc-100'
        : 'border-zinc-100 dark:border-zinc-900'
    }`}>
      <td className="p-4 align-middle w-10 text-center" onClick={(e) => e.stopPropagation()}>
        {onSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect(run.runId)}
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 cursor-pointer"
          />
        )}
      </td>
      <td className="p-4 align-middle max-w-[220px]">
        <div className="truncate font-semibold text-zinc-950 dark:text-zinc-50" title={run.paperTitle || run.pdfName}>
          {run.paperTitle || run.pdfName}
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400" title={run.runId}>
          {shortRunId}
        </div>
        {actionError && (
          <div className="text-xs text-destructive mt-1 font-medium break-all">{actionError}</div>
        )}
      </td>
      <td className="p-4 align-middle whitespace-nowrap">
        <div className="flex flex-col gap-1 items-start">
          <Badge variant={materialType === 'lecture' ? 'warning' : materialType === 'exam' ? 'success' : 'default'}>
            {materialTypeLabel(materialType)}
          </Badge>
          <Badge variant={fileRole === 'solutions' ? 'warning' : fileRole === 'questions' ? 'default' : 'success'}>
            {fileRoleLabel(fileRole)}
          </Badge>
        </div>
      </td>
      <td className="p-4 align-middle whitespace-nowrap">
        <Badge variant={run.ocrProvider === 'doc2x' ? 'warning' : run.ocrProvider === 'glm' ? 'success' : 'default'}>
          {providerLabel}
        </Badge>
      </td>
      <td className="p-4 align-middle whitespace-nowrap">
        <div className="flex flex-col gap-1 items-start">
          <Badge variant={statusVariant(displayOcrStatus)}>
            {label(displayOcrStatus)}
          </Badge>
          {run.ocrError && (
            <span className="text-[10px] text-destructive max-w-[150px] truncate" title={run.ocrError}>
              {run.ocrError}
            </span>
          )}
        </div>
      </td>
      <td className="p-4 align-middle whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
        {fileRole === 'solutions' ? (
          <div>解析: <span className="font-medium text-zinc-950 dark:text-zinc-50">{generatedCount}</span> / {total} 题</div>
        ) : (
          <div className="space-y-0.5">
            <div>生成: <span className="font-medium text-zinc-950 dark:text-zinc-50">{generatedCount}</span> / {total} 题</div>
            <div>入库: <span className="font-medium text-zinc-950 dark:text-zinc-50">{banked}</span> 题</div>
          </div>
        )}
      </td>
      <td className="p-4 align-middle whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
        {new Date(run.createdAt).toLocaleDateString()} {new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </td>
      <td className="p-4 align-middle text-center">
        <div className="flex justify-center gap-1.5">
          {canOpenPendingBank && (
            <Button size="sm" asLink icon={BadgeCheck} to={`/tools/pdf-slicer/runs/${run.runId}/pending-bank`}>
              待入库确认
            </Button>
          )}
          {allQuestionsBanked ? (
            <Button size="sm" asLink icon={BookOpen} to={`/tools/pdf-slicer/runs/${run.runId}/questions`}>
              查看已入库
            </Button>
          ) : (
            <Button size="sm" asLink variant="outline" icon={BookOpen} to={`/tools/pdf-slicer/runs/${run.runId}/questions`}>
              查看识别
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            icon={action === '完全重跑' ? LoaderCircle : RefreshCcw}
            disabled={busy}
            onClick={rerun}
            title="完全重跑"
          >
            {action === '完全重跑' ? '重跑中' : ''}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={action === '删除任务' ? LoaderCircle : Trash2}
            disabled={busy}
            onClick={deleteTask}
            title="删除任务"
          >
            {action === '删除任务' ? '删除中' : ''}
          </Button>
        </div>
      </td>
    </tr>
  )
}
