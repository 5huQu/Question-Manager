import { describe, expect, it } from 'vitest'
import { editorJsonToMarkdown, markdownToEditorHtml } from './markdownAdapter'

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
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
