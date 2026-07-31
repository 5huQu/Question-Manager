import { describe, expect, it } from 'vitest'
import { clearTeachingDocumentKatexCache, renderTeachingDocumentKatex } from './katexCache'

describe('teaching document KaTeX cache', () => {
  it('renders and reuses both inline and block formula variants', () => {
    clearTeachingDocumentKatexCache()
    const inline = renderTeachingDocumentKatex('x^2+y^2=1', false)
    const inlineAgain = renderTeachingDocumentKatex('x^2+y^2=1', false)
    const block = renderTeachingDocumentKatex('x^2+y^2=1', true)
    expect(inline).toContain('katex')
    expect(inlineAgain).toBe(inline)
    expect(block).toContain('katex-display')
  })

  it('returns an empty fallback for invalid formula input', () => {
    expect(renderTeachingDocumentKatex('\\notARealLatexCommand{', false)).toBe('')
  })
})
