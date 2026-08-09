import { describe, expect, it } from 'vitest'
import {
  UI_SCALE_STORAGE_KEY,
  applyPrintSafeUiScale,
  applyUiScaleMode,
  autoUiScaleForViewport,
  parseUiScaleMode,
} from './uiScale'

describe('Web UI scale', () => {
  it.each([
    [1280, 1],
    [1440, 1],
    [1536, 1],
    [1680, 1.05],
    [1920, 1.1],
    [2560, 1.15],
  ])('uses the expected automatic scale at %ipx', (width, expected) => {
    expect(autoUiScaleForViewport(width)).toBe(expected)
  })

  it('only accepts the supported manual values', () => {
    expect(parseUiScaleMode('auto')).toBe('auto')
    expect(parseUiScaleMode('1.1')).toBe(1.1)
    expect(parseUiScaleMode('1.2')).toBe('auto')
    expect(parseUiScaleMode(null)).toBe('auto')
  })

  it('uses CSS defaults in automatic mode and restores a print-safe root size', () => {
    const root = document.documentElement
    root.style.setProperty('--app-ui-scale', '1.15')
    root.style.setProperty('--app-ui-root-font-size', '18.4px')

    applyUiScaleMode('auto', root)
    expect(root.style.getPropertyValue('--app-ui-scale')).toBe('')
    expect(root.style.getPropertyValue('--app-ui-root-font-size')).toBe('')

    applyPrintSafeUiScale(root)
    expect(root.style.getPropertyValue('--app-ui-scale')).toBe('1')
    expect(root.style.getPropertyValue('--app-ui-root-font-size')).toBe('16px')
    root.style.removeProperty('--app-ui-scale')
    root.style.removeProperty('--app-ui-root-font-size')
  })

  it('keeps the storage key stable for future settings migrations', () => {
    expect(UI_SCALE_STORAGE_KEY).toBe('question-manager.ui-scale-mode')
  })
})
