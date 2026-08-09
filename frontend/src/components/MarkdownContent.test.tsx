import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent HTML tables', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders imported HTML table spans instead of exposing the table source', async () => {
    await act(async () => {
      root.render(<MarkdownContent content={'统计结果：\n\n<table border="1"><tr><td rowspan="2">性别</td><td colspan="2">冰雪运动</td></tr><tr><td>了解</td><td>不了解</td></tr></table>'} />)
    })

    expect(container.querySelector('td[rowspan="2"]')?.textContent).toContain('性别')
    expect(container.querySelector('td[colspan="2"]')?.textContent).toContain('冰雪运动')
    expect(container.textContent).not.toContain('<table border')
  })
})
