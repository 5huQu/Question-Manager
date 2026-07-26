/**
 * 实验版 PDF 导出面板
 * 在 TeachingDocument 编辑器 A4 模式中显示导出状态与操作入口。
 */
import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2, FileDown, LoaderCircle, XCircle } from 'lucide-react'
import type { PdfExportResult } from '@/api/client'
import {
  evaluateExportReadiness,
  type ExportReadinessResult,
} from '@/utils/teachingDocument'
import type { A4PaginationState } from './A4PaginationPreview'

export interface ExportPdfPanelProps {
  documentId: string
  documentTitle: string
  revision: number
  saveState: string
  hasRevisionConflict: boolean
  paginationState: A4PaginationState | null
}

type ExportPhase = 'idle' | 'exporting' | 'success' | 'error'

export function ExportPdfPanel({
  documentId,
  documentTitle,
  revision,
  saveState,
  hasRevisionConflict,
  paginationState,
}: ExportPdfPanelProps) {
  const [phase, setPhase] = useState<ExportPhase>('idle')
  const [result, setResult] = useState<PdfExportResult | null>(null)

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

  const isElectron = Boolean(window.questionWorkbench?.pdfExport)
  const canExport = Boolean(readiness?.ready) && isElectron && phase !== 'exporting'

  const handleExport = useCallback(async () => {
    if (!canExport || !readiness) return
    setPhase('exporting')
    setResult(null)
    try {
      const exportResult = await window.questionWorkbench!.pdfExport!.start({
        documentId,
        revision,
        pageCount: readiness.pageCount,
        title: documentTitle,
      })
      setResult(exportResult)
      setPhase(exportResult.success ? 'success' : exportResult.canceled ? 'idle' : 'error')
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : String(error) })
      setPhase('error')
    }
  }, [canExport, readiness, documentId, revision, documentTitle])

  if (!paginationState) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
        <LoaderCircle className="size-3.5 animate-spin" />
        等待分页完成…
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">实验导出</span>
        <span>{readiness?.pageCount ?? '—'} 页</span>
        <span>r{revision}</span>
        <span>g{paginationState.measurementGeneration}</span>
        <span className={readiness?.ready ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {readiness?.ready ? '就绪' : '未就绪'}
        </span>
        {readiness && readiness.blockingDiagnostics.length > 0 ? (
          <span className="text-red-600 dark:text-red-400">{readiness.blockingDiagnostics.length} 阻塞</span>
        ) : null}
        {readiness && readiness.warnings.length > 0 ? (
          <span className="text-amber-600 dark:text-amber-400">{readiness.warnings.length} 警告</span>
        ) : null}
        {!isElectron ? (
          <span className="text-zinc-400">仅桌面版可用</span>
        ) : null}
      </div>

      {/* Blocking diagnostics tooltip */}
      {readiness && readiness.blockingDiagnostics.length > 0 ? (
        <div className="mt-1.5 max-h-20 overflow-auto rounded border border-red-100 bg-red-50/50 p-1.5 dark:border-red-900/30 dark:bg-red-950/20">
          {readiness.blockingDiagnostics.slice(0, 5).map((diagnostic, index) => (
            <p key={`${diagnostic.code}:${index}`} className="text-[10px] leading-tight text-red-700 dark:text-red-400">
              [{diagnostic.code}] {diagnostic.message}
            </p>
          ))}
          {readiness.blockingDiagnostics.length > 5 ? (
            <p className="mt-0.5 text-[10px] text-red-500">…还有 {readiness.blockingDiagnostics.length - 5} 项</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!canExport}
          onClick={() => void handleExport()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {phase === 'exporting' ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
          {phase === 'exporting' ? '导出中…' : '导出实验版 PDF'}
        </button>

        {phase === 'success' && result ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5" />
            {result.fileName}（{result.fileSize ? `${Math.round(result.fileSize / 1024)} KB` : ''}）
          </span>
        ) : null}
        {phase === 'error' && result ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
            <XCircle className="size-3.5" />
            {result.error || '导出失败'}
          </span>
        ) : null}
      </div>
    </div>
  )
}
