import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defineHeadingSkin } from '@/utils/teachingDocument/skins/authoring'
import { teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import { TeachingDocumentRenderer } from '@/components/teaching-document/TeachingDocumentRenderer'
import TeachingSkinLabPage from './TeachingSkinLabPage'
import { skinLabBoxPreviewTemplates, skinLabCompatibility, skinLabDefinitionGroups, skinLabDefinitions, skinLabDesignState, skinLabDocument, skinLabVariants } from './teachingSkinLabModel'

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

  it('groups the full list into Heading and Box sections so neither target is hidden', () => {
    const groups = skinLabDefinitionGroups()
    expect(groups.map((group) => group.label)).toEqual(['标题皮肤', '信息框皮肤'])
    expect(groups[0].definitions.length).toBeGreaterThan(0)
    expect(groups[1].definitions.length).toBeGreaterThan(0)
    expect(groups[0].definitions.every((definition) => definition.target === 'heading')).toBe(true)
    expect(groups[1].definitions.every((definition) => definition.target === 'box')).toBe(true)
    const filtered = skinLabDefinitionGroups('box')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].label).toBe('信息框皮肤')
  })

  it('marks incompatible preview samples without applying a second skin list', () => {
    const definition = skinLabDefinitions('heading').find((item) => item.id === limitedHeading.id)!
    const document = skinLabDocument(definition)
    const headings = document.content.filter((block) => block.type === 'heading')
    expect(headings.filter((block) => block.skin?.id === definition.id)).toHaveLength(4)
    expect(headings.some((block) => !block.skin)).toBe(true)
    expect(document.outline).toMatchObject({ numberingEnabled: true, preset: 'decimal' })
    expect(headings[0].numbering?.mode).toBe('none')
    expect(skinLabCompatibility(definition)).toContainEqual({ label: 'H3', status: 'incompatible' })
  })

  it('keeps previews compact: Heading samples exclude boxes and paragraphs entirely', () => {
    const definition = skinLabDefinitions('heading').find((item) => item.id === 'builtin.heading.underline')!
    const document = skinLabDocument(definition)
    expect(document.content.every((block) => block.type === 'heading')).toBe(true)
  })

  it('keeps previews compact: Box samples show one plain heading plus a few skinned cards', () => {
    const definition = skinLabDefinitions('box').find((item) => item.id === 'builtin.box.outline')!
    const document = skinLabDocument(definition)
    expect(document.content.some((block) => block.type === 'paragraph')).toBe(false)
    const headings = document.content.filter((block) => block.type === 'heading')
    expect(headings).toHaveLength(1)
    expect(headings.every((block) => !block.skin)).toBe(true)
    const boxes = document.content.filter((block) => block.type === 'box')
    expect(boxes.length).toBeGreaterThan(1)
    expect(boxes.every((block) => block.skin?.id === definition.id)).toBe(true)
  })

  it('previews restricted Box skins only on templates that resolve the selected skin', () => {
    const definition = skinLabDefinitions('box').find((item) => item.id === 'builtin.box.theorem-math')!
    expect(skinLabBoxPreviewTemplates(definition)).toEqual(['concept', 'method', 'plain', 'summary'])

    const boxes = skinLabDocument(definition).content.filter((block) => block.type === 'box')
    expect(boxes.map((block) => block.templateId)).toEqual(['concept'])
    expect(boxes[0].title).toContain('Theorem 3.2')
    expect(boxes[0].children.map((block) => block.type)).toEqual(['paragraph', 'blockMath', 'paragraph'])
    expect(boxes.every((block) => block.skin?.id === definition.id)).toBe(true)
    expect(boxes.every((block) => skinLabCompatibility(definition).some((entry) => entry.label === block.templateId && entry.status === 'resolved'))).toBe(true)
  })

  it('uses proposal-authored sample structures for the nine new skins', () => {
    const badge = skinLabDocument(skinLabDefinitions('heading').find((item) => item.id === 'builtin.heading.badge')!)
    const badgeHeadings = badge.content.filter((block) => block.type === 'heading').filter((block) => block.skin)
    expect(badgeHeadings.map((block) => block.numbering?.manualLabel)).toEqual(['01', '题型 1', 'Step 1'])
    expect(renderToStaticMarkup(<TeachingDocumentRenderer document={badge} />)).toContain('data-number-label="01"')

    const step = skinLabDocument(skinLabDefinitions('box').find((item) => item.id === 'builtin.box.step-flow')!)
    const stepBox = step.content.find((block) => block.type === 'box')
    expect(stepBox?.title).toBe('规范解答四步法模型')
    expect(stepBox?.children).toHaveLength(4)

    const trap = skinLabDocument(skinLabDefinitions('box').find((item) => item.id === 'builtin.box.trap-alert')!)
    expect(trap.content.find((block) => block.type === 'box')?.children).toHaveLength(3)
  })

  it('offers declared variants as ephemeral Design states with a different CSS map', () => {
    const definition = skinLabDefinitions('heading').find((item) => item.id === 'builtin.heading.left-accent')!
    const variant = skinLabVariants(definition).find((item) => item.id === 'amber')!
    expect(skinLabDesignState(definition).cssVariables).not.toEqual(skinLabDesignState(definition, variant.id).cssVariables)
  })

  it('renders the DEV tool with registry metadata and real preview components', () => {
    const html = renderToStaticMarkup(<TeachingSkinLabPage />)
    expect(html).toContain('Teaching Skin Lab')
    expect(html).toContain('builtin.heading.pill')
    expect(html).toContain('标题皮肤')
    expect(html).toContain('信息框皮肤')
    expect(html).toContain('builtin.box.outline')
    expect(html).toContain('Screen / continuous preview')
    expect(html).toContain('A4 / print preview')
    expect(html).not.toContain('/api/teaching-documents')
  })
})
