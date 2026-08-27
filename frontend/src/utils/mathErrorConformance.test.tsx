import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from '@/components/MarkdownContent'
import { renderKatexWithStatus, validateKatex } from '@/utils/katexValidation'
import { renderTeachingDocumentKatexWithStatus } from '@/utils/teachingDocument/katexCache'

const validFixtures = [
  ['fraction', '\\frac{1}{2}'],
  ['root', '\\sqrt{x}'],
  ['sum', '\\sum_{i=1}^{n} i'],
  ['cases', '\\begin{cases}x=1\\\\y=2\\end{cases}'],
  ['aligned', '\\begin{aligned}a&=1\\\\b&=2\\end{aligned}'],
] as const

const invalidFixtures = [
  ['unknown command', '\\notARealCommand'],
  ['missing brace', '\\frac{1'],
  ['missing environment closure', '\\begin{cases}x=1'],
] as const

function questionBankMarkup(latex: string, displayMode = false) {
  const source = displayMode ? `$$${latex}$$` : `$${latex}$`
  return renderToStaticMarkup(<MarkdownContent content={source} />)
}

function rawQuestionBankMarkup(markdown: string) {
  return renderToStaticMarkup(<MarkdownContent content={markdown} />)
}

describe('shared KaTeX validation', () => {
  it.each(validFixtures)('classifies %s as valid in direct renderers', (_name, latex) => {
    expect(validateKatex(latex, false)).toEqual({ valid: true })
    expect(renderKatexWithStatus(latex, false).validation).toEqual({ valid: true })
    expect(renderTeachingDocumentKatexWithStatus(latex, false).validation).toEqual({ valid: true })
  })

  it.each(invalidFixtures)('classifies %s as invalid in direct renderers', (_name, latex) => {
    expect(validateKatex(latex, false)).toMatchObject({ valid: false, reason: 'latex' })
    expect(renderKatexWithStatus(latex, false).validation).toMatchObject({ valid: false, reason: 'latex' })
    expect(renderTeachingDocumentKatexWithStatus(latex, false).validation).toMatchObject({ valid: false, reason: 'latex' })
  })
})

describe('math error conformance', () => {
  it.each([...validFixtures, ...invalidFixtures])('keeps Question Bank status aligned for %s', (_name, latex) => {
    const valid = validateKatex(latex, false).valid
    const markup = questionBankMarkup(latex)
    const invalidMarker = markup.includes('aria-invalid="true"')
    expect(invalidMarker).toBe(!valid)
    if (!valid) {
      expect(markup).toContain(latex)
      expect(markup).toContain('公式格式有误')
    }
  })

  it('applies the same invalid classification to display math', () => {
    const latex = '\\notARealCommand'
    const markup = questionBankMarkup(latex, true)
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain(latex)
    expect(markup).toContain('公式格式有误')
  })

  it('keeps parser errors separate from LaTeX errors', () => {
    const markup = rawQuestionBankMarkup('$$x$')
    expect(markup).not.toContain('application/x-tex')
    expect(markup).not.toContain('公式格式有误')
  })
})
