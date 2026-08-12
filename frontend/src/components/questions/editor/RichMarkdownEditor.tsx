import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import Placeholder from '@tiptap/extension-placeholder'
import { AlertTriangle, Bold, Braces, Code2, Columns2, Italic, List, ListOrdered, Merge, PanelTop, Redo2, Rows3, Sigma, Split, Table2, TextCursorInput, Trash2, Undo2 } from 'lucide-react'
import { FormulaBlock, FormulaInline } from './FormulaNode'
import { FormulaEditorDialog } from './FormulaEditorDialog'
import { editorJsonToMarkdown, markdownToEditorHtml } from './markdownAdapter'
import { sanitizePastedHtml } from '@/utils/questionContentCodec'
import { withoutHtmlTableSegments } from '@/utils/htmlTables'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface RichMarkdownEditorProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
  compact?: boolean
  hideHeader?: boolean
  hideToolbar?: boolean
  onSaveRequest?: () => void
  surface?: 'solid' | 'glass'
  /** Raw Markdown benefits from a taller working area than the visual editor. */
  sourceMinHeight?: string
}

const rawPattern = /```|<\/?[a-z][^>]*>|<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/i
const figureMarkerPattern = /<!--\s*DOC2X_FIGURE:[^>\s]+\s*-->/i

function tableSpan(value: string | null) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 1
}

function spanAttribute(name: 'colspan' | 'rowspan') {
  return {
    default: 1,
    parseHTML: (element: HTMLElement) => tableSpan(element.getAttribute(name)),
    renderHTML: (attributes: Record<string, unknown>) => Number(attributes[name] || 1) > 1 ? { [name]: Number(attributes[name]) } : {},
  }
}

/**
 * Tiptap's table primitives provide the editing mechanics. These extensions add
 * source-format and span parsing so imported HTML tables can stay visual without
 * being flattened into Markdown before the user saves.
 */
const QuestionTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sourceFormat: {
        default: 'markdown',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-question-table-format') === 'html' ? 'html' : 'markdown',
        renderHTML: (attributes: Record<string, unknown>) => attributes.sourceFormat === 'html' ? { 'data-question-table-format': 'html' } : {},
      },
      border: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-question-table-border') || element.getAttribute('border') || '',
        renderHTML: () => ({}),
      },
    }
  },
})

const QuestionTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: spanAttribute('colspan'),
      rowspan: spanAttribute('rowspan'),
    }
  },
})

const QuestionTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: spanAttribute('colspan'),
      rowspan: spanAttribute('rowspan'),
    }
  },
})

function containsUnsupportedRawContent(value: string) {
  return rawPattern.test(withoutHtmlTableSegments(value))
}

function IconButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            className={`flex size-8 items-center justify-center rounded-md text-zinc-500 outline-none hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-35 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 ${active ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : ''}`}
          >
            {children}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  )
}

function TableActionBar({ editor }: { editor: Editor }) {
  return (
    <div role="toolbar" aria-label="表格操作" className="flex flex-wrap items-center gap-0.5 border-t border-zinc-100 bg-zinc-50/70 px-2 py-1.5 dark:border-zinc-900 dark:bg-zinc-900/20">
      <span className="mr-1 px-1 text-[11px] font-medium text-zinc-500">表格</span>
      <IconButton label="在上方插入行" disabled={!editor.can().addRowBefore()} onClick={() => editor.chain().focus().addRowBefore().run()}><Rows3 className="size-3.5" /></IconButton>
      <IconButton label="在下方插入行" disabled={!editor.can().addRowAfter()} onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 className="size-3.5 rotate-180" /></IconButton>
      <IconButton label="删除当前行" disabled={!editor.can().deleteRow()} onClick={() => editor.chain().focus().deleteRow().run()}><Rows3 className="size-3.5 text-red-600 dark:text-red-400" /></IconButton>
      <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <IconButton label="在左侧插入列" disabled={!editor.can().addColumnBefore()} onClick={() => editor.chain().focus().addColumnBefore().run()}><Columns2 className="size-3.5" /></IconButton>
      <IconButton label="在右侧插入列" disabled={!editor.can().addColumnAfter()} onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns2 className="size-3.5 rotate-180" /></IconButton>
      <IconButton label="删除当前列" disabled={!editor.can().deleteColumn()} onClick={() => editor.chain().focus().deleteColumn().run()}><Columns2 className="size-3.5 text-red-600 dark:text-red-400" /></IconButton>
      <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <IconButton label="合并选中的单元格" disabled={!editor.can().mergeCells()} onClick={() => editor.chain().focus().mergeCells().run()}><Merge className="size-3.5" /></IconButton>
      <IconButton label="拆分当前单元格" disabled={!editor.can().splitCell()} onClick={() => editor.chain().focus().splitCell().run()}><Split className="size-3.5" /></IconButton>
      <IconButton label="切换首行表头" disabled={!editor.can().toggleHeaderRow()} onClick={() => editor.chain().focus().toggleHeaderRow().run()}><PanelTop className="size-3.5" /></IconButton>
      <IconButton label="删除表格" disabled={!editor.can().deleteTable()} onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="size-3.5 text-red-600 dark:text-red-400" /></IconButton>
    </div>
  )
}

export function RichMarkdownEditor({ id, label, value, onChange, placeholder = '输入内容…', minHeight = 'min-h-36', sourceMinHeight = 'min-h-[28rem]', compact = false, hideHeader = false, hideToolbar = false, onSaveRequest, surface = 'solid' }: RichMarkdownEditorProps) {
  const [sourceMode, setSourceMode] = useState(() => containsUnsupportedRawContent(value))
  const [formulaMode, setFormulaMode] = useState<'inline' | 'block' | null>(null)
  const [formulaInitial, setFormulaInitial] = useState('')
  const [tableActive, setTableActive] = useState(false)
  const latestValue = useRef(value)
  latestValue.current = value
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      QuestionTable.configure({ resizable: true }),
      TableRow,
      QuestionTableHeader,
      QuestionTableCell,
      Placeholder.configure({ placeholder }),
      FormulaInline,
      FormulaBlock,
    ],
    content: markdownToEditorHtml(value),
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        class: `${minHeight} px-3 py-2.5 text-sm leading-7 text-zinc-900 outline-none dark:text-zinc-50 [&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-zinc-400 [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-zinc-200 [&_td]:p-2 [&_th]:border [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:p-2 dark:[&_td]:border-zinc-800 dark:[&_th]:border-zinc-800 dark:[&_th]:bg-zinc-900`,
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onSaveRequest?.()
          return true
        }
        return false
      },
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData('text/html') || ''
        if (!html) return false
        event.preventDefault()
        editor?.commands.insertContent(sanitizePastedHtml(html))
        return true
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const next = editorJsonToMarkdown(currentEditor.getJSON())
      if (next !== latestValue.current) onChange(next)
    },
  })

  const containsRaw = useMemo(() => containsUnsupportedRawContent(value), [value])
  const containsFigureMarkers = useMemo(() => figureMarkerPattern.test(value), [value])

  useEffect(() => {
    if (!editor) return
    const refreshTableActive = () => setTableActive(editor.isActive('table'))
    refreshTableActive()
    editor.on('selectionUpdate', refreshTableActive)
    editor.on('focus', refreshTableActive)
    editor.on('blur', refreshTableActive)
    return () => {
      editor.off('selectionUpdate', refreshTableActive)
      editor.off('focus', refreshTableActive)
      editor.off('blur', refreshTableActive)
    }
  }, [editor])

  useEffect(() => {
    if (!editor || sourceMode) return
    const current = editorJsonToMarkdown(editor.getJSON())
    if (current !== value) editor.commands.setContent(markdownToEditorHtml(value), { emitUpdate: false })
  }, [editor, sourceMode, value])

  const glass = surface === 'glass'

  if (!editor) return <div className={`${minHeight} animate-pulse rounded-lg border ${glass ? 'question-edit-glass-editor' : 'border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/20'}`} />

  const openFormulaDialog = (mode: 'inline' | 'block') => {
    const selection = editor.state.selection
    const selected = selection.empty ? '' : editor.state.doc.textBetween(selection.from, selection.to, '\n')
    setFormulaInitial(selected)
    setFormulaMode(mode)
  }

  return (
    <section aria-label={hideHeader ? label : undefined} aria-labelledby={hideHeader ? undefined : `${id}-label`} className="space-y-1.5">
      {!hideHeader ? <div className="flex items-center justify-between gap-3">
        <label id={`${id}-label`} htmlFor={id} className="text-[13px] font-medium text-zinc-500">{label}</label>
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50" onClick={() => setSourceMode((current) => !current)}>
          <Code2 className="size-3.5" />{sourceMode ? '返回可视化' : 'Markdown 源码'}
        </button>
      </div> : null}
      {containsRaw && !sourceMode ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/40 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{containsFigureMarkers ? '该字段包含图片绑定标记。为防止图片位置或绑定关系丢失，请在 Markdown 源码模式中编辑。' : '该字段包含原始 HTML 或代码围栏。为防止内容丢失，请在 Markdown 源码模式中编辑。'}</span>
        </div>
      ) : null}
      <div className={`${glass ? 'question-edit-glass-editor' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950'} relative overflow-visible rounded-lg border focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-300 dark:focus-within:border-zinc-500`}>
        {sourceMode ? (
          <textarea id={id} aria-label={`${label} Markdown 源码`} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSaveRequest?.() } }} className={`${sourceMinHeight} w-full resize-y bg-transparent px-3 py-2.5 font-mono text-sm leading-6 text-zinc-900 outline-none dark:text-zinc-50`} placeholder={placeholder} />
        ) : (
          <>
            {!hideToolbar ? (
              <div data-editor-toolbar className="sticky top-0 z-20 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <div role="toolbar" aria-label={`${label}格式工具`} className={`${glass ? 'question-edit-glass-toolbar' : 'border-b border-zinc-100 bg-zinc-50/95 dark:border-zinc-900 dark:bg-zinc-900/95'} flex flex-wrap items-center gap-0.5 px-2 py-1 ${compact ? 'max-h-10 overflow-hidden' : ''}`}>
                  <IconButton label="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="size-4" /></IconButton>
                  <IconButton label="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="size-4" /></IconButton>
                  <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
                  <IconButton label="粗体" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" /></IconButton>
                  <IconButton label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></IconButton>
                  <IconButton label="项目符号列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="size-4" /></IconButton>
                  <IconButton label="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></IconButton>
                  <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
                  <IconButton label="打开行内公式键盘" onClick={() => openFormulaDialog('inline')}><Sigma className="size-4" /></IconButton>
                  <IconButton label="打开块级公式键盘" onClick={() => openFormulaDialog('block')}><Braces className="size-4" /></IconButton>
                  <IconButton label="插入三列表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="size-4" /></IconButton>
                  <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
                  <IconButton label="插入填空线" onClick={() => editor.chain().focus().insertContent('___').run()}><TextCursorInput className="size-4" /></IconButton>
                </div>
                {tableActive ? <TableActionBar editor={editor} /> : null}
              </div>
            ) : null}
            <EditorContent editor={editor} />
          </>
        )}
      </div>
      {formulaMode ? (
        <FormulaEditorDialog
          title={formulaMode === 'inline' ? '插入行内公式' : '插入块级公式'}
          displayMode={formulaMode === 'block'}
          initialLatex={formulaInitial}
          onClose={() => { setFormulaMode(null); editor.chain().focus().run() }}
          onApply={(latex) => {
            editor.chain().focus().insertContent({ type: formulaMode === 'inline' ? 'formulaInline' : 'formulaBlock', attrs: { latex } }).run()
            setFormulaMode(null)
          }}
        />
      ) : null}
    </section>
  )
}
