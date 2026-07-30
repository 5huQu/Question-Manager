import { describe, expect, it } from 'vitest'
import { lectureFontCssVars, resolveDocumentFonts } from './lectureFonts'

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
})
