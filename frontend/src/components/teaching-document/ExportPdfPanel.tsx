/**
 * 打印与 PDF 操作组
 * 仅在 TeachingDocument 的打印预览完成分页后启用。
 */
import { useCallback, useMemo, useState } from 'react'
import { FileDown, LoaderCircle, Printer } from 'lucide-react'
import {
  evaluateExportReadiness,
  isA3LandscapeSpread,
  type ExportReadinessResult,
  type PaperSpec,
} from '@/utils/teachingDocument'
import type { PdfExportVariant } from '@/api/client'
import type { A4PaginationState } from './A4PaginationPreview'

export interface ExportPdfPanelProps {
  documentId: string
  documentTitle: string
  revision: number
  saveState: string
  hasRevisionConflict: boolean
  paginationState: A4PaginationState | null
  /** 当前文档纸张：导出时传递给主进程生成 printToPDF 参数，保证 MediaBox 与文档一致。 */
  paper: PaperSpec
}

type ExportPhase = 'idle' | 'exporting'

export function ExportPdfPanel({
  documentId,
  documentTitle,
  revision,
  saveState,
  hasRevisionConflict,
  paginationState,
  paper,
}: ExportPdfPanelProps) {
  const [phase, setPhase] = useState<ExportPhase>('idle')
  const [variant, setVariant] = useState<PdfExportVariant>('student')

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
  const physicalPageCount = readiness
    ? (isA3LandscapeSpread(paper) ? Math.ceil(readiness.pageCount / 2) : readiness.pageCount)
    : 0
  const canRun = Boolean(readiness?.ready) && phase !== 'exporting'
  const unavailableReason = phase === 'exporting'
    ? '正在生成 PDF，请稍候。'
    : readiness?.blockingDiagnostics[0]?.message
      || (readiness?.pendingResources.length ? '题目或图片资源尚未准备完成，请稍候。' : '正在准备分页与排版资源，请稍候。')

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

  const handleExport = useCallback(async () => {
    if (!canRun || !readiness) return
    if (!isElectron) {
      openPrintDialog()
      return
    }
    setPhase('exporting')
    try {
      await window.questionWorkbench!.pdfExport!.start({
        documentId,
        revision,
        pageCount: physicalPageCount,
        title: documentTitle,
        variant,
        paper,
      })
    } finally {
      setPhase('idle')
    }
  }, [canRun, readiness, isElectron, openPrintDialog, documentId, revision, documentTitle, paper, physicalPageCount, variant])

  return (
    <div className="flex items-center gap-1">
      <label className="sr-only" htmlFor="teaching-document-export-variant">导出版本</label>
      <select
        id="teaching-document-export-variant"
        aria-label="导出版本"
        value={variant}
        onChange={(event) => setVariant(event.target.value as PdfExportVariant)}
        className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 outline-none transition-colors hover:bg-zinc-50 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        <option value="student">学生版</option>
        <option value="teacher">教师版</option>
      </select>
      <button
        type="button"
        disabled={!canRun}
        onClick={openPrintDialog}
        title={canRun ? '打印' : unavailableReason}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        <Printer className="size-3.5" />
        打印
      </button>
      <button
        type="button"
        disabled={!canRun}
        onClick={() => void handleExport()}
        title={canRun ? `另存为${variant === 'teacher' ? '教师版' : '学生版'} PDF` : unavailableReason}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {phase === 'exporting' ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
        另存为{variant === 'teacher' ? '教师版' : '学生版'} PDF
      </button>
    </div>
  )
}
