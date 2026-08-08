import { AlertTriangle, Check, LoaderCircle, WandSparkles } from 'lucide-react'
import { Modal } from '@/components/dialogs/Modal'
import { Button } from '@/components/ui'
import type { ModelSplitPreview } from '@/api/importV2'

export function ModelSplitDialog({
  preview,
  loading,
  applying,
  onClose,
  onStart,
  onApply,
}: {
  preview: ModelSplitPreview | null
  loading: boolean
  applying: boolean
  onClose: () => void
  onStart: () => void
  onApply: () => void
}) {
  const issueCount = preview?.items.reduce((count, item) => count + item.issues.length, 0) || 0
  const repairCount = preview?.items.filter((item) => item.numberRepair).length || 0
  const hasBlockingDiagnostics = Boolean(preview?.diagnostics.length)

  return (
    <Modal
      title="模型辅助拆题"
      desc="模型只判断题目边界和题号；OCR 正文、公式与图片标识符由本地原样保留。"
      wide
      onClose={loading || applying ? () => undefined : onClose}
      footer={(
        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-900">
          <div className="text-[11px] text-zinc-500">
            {preview ? `${preview.items.length} 题 · ${issueCount} 项提示${repairCount ? ` · ${repairCount} 题题号修复` : ''}` : '尚未生成模型预览'}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={loading || applying}>取消</Button>
            {!preview ? (
              <Button size="sm" icon={loading ? LoaderCircle : WandSparkles} onClick={onStart} disabled={loading}>
                {loading ? '识别中...' : '开始模型拆题'}
              </Button>
            ) : (
              <Button size="sm" icon={applying ? LoaderCircle : Check} onClick={onApply} disabled={applying || hasBlockingDiagnostics || !preview.items.length}>
                {applying ? '应用中...' : '应用到候选题'}
              </Button>
            )}
          </div>
        </div>
      )}
    >
      {!preview && !loading ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-300">
          生成结果会先进入预览，不会立即替换当前候选题。双文档批次会并行处理原卷和解析稿，再按题号合并。
        </div>
      ) : null}
      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500">
          <LoaderCircle className="size-4 animate-spin" /> 正在调用模型并校验片段归属...
        </div>
      ) : null}
      {preview ? (
        <div className="space-y-4">
          {preview.warnings.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" />模型提示</div>
              <ul className="mt-2 space-y-1">{preview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
            </div>
          ) : null}
          {preview.diagnostics.length ? (
            <div className="rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" />结果无法直接应用</div>
              <ul className="mt-2 space-y-1">{preview.diagnostics.map((diagnostic, index) => <li key={`${diagnostic}-${index}`}>{diagnostic}</li>)}</ul>
            </div>
          ) : null}
          <div className="max-h-[58vh] space-y-2 overflow-auto pr-1">
            {preview.items.map((item, index) => (
              <article key={`${item.questionNo}-${index}`} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold">第 {item.questionNo || '？'} 题</h4>
                  {item.numberRepair ? <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">OCR {item.rawQuestionNo || '？'} → {item.questionNo}</span> : null}
                </div>
                {item.numberRepair ? <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{item.numberRepair.reason}（置信度 {Math.round(item.numberRepair.confidence * 100)}%）</p> : null}
                <div className="mt-2 grid gap-2 text-xs text-zinc-600 dark:text-zinc-300 md:grid-cols-3">
                  <div><span className="font-semibold text-zinc-500">题干</span><p className="mt-1 line-clamp-3 whitespace-pre-wrap">{item.stemMarkdown || '未识别'}</p></div>
                  <div><span className="font-semibold text-zinc-500">答案</span><p className="mt-1 line-clamp-3 whitespace-pre-wrap">{item.answerText || '未识别'}</p></div>
                  <div><span className="font-semibold text-zinc-500">解析</span><p className="mt-1 line-clamp-3 whitespace-pre-wrap">{item.analysisMarkdown || '未识别'}</p></div>
                </div>
                {item.issues.length ? <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{item.issues.map((issue) => issue.message).join('；')}</div> : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
