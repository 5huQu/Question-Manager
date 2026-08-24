import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'
import { teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import TeachingSkinLabPage from './TeachingSkinLabPage'
import { skinLabCompatibility, skinLabDefinitions, skinLabDocument } from './teachingSkinLabModel'

const limitedHeading = defineHeadingSkin({
  id: 'test.lab.heading-limited', label: '受限测试标题', version: 1, printSafe: true, className: 'td-skin-test-lab-heading-limited', supportedLevels: [1, 2],
})
teachingSkinRegistry.register(limitedHeading)

describe('Teaching Skin Lab', () => {
  it('derives Heading and Box lists from the application registry', () => {
    const heading = skinLabDefinitions('heading')
    const box = skinLabDefinitions('box')
    expect(heading.length).toBeGreaterThan(0)
    expect(box.length).toBeGreaterThan(0)
    expect(heading.every((definition) => definition.target === 'heading')).toBe(true)
    expect(box.every((definition) => definition.target === 'box')).toBe(true)
  })

  it('marks incompatible preview samples without applying a second skin list', () => {
    const definition = skinLabDefinitions('heading').find((item) => item.id === limitedHeading.id)!
    const document = skinLabDocument(definition)
    expect(document.content.filter((block) => block.type === 'heading')).toHaveLength(4)
    expect(document.content.filter((block) => block.type === 'heading').every((block) => block.skin?.id === definition.id)).toBe(true)
    expect(skinLabCompatibility(definition)).toContainEqual({ label: 'H3', status: 'incompatible' })
  })

  it('renders the DEV tool with registry metadata and real preview components', () => {
    const html = renderToStaticMarkup(<TeachingSkinLabPage />)
    expect(html).toContain('Teaching Skin Lab')
    expect(html).toContain('builtin.heading.pill')
    expect(html).toContain('Screen / continuous preview')
    expect(html).toContain('A4 / page-boundary preview')
    expect(html).not.toContain('/api/teaching-documents')
  })
})
