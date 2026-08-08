import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, FileText, LoaderCircle, Radio, RotateCcw, WandSparkles } from 'lucide-react'
import { Modal } from '@/components/dialogs/Modal'
import { Button, Input } from '@/components/ui'
import { QuestionContentEditor } from '@/components/questions/editor'
import type { QuestionContentValue } from '@/components/questions/editor/model'
import type { ModelSplitApplyItem, ModelSplitPreview, ModelSplitPreviewItem } from '@/api/importV2'

function translateWarning(value: string) {
  const text = String(value || '').trim()
  if (/single-choice answer table/i.test(text) || /multi-choice answer table/i.test(text)) {
    return '检测到答案表同时包含多道题的答案，因此没有把整张答案表强行分配给某一道题。相关题目的答案可能仍需通过匹配或人工确认。'
  }
  if (/whitespace-only segments are omitted/i.test(text)) return '纯空白片段已忽略，不影响题目内容。'
  return text
}

function issueState(item: ModelSplitPreviewItem) {
  if (item.issues.some((issue) => issue.severity === 'error')) return { label: '需处理', tone: 'danger' as const }
  if (item.issues.length || item.numberRepair) return { label: '需复核', tone: 'warning' as const }
  return { label: '可应用', tone: 'success' as const }
}

const stateStyles = {
  danger: 'border-red-200/70 bg-red-50/70 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300',
  warning: 'border-amber-200/70 bg-amber-50/70 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300',
  success: 'border-emerald-200/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300',
}

function contentOf(item: ModelSplitPreviewItem): QuestionContentValue {
  return { stemMarkdown: item.stemMarkdown, answerText: item.answerText, analysisMarkdown: item.analysisMarkdown }
}

export function ModelSplitDialog({
  preview,
  stream,
  loading,
  applying,
  onClose,
  onStart,
  onApply,
}: {
  preview: ModelSplitPreview | null
  stream: {
    phase: 'idle' | 'connecting' | 'streaming' | 'completed' | 'error'
    receivedItems: number
    totalItems?: number
    totalLines?: number
    message: string
  }
  loading: boolean
  applying: boolean
  onClose: () => void
  onStart: () => void
  onApply: (items: ModelSplitApplyItem[]) => void
}) {
  const [draftItems, setDraftItems] = useState<ModelSplitPreviewItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const dirtyFieldsRef = useRef(new Set<string>())

  useEffect(() => {
    if (stream.phase !== 'connecting') return
    dirtyFieldsRef.current.clear()
    setDraftItems([])
    setSelectedIndex(0)
  }, [stream.phase])

  useEffect(() => {
    if (stream.phase === 'connecting') return
    if (!preview) {
      setDraftItems([])
      setSelectedIndex(0)
      return
    }
    setDraftItems((current) => preview.items.map((item, index) => {
      const draft = current[index]
      if (!draft) return { ...item }
      return {
        ...item,
        questionNo: dirtyFieldsRef.current.has(`${index}:questionNo`) ? draft.questionNo : item.questionNo,
        stemMarkdown: dirtyFieldsRef.current.has(`${index}:stemMarkdown`) ? draft.stemMarkdown : item.stemMarkdown,
        answerText: dirtyFieldsRef.current.has(`${index}:answerText`) ? draft.answerText : item.answerText,
        analysisMarkdown: dirtyFieldsRef.current.has(`${index}:analysisMarkdown`) ? draft.analysisMarkdown : item.analysisMarkdown,
      }
    }))
    setSelectedIndex((index) => Math.min(index, Math.max(0, preview.items.length - 1)))
  }, [preview, stream.phase])

  const selected = draftItems[selectedIndex]
  const issueCount = draftItems.reduce((count, item) => count + item.issues.length, 0)
  const repairCount = draftItems.filter((item) => item.numberRepair).length
  const hasBlockingDiagnostics = Boolean(preview?.diagnostics.length)
  const status = selected ? issueState(selected) : null
  const translatedWarnings = useMemo(() => (preview?.warnings || []).map(translateWarning), [preview?.warnings])
  const isComplete = stream.phase === 'completed'
  const streamLabel = stream.phase === 'connecting'
    ? '正在连接模型'
    : stream.phase === 'streaming'
      ? `正在生成${stream.receivedItems ? ` · 已收到 ${stream.receivedItems} 题` : ''}`
      : stream.phase === 'completed'
        ? `生成完成 · ${draftItems.length} 题`
        : stream.phase === 'error'
          ? '生成中断'
          : '等待开始'

  function updateSelected(patch: Partial<ModelSplitPreviewItem>) {
    for (const field of ['questionNo', 'stemMarkdown', 'answerText', 'analysisMarkdown'] as const) {
      if (field in patch) dirtyFieldsRef.current.add(`${selectedIndex}:${field}`)
    }
    setDraftItems((items) => items.map((item, index) => index === selectedIndex ? { ...item, ...patch } : item))
  }

  function updateContent(value: QuestionContentValue) {
    updateSelected(value)
  }

  function apply() {
    onApply(draftItems.map(({ questionNo, stemMarkdown, answerText, analysisMarkdown }) => ({ questionNo, stemMarkdown, answerText, analysisMarkdown })))
  }

  return (
    <Modal
      title="模型辅助拆题"
      desc="模型只判断题目边界和题号；OCR 正文、公式与图片标识符由本地原样保留。你可以在应用前逐题复核。"
      wide
      locked
      surface="glass"
      onClose={applying ? () => undefined : onClose}
      footer={(
        <div className="question-edit-glass-footer flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            {preview ? <><span>{draftItems.length} 题</span><span className="text-zinc-300 dark:text-zinc-700">·</span><span>{issueCount} 项提示</span>{repairCount ? <><span className="text-zinc-300 dark:text-zinc-700">·</span><span>{repairCount} 题题号修复</span></> : null}</> : '尚未生成模型预览'}
          </div>
          <div className="flex items-center gap-2">
            {preview && draftItems.length ? (
              <>
                <Button variant="outline" size="sm" icon={ArrowLeft} onClick={() => setSelectedIndex((index) => Math.max(0, index - 1))} disabled={selectedIndex === 0 || applying}>上一题</Button>
                <Button variant="outline" size="sm" icon={ArrowRight} onClick={() => setSelectedIndex((index) => Math.min(draftItems.length - 1, index + 1))} disabled={selectedIndex >= draftItems.length - 1 || applying}>下一题</Button>
              </>
            ) : null}
            <Button variant="outline" size="sm" onClick={onClose} disabled={applying}>{loading ? '停止并关闭' : '取消'}</Button>
            {!preview || stream.phase === 'error' ? (
              <Button size="sm" icon={loading ? LoaderCircle : stream.phase === 'error' ? RotateCcw : WandSparkles} onClick={onStart} disabled={loading}>{loading ? '识别中...' : stream.phase === 'error' ? '重新生成' : '开始模型拆题'}</Button>
            ) : (
              <Button size="sm" icon={applying ? LoaderCircle : Check} onClick={apply} disabled={loading || !isComplete || applying || hasBlockingDiagnostics || !preview.id || !draftItems.length}>{applying ? '应用中...' : loading ? '等待模型完成' : '应用全部结果'}</Button>
            )}
          </div>
        </div>
      )}
    >
      {!preview && !loading ? (
        <div className="question-edit-glass-inner rounded-xl p-5 text-sm text-zinc-600 dark:text-zinc-300">生成结果会先进入预览，不会立即替换当前候选题。双文档批次会并行处理原卷和解析稿，再按题号合并。</div>
      ) : null}
      {loading && !draftItems.length ? <div className="question-edit-glass-inner flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl text-sm text-zinc-500"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /><span>{stream.message || '正在调用模型并等待第一道完整题目…'}</span>{stream.totalLines ? <span className="text-[11px] text-zinc-400">正在分析 {stream.totalLines} 行 OCR Markdown</span> : null}</div> : null}
      {stream.phase === 'error' && !draftItems.length ? <div className="question-edit-glass-inner flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl px-6 text-center"><CircleAlert className="size-5 text-red-500" /><span className="text-sm font-medium text-red-700 dark:text-red-300">模型拆题未完成</span><span className="max-w-xl text-xs leading-5 text-zinc-500">{stream.message}</span></div> : null}
      {preview && draftItems.length ? (
        <div className="flex h-full min-h-0 flex-col gap-3">
        <div className={`question-edit-glass-inner flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[11px] ${stream.phase === 'error' ? 'text-red-700 dark:text-red-300' : stream.phase === 'completed' ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-600 dark:text-zinc-300'}`}>
          {loading ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : stream.phase === 'completed' ? <CircleCheck className="size-3.5" /> : stream.phase === 'error' ? <CircleAlert className="size-3.5" /> : <Radio className="size-3.5" />}
          <span className="font-medium">{streamLabel}</span>
          <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">{stream.message}</span>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_245px]">
          <aside className="question-edit-glass-inner min-h-0 overflow-hidden rounded-xl">
            <div className="border-b border-black/6 px-3 py-3 dark:border-white/8"><p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">拆分结果</p><p className="mt-1 text-[11px] text-zinc-500">选择题目进行编辑和核对</p></div>
            <div className="min-h-0 space-y-1 overflow-y-auto p-2">
              {draftItems.map((item, index) => {
                const state = issueState(item)
                const Icon = state.tone === 'danger' ? CircleAlert : state.tone === 'warning' ? AlertTriangle : CircleCheck
                return <button key={`${item.questionNo}-${index}`} type="button" onClick={() => setSelectedIndex(index)} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors active:scale-[0.99] ${index === selectedIndex ? 'border-zinc-400 bg-white/80 shadow-sm dark:border-zinc-600 dark:bg-white/10' : 'border-transparent hover:border-black/8 hover:bg-white/40 dark:hover:border-white/8 dark:hover:bg-white/5'}`}>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">{item.questionNo || '？'}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">第 {item.questionNo || '？'} 题</span><span className={`mt-0.5 inline-flex items-center gap-1 text-[10px] ${state.tone === 'danger' ? 'text-red-600' : state.tone === 'warning' ? 'text-amber-700' : 'text-emerald-700'} dark:opacity-90`}><Icon className="size-3" />{state.label}</span></span>
                </button>
              })}
            </div>
          </aside>

          {selected ? (
            <main className="question-edit-glass-inner flex min-h-0 flex-col overflow-hidden rounded-xl p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <label className="block min-w-36 flex-1 text-xs font-medium text-zinc-700 dark:text-zinc-200">题号
                  <Input className="mt-1.5 max-w-40 bg-white/60 dark:bg-black/10" value={selected.questionNo} onChange={(event) => updateSelected({ questionNo: event.target.value })} aria-label="题号" />
                </label>
                <div className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] ${stateStyles[status?.tone || 'success']}`}>
                  {status?.tone === 'danger' ? <CircleAlert className="size-3.5" /> : status?.tone === 'warning' ? <AlertTriangle className="size-3.5" /> : <CircleCheck className="size-3.5" />}{status?.label}
                </div>
              </div>
              {selected.numberRepair ? <div className="mb-3 rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">OCR 题号 {selected.rawQuestionNo || '？'} → {selected.questionNo}：{selected.numberRepair.reason}（置信度 {Math.round(selected.numberRepair.confidence * 100)}%）</div> : null}
              <QuestionContentEditor
                entityKey={`model-split:${preview.id}:${selectedIndex}`}
                value={contentOf(selected)}
                savedValue={contentOf(preview.items[selectedIndex] || selected)}
                onChange={updateContent}
                variant="compact"
                title={`第 ${selected.questionNo || '？'} 题内容`}
                description="保留 OCR 原文结构；可修正明显的断行、答案和解析。"
                surface="glass"
                hideFooter
                className="min-h-0 flex-1"
              />
            </main>
          ) : <div className="flex items-center justify-center text-sm text-zinc-500">暂无题目</div>}

          <aside className="question-edit-glass-inner min-h-0 overflow-y-auto rounded-xl p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100"><FileText className="size-3.5 text-zinc-500" />核对信息</div>
            {selected ? <>
              {selected.issues.length ? <div className="mt-3 space-y-2">{selected.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className={`rounded-lg border px-2.5 py-2 text-[11px] ${issue.severity === 'error' ? stateStyles.danger : stateStyles.warning}`}>{issue.message}</div>)}</div> : <p className="mt-3 text-[11px] text-zinc-500">当前题目没有结构性提示。</p>}
              <div className="mt-4 border-t border-black/6 pt-3 dark:border-white/8"><p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">来源片段</p><p className="mt-1 text-[11px] leading-5 text-zinc-500">{selected.sourceRefs.length ? selected.sourceRefs.map((ref) => `第 ${ref.pageNo} 页`).join('、') : '暂无来源页码'}</p></div>
            </> : null}
          </aside>
        </div>
        {preview.warnings.length ? <div className="max-h-24 shrink-0 overflow-y-auto rounded-lg border border-amber-200/70 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"><div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" />模型提示</div><ul className="mt-2 space-y-1">{translatedWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div> : null}
        {preview.diagnostics.length ? <div className="max-h-24 shrink-0 overflow-y-auto rounded-lg border border-red-200/70 bg-red-50/60 p-3 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"><div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3.5" />结果无法直接应用</div><ul className="mt-2 space-y-1">{preview.diagnostics.map((diagnostic, index) => <li key={`${diagnostic}-${index}`}>{diagnostic}</li>)}</ul></div> : null}
        </div>
      ) : null}
    </Modal>
  )
}
