import { ChevronLeft, FileText, LoaderCircle, RefreshCcw, PencilLine, Eraser, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui'
import { ReviewActionMenu } from '@/components/import-v2/ReviewActionMenu'
import type { ImportV2WorkspaceState } from '../useImportV2Workspace'

export function ReviewHeaderBar({ ws }: { ws: ImportV2WorkspaceState }) {
  const { selectedDoc, activeImportJob, questions, committedQuestionCount } = ws

  return (
    <section className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="返回导入批次列表"
          title="返回导入批次列表"
          onClick={() => ws.navigate('/tools/import')}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">
            {activeImportJob?.paperTitle || activeImportJob?.title || selectedDoc?.paperTitle || selectedDoc?.originalFileName || '未命名资料'}
          </h1>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <button
              type="button"
              onClick={() => selectedDoc && ws.navigateToDocument(selectedDoc.id)}
              className="shrink-0 transition-colors hover:text-foreground"
            >
              资料与识别
            </button>
            <ChevronLeft className="size-3 rotate-180" />
            <span className="shrink-0 font-medium text-foreground">题目核对</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{questions.length} 题，{committedQuestionCount} 题已入库</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <select
          aria-label="导入规则预设"
          className="h-8 min-w-0 max-w-44 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring"
          value={ws.selectedParserPresetId}
          onChange={(event) => ws.setSelectedParserPresetId(event.target.value)}
          disabled={Boolean(ws.busy)}
          title="导入规则预设"
        >
          {ws.parserPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          icon={ws.busy === `reclean-${selectedDoc?.id}` ? LoaderCircle : RefreshCcw}
          disabled={Boolean(ws.busy) || !ws.selectedParserPresetId || !ws.canRecleanSelectedDoc}
          onClick={ws.handleApplySelectedParserPreset}
          title={ws.selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新解析。' : '按当前所选预设重新生成未入库候选题。'}
        >
          {ws.busy === `reclean-${selectedDoc?.id}` ? '解析中...' : '重新解析'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={FileText}
          disabled={!ws.selectedDocOcr && !ws.selectedOcr}
          onClick={ws.openSelectedDocMarkdownPreview}
          className="hidden xl:inline-flex"
        >
          模型识别稿
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={WandSparkles}
          disabled={Boolean(ws.busy) || !ws.canModelSplit}
          onClick={ws.openModelSplitDialog}
          title={ws.selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持模型辅助拆题。' : '调用模型拆分题目并预览结果。'}
          className="hidden 2xl:inline-flex"
        >
          模型辅助拆题
        </Button>
        <ReviewActionMenu
          label="批次操作"
          actions={[
            {
              label: '查看模型识别稿',
              hint: '检查 OCR 原文与候选题来源定位',
              icon: FileText,
              disabled: !ws.selectedDocOcr && !ws.selectedOcr,
              onSelect: ws.openSelectedDocMarkdownPreview,
            },
            {
              label: '模型辅助拆题',
              hint: '先生成预览，确认后替换未入库候选题',
              icon: WandSparkles,
              disabled: Boolean(ws.busy) || !ws.canModelSplit,
              onSelect: ws.openModelSplitDialog,
            },
            {
              label: '编辑批次信息',
              icon: PencilLine,
              onSelect: ws.openEditModal,
            },
            {
              label: '设置水印清洗',
              hint: '配置排除词并重新清洗未入库候选题',
              icon: Eraser,
              disabled: Boolean(ws.busy) || !ws.selectedDoc,
              onSelect: ws.openWatermarkCleanupModal,
              separatorBefore: true,
            },
            {
              label: '按当前预设重解析',
              hint: '替换本批次尚未入库的候选题',
              icon: RefreshCcw,
              disabled: Boolean(ws.busy) || !ws.selectedParserPresetId || !ws.canRecleanSelectedDoc,
              onSelect: ws.handleApplySelectedParserPreset,
            },
            {
              label: ws.busy === `ocr-${selectedDoc?.id}` ? '识别中...' : '重新识别',
              hint: ws.selectedDocCommittedCount > 0 ? '已有题目入库，当前不可用' : '重新调用 OCR 并清空未入库候选题',
              icon: ws.busy === `ocr-${selectedDoc?.id}` ? LoaderCircle : RefreshCcw,
              disabled: Boolean(ws.busy) || !ws.canReidentifySelectedDoc,
              onSelect: () => selectedDoc && ws.handleReidentifySource(selectedDoc),
            },
            {
              label: ws.busy === `reclean-${selectedDoc?.id}` ? '清洗中...' : '重新清洗',
              hint: ws.selectedDocCommittedCount > 0 ? '已有题目入库，当前不可用' : '按当前清洗脚本重新生成候选题',
              icon: ws.busy === `reclean-${selectedDoc?.id}` ? LoaderCircle : RefreshCcw,
              disabled: Boolean(ws.busy) || !ws.canRecleanSelectedDoc,
              onSelect: () => selectedDoc && ws.handleRecleanCandidates(selectedDoc),
            },
          ]}
        />
      </div>
    </section>
  )
}
