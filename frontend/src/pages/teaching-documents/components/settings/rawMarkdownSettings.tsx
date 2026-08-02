import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { TeachingBlock, TeachingInline } from '@/types/teachingDocument'
import { BlockInlineEditor } from '@/components/teaching-document/BlockInlineEditor/BlockInlineEditor'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { MarkdownContent } from '@/components/MarkdownContent'
import { hasProtectedInlineContent, protectedInlineReason } from '@/utils/teachingDocument'
import { Field, fieldClass, inlineContentOf } from './common'

export function RichTextMarkdownSettings({
  block,
  boxId,
  onUpdate,
  onInsertImage,
}: {
  block: Extract<TeachingBlock, { type: 'rawMarkdown' }>
  boxId?: string
  onUpdate: (patch: Partial<TeachingBlock>, mergeKey?: string) => void
  onInsertImage: (block: Extract<TeachingBlock, { type: 'rawMarkdown' }>, markdown: string, cursor: number, file: File, boxId?: string) => Promise<void>
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[13px] font-medium text-zinc-500">混合内容</p>
        <p className="mt-1 text-xs leading-5 text-zinc-400">适合整段讲义：可混排文字、编号列表、强调样式与 LaTeX 公式。</p>
      </div>
      <button type="button" onClick={() => setEditorOpen(true)} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900">
        <Pencil className="size-3.5" />编辑混合内容…
      </button>
      <div className="max-h-52 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900/20">
        {block.markdown.trim() ? <MarkdownContent content={block.markdown} /> : <p className="text-xs italic text-zinc-400">尚未添加内容。</p>}
      </div>
      {editorOpen ? (
        <FormulaEditorDialog
          title="编辑混合内容"
          initialLatex={block.markdown}
          initialMixedMarkdown
          onApply={(latex) => {
            onUpdate({ markdown: latex }, `markdown:${block.id}`)
            setEditorOpen(false)
          }}
          onApplyMixedMarkdown={(markdown) => {
            onUpdate({ markdown }, `markdown:${block.id}`)
            setEditorOpen(false)
          }}
          onInsertImageAtCursor={(markdown, cursor, file) => onInsertImage(block, markdown, cursor, file, boxId)}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
    </div>
  )
}
