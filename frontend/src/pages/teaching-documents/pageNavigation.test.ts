import { describe, expect, it } from 'vitest'
import { activePageFromPageRects, activePageFromPageTransitions } from './pageNavigation'

describe('teaching document page navigation', () => {
  it('uses the page containing the viewport center for A4 preview', () => {
    expect(activePageFromPageRects([
      { page: 1, top: 100, bottom: 900 },
      { page: 2, top: 940, bottom: 1740 },
    ], 200, 800)).toBe(1)
    expect(activePageFromPageRects([
      { page: 1, top: -800, bottom: 0 },
      { page: 2, top: 40, bottom: 840 },
    ], 100, 700)).toBe(2)
  })

  it('uses the nearest page while the viewport center is in the page gap', () => {
    expect(activePageFromPageRects([
      { page: 1, top: -700, bottom: -20 },
      { page: 2, top: 40, bottom: 720 },
    ], 0, 60)).toBe(2)
  })

  it('advances at the pagination transition in paginated editing mode', () => {
    const transitions = [
      { page: 2, top: 700 },
      { page: 3, top: 1500 },
    ]
    expect(activePageFromPageTransitions(transitions, 0, 600)).toBe(1)
    expect(activePageFromPageTransitions(transitions, 500, 1100)).toBe(2)
    expect(activePageFromPageTransitions(transitions, 1200, 1800)).toBe(3)
  })
})
