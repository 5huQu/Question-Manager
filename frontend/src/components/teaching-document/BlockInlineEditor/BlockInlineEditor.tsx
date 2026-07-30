/**
 * BlockInlineEditor — Heading/Paragraph 单块行内富文本编辑器
 *
 * 设计约束：
 * - 编辑器状态仅为当前块的短生命周期 UI 状态
 * - 每次变更立即通过 onChange 回传 TeachingInline[]，由外部走
 *   TeachingDocumentCommand/history/autosave 路径
 * - 外部文档更新（undo/redo、revision reload、切换块）通过 content 同步，
 *   带确定性比较防止回写循环，不打断中文 IME 组合输入
 * - 受保护内容（UnknownInline/unknownMarks）以只读模式展示，附原因说明
 * - 粘贴 HTML 仅映射允许的 marks/文本/换行，拒绝一切危险内容
 */
import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { AlertTriangle, Bold, Code, Italic, Sigma, Strikethrough, Underline as UnderlineIcon } from 'lucide-react'
import type { JSONContent } from '@tiptap/react'
import type { TeachingInline } from '@/types/teachingDocument'
import {
  pastedHtmlToSafeInlines,
  teachingInlinesToTiptapDoc,
  tiptapDocToTeachingInlines,
} from '@/utils/teachingDocument/inlineAdapter'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { TEXT_FONT_OPTIONS } from '@/utils/teachingDocument/lectureFonts'
import { createBlockEditorExtensions } from './extensions'

export interface BlockInlineEditorProps {
  /** 当前块的行内内容（来自 TeachingDocumentV1，唯一事实来源） */
  inlines: TeachingInline[]
  /** 内容变更回调；外部负责 dispatch command + autosave */
  onChange: (inlines: TeachingInline[]) => void
  /** 保护模式原因；非空时编辑器只读 */
  protectedReason?: string
  ariaLabel?: string
  /** 嵌入文档块时使用无边框编辑器，工具条改为选中文本后浮动显示 */
  variant?: 'panel' | 'embedded'
  toolbar?: 'inline' | 'floating' | 'none'
  /** 编辑器实例就绪回调（用于外部协调焦点/选区，也供测试驱动） */
  onEditorReady?: (editor: Editor) => void
}

function MarkButton({ label, active, disabled, onClick, children }: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded text-zinc-500 outline-none hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-35 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 ${active ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : ''}`}
    >
      {children}
    </button>
  )
}

/** 将安全行内内容插入编辑器当前选区（替换选中文本） */
function insertSafeInlines(editor: Editor, inlines: TeachingInline[]): void {
  if (!inlines.length) return
  const doc = teachingInlinesToTiptapDoc(inlines)
  const paragraph = doc.content?.[0]
  const nodes = (paragraph?.content || []).map((nodeJson: JSONContent) => editor.state.schema.nodeFromJSON(nodeJson))
  if (!nodes.length) return
  const { state, view } = editor
  const tr = state.tr
  let pos = tr.selection.from
  tr.deleteSelection()
  for (const node of nodes) {
    tr.insert(pos, node)
    pos += node.nodeSize
  }
  tr.setSelection(TextSelection.create(tr.doc, pos))
  view.dispatch(tr)
}

export function BlockInlineEditor({
  inlines,
  onChange,
  protectedReason,
  ariaLabel = '块内容编辑',
  variant = 'panel',
  toolbar = 'inline',
  onEditorReady,
}: BlockInlineEditorProps) {
  const [formulaDialogOpen, setFormulaDialogOpen] = useState(false)
  const editable = !protectedReason
  /** 最近一次由编辑器产生的内容签名，用于区分自身回显与外部更新 */
  const lastEmittedSig = useRef('')
  const syncing = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [, refreshToolbar] = useState(0)

  const initialDoc = useRef(teachingInlinesToTiptapDoc(inlines))
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: createBlockEditorExtensions(),
    content: initialDoc.current,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        'data-block-inline-editor': '',
        class: variant === 'embedded'
          ? 'min-h-0 px-0 py-1 text-sm leading-6 text-zinc-900 outline-none dark:text-zinc-50'
          : 'min-h-20 px-2.5 py-2 text-sm leading-6 text-zinc-900 outline-none dark:text-zinc-50',
      },
      handleKeyDown: (_view, event) => {
        // 单块编辑器不允许 Enter 创建新段落/标题；Shift+Enter 插入 hardBreak
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault()
          return true
        }
        return false
      },
      handlePaste: (_view, event) => {
        if (!editable) return true
        const html = event.clipboardData?.getData('text/html') || ''
        if (!html) return false // 纯文本粘贴走默认路径
        event.preventDefault()
        if (editor) insertSafeInlines(editor, pastedHtmlToSafeInlines(html))
        return true
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (syncing.current) return
      const nextInlines = tiptapDocToTeachingInlines(currentEditor.getJSON())
      lastEmittedSig.current = JSON.stringify(nextInlines)
      onChangeRef.current(nextInlines)
    },
  })

  // editable 状态同步（保护模式切换）
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  // 编辑器实例就绪通知
  const onEditorReadyRef = useRef(onEditorReady)
  onEditorReadyRef.current = onEditorReady
  useEffect(() => {
    if (editor) onEditorReadyRef.current?.(editor)
  }, [editor])

  useEffect(() => {
    if (!editor || toolbar !== 'floating') return
    const update = () => refreshToolbar((value) => value + 1)
    editor.on('selectionUpdate', update)
    editor.on('focus', update)
    editor.on('blur', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('focus', update)
      editor.off('blur', update)
    }
  }, [editor, toolbar])

  // 外部文档更新同步（undo/redo、revision reload、切换块）
  useEffect(() => {
    if (!editor) return
    const sig = JSON.stringify(inlines)
    if (sig === lastEmittedSig.current) return // 自身变更的回显，跳过
    const currentSig = JSON.stringify(tiptapDocToTeachingInlines(editor.getJSON()))
    if (sig === currentSig) {
      lastEmittedSig.current = sig
      return
    }
    syncing.current = true
    editor.commands.setContent(teachingInlinesToTiptapDoc(inlines), { emitUpdate: false })
    syncing.current = false
    lastEmittedSig.current = sig
  }, [editor, inlines])

  if (!editor) {
    return <div className="min-h-20 animate-pulse rounded-md border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/20" />
  }

  return (
    <div className={`relative ${variant === 'panel' ? 'space-y-1.5' : ''}`}>
      {protectedReason ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/40 p-2 text-[11px] leading-4 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{protectedReason}</span>
        </div>
      ) : toolbar === 'inline' ? (
        <div role="toolbar" aria-label="文字格式工具" className="flex items-center gap-0.5 rounded-md border border-zinc-200 bg-zinc-50/60 px-1 py-0.5 dark:border-zinc-800 dark:bg-zinc-900/30">
          <InlineFormattingControls editor={editor} onFormula={() => setFormulaDialogOpen(true)} />
        </div>
      ) : null}
      {toolbar === 'floating' && !protectedReason && editor.isFocused && editor.state.selection.from !== editor.state.selection.to ? (
        <div
          role="toolbar"
          aria-label="文字格式工具"
          className="absolute bottom-full left-1/2 z-50 mb-1 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-zinc-200 bg-white/95 px-1 py-0.5 shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95"
          onMouseDown={(event) => event.preventDefault()}
        >
          <InlineFormattingControls editor={editor} onFormula={() => setFormulaDialogOpen(true)} />
        </div>
      ) : null}
      <div className={`${variant === 'embedded'
        ? 'overflow-visible bg-transparent'
        : `overflow-hidden rounded-md border bg-white focus-within:border-zinc-400 focus-within:ring-1 focus-within:ring-zinc-200 dark:bg-zinc-950 dark:focus-within:border-zinc-600 ${protectedReason ? 'border-amber-200 dark:border-amber-900/40' : 'border-zinc-200 dark:border-zinc-800'}`
      }`}>
        <EditorContent editor={editor} />
      </div>
      {formulaDialogOpen ? (
        <FormulaEditorDialog
          title="插入行内公式"
          displayMode={false}
          onClose={() => { setFormulaDialogOpen(false); editor.chain().focus().run() }}
          onApply={(latex) => {
            editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex } }).run()
            setFormulaDialogOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

const TEXT_COLOR_OPTIONS = [
  { value: '', label: '默认颜色' },
  { value: '#18181b', label: '墨黑' },
  { value: '#2563eb', label: '蓝色' },
  { value: '#047857', label: '绿色' },
  { value: '#b45309', label: '棕金' },
  { value: '#be123c', label: '红色' },
  { value: '#7c3aed', label: '紫色' },
]

function pickerColor(value: unknown) {
  const color = String(value || '')
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#18181b'
}

/**
 * 无选区时，格式操作应作用于当前文字对象，而不是只写入后续输入的 stored mark。
 *
 * 文档级编辑器的对象是章节或段落；知识卡片里的独立编辑器则是其内部段落。
 * 二者都以最近的 ProseMirror textblock 为边界，因此不会跨块改变其它内容。
 */
export function selectTextBlockContentWhenSelectionIsEmpty(editor: Editor) {
  const { state, view } = editor
  if (!state.selection.empty) return false
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth)
    if (!node.isTextblock) continue
    const from = $from.start(depth)
    const to = from + node.content.size
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
    return true
  }
  return false
}

function applyTextFormat(editor: Editor, apply: () => void) {
  selectTextBlockContentWhenSelectionIsEmpty(editor)
  apply()
}

/** 可嵌入单块编辑器或画布对象工具栏的共享文字格式控件。 */
export function InlineFormattingControls({ editor, onFormula }: { editor: Editor; onFormula?: () => void }) {
  const currentTextColor = String(editor.getAttributes('textColor').color || '')
  return (
    <>
      <select
        aria-label="字体"
        title="未选中文字时，应用到当前章节或段落的全部文字"
        value={String(editor.getAttributes('fontFamily').family || '')}
        onChange={(event) => {
          const value = event.target.value
          applyTextFormat(editor, () => {
            if (value) editor.chain().focus().setFontFamily(value).run()
            else editor.chain().focus().unsetFontFamily().run()
          })
        }}
        className="h-7 max-w-28 cursor-pointer rounded bg-transparent px-1 text-[11px] text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <option value="">默认</option>
        {TEXT_FONT_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      <select
        aria-label="文字颜色"
        title="未选中文字时，应用到当前章节或段落的全部文字"
        value={TEXT_COLOR_OPTIONS.some((option) => option.value === currentTextColor) ? currentTextColor : ''}
        onChange={(event) => {
          const value = event.target.value
          applyTextFormat(editor, () => {
            if (value) editor.chain().focus().setTextColor(value).run()
            else editor.chain().focus().unsetTextColor().run()
          })
        }}
        className="h-7 max-w-20 cursor-pointer rounded bg-transparent px-1 text-[11px] text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {TEXT_COLOR_OPTIONS.map((option) => (
          <option key={option.value || 'default'} value={option.value}>{option.label}</option>
        ))}
      </select>
      <input
        type="color"
        aria-label="自定义文字颜色"
        title="自定义文字颜色"
        value={pickerColor(currentTextColor)}
        onChange={(event) => applyTextFormat(editor, () => editor.chain().focus().setTextColor(event.target.value).run())}
        className="size-6 cursor-pointer rounded border border-zinc-200 bg-transparent p-0.5 dark:border-zinc-700"
      />
      <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
      <MarkButton label="粗体" active={editor.isActive('bold')} onClick={() => applyTextFormat(editor, () => editor.chain().focus().toggleBold().run())}><Bold className="size-3.5" /></MarkButton>
      <MarkButton label="斜体" active={editor.isActive('italic')} onClick={() => applyTextFormat(editor, () => editor.chain().focus().toggleItalic().run())}><Italic className="size-3.5" /></MarkButton>
      <MarkButton label="下划线" active={editor.isActive('underline')} onClick={() => applyTextFormat(editor, () => editor.chain().focus().toggleUnderline().run())}><UnderlineIcon className="size-3.5" /></MarkButton>
      <MarkButton label="删除线" active={editor.isActive('strike')} onClick={() => applyTextFormat(editor, () => editor.chain().focus().toggleStrike().run())}><Strikethrough className="size-3.5" /></MarkButton>
      <MarkButton label="行内代码" active={editor.isActive('code')} onClick={() => applyTextFormat(editor, () => editor.chain().focus().toggleCode().run())}><Code className="size-3.5" /></MarkButton>
      {onFormula ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          <MarkButton label="插入行内公式" onClick={onFormula}><Sigma className="size-3.5" /></MarkButton>
        </>
      ) : null}
    </>
  )
}
