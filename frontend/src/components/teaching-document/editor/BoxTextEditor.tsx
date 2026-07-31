/**
 * 知识卡片的连续正文编辑器。
 *
 * 卡片里的相邻 paragraph 仍以独立数据块保存（分页、撤销和结构化导入不受影响），
 * 但在编辑时映射到同一个多段 Tiptap 文本框：Enter 创建下一段，Shift+Enter 仅换行。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import type { ParagraphBlock, TeachingInline } from '@/types/teachingDocument'
import {
  hasProtectedInlineContent,
  pastedHtmlToSafeInlines,
  protectedInlineReason,
  teachingInlinesToTiptapDoc,
  tiptapDocToTeachingInlines,
  newTeachingBlock,
} from '@/utils/teachingDocument'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { InlineFormattingControls } from '../BlockInlineEditor/BlockInlineEditor'
import { createBlockEditorExtensions } from '../BlockInlineEditor/extensions'

function paragraphsToDoc(paragraphs: ParagraphBlock[]): JSONContent {
  return {
    type: 'doc',
    content: paragraphs.map((paragraph) => {
      const node = teachingInlinesToTiptapDoc(paragraph.content).content?.[0] || { type: 'paragraph' }
      return { ...node, attrs: { ...(node.attrs || {}), blockId: paragraph.id } }
    }),
  }
}

function docToParagraphs(doc: JSONContent, previous: ParagraphBlock[]): ParagraphBlock[] {
  const blocks = (doc.content || []).filter((block) => block.type === 'paragraph')
  const safeBlocks = blocks.length ? blocks : [{ type: 'paragraph' }]
  return safeBlocks.map((block, index) => {
    const existing = previous[index]
    const fresh = newTeachingBlock('paragraph') as ParagraphBlock
    return {
      type: 'paragraph',
      id: String(block.attrs?.blockId || existing?.id || fresh.id),
      content: tiptapDocToTeachingInlines({ type: 'doc', content: [block] }),
    }
  })
}

export function BoxTextEditor({
  paragraphs,
  onChange,
  onActiveParagraphChange,
}: {
  paragraphs: ParagraphBlock[]
  onChange: (paragraphs: ParagraphBlock[]) => void
  /** 连续编辑器内部仍保存为多个段落；将当前段落同步给外层选择/插入锚点。 */
  onActiveParagraphChange?: (paragraphId: string) => void
}) {
  const protectedReason = useMemo(() => {
    const protectedParagraph = paragraphs.find((paragraph) => hasProtectedInlineContent(paragraph.content))
    return protectedParagraph ? protectedInlineReason(protectedParagraph.content) : ''
  }, [paragraphs])
  const editable = !protectedReason
  const paragraphsRef = useRef(paragraphs)
  paragraphsRef.current = paragraphs
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onActiveParagraphChangeRef = useRef(onActiveParagraphChange)
  onActiveParagraphChangeRef.current = onActiveParagraphChange
  const syncing = useRef(false)
  const lastEmittedSig = useRef('')
  const [formulaDialogOpen, setFormulaDialogOpen] = useState(false)
  const [, refreshToolbar] = useState(0)

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: createBlockEditorExtensions(),
    content: paragraphsToDoc(paragraphs),
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': '卡片正文',
        'aria-multiline': 'true',
        'data-box-text-editor': '',
        class: 'min-h-0 px-0 py-1 text-sm leading-7 text-zinc-900 outline-none dark:text-zinc-50',
      },
      handlePaste: (_view, event) => {
        if (!editable) return true
        const html = event.clipboardData?.getData('text/html') || ''
        if (!html) return false
        event.preventDefault()
        const safe = pastedHtmlToSafeInlines(html)
        const nodes = teachingInlinesToTiptapDoc(safe).content?.[0]?.content || []
        if (nodes.length) editor?.chain().focus().insertContent(nodes).run()
        return true
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (syncing.current) return
      const next = docToParagraphs(currentEditor.getJSON(), paragraphsRef.current)
      paragraphsRef.current = next
      lastEmittedSig.current = JSON.stringify(next)
      onChangeRef.current(next)
    },
  })

  const reportActiveParagraph = () => {
    if (!editor) return
    const index = Math.min(
      Math.max(0, editor.state.selection.$from.index(0)),
      Math.max(0, paragraphsRef.current.length - 1),
    )
    const paragraph = paragraphsRef.current[index]
    if (paragraph) onActiveParagraphChangeRef.current?.(paragraph.id)
  }

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editable, editor])

  useEffect(() => {
    if (!editor) return
    const update = () => refreshToolbar((value) => value + 1)
    editor.on('selectionUpdate', update)
    editor.on('focus', update)
    editor.on('blur', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('focus', update)
      editor.off('blur', update)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', reportActiveParagraph)
    editor.on('focus', reportActiveParagraph)
    return () => {
      editor.off('selectionUpdate', reportActiveParagraph)
      editor.off('focus', reportActiveParagraph)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const nextSig = JSON.stringify(paragraphs)
    if (nextSig === lastEmittedSig.current) return
    const current = docToParagraphs(editor.getJSON(), paragraphsRef.current)
    if (nextSig === JSON.stringify(current)) {
      lastEmittedSig.current = nextSig
      return
    }
    syncing.current = true
    editor.commands.setContent(paragraphsToDoc(paragraphs), { emitUpdate: false })
    syncing.current = false
    lastEmittedSig.current = nextSig
  }, [editor, paragraphs])

  if (!editor) return <div className="min-h-8 animate-pulse rounded bg-zinc-100/60 dark:bg-zinc-800/40" />

  return (
    <div className="td-box-text-editor relative rounded-sm outline-none transition-colors focus-within:bg-white/45 [&_.ProseMirror>p]:my-2.5 [&_.ProseMirror>p:first-child]:mt-0 [&_.ProseMirror>p:last-child]:mb-0 dark:focus-within:bg-zinc-950/20">
      {protectedReason ? (
        <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">{protectedReason}</p>
      ) : null}
      {!protectedReason && editor.isFocused ? (
        <div role="toolbar" aria-label="文字格式工具" className="absolute bottom-full left-1/2 z-50 mb-1 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-zinc-200 bg-white/95 px-1 py-0.5 shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95" onMouseDown={(event) => event.preventDefault()}>
          <InlineFormattingControls editor={editor} onFormula={() => setFormulaDialogOpen(true)} />
        </div>
      ) : null}
      <EditorContent editor={editor} />
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
