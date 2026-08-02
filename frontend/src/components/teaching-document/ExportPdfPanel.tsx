/**
 * 打印操作
 * 仅在 TeachingDocument 的打印预览完成分页后启用；浏览器打印对话框可另存为 PDF。
 */
import { useCallback, useMemo } from 'react'
import { Printer } from 'lucide-react'
import {
  evaluateExportReadiness,
  type ExportReadinessResult,
  type PaperSpec,
} from '@/utils/teachingDocument'
import type { PdfExportVariant } from '@/api/client'
import type { A4PaginationState } from './A4PaginationPreview'

export interface ExportPdfPanelProps {
  documentId: string
  revision: number
  saveState: string
  hasRevisionConflict: boolean
  paginationState: A4PaginationState | null
  variant: PdfExportVariant
  /** 当前文档纸张：传递给打印页，保证纸张尺寸与编辑器一致。 */
  paper: PaperSpec
}

export function ExportPdfPanel({
  documentId,
  revision,
  saveState,
  hasRevisionConflict,
  paginationState,
  variant,
  paper,
}: ExportPdfPanelProps) {
  const readiness: ExportReadinessResult | null = useMemo(() => {
    if (!paginationState) return null
    return evaluateExportReadiness({
      documentRevision: revision,
      paginationGeneration: paginationState.measurementGeneration,
      pagination: paginationState.pagination,
      renderReadiness: paginationState.readiness,
      hasUnsavedChanges: saveState === 'dirty' || saveState === 'saving',
      hasRevisionConflict,
      autosaveFailed: saveState === 'failed',
      measurementGenerationCurrent: paginationState.measurementGeneration > 0,
    })
  }, [paginationState, revision, saveState, hasRevisionConflict])

  const hasPreviewReadiness = Boolean(paginationState)
  const canRun = hasPreviewReadiness
    ? Boolean(readiness?.ready)
    : saveState === 'saved' && !hasRevisionConflict
  const unavailableReason = hasPreviewReadiness
    ? readiness?.blockingDiagnostics[0]?.message
        || (readiness?.pendingResources.length ? '题目或图片资源尚未准备完成，请稍候。' : '正在准备分页与排版资源，请稍候。')
    : hasRevisionConflict
      ? '文档存在版本冲突，请先重新加载。'
      : '请等待文档保存完成后再打印。'

  const openPrintDialog = useCallback(() => {
    if (!canRun) return
    const printUrl = new URL('/print/teaching-document', window.location.origin)
    printUrl.searchParams.set('docId', documentId)
    printUrl.searchParams.set('revision', String(revision))
    printUrl.searchParams.set('autoPrint', '1')
    printUrl.searchParams.set('variant', variant)
    printUrl.searchParams.set('paper', JSON.stringify(paper))
    window.open(printUrl.toString(), '_blank', 'noopener,noreferrer')
  }, [canRun, documentId, revision, paper, variant])

  return (
    <button
      type="button"
      disabled={!canRun}
      onClick={openPrintDialog}
      title={canRun ? `打印${variant === 'teacher' ? '教师版' : '学生版'}（可在系统对话框中另存为 PDF）` : unavailableReason}
      className="inline-flex h-7 items-center gap-1 rounded-full bg-zinc-900 px-2.5 text-[11px] font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      <Printer className="size-3.5" />
      打印
    </button>
  )
}
