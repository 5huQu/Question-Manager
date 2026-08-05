import { useEffect, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, IndentDecrease, IndentIncrease, Italic, List, ListOrdered } from 'lucide-react'
import type { QuestionBlock, TeachingTextStyle } from '@/types/teachingDocument'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { InlineFormattingControls } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'
import { TEXT_FONT_OPTIONS } from '@/utils/teachingDocument/lectureFonts'

type TextBlockTarget = {
  type: 'docHeading' | 'docParagraph'
  attrs: Record<string, unknown>
}

export type QuestionStyleScope = 'question' | 'document'

const TEXT_COLOR_OPTIONS = [
  { value: '', label: '继承颜色' },
  { value: '#18181b', label: '墨黑' },
  { value: '#2563eb', label: '蓝色' },
  { value: '#047857', label: '绿色' },
  { value: '#b45309', label: '棕金' },
  { value: '#be123c', label: '红色' },
  { value: '#7c3aed', label: '紫色' },
]

function activeTextBlock(editor: Editor): TextBlockTarget | null {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'docHeading' || node.type.name === 'docParagraph') {
      return { type: node.type.name, attrs: node.attrs as Record<string, unknown> }
    }
  }
  return null
}

function ToolbarButton({ label, active, disabled, onClick, children }: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick} className={`flex size-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35 ${active ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-900' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}`}>{children}</button>
}

function pickerColor(value: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : '#18181b'
}

function TypographyControls({
  style,
  inheritedFontLabel,
  onChange,
}: {
  style: TeachingTextStyle
  inheritedFontLabel: string
  onChange: (patch: Partial<TeachingTextStyle>) => void
}) {
  const bold = Number(style.fontWeight || 0) >= 600
  return (
    <>
      <select
        aria-label="字体"
        title={`当前${inheritedFontLabel}`}
        value={style.font || ''}
        onChange={(event) => onChange({ font: event.target.value || undefined })}
        className="h-7 max-w-32 cursor-pointer rounded bg-transparent px-1 text-[11px] text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <option value="">{inheritedFontLabel}</option>
        {TEXT_FONT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <select
        aria-label="字号"
        title="题目或标题字号"
        value={style.fontSize ? String(style.fontSize) : ''}
        onChange={(event) => onChange({ fontSize: event.target.value ? Number(event.target.value) as TeachingTextStyle['fontSize'] : undefined })}
        className="h-7 w-14 cursor-pointer rounded bg-transparent px-1 text-[11px] text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <option value="">字号</option>
        {[12, 14, 16, 18, 20, 24].map((size) => <option key={size} value={size}>{size}px</option>)}
      </select>
      <select
        aria-label="文字颜色"
        title="标题或题目文字颜色"
        value={TEXT_COLOR_OPTIONS.some((option) => option.value === style.color) ? style.color || '' : ''}
        onChange={(event) => onChange({ color: event.target.value || undefined })}
        className="h-7 max-w-20 cursor-pointer rounded bg-transparent px-1 text-[11px] text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {TEXT_COLOR_OPTIONS.map((option) => <option key={option.value || 'inherit'} value={option.value}>{option.label}</option>)}
      </select>
      <input
        type="color"
        aria-label="自定义文字颜色"
        title="自定义文字颜色"
        value={pickerColor(style.color)}
        onChange={(event) => onChange({ color: event.target.value })}
        className="size-6 cursor-pointer rounded border border-zinc-200 bg-transparent p-0.5 dark:border-zinc-700"
      />
      <ToolbarButton label="粗体" active={bold} onClick={() => onChange({ fontWeight: bold ? 400 : 700 })}><Bold className="size-3.5" /></ToolbarButton>
      <ToolbarButton label="斜体" active={style.italic === true} onClick={() => onChange({ italic: style.italic === true ? undefined : true })}><Italic className="size-3.5" /></ToolbarButton>
    </>
  )
}

export interface DocumentFormattingToolbarProps {
  editor: Editor | null
  /** 当前页面选中的题目块；题目块为原子节点，不存在普通文本编辑器选区。 */
  questionBlock?: QuestionBlock | null
  questionGlobalStyle?: TeachingTextStyle
  onQuestionStyleChange?: (patch: Partial<TeachingTextStyle>, scope: QuestionStyleScope) => void
  onQuestionStyleReset?: () => void
  headingStyle?: TeachingTextStyle
  onHeadingStyleChange?: (level: 1 | 2 | 3 | 4, patch: Partial<TeachingTextStyle>) => void
}

/** 页面级格式条：普通文本沿用行内格式；标题与题目切换为文档/块级样式目标。 */
export function DocumentFormattingToolbar({
  editor,
  questionBlock = null,
  questionGlobalStyle = {},
  onQuestionStyleChange,
  onQuestionStyleReset,
  headingStyle = {},
  onHeadingStyleChange,
}: DocumentFormattingToolbarProps) {
  const [, refresh] = useState(0)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const [questionScope, setQuestionScope] = useState<QuestionStyleScope>('question')
  useEffect(() => {
    if (!editor) return
    const update = () => refresh((value) => value + 1)
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    editor.on('focus', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
      editor.off('focus', update)
    }
  }, [editor])
  useEffect(() => setQuestionScope('question'), [questionBlock?.id])

  const target = editor ? activeTextBlock(editor) : null
  const headingLevel = target?.type === 'docHeading' && [1, 2, 3, 4].includes(Number(target.attrs.level))
    ? Number(target.attrs.level) as 1 | 2 | 3 | 4
    : null
  // 题卡内部编辑器复用本工具条；此时操作只作用于当前文字选区，
  // 不应被外层题目块样式模式拦截。
  const questionTextMode = Boolean(editor && editor.view.dom.hasAttribute('data-question-inline-editor'))
  const questionMode = !questionTextMode && Boolean(questionBlock && onQuestionStyleChange)
  const headingMode = !questionTextMode && !questionMode && headingLevel != null && Boolean(onHeadingStyleChange)
  const enabled = Boolean(editor && target && editor.isEditable)
  const alignment = String(target?.attrs.alignment || 'left')
  const listStyle = String(target?.attrs.listStyle || '')
  const indentLevel = Number(target?.attrs.indentLevel || 0)
  const updateTextBlock = (patch: Record<string, unknown>) => {
    if (!editor || !target) return
    editor.chain().focus().updateAttributes(target.type, patch).run()
  }
  const questionStyle = questionScope === 'document'
    ? questionGlobalStyle
    : { ...questionGlobalStyle, ...(questionBlock?.display?.typography || {}) }
  const hasQuestionOverride = Boolean(questionBlock?.display?.typography && Object.keys(questionBlock.display.typography).length)

  return (
    <div role="toolbar" aria-label="文档格式" className="flex h-12 min-w-0 items-center gap-0.5 overflow-x-auto border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950">
      {questionTextMode && editor ? (
        <InlineFormattingControls editor={editor} inheritedFontLabel="跟随题目默认字体" onFormula={() => setFormulaOpen(true)} />
      ) : questionMode ? (
        <>
          <span className="shrink-0 px-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">题目样式</span>
          <select aria-label="题目样式范围" title="选择本题或当前文档全部题目" value={questionScope} onChange={(event) => setQuestionScope(event.target.value as QuestionStyleScope)} className="h-7 rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-700 outline-none hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <option value="question">本题</option>
            <option value="document">全文题目</option>
          </select>
          <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
          <TypographyControls style={questionStyle} inheritedFontLabel="跟随题目默认字体" onChange={(patch) => onQuestionStyleChange?.(patch, questionScope)} />
          {hasQuestionOverride ? <button type="button" aria-label="恢复全文题目样式" title="清除本题样式覆盖，恢复全文题目样式" onClick={onQuestionStyleReset} className="ml-1 h-7 shrink-0 rounded px-2 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">跟随全文</button> : null}
        </>
      ) : headingMode ? (
        <>
          <span className="shrink-0 px-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{headingLevel}级标题（全文）</span>
          <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
          <TypographyControls style={headingStyle} inheritedFontLabel="跟随文档标题字体" onChange={(patch) => onHeadingStyleChange?.(headingLevel, patch)} />
        </>
      ) : editor && enabled ? (
        <InlineFormattingControls editor={editor} inheritedFontLabel="跟随文档字体" onFormula={() => setFormulaOpen(true)} />
      ) : <div className="flex h-8 items-center px-1 text-[11px] text-zinc-400">选择文字后编辑格式</div>}

      {!questionMode && !questionTextMode ? <>
        <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
        <ToolbarButton label="左对齐" active={alignment === 'left'} disabled={!enabled} onClick={() => updateTextBlock({ alignment: 'left' })}><AlignLeft className="size-3.5" /></ToolbarButton>
        <ToolbarButton label="居中" active={alignment === 'center'} disabled={!enabled} onClick={() => updateTextBlock({ alignment: 'center' })}><AlignCenter className="size-3.5" /></ToolbarButton>
        <ToolbarButton label="右对齐" active={alignment === 'right'} disabled={!enabled} onClick={() => updateTextBlock({ alignment: 'right' })}><AlignRight className="size-3.5" /></ToolbarButton>
        <ToolbarButton label="两端对齐" active={alignment === 'justify'} disabled={!enabled} onClick={() => updateTextBlock({ alignment: 'justify' })}><AlignJustify className="size-3.5" /></ToolbarButton>
        <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
        <ToolbarButton label="项目列表" active={listStyle === 'bullet'} disabled={!enabled || target?.type !== 'docParagraph'} onClick={() => updateTextBlock({ listStyle: listStyle === 'bullet' ? '' : 'bullet' })}><List className="size-3.5" /></ToolbarButton>
        <ToolbarButton label="编号列表" active={listStyle === 'ordered'} disabled={!enabled || target?.type !== 'docParagraph'} onClick={() => updateTextBlock({ listStyle: listStyle === 'ordered' ? '' : 'ordered' })}><ListOrdered className="size-3.5" /></ToolbarButton>
        <ToolbarButton label="减少缩进" disabled={!enabled || indentLevel <= 0} onClick={() => updateTextBlock({ indentLevel: Math.max(0, indentLevel - 1) })}><IndentDecrease className="size-3.5" /></ToolbarButton>
        <ToolbarButton label="增加缩进" disabled={!enabled || indentLevel >= 4} onClick={() => updateTextBlock({ indentLevel: Math.min(4, indentLevel + 1) })}><IndentIncrease className="size-3.5" /></ToolbarButton>
      </> : null}
      {formulaOpen && editor ? <FormulaEditorDialog title="插入行内公式" displayMode={false} onClose={() => { setFormulaOpen(false); editor.chain().focus().run() }} onApply={(latex) => { editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex } }).run(); setFormulaOpen(false) }} /> : null}
    </div>
  )
}
