import { describe, expect, it } from 'vitest'
import { getBoxTemplateOrFallback } from './boxTemplates'
import { boxBodyStyle, boxFrameStyle } from './boxAppearance'

describe('box appearance styles', () => {
  it('uses the same constrained surface for the card frame and body', () => {
    const template = getBoxTemplateOrFallback('concept')
    const appearance = { background: 'blue' as const, padding: { top: 20 as const } }

    expect(boxFrameStyle(appearance, template).background).toBe('#eef4ff')
    expect(boxBodyStyle(appearance, template)).toMatchObject({
      background: '#eef4ff',
      paddingTop: '20px',
    })
  })
})
