import { describe, expect, it } from 'vitest'
import { editorDocumentToMarkdown, markdownToEditorDocument, sanitizePastedHtml } from './questionContentCodec'

describe('questionContentCodec', () => {
  it('round-trips Chinese text, inline math, block math and hard breaks', () => {
    const markdown = '已知 $x^2+y^2=1$，求 $x+y$。\n写出过程。\n\n$$\n\\begin{cases}\nx+y=2\\\\\nx-y=0\n\\end{cases}\n$$'
    const document = markdownToEditorDocument(markdown)

    expect(document.content[0]).toMatchObject({ type: 'paragraph' })
    expect(document.content[1]).toMatchObject({ type: 'blockMath' })
    expect(editorDocumentToMarkdown(document)).toBe(markdown)
  })

  it('accepts Doc2X LaTeX delimiters and saves them in canonical Markdown form', () => {
    const markdown = '已知 \\(x^2+y^2=1\\)。\n\n\\[\nx+y=2\n\\]'
    const document = markdownToEditorDocument(markdown)

    expect(document.content[0]).toMatchObject({
      type: 'paragraph',
      content: expect.arrayContaining([{ type: 'inlineMath', latex: 'x^2+y^2=1' }]),
    })
    expect(document.content[1]).toMatchObject({ type: 'blockMath', latex: 'x+y=2' })
    expect(editorDocumentToMarkdown(document)).toBe('已知 $x^2+y^2=1$。\n\n$$\nx+y=2\n$$')
  })

  it('turns A-D options into a structured choices node and preserves them', () => {
    const markdown = '选择正确答案。\n\nA. $x=1$\nB. $x=2$\nC. $x=3$\nD. $x=4$'
    const document = markdownToEditorDocument(markdown)

    expect(document.content[1]).toMatchObject({
      type: 'choices',
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
    })
    expect(editorDocumentToMarkdown(document)).toBe(markdown)
  })

  it('round-trips GFM tables including alignment and inline formulas', () => {
    const markdown = '| 项目 | 数值 |\n| :--- | ---: |\n| 半径 | $r$ |\n| 面积 | $\\pi r^2$ |'
    const document = markdownToEditorDocument(markdown)

    expect(document.content[0]).toMatchObject({ type: 'table', alignments: ['left', 'right'] })
    expect(editorDocumentToMarkdown(document)).toBe(markdown)
  })

  it('preserves unsupported Markdown as a raw node instead of dropping it', () => {
    const markdown = '## 暂不支持的标题\n\n- 第一项\n- 第二项'
    const document = markdownToEditorDocument(markdown)

    expect(document.content).toEqual([
      { type: 'rawMarkdown', markdown: '## 暂不支持的标题', reason: 'unsupported-markdown' },
      { type: 'rawMarkdown', markdown: '- 第一项\n- 第二项', reason: 'unsupported-markdown' },
    ])
    expect(document.warnings).toHaveLength(2)
    expect(editorDocumentToMarkdown(document)).toBe(markdown)
  })

  it('removes active HTML while preserving surrounding Markdown and warning about the conversion', () => {
    const markdown = '安全内容\n<script>alert(1)</script>\n<img src="javascript:alert(2)" onerror="alert(3)" alt="题图">'
    const document = markdownToEditorDocument(markdown)
    const output = editorDocumentToMarkdown(document)

    expect(output).toContain('安全内容')
    expect(output).toContain('<img alt="题图">')
    expect(output).not.toMatch(/script|javascript|onerror/)
    expect(document.warnings.some((warning) => warning.code === 'unsafe-html-removed')).toBe(true)
  })

  it('sanitizes pasted HTML without executing or retaining dangerous attributes', () => {
    const html = '<p onclick="evil()">题目 <a href="javascript:evil()">链接</a></p><iframe src="x"></iframe>'
    const sanitized = sanitizePastedHtml(html)

    expect(sanitized).toBe('<p>题目 <a>链接</a></p>')
  })

  it('keeps malformed LaTeX source losslessly', () => {
    const markdown = '计算 $\\frac{1}{$ 的值。'
    expect(editorDocumentToMarkdown(markdownToEditorDocument(markdown))).toBe(markdown)
  })
})
