import { ChevronLeft, Check, BadgeAlert, Layers } from 'lucide-react'
import { importJobQuestionsPath } from './importV2Routes'
import { MarkdownStructurePreviewDialog } from '@/components/import-v2/MarkdownStructurePreviewDialog'
import { ImportMetadataEditorDialog } from '@/components/import-v2/ImportMetadataEditorDialog'
import { WatermarkCleanupDialog } from '@/components/import-v2/WatermarkCleanupDialog'
import { PageTitle, Button } from '@/components/ui'
import { useImportV2Workspace } from './useImportV2Workspace'
import { ReviewHeaderBar } from './components/ReviewHeaderBar'
import { UploadWorkflowPanel } from './components/UploadWorkflowPanel'
import { CandidateReviewWorkspace } from './components/CandidateReviewWorkspace'

export function ImportV2Workspace({ view }: { view: 'document' | 'candidate' }) {
  const ws = useImportV2Workspace(view)

  return (
    <div className={ws.activeStepTab === 'review' ? 'flex min-h-0 flex-col gap-3' : 'space-y-6'}>
      {/* Header */}
      {ws.activeStepTab === 'review' && ws.selectedDoc ? (
        <ReviewHeaderBar ws={ws} />
      ) : (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => ws.navigate('/tools/import')}>
            返回列表
          </Button>
          <PageTitle
            title="资料导入工作台"
            desc="核对题干、答案、解析和题图后，确认入库。"
            path="/tools/import"
          />
        </div>
      )}

      {/* Notification banners */}
      {ws.notice ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-4 py-2.5 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center gap-2 shadow-sm animate-in fade-in duration-200">
          <Check className="size-3.5 text-zinc-900 dark:text-zinc-50" />
          <span>{ws.notice}</span>
        </div>
      ) : null}
      {ws.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50/20 px-4 py-2.5 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-950/10 dark:text-red-400 flex items-center gap-2 shadow-sm animate-in fade-in duration-200">
          <BadgeAlert className="size-3.5" />
          <span>{ws.error}</span>
        </div>
      ) : null}

      {/* Step tab switcher (upload mode only) */}
      {ws.activeStepTab === 'upload' ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex bg-zinc-100/80 dark:bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50 w-full sm:w-80 select-none">
            <button
              onClick={() => {
                if (ws.selectedDoc) ws.navigateToDocument(ws.selectedDoc.id)
                else ws.setActiveStepTab('upload')
              }}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-zinc-200/20 bg-white py-1.5 text-xs font-semibold text-zinc-900 shadow-xs dark:bg-zinc-950 dark:text-zinc-50"
            >
              1. 资料上传与识别
            </button>
            <button
              onClick={() => {
                if (ws.selectedDoc) ws.navigateToCandidates(ws.selectedDoc.id)
                else ws.setActiveStepTab('review')
              }}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-300"
            >
              2. 题目核对区
              {ws.questions.length > 0 && (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[9px] bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-950 font-bold ml-1">
                  {ws.questions.filter(q => q.status !== 'committed' && !ws.committedIds.has(q.id)).length}
                </span>
              )}
            </button>
          </div>
        </div>
      ) : null}

      {/* Step 1: Upload & OCR workflow */}
      {ws.activeStepTab === 'upload' && (
        <UploadWorkflowPanel ws={ws} />
      )}

      {/* Step 2: Review empty state */}
      {ws.activeStepTab === 'review' && ws.questions.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/10 min-h-[400px] animate-in fade-in duration-200">
          <Layers className="size-8 text-zinc-300 dark:text-zinc-700 mb-3" />
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">暂无待核对题目。请先在"1. 资料上传与识别"标签页中选择资料并生成/继续核对题目。</p>
          <Button size="sm" onClick={() => ws.selectedDoc ? ws.navigateToDocument(ws.selectedDoc.id) : ws.setActiveStepTab('upload')}>
            返回第一步
          </Button>
        </div>
      )}

      {/* Step 2: Candidate review workspace */}
      {ws.activeStepTab === 'review' && ws.questions.length > 0 && ws.showCheckArea && (
        <CandidateReviewWorkspace ws={ws} />
      )}

      {/* Metadata editor dialog */}
      {ws.showMetadataEditor ? (
        <ImportMetadataEditorDialog
          draft={ws.metadataDraft}
          setDraft={ws.setMetadataDraft}
          teachingStages={ws.ocrSettings.data?.teachingStages}
          saving={ws.busy === `metadata-${ws.activeImportJob?.id}`}
          onClose={() => ws.setShowMetadataEditor(false)}
          onSave={ws.handleSaveSourceMetadata}
        />
      ) : null}

      {ws.showWatermarkCleanupEditor ? (
        <WatermarkCleanupDialog
          draft={ws.watermarkCleanupDraft}
          setDraft={ws.setWatermarkCleanupDraft}
          saving={ws.busy === `watermark-${ws.activeImportJob?.id || ''}`}
          canReclean={ws.canRecleanSelectedDoc}
          onClose={() => ws.setShowWatermarkCleanupEditor(false)}
          onSave={ws.handleSaveWatermarkCleanup}
        />
      ) : null}

      {/* Markdown structure preview dialog */}
      <MarkdownStructurePreviewDialog
        key={ws.markdownPreviewTarget ? `${ws.markdownPreviewTarget.ocrDocumentId}:${ws.markdownPreviewTarget.candidateId || ''}:${ws.markdownPreviewTarget.focusKind || ''}` : 'closed'}
        open={Boolean(ws.markdownPreviewTarget)}
        ocrDocumentId={ws.markdownPreviewTarget?.ocrDocumentId}
        documentOptions={ws.markdownPreviewTarget?.documentOptions}
        candidateId={ws.markdownPreviewTarget?.candidateId}
        candidateIds={ws.markdownPreviewTarget?.candidateIds}
        questionNo={ws.markdownPreviewTarget?.questionNo}
        focusKind={ws.markdownPreviewTarget?.focusKind}
        title={ws.markdownPreviewTarget?.title}
        applying={ws.busy === `reclean-${ws.selectedDoc?.id || ''}`}
        parserPresets={ws.parserPresets}
        selectedParserPresetId={ws.selectedParserPresetId}
        onSelectedParserPresetChange={ws.setSelectedParserPresetId}
        onApplyParserRequest={ws.selectedDoc && ws.canRecleanSelectedDoc ? ws.handleApplyPreviewParserRequest : undefined}
        onClose={() => ws.setMarkdownPreviewTarget(null)}
      />
    </div>
  )
}
