import { describe, expect, it } from 'vitest'
import { DEFAULT_QUESTION_FIGURE_WIDTH_MM, resolveFigureLayout } from './figureLayoutPresets'

describe('figure layout presets', () => {
  it('uses a compact default width for question-bank figures', () => {
    expect(DEFAULT_QUESTION_FIGURE_WIDTH_MM).toBe(30)
    expect(resolveFigureLayout({ explicitWidthMm: DEFAULT_QUESTION_FIGURE_WIDTH_MM, containerWidthMm: 160 })).toMatchObject({ alignment: 'center', widthMm: 30 })
  })

  it('resolves preset defaults and clamps to the container', () => {
    expect(resolveFigureLayout({ preset: 'block-center', containerWidthMm: 160 })).toMatchObject({ alignment: 'center', widthMm: 80 })
    expect(resolveFigureLayout({ preset: 'full-width', containerWidthMm: 160 })).toMatchObject({ alignment: 'center', widthMm: 160 })
    expect(resolveFigureLayout({ preset: 'block-right', explicitWidthMm: 500, containerWidthMm: 160 })).toMatchObject({ alignment: 'right', widthMm: 160 })
  })

  it('keeps legacy width and alignment when no preset is present', () => {
    expect(resolveFigureLayout({ legacyAlignment: 'left', legacyWidthRatio: 0.5, containerWidthMm: 160 })).toEqual({ alignment: 'left', widthMm: 80 })
  })
})
