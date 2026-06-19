import { memo, useMemo } from 'react'
import katex from 'katex'
import type { QuestionFigure, RichBlock, RichInline } from '../types'

export function normalizeRichBlocks(value: unknown): RichBlock[] {
  if (!Array.isArray(value)) return []
  return value.filter((block): block is RichBlock => Boolean(block && typeof block === 'object' && 'type' in block))
}

export function richBlocksPlainText(value: unknown): string {
  const blocks = normalizeRichBlocks(value)
  return blocks.map((block) => {
    if (block.type === 'paragraph') return inlinePlainText(block.content)
    if (block.type === 'display_math') return block.tex
    if (block.type === 'choices') return block.options.map((option) => `${option.label}. ${richBlocksPlainText(option.blocks)}`).join('\n')
    if (block.type === 'table') return block.rows.map((row) => row.cells.map(inlinePlainText).join('\t')).join('\n')
    return ''
  }).filter(Boolean).join('\n\n').trim()
}

function inlinePlainText(inlines: RichInline[]) {
  return (inlines || []).map((inline) => inline.type === 'inline_math' ? inline.tex : inline.text).join('')
}

function MathSpan({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore' })
    } catch {
      return ''
    }
  }, [display, tex])
  if (!html) {
    return <code className="rounded bg-red-50 px-1 py-0.5 text-red-600">{tex || '公式为空'}</code>
  }
  return (
    <span
      className={display ? 'block overflow-x-auto py-1' : 'inline-block max-w-full align-baseline'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function RichInlineContent({ inlines }: { inlines: RichInline[] }) {
  return (
    <>
      {(inlines || []).map((inline, index) => inline.type === 'inline_math'
        ? <MathSpan key={index} tex={inline.tex} />
        : <TextWithInlineMath key={index} text={inline.text} />)}
    </>
  )
}

function splitLegacyInlineMath(text: string): Array<{ type: 'text'; text: string } | { type: 'inline_math'; tex: string }> {
  const parts: Array<{ type: 'text'; text: string } | { type: 'inline_math'; tex: string }> = []
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('$', cursor)
    if (start < 0) {
      if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) })
      break
    }
    if (start > cursor) parts.push({ type: 'text', text: text.slice(cursor, start) })
    const end = text.indexOf('$', start + 1)
    if (end < 0) {
      parts.push({ type: 'text', text: text.slice(start) })
      break
    }
    const tex = text.slice(start + 1, end).trim()
    if (tex) parts.push({ type: 'inline_math', tex })
    else parts.push({ type: 'text', text: text.slice(start, end + 1) })
    cursor = end + 1
  }
  return parts
}

function TextWithInlineMath({ text }: { text: string }) {
  const parts = useMemo(() => splitLegacyInlineMath(text), [text])
  return (
    <>
      {parts.map((part, index) => part.type === 'inline_math'
        ? <MathSpan key={index} tex={part.tex} />
        : <span key={index}>{part.text}</span>)}
    </>
  )
}

export const RichContent = memo(function RichContent({
  blocks,
  figures = [],
  className = '',
  prefix,
}: {
  blocks: RichBlock[]
  figures?: QuestionFigure[]
  className?: string
  prefix?: string
}) {
  const visibleFigures = figures.filter((figure) => figure.path)
  return (
    <div className={`rich-content min-w-0 max-w-none text-zinc-950 dark:text-zinc-50 ${className}`}>
      {prefix ? <p className="mb-2 text-xs font-semibold text-zinc-500">{prefix}</p> : null}
      <div className="space-y-3">
        {normalizeRichBlocks(blocks).map((block, index) => {
          if (block.type === 'paragraph') {
            return <p key={index} className="my-2 first:mt-0 last:mb-0"><RichInlineContent inlines={block.content} /></p>
          }
          if (block.type === 'display_math') {
            return <div key={index} className="my-3"><MathSpan tex={block.tex} display /></div>
          }
          if (block.type === 'choices') {
            return (
              <div key={index} className="choice-options choice-options-single" data-layout="single">
                {block.options.map((option) => (
                  <div className="choice-option" key={option.label}>
                    <span className="choice-label">{option.label}</span>
                    <RichContent blocks={option.blocks} figures={figures.filter((figure) => String(figure.optionLabel || '').toUpperCase() === option.label)} className="choice-rich" />
                  </div>
                ))}
              </div>
            )
          }
          if (block.type === 'table') {
            return (
              <div className="question-table-wrap" key={index}>
                <table className="question-table">
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.cells.map((cell, cellIndex) => row.header
                          ? <th key={cellIndex}><RichInlineContent inlines={cell} /></th>
                          : <td key={cellIndex}><RichInlineContent inlines={cell} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
          return null
        })}
      </div>
      {visibleFigures.length ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {visibleFigures.map((figure, index) => (
            <img key={figure.id || `${figure.path}-${index}`} src={`/assets/${figure.path}`} alt={`题图 ${index + 1}`} className="max-h-64 rounded-lg border bg-white object-contain" loading="lazy" />
          ))}
        </div>
      ) : null}
    </div>
  )
})
