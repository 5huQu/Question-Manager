import { ChevronLeft, FileText, LoaderCircle, RefreshCcw, PencilLine, Eraser, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui'
import { ReviewActionMenu } from '@/components/import-v2/ReviewActionMenu'
import type { ImportV2WorkspaceState } from '../useImportV2Workspace'

export function ReviewHeaderBar({ ws }: { ws: ImportV2WorkspaceState }) {
  const { selectedDoc, activeImportJob, questions, committedQuestionCount } = ws
  const paperTitle = activeImportJob?.paperTitle || activeImportJob?.title || selectedDoc?.paperTitle || selectedDoc?.originalFileName || '未命名资料'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-black/6 bg-white/80 px-4 md:px-6 backdrop-blur-md dark:border-white/8 dark:bg-zinc-900/80">
      {/* Left section: Back button + Primary Title + Secondary Metadata/Breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          aria-label="返回导入批次列表"
          title="返回导入批次列表"
          onClick={() => ws.navigate('/tools/import')}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white/80 text-zinc-600 hover:bg-white hover:text-zinc-900 dark:border-white/12 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-all active:scale-95 shadow-2xs"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div className="flex min-w-0 flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
          <h1 className="truncate text-sm md:text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50 shrink-0 max-w-[20rem] lg:max-w-[28rem] xl:max-w-none">
            {paperTitle}
          </h1>

          <div className="flex min-w-0 shrink items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <button
              type="button"
              onClick={() => selectedDoc && ws.navigateToDocument(selectedDoc.id)}
              className="shrink-0 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              资料与识别
            </button>
            <ChevronLeft className="size-3 rotate-180 text-zinc-400 shrink-0" />
            <span className="shrink-0 font-medium text-zinc-800 dark:text-zinc-200">题目校对</span>
            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700 shrink-0">·</span>
            <span className="truncate font-medium">{questions.length} 题 · {committedQuestionCount} 题已入库</span>
          </div>
        </div>
      </div>

      {/* Right section: Presets & Action Buttons */}
      <div className="flex shrink-0 items-center gap-2">
        <select
          aria-label="导入规则预设"
          className="h-8.5 min-w-0 max-w-44 rounded-xl border border-black/10 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 dark:border-white/12 dark:bg-zinc-900/90 dark:text-zinc-100"
          value={ws.selectedParserPresetId}
          onChange={(event) => ws.setSelectedParserPresetId(event.target.value)}
          disabled={Boolean(ws.busy)}
          title="导入规则预设"
        >
          {ws.parserPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>

        <Button
          size="sm"
          variant="outline"
          icon={ws.busy === `reclean-${selectedDoc?.id}` ? LoaderCircle : RefreshCcw}
          disabled={Boolean(ws.busy) || !ws.selectedParserPresetId || !ws.canRecleanSelectedDoc}
          onClick={ws.handleApplySelectedParserPreset}
          title={ws.selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新解析。' : '按当前所选预设重新生成未入库候选题。'}
          className="rounded-xl border-black/10 bg-white/80 hover:bg-white dark:border-white/12 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-semibold shadow-2xs active:scale-95"
        >
          {ws.busy === `reclean-${selectedDoc?.id}` ? '解析中...' : '重新解析'}
        </Button>

        <Button
          size="sm"
          variant="outline"
          icon={FileText}
          disabled={!ws.selectedDocOcr && !ws.selectedOcr}
          onClick={ws.openSelectedDocMarkdownPreview}
          className="hidden xl:inline-flex rounded-xl border-black/10 bg-white/80 hover:bg-white dark:border-white/12 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-semibold shadow-2xs active:scale-95"
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
          className="hidden 2xl:inline-flex rounded-xl border-black/10 bg-white/80 hover:bg-white dark:border-white/12 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-semibold shadow-2xs active:scale-95"
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
    </header>
  )
}
