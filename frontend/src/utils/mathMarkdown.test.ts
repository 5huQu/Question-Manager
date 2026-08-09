import { describe, expect, it } from 'vitest'
import { normalizeLatexMathDelimiters } from './mathMarkdown'

describe('normalizeLatexMathDelimiters', () => {
  it('normalizes Doc2X inline and display math delimiters', () => {
    expect(normalizeLatexMathDelimiters('行内 \\(x+1\\)\n\\[x^2\\]')).toBe('行内 $x+1$\n$$x^2$$')
  })

  it('does not alter delimiters shown as code or escaped text', () => {
    const markdown = '示例 `\\(x\\)` 和 \\\\(literal\\\\)\n\n```tex\n\\(x\\)\n```'
    expect(normalizeLatexMathDelimiters(markdown)).toBe(markdown)
  })

  it('repairs the specific nested OCR delimiter pattern without changing display math', () => {
    const markdown = '$设 $$ p_{2(m+1)}+\\lambda=-\\frac{1}{4}(p_{2m}+\\lambda)$ $\n$所以 $$ \\left\\{p_{2m}-\\frac{1}{2}\\right\\}$ $是等比数列。\n\n$$\\frac{1}{2}$$'

    expect(normalizeLatexMathDelimiters(markdown)).toBe('设 $p_{2(m+1)}+\\lambda=-\\frac{1}{4}(p_{2m}+\\lambda)$\n所以 $\\left\\{p_{2m}-\\frac{1}{2}\\right\\}$是等比数列。\n\n$$\\frac{1}{2}$$')
  })

  it('preserves consecutive inline formulas emitted by OCR', () => {
    const markdown = '$ a_{1}=1 $ $ a_{2}=4 $ $ a_{3}=9 $'

    expect(normalizeLatexMathDelimiters(markdown)).toBe(markdown)
  })

  it('leaves OCR-like delimiters inside inline code unchanged', () => {
    expect(normalizeLatexMathDelimiters('`$设 $$ p_n = 1 $ $`')).toBe('`$设 $$ p_n = 1 $ $`')
  })
})
