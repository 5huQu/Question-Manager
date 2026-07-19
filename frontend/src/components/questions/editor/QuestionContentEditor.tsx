import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, FileText, Plus, RotateCcw, Save, Sigma, X } from 'lucide-react'
import { RichMarkdownEditor } from './RichMarkdownEditor'
import { FormulaEditorDialog } from './FormulaEditorDialog'
import { contentEquals, detectCompatibilityWarnings, joinChoices, splitChoices, type QuestionContentValue, type QuestionEditorVariant, type StructuredChoice } from './model'

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
  variant?: QuestionEditorVariant
  saving?: boolean
  disabled?: boolean
  contentRevision?: number
  conflict?: QuestionEditorConflict | null
  dirty?: boolean
  className?: string
}

type EditorField = keyof QuestionContentValue

const tabs: Array<{ key: EditorField; label: string }> = [
  { key: 'stemMarkdown', label: '题干与选项' },
  { key: 'answerText', label: '答案' },
  { key: 'analysisMarkdown', label: '解析' },
]

function StructuredChoicesEditor({ entityKey, choices, onChange }: { entityKey: string; choices: StructuredChoice[]; onChange: (choices: StructuredChoice[]) => void }) {
  if (!choices.length) {
    return (
      <button type="button" className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900" onClick={() => onChange(['A', 'B', 'C', 'D'].map((label) => ({ label, content: '' })))}>
        <Plus className="size-3.5" />添加结构化选项
      </button>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/30 p-3 dark:border-zinc-800 dark:bg-zinc-900/10">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-zinc-500">结构化选项</span>
        <button type="button" className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50" onClick={() => onChange([])}>转为普通正文</button>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {choices.map((choice, index) => (
          <StructuredChoiceRow
            key={choice.label}
            id={`${entityKey}-choice-${choice.label}`}
            choice={choice}
            onChange={(content) => onChange(choices.map((item, itemIndex) => itemIndex === index ? { ...item, content } : item))}
          />
        ))}
      </div>
    </div>
  )
}

function StructuredChoiceRow({ id, choice, onChange }: { id: string; choice: StructuredChoice; onChange: (content: string) => void }) {
  const [formulaOpen, setFormulaOpen] = useState(false)

  function insertFormula(latex: string) {
    const formula = `$${latex}$`
    onChange(`${choice.content}${choice.content.trim() ? ' ' : ''}${formula}`)
    setFormulaOpen(false)
  }

  return (
    <div className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_2rem] items-start gap-2 rounded-lg border border-zinc-200 bg-white p-2.5 focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{choice.label}</span>
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
      <button
        type="button"
        aria-label={`为选项 ${choice.label} 打开公式键盘`}
        title="插入公式"
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        onClick={() => setFormulaOpen(true)}
      >
        <Sigma className="size-4" />
      </button>
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
  variant = 'full',
  saving = false,
  disabled = false,
  contentRevision,
  conflict,
  dirty: dirtyOverride,
  className = '',
}: QuestionContentEditorProps) {
  const [activeField, setActiveField] = useState<EditorField>('stemMarkdown')
  const [saveError, setSaveError] = useState('')
  const baseline = useRef(value)
  const lastEntity = useRef(entityKey)
  if (lastEntity.current !== entityKey) {
    lastEntity.current = entityKey
    baseline.current = value
  }
  const dirty = dirtyOverride ?? !contentEquals(value, savedValue ?? baseline.current)
  const warnings = useMemo(() => detectCompatibilityWarnings(value), [value])
  const stem = useMemo(() => splitChoices(value.stemMarkdown), [value.stemMarkdown])
  const compact = variant === 'compact'

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

  async function save() {
    if (!onSave || disabled || saving || !dirty) return
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
    />
  )

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${className}`} aria-busy={saving}>
      <header className="border-b border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-900 dark:bg-zinc-900/10">
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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {conflict ? (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div><p className="text-xs font-medium">内容版本冲突</p><p className="mt-1 text-xs opacity-90">{conflict.message}{conflict.actualContentRevision != null ? `（当前版本 ${conflict.actualContentRevision}）` : ''}</p></div>
          </div>
        ) : null}
        {saveError ? <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-xs text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" />保存失败，本地修改仍保留：{saveError}</div> : null}
        {warnings.length ? (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div><p className="text-xs font-medium">发现 {warnings.length} 项转换提示</p><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">{warnings.map((warning, index) => <li key={`${warning.field}-${warning.code}-${index}`}>{tabs.find((tab) => tab.key === warning.field)?.label}：{warning.message}</li>)}</ul></div>
          </div>
        ) : null}

        <div role="tablist" aria-label="题目内容字段" className="flex w-fit max-w-full overflow-x-auto rounded-lg border border-zinc-200/50 bg-zinc-100/80 p-0.5 dark:border-zinc-800/50 dark:bg-zinc-900/80">
          {tabs.map((tab) => (
            <button key={tab.key} type="button" role="tab" aria-selected={activeField === tab.key} aria-controls={`${entityKey}-${tab.key}-panel`} className={`h-8 whitespace-nowrap rounded-md px-3 text-xs font-medium ${activeField === tab.key ? 'border border-zinc-200/50 bg-white text-zinc-900 shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}`} onClick={() => setActiveField(tab.key)}>{tab.label}</button>
          ))}
        </div>

        <div id={`${entityKey}-${activeField}-panel`} role="tabpanel" aria-label={tabs.find((tab) => tab.key === activeField)?.label}>
          {editorForField(activeField)}
        </div>
        {activeField === 'stemMarkdown' ? <StructuredChoicesEditor entityKey={entityKey} choices={stem.choices} onChange={(choices) => updateField('stemMarkdown', joinChoices(stem.body, choices))} /> : null}
      </div>

      <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t border-zinc-200 bg-white/90 px-5 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-400" aria-live="polite">
          {dirty ? <><span className="size-1.5 shrink-0 rounded-full bg-amber-500" />有未保存修改</> : <><Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />内容已保存</>}
          <span className="hidden truncate sm:inline">快捷键 ⌘/Ctrl + S</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onCancel ? <button type="button" className="h-9 rounded-md px-3 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50" onClick={onCancel}><span className="flex items-center gap-1.5"><X className="size-3.5" />关闭</span></button> : null}
          <button type="button" disabled={!dirty || saving || disabled} className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900" onClick={reset}><span className="flex items-center gap-1.5"><RotateCcw className="size-3.5" />重置</span></button>
          <button type="button" disabled={!onSave || !dirty || saving || disabled} className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200" onClick={() => { void save() }}><span className="flex items-center gap-1.5"><Save className="size-3.5" />{saving ? '保存中…' : '保存内容'}</span></button>
        </div>
      </footer>
    </div>
  )
}
