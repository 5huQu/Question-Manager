import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { TeachingSkinRegistry } from './registry'
import { teachingSkinRegistry } from './registryInstance'
import { teachingSkinPresetRegistry } from './presetRegistryInstance'
import type { TeachingSkinPresetDefinition } from './presets'
import { applyTeachingDocumentRecommendedSkins, planTeachingDocumentPresetRecommendedSkins } from './recommendedSkins'

const warm = teachingSkinPresetRegistry.get('builtin.preset.warm', 1)!

function documentWithSkinCases(): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: '推荐样式测试',
    metadata: {},
    design: { preset: { id: warm.id, version: warm.version } },
    content: [
      { type: 'heading', id: 'heading-eligible', level: 2, content: [{ type: 'text', text: '待应用标题' }] },
      { type: 'heading', id: 'heading-recommended', level: 2, content: [{ type: 'text', text: '已有推荐标题' }], skin: { id: 'builtin.heading.left-accent', version: 1 } },
      { type: 'heading', id: 'heading-other', level: 2, content: [{ type: 'text', text: '其他标题皮肤' }], skin: { id: 'builtin.heading.pill', version: 1 } },
      { type: 'heading', id: 'heading-unknown', level: 2, content: [{ type: 'text', text: '未知标题皮肤' }], skin: { id: 'plugin.heading.future', version: 3, variant: 'futureVariant' } },
      { type: 'paragraph', id: 'paragraph', content: [{ type: 'text', text: '不应受影响的正文' }] },
      { type: 'box', id: 'box-eligible', templateId: 'concept', title: '待应用卡片', appearance: { borderWidth: 2 }, breakBehavior: 'auto', children: [] },
      { type: 'box', id: 'box-recommended', templateId: 'concept', title: '已有推荐卡片', breakBehavior: 'avoid', skin: { id: 'builtin.box.left-accent', version: 1, variant: 'green' }, children: [] },
      { type: 'box', id: 'box-other', templateId: 'concept', title: '其他卡片皮肤', breakBehavior: 'allow', skin: { id: 'builtin.box.header-band', version: 1 }, children: [] },
      { type: 'box', id: 'box-unknown', templateId: 'concept', title: '未知卡片皮肤', breakBehavior: 'auto', skin: { id: 'plugin.box.future', version: 3, variant: 'futureVariant' }, children: [] },
    ],
  }
}

describe('Teaching Preset recommended Skin setup', () => {
  it('plans only unskinned compatible Heading and Box blocks, preserving every existing Skin ref', () => {
    const plan = planTeachingDocumentPresetRecommendedSkins(documentWithSkinCases(), warm)

    expect(plan).toMatchObject({ status: 'available', totalEligible: 2 })
    expect(plan.heading).toMatchObject({
      status: 'available',
      recommendedSkinId: 'builtin.heading.left-accent',
      eligibleBlockIds: ['heading-eligible'],
      alreadyRecommendedCount: 1,
      existingOtherSkinCount: 2,
      incompatibleCount: 0,
    })
    expect(plan.box).toMatchObject({
      status: 'available',
      recommendedSkinId: 'builtin.box.left-accent',
      eligibleBlockIds: ['box-eligible'],
      alreadyRecommendedCount: 1,
      existingOtherSkinCount: 2,
      incompatibleCount: 0,
    })
  })

  it('skips unskinned blocks when the exact recommended Skin is incompatible', () => {
    const registry = new TeachingSkinRegistry()
    const heading = teachingSkinRegistry.get('builtin.heading.left-accent')!
    const box = teachingSkinRegistry.get('builtin.box.left-accent')!
    if (heading.target !== 'heading' || box.target !== 'box') throw new Error('Built-in Skin fixture mismatch')
    registry.register({ ...heading, id: 'test.heading.level-two', supportedLevels: [2] })
    registry.register({ ...box, id: 'test.box.concept', supportedTemplates: ['concept'] })
    const preset: TeachingSkinPresetDefinition = {
      ...warm,
      id: 'test.preset.recommended',
      bindings: { 'test.heading.level-two': 'amber', 'test.box.concept': 'green' },
      recommendedSkins: { heading: 'test.heading.level-two', box: 'test.box.concept' },
    }
    const document: TeachingDocumentV1 = {
      ...documentWithSkinCases(),
      content: [
        { type: 'heading', id: 'heading-level-one', level: 1, content: [{ type: 'text', text: '一级标题' }] },
        { type: 'box', id: 'box-summary', templateId: 'summary', title: '总结', breakBehavior: 'auto', children: [] },
      ],
    }

    const plan = planTeachingDocumentPresetRecommendedSkins(document, preset, registry)
    expect(plan.heading).toMatchObject({ eligibleBlockIds: [], incompatibleCount: 1 })
    expect(plan.box).toMatchObject({ eligibleBlockIds: [], incompatibleCount: 1 })
  })

  it('applies selected recommendations in one document transform without materializing Variants', () => {
    const document = documentWithSkinCases()
    const plan = planTeachingDocumentPresetRecommendedSkins(document, warm)
    const next = applyTeachingDocumentRecommendedSkins(document, plan, { heading: true, box: true })

    expect(next).not.toBe(document)
    expect(next.design).toEqual(document.design)
    expect(next.content.find((block) => block.id === 'heading-eligible')).toMatchObject({ skin: { id: 'builtin.heading.left-accent', version: 1 } })
    expect(next.content.find((block) => block.id === 'box-eligible')).toMatchObject({ skin: { id: 'builtin.box.left-accent', version: 1 } })
    expect((next.content.find((block) => block.id === 'heading-eligible') as { skin?: { variant?: string } }).skin?.variant).toBeUndefined()
    expect((next.content.find((block) => block.id === 'box-eligible') as { skin?: { variant?: string } }).skin?.variant).toBeUndefined()
    expect(next.content.find((block) => block.id === 'heading-other')).toEqual(document.content.find((block) => block.id === 'heading-other'))
    expect(next.content.find((block) => block.id === 'heading-unknown')).toEqual(document.content.find((block) => block.id === 'heading-unknown'))
    expect(next.content.find((block) => block.id === 'box-recommended')).toEqual(document.content.find((block) => block.id === 'box-recommended'))
    expect(next.content.find((block) => block.id === 'box-other')).toEqual(document.content.find((block) => block.id === 'box-other'))
    expect(next.content.find((block) => block.id === 'box-unknown')).toEqual(document.content.find((block) => block.id === 'box-unknown'))
    expect(next.content.find((block) => block.id === 'paragraph')).toEqual(document.content.find((block) => block.id === 'paragraph'))
  })

  it('supports applying only one target without touching the other', () => {
    const document = documentWithSkinCases()
    const plan = planTeachingDocumentPresetRecommendedSkins(document, warm)
    const next = applyTeachingDocumentRecommendedSkins(document, plan, { heading: true, box: false })

    expect(next.content.find((block) => block.id === 'heading-eligible')).toMatchObject({ skin: { id: 'builtin.heading.left-accent', version: 1 } })
    expect(next.content.find((block) => block.id === 'box-eligible')).not.toHaveProperty('skin')
  })

  it('fails closed for an unavailable recommendation without changing runtime Preset bindings', () => {
    const preset: TeachingSkinPresetDefinition = { ...warm, recommendedSkins: { heading: 'plugin.heading.future', box: 'builtin.box.left-accent' } }
    const document = documentWithSkinCases()
    const plan = planTeachingDocumentPresetRecommendedSkins(document, preset)
    const next = applyTeachingDocumentRecommendedSkins(document, plan, { heading: true, box: true })

    expect(plan.heading).toMatchObject({ status: 'unavailable', unavailableReason: 'skin-missing', eligibleBlockIds: [] })
    expect(next.content.find((block) => block.id === 'heading-eligible')).not.toHaveProperty('skin')
    expect(next.content.find((block) => block.id === 'box-eligible')).toMatchObject({ skin: { id: 'builtin.box.left-accent', version: 1 } })
  })

  it('does nothing for Presets without explicit recommendedSkins metadata', () => {
    const document = documentWithSkinCases()
    const preset: TeachingSkinPresetDefinition = { ...warm, recommendedSkins: undefined }
    const plan = planTeachingDocumentPresetRecommendedSkins(document, preset)
    expect(plan).toMatchObject({ status: 'none', totalEligible: 0 })
    expect(applyTeachingDocumentRecommendedSkins(document, plan, { heading: true, box: true })).toBe(document)
  })
})
