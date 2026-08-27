import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { FormulaBlock, FormulaInline } from './FormulaNode'
import { editorJsonToMarkdown, markdownToEditorHtml } from './markdownAdapter'

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

type MathToken = { latex: string; displayMode: boolean }

function editorJsonForMarkdown(markdown: string) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), FormulaInline, FormulaBlock],
    content: markdownToEditorHtml(markdown),
  })
  try {
    return editor.getJSON()
  } finally {
    editor.destroy()
  }
}

function formulaTokens(node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): MathToken[] {
  const current = node.type === 'formulaInline' || node.type === 'formulaBlock'
    ? [{ latex: String(node.attrs?.latex || ''), displayMode: node.type === 'formulaBlock' }]
    : []
  return [...current, ...(node.content || []).flatMap((child) => formulaTokens(child as typeof node))]
}

function codeTexts(node: { type?: string; text?: string; marks?: Array<{ type?: string }>; content?: unknown[] }): string[] {
  const current = node.type === 'text' && node.marks?.some((mark) => mark.type === 'code') ? [node.text || ''] : []
  return [...current, ...(node.content || []).flatMap((child) => codeTexts(child as typeof node))]
}

describe('markdownAdapter tables', () => {
  it('keeps GFM table alignment and escaped pipes through the editable representation', () => {
    const source = '| 项目 | 数值 |\n| :--- | ---: |\n| 集合 A\\|B | 12 |'
    const html = markdownToEditorHtml(source)

    expect(html).toContain('<th align="left">项目</th>')
    expect(html).toContain('<th align="right">数值</th>')
    expect(html).toContain('集合 A|B')

    expect(editorJsonToMarkdown({
      type: 'doc',
      content: [{
        type: 'table',
        attrs: { sourceFormat: 'markdown' },
        content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', attrs: { align: 'left' }, content: [paragraph('项目')] },
            { type: 'tableHeader', attrs: { align: 'right' }, content: [paragraph('数值')] },
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { align: 'left' }, content: [paragraph('集合 A|B')] },
            { type: 'tableCell', attrs: { align: 'right' }, content: [paragraph('12')] },
          ] },
        ],
      }],
    })).toBe(source)
  })

  it('converts imported HTML tables into span-aware editor HTML and writes them back as HTML', () => {
    const source = '<table border="1"><tr><td rowspan="2">性别</td><td colspan="2">冰雪运动</td></tr><tr><td>了解</td><td>不了解</td></tr></table>'
    const html = markdownToEditorHtml(source)

    expect(html).toContain('data-question-table-format="html"')
    expect(html).toContain('data-question-table-border="1"')
    expect(html).toContain('<td rowspan="2">性别</td>')
    expect(html).toContain('<td colspan="2">冰雪运动</td>')

    expect(editorJsonToMarkdown({
      type: 'doc',
      content: [{
        type: 'table',
        attrs: { sourceFormat: 'html', border: '1' },
        content: [
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { rowspan: 2, colspan: 1 }, content: [paragraph('性别')] },
            { type: 'tableCell', attrs: { rowspan: 1, colspan: 2 }, content: [paragraph('冰雪运动')] },
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { rowspan: 1, colspan: 1 }, content: [paragraph('了解')] },
            { type: 'tableCell', attrs: { rowspan: 1, colspan: 1 }, content: [paragraph('不了解')] },
          ] },
        ],
      }],
    })).toBe(source)
  })
})

describe('markdownAdapter inline code spans', () => {
  it.each([
    ['basic inline code', '`$x$`', ['$x$'], []],
    ['text followed by inline code', '示例 `$x+1$`', ['$x+1$'], []],
    ['block delimiter inside inline code', '`$$x+1$$`', ['$$x+1$$'], []],
    ['code and a real formula', '示例 `$x$`，实际公式为 $y$。', ['$x$'], [{ latex: 'y', displayMode: false }]],
    ['multiple code spans and a formula', '`$a$` + $b$ + `$$c$$`', ['$a$', '$$c$$'], [{ latex: 'b', displayMode: false }]],
    ['a double-backtick code span containing backticks', '`` `$x$` ``', ['`$x$`'], []],
  ] as const)('does not parse math delimiters in %s', (_name, markdown, expectedCode, expectedMath) => {
    const json = editorJsonForMarkdown(markdown)
    expect(codeTexts(json)).toEqual(expectedCode)
    expect(formulaTokens(json)).toEqual(expectedMath)
  })

  it('does not let an escaped backtick start a code span', () => {
    const json = editorJsonForMarkdown('\\`$x$`')
    expect(codeTexts(json)).toEqual([])
    expect(formulaTokens(json)).toEqual([{ latex: 'x', displayMode: false }])
  })

  it('preserves code semantics rather than serializing code-delimited dollars as a formula', () => {
    const source = '示例 `$x$`，实际公式为 $y$。'
    const serialized = editorJsonToMarkdown(editorJsonForMarkdown(source))

    expect(serialized).toContain('`$x$`')
    expect(formulaTokens(editorJsonForMarkdown(serialized))).toEqual([{ latex: 'y', displayMode: false }])
    expect(codeTexts(editorJsonForMarkdown(serialized))).toEqual(['$x$'])
  })

  it('round-trips a multiple-backtick code span without exposing its dollars to math parsing', () => {
    const source = '`` `$x$` ``'
    const serialized = editorJsonToMarkdown(editorJsonForMarkdown(source))

    expect(serialized).toBe(source)
    expect(formulaTokens(editorJsonForMarkdown(serialized))).toEqual([])
    expect(codeTexts(editorJsonForMarkdown(serialized))).toEqual(['`$x$`'])
  })

  it('does not expose display delimiters from a fenced code block when called directly', () => {
    expect(formulaTokens(editorJsonForMarkdown('```md\n$$x$$\n```'))).toEqual([])
  })
})

describe('markdownAdapter canonical math delimiters', () => {
  it.each([
    ['single-line display math', '$$x$$', [{ latex: 'x', displayMode: true }]],
    ['display math followed by inline math', '$$x$$ 后接 $y$', [{ latex: 'x', displayMode: true }, { latex: 'y', displayMode: false }]],
    ['text around display math', '前文 $$x$$ 后文', [{ latex: 'x', displayMode: true }]],
  ] as const)('uses the shared display/inline semantics for %s', (_name, markdown, expected) => {
    expect(formulaTokens(editorJsonForMarkdown(markdown))).toEqual(expected)
  })

  it.each(['$$x$$', '$$x$$ 后接 $y$'])('preserves math semantics through the editor round-trip: %s', (markdown) => {
    const first = formulaTokens(editorJsonForMarkdown(markdown))
    const serialized = editorJsonToMarkdown(editorJsonForMarkdown(markdown))

    expect(formulaTokens(editorJsonForMarkdown(serialized))).toEqual(first)
  })
})
