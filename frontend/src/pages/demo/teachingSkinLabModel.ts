import type { BoxBlock, HeadingBlock, ParagraphBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import type { TeachingSkinDefinition, TeachingSkinTarget, TeachingSkinVariantId } from '@/utils/teachingDocument/skins'
import { resolveBoxSkin, resolveHeadingSkin, resolveTeachingSkinDesignRenderState } from '@/utils/teachingDocument/skins'

export const SKIN_LAB_BOX_TEMPLATES = ['concept', 'method', 'example', 'warning', 'summary'] as const

export function skinLabDefinitions(target?: TeachingSkinTarget): TeachingSkinDefinition[] {
  return teachingSkinRegistry.list(target).slice().sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

export function skinLabDocument(definition: TeachingSkinDefinition): TeachingDocumentV1 {
  const skin = { id: definition.id, version: definition.version }
  const boundaryParagraphs: ParagraphBlock[] = Array.from({ length: 36 }, (_, index) => ({
    type: 'paragraph',
    id: `skin-lab-boundary-${index + 1}`,
    content: [{ type: 'text', text: '这是用于观察边框、内距与标题高度在真实 A4 分页附近表现的示例正文。' }],
  }))
  const headingBlocks: HeadingBlock[] = [
    ['skin-lab-heading-1', 1, '第一章 函数'],
    ['skin-lab-heading-2', 2, '1.1 函数的概念'],
    ['skin-lab-heading-3', 3, '一、定义域'],
    ['skin-lab-heading-4', 4, '基础性质'],
  ].map(([id, level, text]) => ({
    type: 'heading', id: String(id), level: Number(level) as HeadingBlock['level'], content: [{ type: 'text', text: String(text) }], ...(definition.target === 'heading' ? { skin } : {}),
  }))
  const boxBlocks: BoxBlock[] = SKIN_LAB_BOX_TEMPLATES.map((templateId, index) => ({
    type: 'box',
    id: `skin-lab-box-${templateId}`,
    templateId,
    title: `示例 ${index + 1}`,
    breakBehavior: 'auto',
    ...(definition.target === 'box' ? { skin } : {}),
    children: [{ type: 'paragraph', id: `skin-lab-box-body-${templateId}`, content: [{ type: 'text', text: '这张卡片用于显示当前皮肤在不同模板语义下的兼容状态与真实渲染结果。' }] }],
  }))
  return {
    version: 1,
    documentType: 'lecture',
    title: `Skin Lab · ${definition.label}`,
    metadata: { source: 'skin-lab' },
    content: [
      { type: 'heading', id: 'skin-lab-heading-title', level: 1, content: [{ type: 'text', text: '标题示例' }] },
      ...headingBlocks,
      ...boundaryParagraphs,
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
