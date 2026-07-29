/**
 * 盒子模板注册表
 *
 * 设计原则：
 * - BoxBlock 只保存 templateId，不保存完整颜色/边框/阴影/CSS
 * - 视觉信息集中在注册表和样式文件中
 * - 模板具有稳定 ID 和版本号
 * - 方便后续增加模板、主题和用户自定义模板
 */

export const BOX_TEMPLATE_ICON_NAMES = [
  'BookOpen',
  'Lightbulb',
  'PenLine',
  'AlertTriangle',
  'Pencil',
  'ListChecks',
  'Box',
] as const

export type BoxTemplateIconName = typeof BOX_TEMPLATE_ICON_NAMES[number]

export interface BoxTemplateDefinition {
  /** 稳定模板 ID */
  id: string
  /** 模板版本号 */
  version: number
  /** 显示名称 */
  label: string
  /** 语义描述 */
  description: string
  /** 默认图标（lucide icon name） */
  defaultIcon: BoxTemplateIconName
  /** 语义色调标记，用于 CSS 变量映射 */
  tone: 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet'
  /** 是否默认显示标题栏 */
  showHeader: boolean
}

// ─── 内置模板 ────────────────────────────────────────────────────────────────

export const BUILTIN_BOX_TEMPLATES: readonly BoxTemplateDefinition[] = [
  {
    id: 'plain',
    version: 1,
    label: '文本框',
    description: '无标题栏的普通内容容器',
    defaultIcon: 'Box',
    tone: 'neutral',
    showHeader: false,
  },
  {
    id: 'concept',
    version: 1,
    label: '定义 / 知识点',
    description: '用于展示核心概念、定义、定理等知识要点',
    defaultIcon: 'BookOpen',
    tone: 'blue',
    showHeader: true,
  },
  {
    id: 'method',
    version: 1,
    label: '方法 / 技巧',
    description: '用于归纳解题方法、技巧和策略',
    defaultIcon: 'Lightbulb',
    tone: 'violet',
    showHeader: true,
  },
  {
    id: 'example',
    version: 1,
    label: '例题',
    description: '用于展示典型例题及其解答过程',
    defaultIcon: 'PenLine',
    tone: 'green',
    showHeader: true,
  },
  {
    id: 'warning',
    version: 1,
    label: '易错提醒',
    description: '用于标注常见错误、易混淆点和注意事项',
    defaultIcon: 'AlertTriangle',
    tone: 'amber',
    showHeader: true,
  },
  {
    id: 'practice',
    version: 1,
    label: '课堂练习',
    description: '用于嵌入随堂练习题和即时训练',
    defaultIcon: 'Pencil',
    tone: 'neutral',
    showHeader: true,
  },
  {
    id: 'summary',
    version: 1,
    label: '本节小结',
    description: '用于章节末尾的知识回顾与要点总结',
    defaultIcon: 'ListChecks',
    tone: 'green',
    showHeader: true,
  },
] as const

// ─── 注册表 ──────────────────────────────────────────────────────────────────

const templateRegistry = new Map<string, BoxTemplateDefinition>()

for (const template of BUILTIN_BOX_TEMPLATES) {
  templateRegistry.set(template.id, template)
}

/** 查询模板定义。未注册时返回 undefined。 */
export function getBoxTemplate(templateId: string): BoxTemplateDefinition | undefined {
  return templateRegistry.get(templateId)
}

/** 查询模板定义，未注册时返回通用降级模板。 */
export function getBoxTemplateOrFallback(templateId: string): BoxTemplateDefinition {
  return templateRegistry.get(templateId) ?? FALLBACK_TEMPLATE
}

/** 获取所有已注册模板 */
export function getAllBoxTemplates(): BoxTemplateDefinition[] {
  return Array.from(templateRegistry.values())
}

/**
 * 注册自定义模板（运行时扩展）。
 * 如果 ID 已存在且版本不高于现有版本，则忽略。
 */
export function registerBoxTemplate(template: BoxTemplateDefinition): boolean {
  if (!template.id.trim() || !Number.isInteger(template.version) || template.version < 1) return false
  if (!BOX_TEMPLATE_ICON_NAMES.includes(template.defaultIcon)) return false
  const existing = templateRegistry.get(template.id)
  if (existing && existing.version >= template.version) return false
  templateRegistry.set(template.id, template)
  return true
}

/** 重置注册表为内置模板（主要用于测试） */
export function resetBoxTemplateRegistry(): void {
  templateRegistry.clear()
  for (const template of BUILTIN_BOX_TEMPLATES) {
    templateRegistry.set(template.id, template)
  }
}

// ─── 降级模板 ────────────────────────────────────────────────────────────────

const FALLBACK_TEMPLATE: BoxTemplateDefinition = {
  id: '__fallback__',
  version: 1,
  label: '通用盒子',
  description: '未识别模板的降级展示',
  defaultIcon: 'Box',
  tone: 'neutral',
  showHeader: true,
}

// ─── CSS 变量映射辅助 ────────────────────────────────────────────────────────

export interface BoxToneStyle {
  /** 边框颜色 CSS 变量 */
  borderColor: string
  /** 标题栏背景 CSS 变量 */
  headerBg: string
  /** 内容区背景 CSS 变量 */
  bodyBg: string
  /** 图标/强调色 CSS 变量 */
  accentColor: string
}

/**
 * 色调 → CSS 变量映射。
 * 渲染器通过 data-tone 属性 + CSS 文件实现样式，
 * 此函数仅供需要内联样式降级时使用。
 */
export function toneStyleVariables(tone: BoxTemplateDefinition['tone']): BoxToneStyle {
  const map: Record<BoxTemplateDefinition['tone'], BoxToneStyle> = {
    neutral: {
      borderColor: 'var(--box-neutral-border, #e4e4e7)',
      headerBg: 'var(--box-neutral-header, #fafafa)',
      bodyBg: 'var(--box-neutral-body, #ffffff)',
      accentColor: 'var(--box-neutral-accent, #71717a)',
    },
    blue: {
      borderColor: 'var(--box-blue-border, #bfdbfe)',
      headerBg: 'var(--box-blue-header, #eff6ff)',
      bodyBg: 'var(--box-blue-body, #ffffff)',
      accentColor: 'var(--box-blue-accent, #2563eb)',
    },
    green: {
      borderColor: 'var(--box-green-border, #bbf7d0)',
      headerBg: 'var(--box-green-header, #f0fdf4)',
      bodyBg: 'var(--box-green-body, #ffffff)',
      accentColor: 'var(--box-green-accent, #16a34a)',
    },
    amber: {
      borderColor: 'var(--box-amber-border, #fde68a)',
      headerBg: 'var(--box-amber-header, #fffbeb)',
      bodyBg: 'var(--box-amber-body, #ffffff)',
      accentColor: 'var(--box-amber-accent, #d97706)',
    },
    red: {
      borderColor: 'var(--box-red-border, #fecaca)',
      headerBg: 'var(--box-red-header, #fef2f2)',
      bodyBg: 'var(--box-red-body, #ffffff)',
      accentColor: 'var(--box-red-accent, #dc2626)',
    },
    violet: {
      borderColor: 'var(--box-violet-border, #ddd6fe)',
      headerBg: 'var(--box-violet-header, #f5f3ff)',
      bodyBg: 'var(--box-violet-body, #ffffff)',
      accentColor: 'var(--box-violet-accent, #7c3aed)',
    },
  }
  return map[tone] ?? map.neutral
}
