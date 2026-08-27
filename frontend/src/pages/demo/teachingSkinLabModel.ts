import type { BoxBlock, BoxChildBlock, HeadingBlock, TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
import { teachingSkinRegistry } from '@/utils/teachingDocument/skins'
import type { TeachingSkinDefinition, TeachingSkinTarget, TeachingSkinVariantId } from '@/utils/teachingDocument/skins'
import { resolveBoxSkin, resolveHeadingSkin, resolveTeachingSkinDesignRenderState } from '@/utils/teachingDocument/skins'

export const SKIN_LAB_BOX_TEMPLATES = ['concept', 'method', 'example', 'warning', 'summary'] as const

/**
 * The generic set is useful for unrestricted skins, but a restricted skin must
 * be previewed with templates it actually supports. Otherwise the resolver is
 * expected to fall back and the Lab ends up demonstrating the default template
 * instead of the selected skin.
 */
export function skinLabBoxPreviewTemplates(definition: TeachingSkinDefinition): readonly string[] {
  if (definition.target !== 'box' || !definition.supportedTemplates?.length) return SKIN_LAB_BOX_TEMPLATES
  return definition.supportedTemplates.slice(0, SKIN_LAB_BOX_TEMPLATES.length)
}

export function skinLabDefinitions(target?: TeachingSkinTarget): TeachingSkinDefinition[] {
  return teachingSkinRegistry.list(target).slice().sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

export interface SkinLabDefinitionGroup {
  label: string
  definitions: TeachingSkinDefinition[]
}

const text = (value: string, bold = false): TeachingInline => ({ type: 'text', text: value, ...(bold ? { marks: ['bold'] } : {}) })
const math = (latex: string): TeachingInline => ({ type: 'inlineMath', latex })

function skinLabHeadingSamples(definition: TeachingSkinDefinition): Array<{ level: HeadingBlock['level']; text: string; manualLabel?: string }> {
  switch (definition.id) {
    case 'builtin.heading.badge':
      return [
        { level: 1, manualLabel: '01', text: '考点一：导数与函数单调性极值综合应用' },
        { level: 2, manualLabel: '题型 1', text: '利用导数求含参函数的单调区间与极值点' },
        { level: 2, manualLabel: 'Step 1', text: "确定定义域并求导数 f'(x) 的零点分布" },
      ]
    case 'builtin.heading.winged':
      return [
        { level: 1, text: '第 Ⅰ 卷（选择题 共 60 分）' },
        { level: 2, text: '二、填空题（本大题共 4 小题，每小题 5 分）' },
      ]
    case 'builtin.heading.diamond-tag':
      return [{ level: 1, text: '思维拔高：极值点偏移问题的三种对偶构造技巧' }]
    case 'builtin.heading.double-line':
      return [{ level: 1, text: '专题十四：圆锥曲线中的定点与定值问题探究' }]
    default:
      return [
        { level: 1, text: '函数' },
        { level: 2, text: '函数的概念' },
        { level: 3, text: '定义域' },
        { level: 4, text: '基础性质' },
      ]
  }
}

function skinLabBoxProposalSample(definition: TeachingSkinDefinition): { templateId: string; title: string; children: BoxChildBlock[] } | undefined {
  switch (definition.id) {
    case 'builtin.box.dashed-workspace':
      return {
        templateId: 'practice',
        title: '【随堂实战演练】',
        children: [{
          type: 'paragraph', id: 'skin-lab-dashed-body', content: [
            text('已知函数 '), math('f(x)=x\\ln x-\\frac{1}{2}ax^2+x'), text(' 在区间 '), math('(1,+\\infty)'), text(' 单调递增，求实数 '), math('a'), text(' 的取值范围。'),
          ],
        }],
      }
    case 'builtin.box.theorem-math':
      return {
        templateId: 'concept',
        title: 'Theorem 3.2（柯西-施瓦茨不等式的向量形式）',
        children: [
          { type: 'paragraph', id: 'skin-lab-theorem-intro', content: [text('设 '), math('\\boldsymbol{\\alpha},\\boldsymbol{\\beta}'), text(' 为内积空间 V 中的任意两个向量，则恒有：')] },
          { type: 'blockMath', id: 'skin-lab-theorem-formula', latex: '\\left(\\sum_{i=1}^n a_i b_i\\right)^2\\le\\left(\\sum_{i=1}^n a_i^2\\right)\\left(\\sum_{i=1}^n b_i^2\\right)' },
          { type: 'paragraph', id: 'skin-lab-theorem-result', content: [text('当且仅当向量线性共线时，等号成立。')] },
        ],
      }
    case 'builtin.box.trap-alert':
      return {
        templateId: 'warning',
        title: '【避坑指南】常见思维误区与防错策略',
        children: [
          { type: 'paragraph', id: 'skin-lab-trap-intro', content: [text('利用基本不等式求最值时，必须严格验证“一正、二定、三相等”。')] },
          { type: 'paragraph', id: 'skin-lab-trap-bad', content: [text('常见错解：', true), text('忽视等号成立条件，未将整体配凑为乘积定值的两项。')] },
          { type: 'paragraph', id: 'skin-lab-trap-good', content: [text('规范正解：', true), text('保证两项乘积为定值，并验证取等点是否处于定义域内。')] },
        ],
      }
    case 'builtin.box.monochrome-double':
      return {
        templateId: 'plain',
        title: '绝密 · 2026年高考数学押题冲刺卷答题须知',
        children: [
          { type: 'paragraph', id: 'skin-lab-mono-1', content: [text('1. 答卷前，考生务必将姓名、准考证号填写在答题卡上。')] },
          { type: 'paragraph', id: 'skin-lab-mono-2', content: [text('2. 作答解答题时，必须写出文字说明、证明过程或演算步骤。')] },
        ],
      }
    case 'builtin.box.step-flow':
      return {
        templateId: 'method',
        title: '规范解答四步法模型',
        children: [
          { type: 'paragraph', id: 'skin-lab-step-1', content: [text('第一步（审题析图）：', true), text('明确二次曲线与直线的联立条件，写出判别式 Δ > 0。')] },
          { type: 'paragraph', id: 'skin-lab-step-2', content: [text('第二步（设而不求）：', true), text('设交点坐标 A、B，写出韦达定理关系式。')] },
          { type: 'paragraph', id: 'skin-lab-step-3', content: [text('第三步（代数转化）：', true), text('将目标式转化为关于两根和与积的表达式。')] },
          { type: 'paragraph', id: 'skin-lab-step-4', content: [text('第四步（回代反思）：', true), text('化简得出最值，并核对判别式约束。')] },
        ],
      }
    default:
      return undefined
  }
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
    const headingBlocks: HeadingBlock[] = skinLabHeadingSamples(definition).map((sample, index) => ({
      type: 'heading', id: `skin-lab-heading-${index + 1}`, level: sample.level, content: [{ type: 'text', text: sample.text }], skin,
      ...(sample.manualLabel
        ? { numbering: { mode: 'manual' as const, manualLabel: sample.manualLabel } }
        : index === 0 ? { numbering: { mode: 'inherit' as const, restartAt: 1 } } : {}),
    }))
    return {
      version: 1,
      documentType: 'lecture',
      title: `Skin Lab · ${definition.label}`,
      metadata: { source: 'skin-lab' },
      outline: { numberingEnabled: true, preset: 'decimal' },
      content: [
        { type: 'heading', id: 'skin-lab-heading-title', level: 1, numbering: { mode: 'none' }, content: [{ type: 'text', text: '标题示例' }] },
        ...headingBlocks,
      ],
    }
  }
  const proposalSample = skinLabBoxProposalSample(definition)
  const boxBlocks: BoxBlock[] = (proposalSample ? [proposalSample] : skinLabBoxPreviewTemplates(definition).map((templateId, index) => ({
    templateId,
    title: `示例 ${index + 1}`,
    children: [{ type: 'paragraph' as const, id: `skin-lab-box-body-${templateId}`, content: [{ type: 'text' as const, text: '这是用于观察皮肤在模板语义下渲染效果的示例正文。' }] }],
  }))).map((sample, index) => ({
    type: 'box',
    id: `skin-lab-box-${sample.templateId}-${index + 1}`,
    templateId: sample.templateId,
    title: sample.title,
    breakBehavior: 'auto',
    skin,
    children: sample.children,
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
    : skinLabBoxPreviewTemplates(definition).map((templateId) => ({ label: templateId, status: resolveBoxSkin(skin, templateId).status }))
}

export function skinLabVariants(definition: TeachingSkinDefinition) {
  return definition.design?.variants || []
}

export function skinLabDesignState(definition: TeachingSkinDefinition, variantId?: TeachingSkinVariantId) {
  return resolveTeachingSkinDesignRenderState(definition, variantId)
}
