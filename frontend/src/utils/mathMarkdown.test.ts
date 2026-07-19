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
})
