import type { BoxBlock, HeadingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import type { TeachingSkinDefinition, TeachingSkinTarget, TeachingSkinVariantId } from '@/utils/teachingDocument/skins'
import { resolveBoxSkin, resolveHeadingSkin, resolveTeachingSkinDesignRenderState } from '@/utils/teachingDocument/skins'

export const SKIN_LAB_BOX_TEMPLATES = ['concept', 'method', 'example', 'warning', 'summary'] as const

export function skinLabDefinitions(target?: TeachingSkinTarget): TeachingSkinDefinition[] {
  return teachingSkinRegistry.list(target).slice().sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

export interface SkinLabDefinitionGroup {
  label: string
  definitions: TeachingSkinDefinition[]
}

/** 侧边列表分组：全选时按标题/信息框分组展示，避免单一目标被混排淹没。 */
export function skinLabDefinitionGroups(target?: TeachingSkinTarget): SkinLabDefinitionGroup[] {
  if (target) return [{ label: target === 'heading' ? '标题皮肤' : '信息框皮肤', definitions: skinLabDefinitions(target) }]
  return [
    { label: '标题皮肤', definitions: skinLabDefinitions('heading') },
    { label: '信息框皮肤', definitions: skinLabDefinitions('box') },
  ]
}

export function skinLabDocument(definition: TeachingSkinDefinition): TeachingDocumentV1 {
  const skin = { id: definition.id, version: definition.version }
  if (definition.target === 'heading') {
    const headingBlocks: HeadingBlock[] = [
      ['skin-lab-heading-1', 1, '第一章 函数'],
      ['skin-lab-heading-2', 2, '1.1 函数的概念'],
      ['skin-lab-heading-3', 3, '一、定义域'],
      ['skin-lab-heading-4', 4, '基础性质'],
    ].map(([id, level, text]) => ({
      type: 'heading', id: String(id), level: Number(level) as HeadingBlock['level'], content: [{ type: 'text', text: String(text) }], skin,
    }))
    return {
      version: 1,
      documentType: 'lecture',
      title: `Skin Lab · ${definition.label}`,
      metadata: { source: 'skin-lab' },
      content: [
        { type: 'heading', id: 'skin-lab-heading-title', level: 1, content: [{ type: 'text', text: '标题示例' }] },
        ...headingBlocks,
      ],
    }
  }
  const boxBlocks: BoxBlock[] = SKIN_LAB_BOX_TEMPLATES.map((templateId, index) => ({
    type: 'box',
    id: `skin-lab-box-${templateId}`,
    templateId,
    title: `示例 ${index + 1}`,
    breakBehavior: 'auto',
    skin,
    children: [{ type: 'paragraph', id: `skin-lab-box-body-${templateId}`, content: [{ type: 'text', text: '这是用于观察皮肤在模板语义下渲染效果的示例正文。' }] }],
  }))
  return {
    version: 1,
    documentType: 'lecture',
    title: `Skin Lab · ${definition.label}`,
    metadata: { source: 'skin-lab' },
    content: [
      { type: 'heading', id: 'skin-lab-box-title', level: 1, content: [{ type: 'text', text: '信息框示例' }] },
      ...boxBlocks,
    ],
  }
}

export function skinLabCompatibility(definition: TeachingSkinDefinition) {
  const skin = { id: definition.id, version: definition.version }
  return definition.target === 'heading'
    ? [1, 2, 3, 4].map((level) => ({ label: `H${level}`, status: resolveHeadingSkin(skin, level as HeadingBlock['level']).status }))
    : SKIN_LAB_BOX_TEMPLATES.map((templateId) => ({ label: templateId, status: resolveBoxSkin(skin, templateId).status }))
}

export function skinLabVariants(definition: TeachingSkinDefinition) {
  return definition.design?.variants || []
}

export function skinLabDesignState(definition: TeachingSkinDefinition, variantId?: TeachingSkinVariantId) {
  return resolveTeachingSkinDesignRenderState(definition, variantId)
}
