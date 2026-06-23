import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, BookOpen, Check, FileJson, FileText, FolderOpen, LoaderCircle, RefreshCcw, ScanSearch, Trash2, X } from 'lucide-react'
import { ocrApi } from '@/api/ocr'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import { Badge, Button } from '@/components/ui'
import type { ApiRun, SliceReviewItem } from '@/types'
import { fileRoleLabel, label, materialTypeLabel, statusVariant, workflowStatusVariant } from '@/utils/questionDisplay'
import { SliceReviewDialog } from './SliceReviewDialog'

export function RunCard({ run, onReload }: { run: ApiRun; onReload: () => void }) {
  const navigate = useNavigate()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [classificationBusy, setClassificationBusy] = useState(false)
  const [manualImportBusy, setManualImportBusy] = useState(false)
  const materialType = run.materialType || 'unknown'
  const fileRole = run.fileRole || 'full'
  const manualOcrLabel = fileRole === 'solutions' ? '手动识别答案解析' : fileRole === 'questions' ? '手动识别题干' : '手动开始 OCR'
  const reviewDone = run.totalQuestions > 0 && run.quickReviewStatus === 'submitted' && (run.unreviewedQuestions ?? 0) <= 0
  const resultReady = run.ocrStatus === 'succeeded'
  const pendingBankCount = run.importedQuestions ?? 0
  const allQuestionsBanked = pendingBankCount > 0 && (run.bankedQuestions ?? 0) >= pendingBankCount
  const canOpenPendingBank = fileRole !== 'solutions' && pendingBankCount > 0 && !allQuestionsBanked
  const showIntermediateStatus = run.ocrStatus !== 'succeeded' && !allQuestionsBanked
  const showSliceProgress = !allQuestionsBanked && run.ocrStatus !== 'succeeded' && (run.sliceStatus === 'running' || run.sliceStatus === 'succeeded')
  const sliceProgressWidth = run.sliceStatus === 'running' ? 50 : 100
  const sliceProgressLabel = run.sliceStatus === 'running' ? '切分中...' : '切分完成'
  const hasImageFormula = Boolean(run.diagnosticMessage)
  const recognitionFileKind = ['word_native', 'docx_native', 'native_docx'].includes(String(run.uploadMode || '')) ? 'Word' : 'PDF'
  const recognitionFileName = recognitionFileKind === 'Word' ? (run.sourceFileName || run.pdfName) : run.pdfName
  async function queueOcr() {
    await ocrApi.bulkOcr([run.runId])
    onReload()
  }
  async function deleteRun() {
    await pdfSlicerApi.deleteRun(run.runId)
    onReload()
  }
  async function openPdfFolder() {
    await pdfSlicerApi.openRunFolder(run.runId)
  }
  async function goManualImport() {
    setManualImportBusy(true)
    try {
      const payload = await pdfSlicerApi.getSliceReviewItems(run.runId)
      const approvedResultIds = (payload.items ?? [])
        .filter((item) => item.reviewStatus !== 'rejected')
        .map((item) => item.resultId)
      if (!approvedResultIds.length) {
        window.alert('该批次暂无可手动导入的题块。')
        return
      }
      await pdfSlicerApi.quickReview({ runId: run.runId, approvedResultIds, autoStartOcr: false })
      navigate(`/questions/new?target=paper&method=direct&source=slices&runId=${encodeURIComponent(run.runId)}&prompt=paper`)
    } finally {
      setManualImportBusy(false)
      setMoreOpen(false)
    }
  }
  async function updateClassification(next: { materialType?: string; fileRole?: string }) {
    setClassificationBusy(true)
    try {
      const result = await pdfSlicerApi.updateRunClassification(run.runId, {
        materialType: next.materialType || materialType,
        fileRole: next.fileRole || fileRole,
      })
      if (result.warning) window.alert(result.warning)
      onReload()
    } finally {
      setClassificationBusy(false)
    }
  }
  return (
    <div className="bg-card rounded-xl border p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground break-words">{run.paperTitle || run.pdfName}</h3>
            {hasImageFormula ? (
              <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">图片型公式</span>
            ) : null}
            <span className="inline-flex items-center rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{materialTypeLabel(materialType)}</span>
          </div>
          <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 mt-1">
            <span className="flex min-w-0 items-center gap-1">
              <FileText className="size-3.5 shrink-0" />
              <span className="shrink-0">{recognitionFileKind}：</span>
              <span className="truncate">{recognitionFileName}</span>
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex flex-wrap justify-end gap-1.5">
            <Badge variant={fileRole === 'solutions' ? 'warning' : fileRole === 'questions' ? 'default' : 'success'}>{fileRoleLabel(fileRole)}</Badge>
            {showIntermediateStatus ? <Badge variant={statusVariant(run.sliceStatus)}>{label(run.sliceStatus)}</Badge> : null}
            {showIntermediateStatus ? <Badge variant={statusVariant(run.quickReviewStatus)}>{label(run.quickReviewStatus)}</Badge> : null}
            <Badge variant={statusVariant(run.ocrStatus)}>{label(run.ocrStatus)}</Badge>
          </div>
        </div>
      </div>

      {showSliceProgress && (
        <div className="mt-4 pt-4 border-t">
           <div className="flex justify-between text-xs mb-1.5">
             <span className="text-muted-foreground">{sliceProgressLabel}</span>
             <span className="text-muted-foreground">{sliceProgressWidth}%</span>
           </div>
           <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
             <div
               className={`h-1.5 rounded-full relative overflow-hidden ${run.sliceStatus === 'running' ? 'bg-amber-500' : 'bg-emerald-500'}`}
               style={{ width: `${sliceProgressWidth}%` }}
             >
               {run.sliceStatus === 'running' ? <div className="absolute inset-0 bg-white/20 animate-pulse" /> : null}
             </div>
           </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex flex-col">
            <span className="text-muted-foreground">识别进度</span>
            <span className="font-medium text-foreground">{run.ocrStatus === 'succeeded' ? '100%' : '处理中'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground">题目数量</span>
            <span className="font-medium text-foreground">{run.totalQuestions} 题</span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground">待复核</span>
            <span className="font-medium text-foreground">{run.unreviewedQuestions ?? 0}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 relative">
	          <button
	            onClick={() => (resultReady || allQuestionsBanked) ? navigate(`/tools/pdf-slicer/runs/${encodeURIComponent(run.runId)}/questions`) : setReviewOpen(true)}
	            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm cursor-pointer"
	          >
	            {resultReady || allQuestionsBanked ? '查看批次结果' : reviewDone ? '查看题块' : '进入复核'}
	          </button>
	          {canOpenPendingBank ? (
	            <button
	              onClick={() => navigate(`/tools/pdf-slicer/runs/${encodeURIComponent(run.runId)}/pending-bank`)}
	              className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs font-semibold transition-colors shadow-sm cursor-pointer inline-flex items-center gap-1.5"
	            >
	              <BadgeCheck className="size-3.5" />
	              进入待入库确认
	            </button>
	          ) : null}

	          <div className="relative">
            <button onClick={() => setMoreOpen((open) => !open)} className="px-3 py-1.5 bg-background border border-input hover:bg-accent hover:text-accent-foreground text-foreground rounded-md text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer">
              更多 <span className="text-[8px] ml-0.5">▼</span>
            </button>
            {moreOpen ? (
            <div className="absolute right-0 top-full mt-1 w-48 bg-popover text-popover-foreground rounded-xl shadow-lg border py-2 z-10">
              <div className="px-3 pb-2 mb-2 border-b space-y-2">
                <label className="text-[10px] text-muted-foreground block">修改分类与角色</label>
                <select className="h-7 w-full rounded border bg-background px-2 text-xs outline-none" disabled={classificationBusy} value={materialType} onChange={(event) => updateClassification({ materialType: event.target.value })}>
                  <option value="exam">试卷</option>
                  <option value="lecture">讲义</option>
                  <option value="unknown">未确认</option>
                </select>
                <select className="h-7 w-full rounded border bg-background px-2 text-xs outline-none" disabled={classificationBusy} value={fileRole} onChange={(event) => updateClassification({ fileRole: event.target.value })}>
                  <option value="full">解析版一体</option>
                  <option value="questions">原卷</option>
                  <option value="solutions">解析文件</option>
                  <option value="unknown">未确认</option>
                </select>
              </div>
              <button onClick={queueOcr} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent flex items-center gap-2 cursor-pointer">
                <ScanSearch className="size-3.5" /> 重新识别
              </button>
              <button onClick={openPdfFolder} className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent flex items-center gap-2 cursor-pointer">
                <FolderOpen className="size-3.5" /> 打开 PDF 文件夹
              </button>
              {hasImageFormula ? (
                <button
                  onClick={goManualImport}
                  disabled={manualImportBusy}
                  className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {manualImportBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileJson className="size-3.5" />}
                  前往手动导入
                </button>
              ) : null}
              <button onClick={deleteRun} className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer">
                <Trash2 className="size-3.5" /> 删除批次
              </button>
            </div>
            ) : null}
          </div>
        </div>
      </div>

      {run.sliceError ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{run.sliceError}</p> : null}
      {reviewOpen ? <SliceReviewDialog run={run} readonly={reviewDone} onClose={() => setReviewOpen(false)} onSubmitted={() => { setReviewOpen(false); onReload() }} /> : null}
    </div>
  )
}
