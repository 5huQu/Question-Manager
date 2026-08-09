import { describe, expect, it } from 'vitest'
import { parseHtmlTable, splitHtmlTableSegments, withoutHtmlTableSegments } from './htmlTables'

const mergedTable = '<table border="1"><tr><td rowspan="2">性别</td><td colspan="2" align="center">冰雪运动</td></tr><tr><td>了解</td><td>不了解</td></tr></table>'

describe('htmlTables', () => {
  it('extracts safe cell text and preserves table spans', () => {
    const table = parseHtmlTable(mergedTable)

    expect(table).toEqual({
      border: '1',
      rows: [
        [
          { content: '性别', colspan: 1, rowspan: 2, align: null, header: false },
          { content: '冰雪运动', colspan: 2, rowspan: 1, align: 'center', header: false },
        ],
        [
          { content: '了解', colspan: 1, rowspan: 1, align: null, header: false },
          { content: '不了解', colspan: 1, rowspan: 1, align: null, header: false },
        ],
      ],
    })
  })

  it('keeps surrounding Markdown and removes only complete supported tables', () => {
    const source = `题干\n\n${mergedTable}\n\n继续作答`
    const segments = splitHtmlTableSegments(source)

    expect(segments.map((segment) => segment.type)).toEqual(['markdown', 'html-table', 'markdown'])
    expect(withoutHtmlTableSegments(source)).toBe('题干\n\n\n\n继续作答')
    expect(withoutHtmlTableSegments('题干 <table><tr><td>未闭合')).toContain('<table>')
  })
})
