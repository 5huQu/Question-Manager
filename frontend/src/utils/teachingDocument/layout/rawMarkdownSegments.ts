/**
 * Split raw Markdown only at top-level blank-line boundaries.  Each returned
 * unit is rendered independently during pagination, so a list item, display
 * formula, or GFM table is never cut through the middle.
 */
export function rawMarkdownSegments(markdown: string): string[] {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
  const segments: string[] = []
  let current: string[] = []
  let nextOrderedListNumber: number | null = null
  const flush = () => {
    let value = current.join('\n').trim()
    // 分页测量会把同一份 Markdown 按空行拆成独立渲染单元。Markdown
    // 有序列表在独立单元中会重新从 1 开始；当连续单元都使用惯用的
    // “1.” 标记时，显式补回下一项的起始编号，显示与原文逻辑一致。
    const match = /^(\s*)(\d+)([.)])(\s+)/.exec(value)
    if (match) {
      const sourceNumber = Number(match[2])
      const displayNumber = sourceNumber === 1 && nextOrderedListNumber && nextOrderedListNumber > 1
        ? nextOrderedListNumber
        : sourceNumber
      if (displayNumber !== sourceNumber) {
        value = `${match[1]}${displayNumber}${match[3]}${match[4]}${value.slice(match[0].length)}`
      }
      nextOrderedListNumber = displayNumber + 1
    } else if (value) {
      nextOrderedListNumber = null
    }
    if (value) segments.push(value)
    current = []
  }
  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return segments.length ? segments : ['']
}
