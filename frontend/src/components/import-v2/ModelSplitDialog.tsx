import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  FileText,
  Filter,
  Info,
  LoaderCircle,
  Radio,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { Modal } from '@/components/dialogs/Modal'
import { Button, Input } from '@/components/ui'
import { MarkdownContent } from '@/components/MarkdownContent'
import { QuestionContentEditor } from '@/components/questions/editor'
import type { QuestionContentValue } from '@/components/questions/editor/model'
import type { ModelSplitApplyItem, ModelSplitPreview, ModelSplitPreviewItem, ModelSplitRequestOptions } from '@/api/importV2'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

function translateWarning(value: string) {
  const text = String(value || '').trim()
  if (/lines in the header|section headings|shared proposition notes|page markers/i.test(text)) {
    return '页眉、章节标题、跨题说明和页码等文档级内容未分配到单题，不影响题目正文。'
  }
  if (/answer summary tables|shared answer summary tables/i.test(text)) {
    return '检测到汇总答案表。系统会按题号提取并核验答案，不会把整张表强行归入某一道题。'
  }
  if (/single-choice answer table/i.test(text) || /multi-choice answer table/i.test(text)) {
    return '检测到答案表同时包含多道题的答案，相关题目的答案可能仍需人工确认。'
  }
  if (/whitespace-only segments are omitted/i.test(text)) return '纯空白片段已忽略，不影响题目内容。'
  return text
}

function issueState(item: ModelSplitPreviewItem) {
  if (item.issues.some((issue) => issue.severity === 'error')) return { label: '需处理', tone: 'danger' as const }
  if (item.issues.length || item.numberRepair) return { label: '需复核', tone: 'warning' as const }
  return { label: '可应用', tone: 'success' as const }
}

const statusBadgeStyles = {
  danger: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}

const NOTE_PRESETS = [
  '选择、填空题使用“题号. 答案 解析正文”格式，答案与解析紧接在同一行。',
  '解析稿按题号排列，题号之后先给出答案，再给出该题解析。',
  '选择题答案位于解析末尾（如“故选 A”）；请提取答案，但完整保留原解析。',
  '原卷与答案解析是分开的两份识别稿，请按题号对应，不要把解析当作题干。',
]

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
  onStart: (options?: ModelSplitRequestOptions) => void
  onApply: (items: ModelSplitApplyItem[]) => void
}) {
  const [draftItems, setDraftItems] = useState<ModelSplitPreviewItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filterMode, setFilterMode] = useState<'all' | 'review' | 'ready'>('all')
  const [showWarnings, setShowWarnings] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [assistantNote, setAssistantNote] = useState('')
  const dirtyFieldsRef = useRef(new Set<string>())
  const selectedQuestionRef = useRef<HTMLButtonElement | null>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (stream.phase !== 'connecting') return
    dirtyFieldsRef.current.clear()
    setDraftItems([])
    setSelectedIndex(0)
    setShowDiagnostics(false)
  }, [stream.phase])

  useEffect(() => {
    if (stream.phase === 'connecting') return
    if (!preview) {
      setDraftItems([])
      setSelectedIndex(0)
      return
    }
    setDraftItems((current) =>
      preview.items.map((item, index) => {
        const draft = current[index]
        if (!draft) return { ...item }
        return {
          ...item,
          questionNo: dirtyFieldsRef.current.has(`${index}:questionNo`) ? draft.questionNo : item.questionNo,
          stemMarkdown: dirtyFieldsRef.current.has(`${index}:stemMarkdown`) ? draft.stemMarkdown : item.stemMarkdown,
          answerText: dirtyFieldsRef.current.has(`${index}:answerText`) ? draft.answerText : item.answerText,
          analysisMarkdown: dirtyFieldsRef.current.has(`${index}:analysisMarkdown`) ? draft.analysisMarkdown : item.analysisMarkdown,
        }
      }),
    )
    setSelectedIndex((index) => Math.min(index, Math.max(0, preview.items.length - 1)))
  }, [preview, stream.phase])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => selectedQuestionRef.current?.scrollIntoView({ block: 'nearest' }))
    return () => window.cancelAnimationFrame(frame)
  }, [selectedIndex])

  useEffect(() => {
    if (preview?.diagnostics.length) setShowDiagnostics(true)
  }, [preview?.id, preview?.diagnostics.length])

  const selected = draftItems[selectedIndex]
  const issueCount = draftItems.reduce((count, item) => count + item.issues.length, 0)
  const reviewCount = draftItems.filter((item) => issueState(item).tone !== 'success').length
  const readyCount = draftItems.length - reviewCount
  const repairCount = draftItems.filter((item) => item.numberRepair).length
  const hasDiagnostics = Boolean(preview?.diagnostics.length)
  const diagnosticCount = preview?.diagnostics.length || 0
  const status = selected ? issueState(selected) : null
  const translatedWarnings = useMemo(() => (preview?.warnings || []).map(translateWarning), [preview?.warnings])
  const isComplete = stream.phase === 'completed'
  const noticeTransition = reduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' as const }

  const streamLabel =
    stream.phase === 'connecting'
      ? '正在连接 AI 模型'
      : stream.phase === 'streaming'
        ? `AI 拆题生成中${stream.receivedItems ? ` · 已解析 ${stream.receivedItems} 题` : ''}`
        : stream.phase === 'completed'
          ? `生成完成 · 共 ${draftItems.length} 题`
          : stream.phase === 'error'
            ? '生成中断'
            : '就绪'

  const filteredIndices = useMemo(() => {
    return draftItems
      .map((item, index) => ({ item, index, state: issueState(item) }))
      .filter(({ state }) => {
        if (filterMode === 'review') return state.tone !== 'success'
        if (filterMode === 'ready') return state.tone === 'success'
        return true
      })
      .map(({ index }) => index)
  }, [draftItems, filterMode])

  function updateSelected(patch: Partial<ModelSplitPreviewItem>) {
    for (const field of ['questionNo', 'stemMarkdown', 'answerText', 'analysisMarkdown'] as const) {
      if (field in patch) dirtyFieldsRef.current.add(`${selectedIndex}:${field}`)
    }
    setDraftItems((items) => items.map((item, index) => (index === selectedIndex ? { ...item, ...patch } : item)))
  }

  function updateContent(value: QuestionContentValue) {
    updateSelected(value)
  }

  function apply() {
    onApply(draftItems.map(({ questionNo, stemMarkdown, answerText, analysisMarkdown }) => ({ questionNo, stemMarkdown, answerText, analysisMarkdown })))
  }

  function startSplit() {
    onStart({ note: assistantNote.trim() })
  }

  function appendNotePreset(value: string) {
    setAssistantNote((current) => {
      const note = current.trim()
      if (note.includes(value)) return current
      return note ? `${note}\n${value}` : value
    })
  }

  return (
    <Modal
      title="AI 模型拆题核对"
      desc="模型草稿可编辑，OCR 原稿只读对照；确认后才会写入候选题。公式和图片标识符保持原样。"
      wide
      locked
      surface="glass"
      onClose={applying ? () => undefined : onClose}
      footer={
        <div className="question-edit-glass-footer flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-black/6 dark:border-white/8 bg-white/35 dark:bg-black/25">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {preview ? (
              <>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{draftItems.length} 道题目</span>
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                {reviewCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                    <AlertTriangle className="size-3" />
                    {reviewCount} 题待复核
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CircleCheck className="size-3" />
                    全部可直接应用
                  </span>
                )}
                {repairCount ? (
                  <>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    <span className="text-zinc-500">{repairCount} 题智能修正题号</span>
                  </>
                ) : null}
              </>
            ) : (
              '尚未生成 AI 拆题预览'
            )}
          </div>
          <div className="flex items-center gap-2">
            {preview && draftItems.length ? (
              <div className="flex items-center gap-1 mr-2">
                <Button
                  variant="outline"
                  size="sm"
                  icon={ArrowLeft}
                  onClick={() => setSelectedIndex((index) => Math.max(0, index - 1))}
                  disabled={selectedIndex === 0 || applying}
                >
                  上一题
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={ArrowRight}
                  onClick={() => setSelectedIndex((index) => Math.min(draftItems.length - 1, index + 1))}
                  disabled={selectedIndex >= draftItems.length - 1 || applying}
                >
                  下一题
                </Button>
              </div>
            ) : null}
            <Button variant="outline" size="sm" onClick={onClose} disabled={applying}>
              {loading ? '停止并关闭' : '取消'}
            </Button>
            {!preview || stream.phase === 'error' ? (
              <Button size="sm" icon={loading ? LoaderCircle : stream.phase === 'error' ? RotateCcw : WandSparkles} onClick={startSplit} disabled={loading}>
                {loading ? 'AI 识别拆分中...' : stream.phase === 'error' ? '重新生成' : '开始 AI 拆题'}
              </Button>
            ) : (
              <Button
                size="sm"
                icon={applying ? LoaderCircle : Check}
                onClick={apply}
                disabled={loading || !isComplete || applying || !preview.id || !draftItems.length}
                className="bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {applying ? '应用中...' : loading ? '等待 AI 生成完成' : '应用全部结果'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {!preview && !loading ? (
        <div className="flex min-h-60 flex-col items-center justify-center gap-5 p-4 sm:p-6 text-center">
          <div className="flex size-13 items-center justify-center rounded-2xl border border-black/6 bg-white/65 shadow-2xs dark:border-white/10 dark:bg-white/10">
            <Sparkles className="size-6 text-zinc-700 dark:text-zinc-200" />
          </div>
          <div>
            <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">AI 辅助智能拆题</h4>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              自动识别复杂试卷题目边界、格式化题号并关联答案解析。生成结果提供全界面实时预览与对比核对。
            </p>
          </div>
          <div className="w-full max-w-2xl rounded-2xl border border-black/6 bg-white/92 p-4 text-left shadow-md dark:border-white/8 dark:bg-zinc-900/94">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="model-split-note" className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">本卷识别备注 <span className="font-normal text-zinc-400">（可选）</span></label>
              <span className="text-[11px] tabular-nums text-zinc-400">{assistantNote.length}/800</span>
            </div>
            <textarea
              id="model-split-note"
              value={assistantNote}
              maxLength={800}
              onChange={(event) => setAssistantNote(event.target.value)}
              placeholder="例如：选择、填空题的解析格式为“题号. 答案 解析正文”，答案与解析在同一行。"
              className="mt-2.5 min-h-24 w-full resize-y rounded-xl border border-black/8 bg-white/75 px-3 py-2.5 text-xs leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/8 dark:border-white/10 dark:bg-zinc-950/75 dark:text-zinc-100 dark:focus:border-zinc-500"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-zinc-400">快捷说明</span>
              {NOTE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => appendNotePreset(preset)}
                  className="rounded-full border border-black/8 bg-white/80 px-2.5 py-1 text-[11px] text-zinc-600 transition-all hover:border-zinc-300 hover:bg-white hover:text-zinc-900 active:scale-[0.98] dark:border-white/10 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 shadow-2xs"
                >
                  {preset.startsWith('选择、')
                    ? '答案与解析同行'
                    : preset.startsWith('解析稿')
                      ? '答案在解析开头'
                      : preset.startsWith('选择题')
                        ? '答案在解析末尾'
                        : '原卷与解析分离'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">备注仅用于本次模型识别，不会写入题库；OCR 正文、公式和图片标识符仍由本地原样重建。</p>
          </div>
          <Button size="sm" icon={WandSparkles} onClick={startSplit} className="mt-1">
            开始 AI 拆题
          </Button>
        </div>
      ) : null}

      {loading && !draftItems.length ? (
        <div className="question-edit-glass-inner flex min-h-60 flex-col items-center justify-center gap-3 rounded-2xl border border-black/6 p-8 text-center dark:border-white/8">
          <LoaderCircle className="size-6 animate-spin text-zinc-700 dark:text-zinc-200 motion-reduce:animate-none" />
          <div>
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{stream.message || '正在调用 AI 模型解析文档…'}</span>
            {stream.totalLines ? <p className="mt-1 text-xs text-zinc-400">正在分析 {stream.totalLines} 行 OCR 结构化文本</p> : null}
          </div>
        </div>
      ) : null}

      {stream.phase === 'error' && !draftItems.length ? (
        <div className="question-edit-glass-inner flex min-h-60 flex-col items-center justify-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-8 text-center">
          <CircleAlert className="size-6 text-rose-500" />
          <div>
            <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">AI 拆题未能完成</span>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-zinc-500">{stream.message}</p>
          </div>
          <Button variant="outline" size="sm" icon={RotateCcw} onClick={startSplit}>
            重试 AI 拆题
          </Button>
        </div>
      ) : null}

      {preview && draftItems.length ? (
        <div className="flex h-full min-h-0 flex-col gap-3">
          {/* Top Status & Collapsible Notice Bar */}
          <div className="shrink-0 space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-black/6 bg-white/60 px-3.5 py-2 shadow-2xs backdrop-blur-md dark:border-white/8 dark:bg-zinc-900/60">
              <div className="flex min-w-0 items-center gap-2 text-xs">
                {loading ? (
                  <LoaderCircle className="size-3.5 animate-spin text-zinc-600 dark:text-zinc-300 motion-reduce:animate-none" />
                ) : stream.phase === 'completed' ? (
                  <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : stream.phase === 'error' ? (
                  <CircleAlert className="size-3.5 text-rose-600 dark:text-rose-400" />
                ) : (
                  <Radio className="size-3.5 text-amber-500" />
                )}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{streamLabel}</span>
                <span className="text-zinc-300 dark:text-zinc-700">|</span>
                <span className="min-w-0 truncate text-zinc-500 dark:text-zinc-400">{stream.message}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {hasDiagnostics ? (
                  <button
                    type="button"
                    onClick={() => setShowDiagnostics((value) => !value)}
                    aria-expanded={showDiagnostics}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-800 transition-colors hover:bg-rose-500/20 active:scale-[0.98] dark:text-rose-200"
                  >
                    <ShieldAlert className="size-3.5 text-rose-600 dark:text-rose-400" />
                    <span>结构提示 ({diagnosticCount})</span>
                    <ChevronDown className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${showDiagnostics ? 'rotate-180' : ''}`} />
                  </button>
                ) : null}
                {translatedWarnings.length ? (
                  <button
                    type="button"
                    onClick={() => setShowWarnings((value) => !value)}
                    aria-expanded={showWarnings}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-500/20 active:scale-[0.98] dark:text-amber-300 transition-colors"
                  >
                    <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
                    <span>处理说明 ({translatedWarnings.length})</span>
                    <ChevronDown className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${showWarnings ? 'rotate-180' : ''}`} />
                  </button>
                ) : null}
              </div>
            </div>

            <AnimatePresence>
              {showDiagnostics && preview?.diagnostics.length ? (
                <motion.div
                  initial={reduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={noticeTransition}
                  className="overflow-hidden rounded-xl border border-rose-500/25 bg-rose-500/8 p-3 text-xs text-rose-950 shadow-2xs backdrop-blur-md dark:text-rose-100"
                >
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <div className="min-w-0">
                      <div className="font-semibold text-rose-800 dark:text-rose-200">模型结构存在提示，请对照 OCR 原稿后确认</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-rose-800/80 dark:text-rose-200/80">
                        这类提示不再阻止应用。模型草稿与 OCR 原稿会同时保留，你可以在本面板修正后再应用，后续仍会进入普通题目核对流程。
                      </p>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1.5 pl-6 text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {preview.diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic}-${index}`} className="list-disc marker:text-rose-500">{diagnostic}</li>
                    ))}
                  </ul>
                </motion.div>
              ) : null}
              {showWarnings && translatedWarnings.length ? (
                <motion.div
                  initial={reduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={noticeTransition}
                  className="overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 shadow-2xs backdrop-blur-md"
                >
                  <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300 mb-1.5">
                    <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
                    全局格式处理说明
                  </div>
                  <ul className="space-y-1 pl-4 list-disc text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    {translatedWarnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* 3-Column macOS Split View Layout */}
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_250px]">
            {/* Sidebar: Question List */}
            <aside className="question-edit-glass-inner flex min-h-0 flex-col overflow-hidden rounded-2xl border border-black/6 bg-white/85 dark:border-white/8 dark:bg-zinc-900/85 shadow-2xs">
              <div className="shrink-0 border-b border-black/6 px-3.5 py-3 dark:border-white/8">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">拆分结果</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {draftItems.length} 题
                  </span>
                </div>
                {/* Filter Switcher */}
                <div className="mt-2.5 flex items-center rounded-lg bg-black/4 p-0.5 text-[11px] font-medium dark:bg-white/6">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`flex-1 rounded-md py-1 text-center transition-all ${
                      filterMode === 'all'
                        ? 'bg-white text-zinc-900 shadow-2xs font-semibold dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    全部 ({draftItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('review')}
                    className={`flex-1 rounded-md py-1 text-center transition-all ${
                      filterMode === 'review'
                        ? 'bg-white text-zinc-900 shadow-2xs font-semibold dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    待复核 ({reviewCount})
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 [scrollbar-gutter:stable]" aria-label="题目列表">
                {filteredIndices.map((index) => {
                  const item = draftItems[index]
                  if (!item) return null
                  const state = issueState(item)
                  const Icon = state.tone === 'danger' ? CircleAlert : state.tone === 'warning' ? AlertTriangle : CircleCheck
                  const isSelected = index === selectedIndex

                  return (
                    <button
                      ref={isSelected ? selectedQuestionRef : undefined}
                      key={`${item.questionNo}-${index}`}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      className={`group relative flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all active:scale-[0.98] ${
                        isSelected
                          ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-950 shadow-2xs ring-1 ring-emerald-500/30 dark:border-emerald-600/40 dark:bg-emerald-950/40 dark:text-emerald-100 font-semibold'
                          : 'border-transparent text-zinc-700 hover:bg-black/4 dark:text-zinc-300 dark:hover:bg-white/5'
                      }`}
                    >
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                          isSelected
                            ? 'bg-emerald-600 text-white shadow-2xs dark:bg-emerald-500 dark:text-zinc-950'
                            : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}
                      >
                        {item.questionNo || '？'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">第 {item.questionNo || '？'} 题</span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          state.tone === 'danger'
                            ? isSelected
                              ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : state.tone === 'warning'
                              ? isSelected
                                ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                              : isSelected
                                ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300'
                                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        <Icon className="size-2.5" />
                        {state.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </aside>

            {/* Main Canvas: Question Content Editor */}
            {selected ? (
              <main className="question-edit-glass-inner flex min-h-0 flex-col overflow-hidden rounded-2xl border border-black/6 bg-white/92 p-3.5 dark:border-white/8 dark:bg-zinc-900/94 shadow-2xs">
                {/* Header Bar */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-black/6 pb-3 dark:border-white/8">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      <span>题号</span>
                      <Input
                        className="h-8 w-24 rounded-lg border-black/10 bg-white px-2.5 text-xs font-semibold text-zinc-900 shadow-2xs outline-none focus:border-zinc-900 dark:border-white/12 dark:bg-zinc-950 dark:text-zinc-100"
                        value={selected.questionNo}
                        onChange={(event) => updateSelected({ questionNo: event.target.value })}
                        aria-label="题号"
                      />
                    </label>
                    <span className="text-xs text-zinc-400">|</span>
                    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadgeStyles[status?.tone || 'success']}`}>
                      {status?.tone === 'danger' ? <CircleAlert className="size-3.5" /> : status?.tone === 'warning' ? <AlertTriangle className="size-3.5" /> : <CircleCheck className="size-3.5" />}
                      {status?.label}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400 font-medium">
                    {selectedIndex + 1} / {draftItems.length}
                  </div>
                </div>

                {/* OCR Repair Notification Callout */}
                {selected.numberRepair ? (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 shadow-2xs">
                    <Info className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                      OCR 原始题号 <strong className="font-semibold">{selected.rawQuestionNo || '？'}</strong> → 智能修复为 <strong className="font-semibold">{selected.questionNo}</strong> ({selected.numberRepair.reason}，置信度 {Math.round(selected.numberRepair.confidence * 100)}%)
                    </span>
                  </div>
                ) : null}

                <div className="mb-3 flex items-center gap-2 rounded-xl border border-sky-500/18 bg-sky-500/8 px-3 py-2 text-[11px] leading-relaxed text-sky-900 dark:text-sky-200">
                  <Info className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                  <span><strong className="font-semibold">模型草稿（可编辑）</strong>：右侧保留同一题的 OCR 原稿，可直接对照后修改。</span>
                </div>

                {/* Main Content Editor */}
                <QuestionContentEditor
                  key={`model-split:${preview.id}:${selectedIndex}`}
                  entityKey={`model-split:${preview.id}:${selectedIndex}`}
                  value={contentOf(selected)}
                  savedValue={contentOf(preview.items[selectedIndex] || selected)}
                  onChange={updateContent}
                  variant="compact"
                  surface="glass"
                  hideHeader
                  hideFooter
                  className="min-h-0 flex-1 border-none shadow-none bg-transparent"
                />
              </main>
            ) : (
              <div className="flex items-center justify-center text-sm text-zinc-500">暂无题目</div>
            )}

            {/* Right Panel: OCR source comparison and diagnostics */}
            <aside className="question-edit-glass-inner flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-black/6 bg-white/85 p-3.5 dark:border-white/8 dark:bg-zinc-900/85 shadow-2xs space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 border-b border-black/6 pb-2.5 dark:border-white/8">
                <FileText className="size-4 text-zinc-500" />
                OCR 原稿对照与核对
              </div>

              {selected ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">OCR 原稿（只读）</span>
                      <span className="rounded-full border border-black/6 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-white/8 dark:bg-zinc-800/80 dark:text-zinc-400">不会随草稿修改</span>
                    </div>
                    <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-black/6 bg-white/65 p-2.5 shadow-inner dark:border-white/8 dark:bg-zinc-950/35">
                      {selected.sourceStemMarkdown ? (
                        <section>
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">题干原稿</div>
                          <MarkdownContent className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300" content={selected.sourceStemMarkdown} />
                        </section>
                      ) : null}
                      {selected.sourceSolutionMarkdown ? (
                        <section className={selected.sourceStemMarkdown ? 'border-t border-black/6 pt-2.5 dark:border-white/8' : ''}>
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">答案与解析原稿</div>
                          <MarkdownContent className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300" content={selected.sourceSolutionMarkdown} />
                        </section>
                      ) : null}
                      {!selected.sourceStemMarkdown && !selected.sourceSolutionMarkdown ? (
                        <p className="text-xs text-zinc-400">本次预览未提供 OCR 原稿片段；请重新生成以查看对照。</p>
                      ) : null}
                    </div>
                  </div>

                  {/* Issue Diagnostics */}
                  <div className="space-y-2 border-t border-black/6 pt-3 dark:border-white/8">
                    <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">结构提示</span>
                    {selected.issues.length ? (
                      <div className="space-y-2">
                        {selected.issues.map((issue, index) => (
                          <div
                            key={`${issue.code}-${index}`}
                            className={`rounded-xl border p-2.5 text-xs leading-relaxed ${
                              issue.severity === 'error'
                                ? 'border-rose-500/20 bg-rose-500/10 text-rose-800 dark:text-rose-300'
                                : 'border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-300'
                            }`}
                          >
                            <div className="flex items-start gap-1.5 font-medium">
                              {issue.severity === 'error' ? <CircleAlert className="size-3.5 shrink-0 text-rose-500 mt-0.5" /> : <AlertTriangle className="size-3.5 shrink-0 text-amber-500 mt-0.5" />}
                              <span>{issue.message}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>该题目无异常，结构格式完整。</span>
                      </div>
                    )}
                  </div>

                  {/* Source Refs */}
                  <div className="border-t border-black/6 pt-3 dark:border-white/8 space-y-2">
                    <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">来源片段页码</span>
                    {selected.sourceRefs.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selected.sourceRefs.map((ref, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded-lg border border-black/6 bg-white/80 px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-2xs dark:border-white/8 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            <FileText className="size-3 text-zinc-400" />
                            第 {ref.pageNo} 页
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400">暂无来源页码</p>
                    )}
                  </div>
                </>
              ) : null}
            </aside>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
