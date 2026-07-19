import { useState } from 'react'
import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { FormulaEditorDialog } from './FormulaEditorDialog'

function FormulaNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(String(node.attrs.latex || ''))
  const displayMode = node.type.name === 'formulaBlock'
  let markup = ''
  let invalid = false
  try {
    markup = katex.renderToString(String(node.attrs.latex || ''), { displayMode, throwOnError: true, strict: false })
  } catch {
    invalid = true
    markup = katex.renderToString(String(node.attrs.latex || ''), { displayMode, throwOnError: false, strict: false })
  }

  return (
    <NodeViewWrapper
      as={displayMode ? 'div' : 'span'}
      className={displayMode ? 'my-3 block text-center' : 'inline-block align-middle'}
      data-formula-node="true"
    >
      <button
        type="button"
        aria-label={`${displayMode ? '块级' : '行内'}公式，按 Enter 编辑`}
        aria-invalid={invalid}
        className={`rounded-md border px-1.5 py-0.5 text-zinc-900 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-50 dark:hover:bg-zinc-800 ${selected ? 'border-zinc-900 dark:border-zinc-100' : invalid ? 'border-amber-400 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20' : 'border-transparent'}`}
        onClick={() => { setDraft(String(node.attrs.latex || '')); setOpen(true) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            setDraft(String(node.attrs.latex || ''))
            setOpen(true)
          }
        }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      {open ? (
        <FormulaEditorDialog
          initialLatex={draft}
          displayMode={displayMode}
          onClose={() => setOpen(false)}
          onApply={(latex) => { setDraft(latex); updateAttributes({ latex }); setOpen(false) }}
        />
      ) : null}
    </NodeViewWrapper>
  )
}

function formulaNode(name: 'formulaInline' | 'formulaBlock', inline: boolean) {
  return Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: true,
    addAttributes: () => ({ latex: { default: '' } }),
    parseHTML: () => [{ tag: `${inline ? 'span' : 'div'}[data-formula="${inline ? 'inline' : 'block'}"]`, getAttrs: (element) => ({ latex: (element as HTMLElement).dataset.latex || '' }) }],
    renderHTML: ({ HTMLAttributes }) => [inline ? 'span' : 'div', mergeAttributes(HTMLAttributes, { 'data-formula': inline ? 'inline' : 'block', 'data-latex': HTMLAttributes.latex })],
    addNodeView: () => ReactNodeViewRenderer(FormulaNodeView),
  })
}

export const FormulaInline = formulaNode('formulaInline', true)
export const FormulaBlock = formulaNode('formulaBlock', false)
