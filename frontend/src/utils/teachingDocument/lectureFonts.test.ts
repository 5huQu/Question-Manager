import { describe, expect, it } from 'vitest'
import {
  lectureFontCssVars,
  lectureFontFaceCss,
  resolveDocumentFonts,
  resolveHeadingStyle,
  teachingDocumentLayoutCssVars,
  teachingTypographyCssVars,
  typographyPresetForDocumentType,
  typographyStyleForPreset,
} from './lectureFonts'

describe('lecture font resolution', () => {
  it('keeps old documents on their original font stacks when Latin font settings are absent', () => {
    const fonts = resolveDocumentFonts({ bodyFont: 'kaiti', headingFont: 'heiti' })
    expect(fonts.bodyLatin).toBe(fonts.body)
    expect(fonts.headingLatin).toBe(fonts.heading)
  })

  it('uses independent Latin fonts for English, digits, and heading number labels', () => {
    const fonts = resolveDocumentFonts({
      bodyFont: 'songti', bodyLatinFont: 'times', bodyNumberFont: 'courier',
      headingFont: 'heiti', headingLatinFont: 'georgia', headingNumberFont: 'cambria',
    })
    const vars = lectureFontCssVars(fonts.body, fonts.heading, fonts.bodyLatin, fonts.headingLatin, fonts.bodyNumber, fonts.headingNumber)
    expect(vars['--td-body-font']).toContain('td-body-number')
    expect(vars['--td-heading-font']).toContain('td-heading-latin')
    expect(vars['--td-heading-number-font']).toContain('td-heading-number')
  })

  it('injects the bundled KaTeX Math Italic face for teaching-document Latin text', () => {
    const css = lectureFontFaceCss(
      resolveDocumentFonts({}).bodyLatin,
      resolveDocumentFonts({}).bodyNumber,
      resolveDocumentFonts({}).headingLatin,
      resolveDocumentFonts({}).headingNumber,
    )
    expect(css).toContain('font-family:"QuestionMathLatin"')
    expect(css).toContain('unicode-range:U+0041-005A, U+0061-007A')
    expect(css).toContain('KaTeX_Main-Italic')
    expect(css).toContain('unicode-range:U+0025, U+0028-0029, U+002B-002F, U+0030-0039, U+003A-003E, U+005B-005D, U+007B-007D')
    expect(css).toContain('KaTeX_Main-Regular')
  })

  it('maps new documents to type-appropriate typography presets', () => {
    expect(typographyPresetForDocumentType('exam')).toBe('exam')
    expect(typographyPresetForDocumentType('worksheet')).toBe('exam')
    expect(typographyPresetForDocumentType('lecture')).toBe('lecture')
    expect(typographyStyleForPreset('exam')).toMatchObject({ typographyPreset: 'exam', bodyFont: 'songti', headingFont: 'heiti', marginPreset: 'compact' })
    expect(typographyStyleForPreset('lecture')).toMatchObject({ typographyPreset: 'lecture', bodyFont: 'songti', headingFont: 'heiti', marginPreset: 'normal' })
  })

  it('resolves per-level heading defaults while emitting only explicit document overrides', () => {
    expect(resolveHeadingStyle(undefined, 2)).toMatchObject({ fontSize: 20, fontWeight: 600 })

    const vars = teachingTypographyCssVars({
      headingStyles: { 1: { font: 'heiti', fontSize: 24, fontWeight: 700 } },
      questionStyle: { font: 'kaiti', fontSize: 16, color: '#2563eb', italic: true },
    })
    expect(vars['--td-heading-1-size']).toBe('24px')
    expect(vars['--td-heading-1-font']).toContain('Noto Sans')
    expect(vars['--td-heading-2-size']).toBeUndefined()
    expect(vars['--td-question-size']).toBe('16px')
    expect(vars['--td-question-color']).toBe('#2563eb')
    expect(vars['--td-question-style']).toBe('italic')
  })

  it('shares question spacing with the print layout', () => {
    expect(teachingDocumentLayoutCssVars({ questionSpacing: 'normal' })['--td-question-gap']).toBe('12px')
    expect(teachingDocumentLayoutCssVars({ questionSpacing: 'relaxed' })['--td-question-gap']).toBe('18px')
  })
})
