import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, FileText, ListPlus, LoaderCircle, Plus, RotateCcw, Save, Sigma, Sparkles, X } from 'lucide-react'
import { MarkdownContent } from '@/components/MarkdownContent'
import { RichMarkdownEditor } from './RichMarkdownEditor'
import { FormulaEditorDialog } from './FormulaEditorDialog'
import { AiPromptHelperDialog } from '@/components/dialogs/AiPromptHelperDialog'
import { aiAssistantApi, type AiAssistantQuestionContent } from '@/api/aiAssistant'
import { choiceAnswerMode, contentEquals, detectCompatibilityWarnings, extractChoiceAnswerLabels, joinChoices, serializeChoiceAnswerLabels, splitChoices, suggestChoiceConversion, type ChoiceAnswerMode, type ChoiceConversionSuggestion, type QuestionContentValue, type QuestionEditorVariant, type StructuredChoice } from './model'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface QuestionEditorConflict {
  message: string
  actualContentRevision?: number
}

export interface QuestionContentEditorProps {
  entityKey: string
  value: QuestionContentValue
  savedValue?: QuestionContentValue
  onChange: (value: QuestionContentValue) => void
  onSave?: (value: QuestionContentValue) => void | Promise<void>
  onCancel?: () => void
  title?: string
  description?: string
  /** Enables answer-option selection for 单选题 / 多选题. */
  questionType?: string
  variant?: QuestionEditorVariant
  saving?: boolean
  disabled?: boolean
  contentRevision?: number
  conflict?: QuestionEditorConflict | null
  dirty?: boolean
  className?: string
  surface?: 'solid' | 'glass'
  hideFooter?: boolean
  hideHeader?: boolean
  /** Let an enclosing pane own scrolling so child toolbars can stick to it. */
  contentScroll?: 'self' | 'parent'
  /** Callback fired when active tab field changes (stemMarkdown, answerText, analysisMarkdown) */
  onActiveTabChange?: (field: EditorField) => void
  /** Optional manual-fix PDF selection actions shown in the AI helper. */
  onCopyStemPdfScreenshot?: () => Promise<void>
  onCopyAnalysisPdfScreenshot?: () => Promise<void>
}

type EditorField = keyof QuestionContentValue
type AiOptimizationStatus = 'idle' | 'running' | 'review' | 'error'

const tabs: Array<{ key: EditorField; label: string }> = [
  { key: 'stemMarkdown', label: '题干与选项' },
  { key: 'answerText', label: '答案' },
  { key: 'analysisMarkdown', label: '解析' },
]

function StructuredChoicesEditor({
  entityKey,
  choices,
  suggestion,
  onChange,
  onApplySuggestion,
  answerMode,
  selectedAnswerLabels,
  onAnswerSelectionChange,
  surface = 'solid',
}: {
  entityKey: string
  choices: StructuredChoice[]
  suggestion?: ChoiceConversionSuggestion | null
  onChange: (choices: StructuredChoice[]) => void
  onApplySuggestion?: () => void
  answerMode?: ChoiceAnswerMode | null
  selectedAnswerLabels?: string[]
  onAnswerSelectionChange?: (label: string) => void
  surface?: 'solid' | 'glass'
}) {
  const glass = surface === 'glass'
  if (!choices.length) {
    return (
      <div className="space-y-2">
        {suggestion ? (
          <div className={`${glass ? 'question-edit-glass-choice' : 'border-zinc-300 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-900/30'} rounded-lg border p-3`} role="status">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">从题干识别到 A–D 四个选项</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">确认后会整理为结构化选项，保存前仍可逐项修改。</p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                onClick={onApplySuggestion}
              >
                <ListPlus className="size-3.5" />应用识别结果
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {suggestion.choices.map((choice) => (
                <div key={choice.label} className={`${glass ? 'question-edit-glass-choice' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'} flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2`}>
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-zinc-100 text-[11px] font-semibold dark:bg-zinc-800">{choice.label}</span>
                  <MarkdownContent className="min-w-0 text-xs" content={choice.content} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <button type="button" className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900" onClick={() => onChange(['A', 'B', 'C', 'D'].map((label) => ({ label, content: '' })))}>
          <Plus className="size-3.5" />添加空白结构化选项
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/30 p-3 dark:border-zinc-800 dark:bg-zinc-900/10">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[13px] font-medium text-zinc-500">结构化选项</span>
          {answerMode ? <p className="mt-0.5 text-[11px] text-zinc-500">点击选项字母即可{answerMode === 'single' ? '设置' : '勾选'}答案</p> : null}
        </div>
        <button type="button" className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50" onClick={() => onChange([])}>转为普通正文</button>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {choices.map((choice, index) => (
          <StructuredChoiceRow
            key={choice.label}
            id={`${entityKey}-choice-${choice.label}`}
            choice={choice}
            answerMode={answerMode}
            selected={selectedAnswerLabels?.includes(choice.label) || false}
            onAnswerSelectionChange={onAnswerSelectionChange ? () => onAnswerSelectionChange(choice.label) : undefined}
            onChange={(content) => onChange(choices.map((item, itemIndex) => itemIndex === index ? { ...item, content } : item))}
          />
        ))}
      </div>
    </div>
  )
}

function StructuredChoiceRow({
  id,
  choice,
  answerMode,
  selected,
  onAnswerSelectionChange,
  onChange,
}: {
  id: string
  choice: StructuredChoice
  answerMode?: ChoiceAnswerMode | null
  selected: boolean
  onAnswerSelectionChange?: () => void
  onChange: (content: string) => void
}) {
  const [formulaOpen, setFormulaOpen] = useState(false)

  function insertFormula(latex: string) {
    const formula = `$${latex}$`
    onChange(`${choice.content}${choice.content.trim() ? ' ' : ''}${formula}`)
    setFormulaOpen(false)
  }

  return (
    <div className={`grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_2rem] items-start gap-2 rounded-lg border bg-white p-2.5 focus-within:ring-1 dark:bg-zinc-950 ${selected ? 'border-zinc-900 bg-zinc-50 focus-within:border-zinc-900 focus-within:ring-zinc-400 dark:border-zinc-100 dark:bg-zinc-900/40 dark:focus-within:border-zinc-100 dark:focus-within:ring-zinc-600' : 'border-zinc-200 focus-within:border-zinc-500 focus-within:ring-zinc-300 dark:border-zinc-800'}`}>
      {answerMode && onAnswerSelectionChange ? (
        <button
          type="button"
          aria-label={`${answerMode === 'single' ? '设置' : '切换'}答案选项 ${choice.label}`}
          aria-pressed={selected}
          title={answerMode === 'single' ? `将选项 ${choice.label} 设为答案` : `${selected ? '取消' : '选择'}答案选项 ${choice.label}`}
          className={`mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${selected ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'}`}
          onClick={onAnswerSelectionChange}
        >
          {selected ? <Check className="size-3.5" /> : choice.label}
        </button>
      ) : <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{choice.label}</span>}
      <RichMarkdownEditor
        id={id}
        label={`选项 ${choice.label}`}
        value={choice.content}
        onChange={onChange}
        placeholder={`输入选项 ${choice.label}`}
        minHeight="min-h-20"
        compact
        hideHeader
        hideToolbar
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`为选项 ${choice.label} 打开公式键盘`}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            onClick={() => setFormulaOpen(true)}
          >
            <Sigma className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>插入公式</TooltipContent>
      </Tooltip>
      {formulaOpen ? (
        <FormulaEditorDialog
          title={`为选项 ${choice.label} 插入公式`}
          onClose={() => setFormulaOpen(false)}
          onApply={insertFormula}
        />
      ) : null}
    </div>
  )
}

export function QuestionContentEditor({
  entityKey,
  value,
  savedValue,
  onChange,
  onSave,
  onCancel,
  title = '编辑题目内容',
  description = '内容以 Markdown 保存，公式与表格可视化编辑。',
  questionType,
  variant = 'full',
  saving = false,
  disabled = false,
  contentRevision,
  conflict,
  dirty: dirtyOverride,
  className = '',
  surface = 'solid',
  hideFooter = false,
  hideHeader = false,
  contentScroll = 'self',
  onActiveTabChange,
  onCopyStemPdfScreenshot,
  onCopyAnalysisPdfScreenshot,
}: QuestionContentEditorProps) {
  const [activeField, setActiveField] = useState<EditorField>('stemMarkdown')
  const [saveError, setSaveError] = useState('')
  const [aiPromptOpen, setAiPromptOpen] = useState(false)
  const [aiOptimizationStatus, setAiOptimizationStatus] = useState<AiOptimizationStatus>('idle')
  const [aiOptimizationError, setAiOptimizationError] = useState('')
  const baseline = useRef(value)
  const lastEntity = useRef(entityKey)
  const aiOriginalContent = useRef<QuestionContentValue | null>(null)
  const aiRequestId = useRef(0)
  const isMounted = useRef(true)
  if (lastEntity.current !== entityKey) {
    lastEntity.current = entityKey
    baseline.current = value
  }
  const dirty = dirtyOverride ?? !contentEquals(value, savedValue ?? baseline.current)
  const warnings = useMemo(() => detectCompatibilityWarnings(value), [value])
  const stem = useMemo(() => splitChoices(value.stemMarkdown), [value.stemMarkdown])
  const answerMode = useMemo(() => choiceAnswerMode(questionType), [questionType])
  const selectedAnswerLabels = useMemo(
    () => answerMode ? extractChoiceAnswerLabels(value.answerText, stem.choices, answerMode) : [],
    [answerMode, stem.choices, value.answerText],
  )
  const choiceSuggestion = useMemo(
    () => stem.choices.length ? null : suggestChoiceConversion(value.stemMarkdown),
    [stem.choices.length, value.stemMarkdown],
  )
  const compact = variant === 'compact'
  const aiOptimizing = aiOptimizationStatus === 'running'

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  useEffect(() => {
    aiRequestId.current += 1
    aiOriginalContent.current = null
    setAiOptimizationStatus('idle')
    setAiOptimizationError('')
  }, [entityKey])

  useEffect(() => {
    if (!dirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  function updateField(field: EditorField, next: string) {
    onChange({ ...value, [field]: next })
  }

  function toggleAnswerSelection(label: string) {
    if (!answerMode) return
    const selected = new Set(selectedAnswerLabels)
    if (answerMode === 'single') {
      if (selected.has(label)) selected.clear()
      else {
        selected.clear()
        selected.add(label)
      }
    } else if (selected.has(label)) {
      selected.delete(label)
    } else {
      selected.add(label)
    }
    updateField('answerText', serializeChoiceAnswerLabels(stem.choices, Array.from(selected)))
  }

  async function optimizeWithAi(content: AiAssistantQuestionContent) {
    const requestId = ++aiRequestId.current
    if (!content.stemMarkdown.trim() && !content.answerText.trim() && !content.analysisMarkdown.trim()) {
      aiOriginalContent.current = null
      setAiOptimizationError('题干、答案和解析不能同时为空。')
      setAiOptimizationStatus('error')
      return
    }

    aiOriginalContent.current = content
    setAiOptimizationError('')
    setAiOptimizationStatus('running')
    try {
      const result = await aiAssistantApi.formatQuestionContent(content)
      if (!isMounted.current || requestId !== aiRequestId.current) return
      onChange(result.content)
      setAiOptimizationStatus('review')
    } catch (error) {
      if (!isMounted.current || requestId !== aiRequestId.current) return
      aiOriginalContent.current = null
      setAiOptimizationError(error instanceof Error ? error.message : 'AI 助手格式优化失败。')
      setAiOptimizationStatus('error')
    }
  }

  function keepAiOptimization() {
    aiOriginalContent.current = null
    setAiOptimizationError('')
    setAiOptimizationStatus('idle')
  }

  function revertAiOptimization() {
    if (aiOriginalContent.current) onChange(aiOriginalContent.current)
    aiOriginalContent.current = null
    setAiOptimizationError('')
    setAiOptimizationStatus('idle')
  }

  async function save() {
    if (!onSave || disabled || saving || aiOptimizing || !dirty) return
    setSaveError('')
    try {
      await onSave(value)
      baseline.current = value
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  function reset() {
    onChange(savedValue ?? baseline.current)
    setSaveError('')
  }

  const editorForField = (field: EditorField) => (
    <RichMarkdownEditor
      id={`${entityKey}-${field}`}
      label={tabs.find((tab) => tab.key === field)?.label || field}
      value={field === 'stemMarkdown' ? stem.body : value[field]}
      onChange={(next) => updateField(field, field === 'stemMarkdown' ? joinChoices(next, stem.choices) : next)}
      compact={compact}
      minHeight={compact ? 'min-h-28' : field === 'stemMarkdown' ? 'min-h-52' : 'min-h-40'}
      placeholder={field === 'stemMarkdown' ? '输入题干，使用工具栏插入公式或表格…' : field === 'answerText' ? '输入答案…' : '输入解题过程与关键步骤…'}
      onSaveRequest={() => { void save() }}
      surface={surface}
    />
  )

  return (
    <div className={`${surface === 'glass' ? (hideHeader ? 'bg-transparent' : 'question-edit-glass-inner') : `flex ${contentScroll === 'self' ? 'overflow-hidden' : 'overflow-visible'} rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950`} flex min-h-0 flex-col ${className}`} aria-busy={saving || aiOptimizing}>
      {!hideHeader ? (
        <header className={`${surface === 'glass' ? 'question-edit-glass-inner-header' : 'border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-900 dark:bg-zinc-900/10'} px-5 py-4`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-zinc-500" />
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>
              </div>
              <p className="mt-1 text-[13px] text-zinc-500">{description}</p>
            </div>
            {contentRevision != null ? <span className="inline-flex h-5 items-center rounded-md border border-zinc-200 bg-zinc-100 px-2 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">版本 {contentRevision}</span> : null}
          </div>
        </header>
      ) : null}

      <div className={`min-h-0 flex-1 space-y-4 ${contentScroll === 'self' ? 'overflow-y-auto' : 'overflow-visible'} p-5`}>
        {conflict ? (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div><p className="text-xs font-medium">内容版本冲突</p><p className="mt-1 text-xs opacity-90">{conflict.message}{conflict.actualContentRevision != null ? `（当前版本 ${conflict.actualContentRevision}）` : ''}</p></div>
          </div>
        ) : null}
        {saveError ? <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" />保存失败，本地修改仍保留：{saveError}</div> : null}
        {aiOptimizationStatus === 'running' ? (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50/45 p-3 text-violet-800 dark:border-violet-900/40 dark:bg-violet-950/20 dark:text-violet-200">
            <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />
            <div><p className="text-xs font-medium">AI 助手正在优化题干、答案和解析</p><p className="mt-1 text-xs opacity-90">完成后会自动回填到当前编辑器，期间请勿修改或保存内容。</p></div>
          </div>
        ) : null}
        {aiOptimizationStatus === 'review' ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/55 p-3 text-emerald-900 dark:border-emerald-900/45 dark:bg-emerald-950/20 dark:text-emerald-100">
            <div><p className="text-xs font-medium">AI 格式优化已回填到题干、答案和解析</p><p className="mt-1 text-xs opacity-80">请检查内容后选择保留或撤销；保留后仍需按正常流程保存。</p></div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={revertAiOptimization} className="h-8 rounded-md border border-emerald-300 bg-white px-3 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-zinc-950 dark:text-emerald-200 dark:hover:bg-emerald-950/60">撤销 AI 优化</button>
              <button type="button" onClick={keepAiOptimization} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"><Check className="size-3.5" />保留优化结果</button>
            </div>
          </div>
        ) : null}
        {aiOptimizationStatus === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
            <span className="text-xs">AI 格式优化失败：{aiOptimizationError}</span>
            <button type="button" onClick={keepAiOptimization} className="h-7 rounded-md px-2 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-950/60">关闭提示</button>
          </div>
        ) : null}
        {warnings.length ? (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div><p className="text-xs font-medium">发现 {warnings.length} 项转换提示</p><ul className="mt-1 list-disc space-y-1.5 pl-4 text-xs">{warnings.map((warning, index) => <li key={`${warning.field}-${warning.code}-${index}`}><span>{tabs.find((tab) => tab.key === warning.field)?.label}：{warning.message}</span>{warning.excerpt ? <code className="mt-0.5 block break-words rounded bg-amber-100/70 px-1.5 py-1 font-mono text-[11px] text-amber-900/80 dark:bg-amber-950/40 dark:text-amber-200/80">示例：{warning.excerpt}{warning.excerpt.length >= 160 ? '…' : ''}</code> : null}</li>)}</ul></div>
          </div>
        ) : null}

        <div className={aiOptimizing ? 'pointer-events-none select-none opacity-55' : ''}>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div role="tablist" aria-label="题目内容字段" className={`${surface === 'glass' ? 'question-edit-glass-tabs' : 'border-zinc-200/50 bg-zinc-100/80 dark:border-zinc-800/50 dark:bg-zinc-900/80 border'} grid flex-1 grid-cols-3 rounded-lg p-0.5`}>
            {tabs.map((tab) => (
              <button key={tab.key} type="button" role="tab" aria-selected={activeField === tab.key} aria-controls={`${entityKey}-${tab.key}-panel`} className={`flex h-8 items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-medium transition-all duration-150 active:scale-[0.97] ${activeField === tab.key ? 'border border-zinc-200/20 bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`} onClick={() => { setActiveField(tab.key); onActiveTabChange?.(tab.key) }}>{tab.label}</button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAiPromptOpen(true)}
            disabled={disabled || aiOptimizing}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200/90 bg-slate-100/90 px-3 text-xs font-medium text-slate-800 shadow-2xs transition-all duration-150 hover:border-slate-300 hover:bg-slate-200/80 active:scale-[0.97] dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-800"
          >
            <Sparkles className="size-3.5 text-slate-600 dark:text-slate-400" />
            <span>AI 辅助</span>
          </button>
        </div>

        <AiPromptHelperDialog
          open={aiPromptOpen}
          onClose={() => setAiPromptOpen(false)}
          content={value}
          onOptimizeWithAi={optimizeWithAi}
          onCopyStemPdfScreenshot={onCopyStemPdfScreenshot}
          onCopyAnalysisPdfScreenshot={onCopyAnalysisPdfScreenshot}
        />

        <div id={`${entityKey}-${activeField}-panel`} role="tabpanel" aria-label={tabs.find((tab) => tab.key === activeField)?.label}>
          {editorForField(activeField)}
        </div>
        {activeField === 'stemMarkdown' ? (
          <StructuredChoicesEditor
            entityKey={entityKey}
            choices={stem.choices}
            suggestion={choiceSuggestion}
            surface={surface}
            onApplySuggestion={choiceSuggestion
              ? () => updateField('stemMarkdown', joinChoices(choiceSuggestion.body, choiceSuggestion.choices))
              : undefined}
            answerMode={answerMode}
            selectedAnswerLabels={selectedAnswerLabels}
            onAnswerSelectionChange={answerMode ? toggleAnswerSelection : undefined}
            onChange={(choices) => updateField('stemMarkdown', joinChoices(stem.body, choices))}
          />
        ) : null}
        </div>
      </div>

      {!hideFooter ? (
        <footer className={`${surface === 'glass' ? 'question-edit-glass-footer' : 'border-t border-zinc-200 bg-white/90 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90'} sticky bottom-0 z-10 flex items-center justify-between gap-4 px-5 py-3`}>
          <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {dirty ? (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-400">
                <span className="size-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />有未保存修改
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400">
                <Check className="size-3.5 shrink-0" />内容已保存
              </span>
            )}
            <span className="hidden truncate text-zinc-400 sm:inline dark:text-zinc-500">快捷键 ⌘/Ctrl + S</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onCancel ? (
              <button
                type="button"
                className="h-8.5 rounded-lg px-3 text-xs font-medium text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-50"
                onClick={onCancel}
              >
                <span className="flex items-center gap-1.5"><X className="size-3.5" />关闭</span>
              </button>
            ) : null}
            <button
              type="button"
              disabled={!dirty || saving || disabled || aiOptimizing}
              className={`${surface === 'glass' ? 'question-edit-glass-button-secondary' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'} h-8.5 rounded-lg border px-3 text-xs font-medium text-zinc-700 transition-all hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900`}
              onClick={reset}
            >
              <span className="flex items-center gap-1.5"><RotateCcw className="size-3.5" />重置</span>
            </button>
            <button
              type="button"
              disabled={!onSave || !dirty || saving || disabled || aiOptimizing}
              className="h-8.5 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-zinc-50 shadow-xs transition-all hover:bg-zinc-800 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              onClick={() => { void save() }}
            >
              <span className="flex items-center gap-1.5"><Save className="size-3.5" />{saving ? '保存中…' : '保存内容'}</span>
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  )
}
