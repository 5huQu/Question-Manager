import { describe, expect, it } from 'vitest'
import { normalizeLatexMathDelimiters, repairOcrMathMarkdown } from './mathMarkdown'

function expectFixedPoint(source: string, expected = source) {
  const once = normalizeLatexMathDelimiters(source)
  const twice = normalizeLatexMathDelimiters(once)
  const thrice = normalizeLatexMathDelimiters(twice)

  expect(once).toBe(expected)
  expect(twice).toBe(once)
  expect(thrice).toBe(once)
}

describe('normalizeLatexMathDelimiters', () => {
  it('normalizes Doc2X inline and display math delimiters', () => {
    expect(normalizeLatexMathDelimiters('行内 \\(x+1\\)\n\\[x^2\\]')).toBe('行内 $x+1$\n$$x^2$$')
  })

  it('does not alter delimiters shown as code or escaped text', () => {
    const markdown = '示例 `\\(x\\)` 和 \\\\(literal\\\\)\n\n```tex\n\\(x\\)\n```'
    expect(normalizeLatexMathDelimiters(markdown)).toBe(markdown)
  })

  it('does not apply OCR delimiter guesses during safe normalization', () => {
    const markdown = '$设 $$ p_{2(m+1)}+\\lambda=-\\frac{1}{4}(p_{2m}+\\lambda)$ $\n$所以 $$ \\left\\{p_{2m}-\\frac{1}{2}\\right\\}$ $是等比数列。\n\n$$\\frac{1}{2}$$'

    expect(normalizeLatexMathDelimiters(markdown)).toBe(markdown)
  })

  it('preserves consecutive inline formulas emitted by OCR', () => {
    const markdown = '$ a_{1}=1 $ $ a_{2}=4 $ $ a_{3}=9 $'

    expect(normalizeLatexMathDelimiters(markdown)).toBe(markdown)
  })

  it('leaves OCR-like delimiters inside inline code unchanged', () => {
    expect(normalizeLatexMathDelimiters('`$设 $$ p_n = 1 $ $`')).toBe('`$设 $$ p_n = 1 $ $`')
  })

  it('preserves the boundaries of basic inline formulas', () => {
    const markdown = '由 $a=1$，得 $b=2$。'

    expectFixedPoint(markdown)
    expect(normalizeLatexMathDelimiters(markdown)).toContain('$a=1$')
    expect(normalizeLatexMathDelimiters(markdown)).toContain('$b=2$')
  })

  it('preserves consecutive inline formula boundaries', () => {
    const markdown = '由 $a=1$，$b=2$，得 $a+b=3$。'

    expectFixedPoint(markdown)
    expect(normalizeLatexMathDelimiters(markdown)).toBe(markdown)
  })

  it('preserves a multiline display formula', () => {
    const markdown = '$$\n\\begin{cases}\nx=1\\\\\ny=2\n\\end{cases}\n$$'

    expectFixedPoint(markdown)
  })

  it('preserves display-math and following inline-math boundaries', () => {
    const markdown = '$$\nx+1\n$$\n则 $y=2$。'

    expectFixedPoint(markdown)
    expect(normalizeLatexMathDelimiters(markdown)).toBe(markdown)
  })

  describe('idempotence baseline for valid Markdown', () => {
    it.each([
      ['plain text', '普通文本，数字 42。', '普通文本，数字 42。'],
      ['one inline formula', '由 $a=1$ 得 $b=2$。', '由 $a=1$ 得 $b=2$。'],
      ['multiple inline formulas', '由 $a=1$，$b=2$，得 $a+b=3$。', '由 $a=1$，$b=2$，得 $a+b=3$。'],
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
  })

  describe('repairOcrMathMarkdown', () => {
    function expectOcrRepairFixedPoint(source: string, expected = source) {
      const once = repairOcrMathMarkdown(source)
      const twice = repairOcrMathMarkdown(once)
      const thrice = repairOcrMathMarkdown(twice)

      expect(once).toBe(expected)
      expect(twice).toBe(once)
      expect(thrice).toBe(once)
    }

    it.each([
      ['one inline formula', '$a$'],
      ['two inline formulas with prose', '由 $a=1$ 得 $b=2$'],
      ['adjacent inline formulas', '$a=1$，$b=2$'],
      ['one single-line display formula', '$$x$$'],
      ['single-line display formula followed by inline math', '$$x$$ 后接 $y$'],
      ['prose around a single-line display formula', '前文 $$x$$ 后文'],
      ['prose, display formula, and inline math', '前文 $$x$$ 后文 $y$'],
      ['multiline display formula', '$$\nx+1\n$$'],
      ['cases display formula', '$$\n\\begin{cases}\nx=1\\\\\ny=2\n\\end{cases}\n$$'],
      ['aligned display formula', '$$\n\\begin{aligned}\na&=1\\\\\nb&=2\n\\end{aligned}\n$$'],
      ['multiple display formulas', '$$x$$\n\n文字\n\n$$y$$'],
      ['escaped dollar', '价格为 \\$100'],
      ['inline code', '示例 `$foo$` 和 `price = "$100"`。'],
      ['fenced code', '```js\nconst value = "$x$";\n```'],
    ])('keeps valid Markdown unchanged and idempotent for %s', (_name, source) => {
      expectOcrRepairFixedPoint(source)
    })

    it.each([
      ['nested-prefix heuristic', '$说明 $$ 公式 $ $', '说明 $公式$'],
      ['double-open-plus-separated-close heuristic', '$$ 公式 $ $', '$公式$'],
      ['double-open-plus-single-close heuristic', '$$ 公式 $', '$公式$'],
      ['nested-prefix does not cross a complete display formula', '$a$ $$x$$ 后接 $y$', '$a$ $$x$$ 后接 $y$'],
      ['separated-close does not reinterpret a complete display formula', '$$x$$ 后接 $y$', '$$x$$ 后接 $y$'],
      ['single-close does not restart at a display closing delimiter', '前文 $$x$$ 后文 $y$', '前文 $$x$$ 后文 $y$'],
    ])('keeps the historical repair boundary for %s', (_name, source, expected) => {
      expectOcrRepairFixedPoint(source, expected)
    })

    it('repairs the specific nested OCR delimiter pattern without changing display math', () => {
      const markdown = '$设 $$ p_{2(m+1)}+\\lambda=-\\frac{1}{4}(p_{2m}+\\lambda)$ $\n$所以 $$ \\left\\{p_{2m}-\\frac{1}{2}\\right\\}$ $是等比数列。\n\n$$\\frac{1}{2}$$'

      expectOcrRepairFixedPoint(markdown, '设 $p_{2(m+1)}+\\lambda=-\\frac{1}{4}(p_{2m}+\\lambda)$\n所以 $\\left\\{p_{2m}-\\frac{1}{2}\\right\\}$是等比数列。\n\n$$\\frac{1}{2}$$')
    })

    it('leaves inline code and fenced code unchanged', () => {
      const markdown = '`$设 $$ p_n = 1 $ $`\n\n```tex\n$设 $$ p_n = 1 $ $\n```'

      expect(repairOcrMathMarkdown(markdown)).toBe(markdown)
    })
  })

  describe('single-line display math followed by inline math', () => {
    const source = '$$x$$ 后接 $y$'

    it('keeps math boundaries stable across passes', () => {
      expectFixedPoint(source)
      expect(repairOcrMathMarkdown(source)).toBe(source)
    })
  })
})
