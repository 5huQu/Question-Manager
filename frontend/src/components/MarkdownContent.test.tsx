import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalizeMathDelimitersForRemark, MarkdownContent, normalizeMarkdownForRender } from './MarkdownContent'

function expectFixedPoint(source: string, expected = source) {
  const once = normalizeMarkdownForRender(source)
  const twice = normalizeMarkdownForRender(once)
  const thrice = normalizeMarkdownForRender(twice)

  expect(once).toBe(expected)
  expect(twice).toBe(once)
  expect(thrice).toBe(once)
}

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

describe('normalizeMarkdownForRender math normalization baseline', () => {
  it.each([
    ['plain text', '普通文本，数字 42。', '普通文本，数字 42。'],
    ['basic inline formulas', '由 $a=1$，得 $b=2$。', '由 $a=1$，得 $b=2$。'],
    ['consecutive inline formulas', '由 $a=1$，$b=2$，得 $a+b=3$。', '由 $a=1$，$b=2$，得 $a+b=3$。'],
    ['multiline display formula', '$$\n\\begin{cases}\nx=1\\\\\ny=2\n\\end{cases}\n$$', '$$\n\\begin{cases}\nx=1\\\\\ny=2\n\\end{cases}\n$$'],
    ['display formula followed by text', '$$\nx+1\n$$\n因此结论成立。', '$$\nx+1\n$$\n因此结论成立。'],
    ['display formula followed by inline formula', '$$\nx+1\n$$\n则 $y=2$。', '$$\nx+1\n$$\n则 $y=2$。'],
    ['LaTeX inline delimiters', '\\(x+1\\)', '$x+1$'],
    ['LaTeX display delimiters', '\\[x+1\\]', '$$x+1$$'],
    ['escaped dollar', '价格 \\$100。', '价格 \\$100。'],
    ['inline code', '示例 `$foo$` 和 `price = "$100"`。', '示例 `$foo$` 和 `price = "$100"`。'],
    ['fenced code block', '```js\nconst value = "$x$";\n```', '```js\nconst value = "$x$";\n```'],
  ])('reaches a fixed point for %s', (_name, source, expected) => {
    expectFixedPoint(source, expected)
  })

  it('keeps single-line display math and following inline math stable across passes', () => {
    const source = '$$x$$ 后接 $y$'

    expectFixedPoint(source)
  })
})

describe('MarkdownContent canonical display-math adapter', () => {
  function mathTokens(markdown: string) {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(<MarkdownContent content={markdown} />)
    return Array.from(container.querySelectorAll('annotation[encoding="application/x-tex"]')).map((annotation) => ({
      latex: annotation.textContent || '',
      displayMode: Boolean(annotation.closest('.katex-display')),
    }))
  }

  it.each([
    ['single-line display math', '$$x$$', [{ latex: 'x', displayMode: true }]],
    ['display math followed by inline math', '$$x$$ 后接 $y$', [{ latex: 'x', displayMode: true }, { latex: 'y', displayMode: false }]],
    ['text around display math', '前文 $$x$$ 后文', [{ latex: 'x', displayMode: true }]],
  ] as const)('adapts %s for remark-math without changing its token semantics', (_name, markdown, expected) => {
    expect(mathTokens(markdown)).toEqual(expected)
  })

  it('does not adapt display delimiters inside code', () => {
    expect(mathTokens('`$$x$$`')).toEqual([])
  })

  it('leaves ordinary Markdown and protected code byte-for-byte intact', () => {
    const source = '# 标题\n\n- **加粗** [链接](https://example.com)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n`$$x$$`\n\n```md\n$$x$$\n```'
    expect(canonicalizeMathDelimitersForRemark(source)).toBe(source)
  })

  it('keeps ordinary single-dollar text unchanged while protecting isolated double dollars', () => {
    expect(canonicalizeMathDelimitersForRemark('价格 $100')).toBe('价格 $100')
    expect(canonicalizeMathDelimitersForRemark('总计 $$')).toBe('总计 \\$\\$')
  })
})
