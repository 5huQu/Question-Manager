import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import Placeholder from '@tiptap/extension-placeholder'
import { AlertTriangle, Bold, Braces, Code2, Italic, List, ListOrdered, Redo2, Sigma, Table2, Undo2 } from 'lucide-react'
import { FormulaBlock, FormulaInline } from './FormulaNode'
import { FormulaEditorDialog } from './FormulaEditorDialog'
import { editorJsonToMarkdown, markdownToEditorHtml } from './markdownAdapter'
import { sanitizePastedHtml } from '@/utils/questionContentCodec'

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
}

const rawPattern = /```|<\/?[a-z][^>]*>/i

function IconButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
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
  )
}

export function RichMarkdownEditor({ id, label, value, onChange, placeholder = '输入内容…', minHeight = 'min-h-36', compact = false, hideHeader = false, hideToolbar = false, onSaveRequest }: RichMarkdownEditorProps) {
  const [sourceMode, setSourceMode] = useState(() => rawPattern.test(value))
  const [formulaMode, setFormulaMode] = useState<'inline' | 'block' | null>(null)
  const latestValue = useRef(value)
  latestValue.current = value
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      TableKit.configure({ table: { resizable: true } }),
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

  const containsRaw = useMemo(() => rawPattern.test(value), [value])

  useEffect(() => {
    if (!editor || sourceMode) return
    const current = editorJsonToMarkdown(editor.getJSON())
    if (current !== value) editor.commands.setContent(markdownToEditorHtml(value), { emitUpdate: false })
  }, [editor, sourceMode, value])

  if (!editor) return <div className={`${minHeight} animate-pulse rounded-lg border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/20`} />

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
          <span>该字段包含原始 HTML 或代码围栏。为防止内容丢失，请在 Markdown 源码模式中编辑。</span>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:border-zinc-500">
        {sourceMode ? (
          <textarea id={id} aria-label={`${label} Markdown 源码`} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSaveRequest?.() } }} className={`${minHeight} w-full resize-y bg-transparent px-3 py-2.5 font-mono text-sm leading-6 text-zinc-900 outline-none dark:text-zinc-50`} placeholder={placeholder} />
        ) : (
          <>
            {!hideToolbar ? <div role="toolbar" aria-label={`${label}格式工具`} className={`flex flex-wrap items-center gap-0.5 border-b border-zinc-100 bg-zinc-50/50 px-2 py-1 dark:border-zinc-900 dark:bg-zinc-900/20 ${compact ? 'max-h-10 overflow-hidden' : ''}`}>
              <IconButton label="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="size-4" /></IconButton>
              <IconButton label="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="size-4" /></IconButton>
              <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
              <IconButton label="粗体" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" /></IconButton>
              <IconButton label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></IconButton>
              <IconButton label="项目符号列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="size-4" /></IconButton>
              <IconButton label="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></IconButton>
              <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
              <IconButton label="打开行内公式键盘" onClick={() => setFormulaMode('inline')}><Sigma className="size-4" /></IconButton>
              <IconButton label="打开块级公式键盘" onClick={() => setFormulaMode('block')}><Braces className="size-4" /></IconButton>
              <IconButton label="插入三列表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="size-4" /></IconButton>
            </div> : null}
            <EditorContent editor={editor} />
          </>
        )}
      </div>
      {formulaMode ? (
        <FormulaEditorDialog
          title={formulaMode === 'inline' ? '插入行内公式' : '插入块级公式'}
          displayMode={formulaMode === 'block'}
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
