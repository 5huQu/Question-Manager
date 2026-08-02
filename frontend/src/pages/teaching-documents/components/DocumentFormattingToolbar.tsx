import { useEffect, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, IndentDecrease, IndentIncrease, List, ListOrdered } from 'lucide-react'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { InlineFormattingControls } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'

type TextBlockTarget = {
  type: 'docHeading' | 'docParagraph'
  attrs: Record<string, unknown>
}

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

/** 页面级统一格式条：只修改当前 Tiptap 文本块，绝不写任意 DOM/CSS。 */
export function DocumentFormattingToolbar({ editor }: { editor: Editor | null }) {
  const [, refresh] = useState(0)
  const [formulaOpen, setFormulaOpen] = useState(false)
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

  const target = editor ? activeTextBlock(editor) : null
  const enabled = Boolean(editor && target && editor.isEditable)
  const alignment = String(target?.attrs.alignment || 'left')
  const listStyle = String(target?.attrs.listStyle || '')
  const indentLevel = Number(target?.attrs.indentLevel || 0)
  const updateTextBlock = (patch: Record<string, unknown>) => {
    if (!editor || !target) return
    editor.chain().focus().updateAttributes(target.type, patch).run()
  }

  return (
    <div role="toolbar" aria-label="文档格式" className="flex h-12 min-w-0 items-center gap-0.5 overflow-x-auto border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950">
      {editor && enabled ? <InlineFormattingControls editor={editor} inheritedFontLabel="跟随文档字体" onFormula={() => setFormulaOpen(true)} /> : <div className="flex h-8 items-center px-1 text-[11px] text-zinc-400">选择文字后编辑格式</div>}
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
      {formulaOpen && editor ? <FormulaEditorDialog title="插入行内公式" displayMode={false} onClose={() => { setFormulaOpen(false); editor.chain().focus().run() }} onApply={(latex) => { editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex } }).run(); setFormulaOpen(false) }} /> : null}
    </div>
  )
}
