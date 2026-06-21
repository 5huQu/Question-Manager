import { inlineMarkdown, normalizeBlocks } from './rich-content.js'
import type { RichInline, RichBlock } from '../types/index.js'

function latexText(value: string) {
  return String(value || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#%&_$])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function inlineLatex(inlines: RichInline[]) {
  return inlines.map((inline) => inline.type === 'inline_math' ? `$${inline.tex}$` : latexText(inline.text)).join('')
}

function blocksToLatex(blocksInput: unknown): string {
  const blocks = normalizeBlocks(blocksInput)
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') lines.push(inlineLatex(block.content))
    else if (block.type === 'display_math') lines.push(`\\[\n${block.tex}\n\\]`)
    else if (block.type === 'choices') lines.push(block.options.map((option) => `\\textbf{${latexText(option.label)}.} ${blocksToLatex(option.blocks).replace(/\n+/g, ' ').trim()}`).join('\\quad '))
    else if (block.type === 'table') {
      const width = Math.max(...block.rows.map((row) => row.cells.length), 1)
      lines.push(`\\begin{tabular}{${Array.from({ length: width }, () => 'c').join('|')}}`)
      block.rows.forEach((row, index) => {
        lines.push(`${Array.from({ length: width }, (_, cellIndex) => inlineLatex(row.cells[cellIndex] || [])).join(' & ')} \\\\`)
        if (index === 0 && row.header) lines.push('\\hline')
      })
      lines.push('\\end{tabular}')
    }
  }
  return lines.join('\n\n').trim()
}

export { latexText, inlineLatex, blocksToLatex }
