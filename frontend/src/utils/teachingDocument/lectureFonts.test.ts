import { describe, expect, it } from 'vitest'
import { lectureFontCssVars, resolveDocumentFonts, typographyPresetForDocumentType, typographyStyleForPreset } from './lectureFonts'

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

  it('maps new documents to type-appropriate typography presets', () => {
    expect(typographyPresetForDocumentType('exam')).toBe('exam')
    expect(typographyPresetForDocumentType('worksheet')).toBe('exam')
    expect(typographyPresetForDocumentType('lecture')).toBe('lecture')
    expect(typographyStyleForPreset('exam')).toMatchObject({ typographyPreset: 'exam', bodyFont: 'songti', headingFont: 'heiti', marginPreset: 'compact' })
    expect(typographyStyleForPreset('lecture')).toMatchObject({ typographyPreset: 'lecture', bodyFont: 'songti', headingFont: 'heiti', marginPreset: 'normal' })
  })
})
