import { describe, expect, it } from 'vitest'
import { fitCanvasScale } from './TeachingDocumentCanvas'

describe('fitCanvasScale', () => {
  it('keeps a paper at its normal scale when the viewport matches the paper width', () => {
    expect(fitCanvasScale(760, 760, 1)).toBe(1)
  })

  it('uniformly scales down for a narrow center column without changing paper width', () => {
    expect(fitCanvasScale(418, 760, 1)).toBe(0.55)
  })

  it('caps wide center columns and composes with a user-selected zoom', () => {
    expect(fitCanvasScale(1600, 760, 1)).toBe(1.35)
    expect(fitCanvasScale(760, 760, 1.25)).toBe(1.25)
  })
})
