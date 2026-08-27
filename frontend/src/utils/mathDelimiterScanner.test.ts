import { describe, expect, it } from 'vitest'
import { scanMathDelimiters, type MathDelimiterSegment } from './mathDelimiterScanner'

type MathToken = { latex: string; displayMode: boolean }

function mathTokens(markdown: string): MathToken[] {
  return scanMathDelimiters(markdown).flatMap((segment) => segment.type === 'math'
    ? [{ latex: segment.latex, displayMode: segment.displayMode }]
    : [])
}

function codeSegments(markdown: string) {
  return scanMathDelimiters(markdown).filter((segment): segment is Extract<MathDelimiterSegment, { type: 'code' }> => segment.type === 'code')
}

describe('scanMathDelimiters', () => {
  it.each([
    ['one inline formula', '$x$', [{ latex: 'x', displayMode: false }]],
    ['multiple inline formulas', '由 $a=1$ 得 $b=2$', [{ latex: 'a=1', displayMode: false }, { latex: 'b=2', displayMode: false }]],
    ['adjacent inline formulas', '$a$、$b$、$c$', [{ latex: 'a', displayMode: false }, { latex: 'b', displayMode: false }, { latex: 'c', displayMode: false }]],
  ] as const)('recognizes %s', (_name, markdown, expected) => {
    expect(mathTokens(markdown)).toEqual(expected)
  })

  it.each([
    ['one-line display math', '$$x$$', [{ latex: 'x', displayMode: true }]],
    ['multiline display math', '$$\nx+1\n$$', [{ latex: 'x+1', displayMode: true }]],
    ['cases', '$$\n\\begin{cases}\nx=1\\\\\ny=2\n\\end{cases}\n$$', [{ latex: '\\begin{cases}\nx=1\\\\\ny=2\n\\end{cases}', displayMode: true }]],
    ['aligned', '$$\n\\begin{aligned}\na&=1\\\\\nb&=2\n\\end{aligned}\n$$', [{ latex: '\\begin{aligned}\na&=1\\\\\nb&=2\n\\end{aligned}', displayMode: true }]],
  ] as const)('recognizes %s without changing the LaTeX body', (_name, markdown, expected) => {
    expect(mathTokens(markdown)).toEqual(expected)
  })

  it.each([
    ['display followed by inline math', '$$x$$ 后接 $y$', [{ latex: 'x', displayMode: true }, { latex: 'y', displayMode: false }]],
    ['text around display math', '前文 $$x$$ 后文', [{ latex: 'x', displayMode: true }]],
    ['text around display and inline math', '前文 $$x$$ 后文 $y$', [{ latex: 'x', displayMode: true }, { latex: 'y', displayMode: false }]],
    ['multiple display formulas', '$$a$$ 与 $$b$$', [{ latex: 'a', displayMode: true }, { latex: 'b', displayMode: true }]],
    ['inline, display, then inline math', '$a$ $$b$$ $c$', [{ latex: 'a', displayMode: false }, { latex: 'b', displayMode: true }, { latex: 'c', displayMode: false }]],
  ] as const)('keeps token order for %s', (_name, markdown, expected) => {
    expect(mathTokens(markdown)).toEqual(expected)
  })

  it.each([
    ['inline code with inline delimiters', '`$x$`', false],
    ['inline code with display delimiters', '`$$x$$`', false],
    ['multiple-backtick inline code', '`` `$x$` ``', false],
    ['fenced code with display delimiters', '```md\n$$x$$\n```', true],
    ['fenced code with multiline display delimiters', '```md\n$$\nx\n$$\n```', true],
  ] as const)('protects %s before math matching', (_name, markdown, fenced) => {
    expect(mathTokens(markdown)).toEqual([])
    expect(codeSegments(markdown)).toEqual([{ type: 'code', value: markdown, fenced }])
  })

  it('continues scanning real math outside protected code', () => {
    expect(mathTokens('`$$x$$` 与 $y$')).toEqual([
      { latex: 'y', displayMode: false },
    ])
  })

  it('leaves escaped dollars and an escaped code opener available to normal text/math handling', () => {
    expect(mathTokens('价格为 \\$100')).toEqual([])
    expect(mathTokens('\\`$x$`')).toEqual([{ latex: 'x', displayMode: false }])
  })

  it.each(['$$x$', '$x', '$', '$$'])('does not repair malformed delimiter input: %s', (markdown) => {
    expect(scanMathDelimiters(markdown)).toEqual([{ type: 'text', value: markdown }])
  })
})
