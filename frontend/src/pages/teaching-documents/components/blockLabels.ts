/**
 * 编辑器用户视角标签
 * 将开发语意映射为面向用户的自然表达
 */

import type { TeachingBlock } from '@/types/teachingDocument'

/** 用户视角的内容类型名称 */
export const USER_BLOCK_LABEL: Record<TeachingBlock['type'], string> = {
  heading: '章节',
  paragraph: '文本内容',
  blockMath: '公式',
  table: '表格',
  figure: '图片',
  tikz: 'TikZ 绘图',
  question: '题目',
  box: '知识卡片',
  divider: '分隔线',
  spacer: '留白',
  pageBreak: '换页',
  rawMarkdown: '混合内容',
  unknown: '未知内容',
}

/** 可插入的类型（用户视角排序：常用在前；rawMarkdown 为迁移兜底，不在菜单暴露） */
export const INSERTABLE_TYPES: TeachingBlock['type'][] = [
  'paragraph', 'pageBreak', 'heading', 'blockMath', 'table', 'question', 'box',
  'figure', 'divider', 'spacer',
  'tikz',
]

/** 知识卡片内允许的子内容类型（rawMarkdown 由“合并为混合内容”产生，不在菜单暴露） */
export const CARD_CHILD_TYPES: TeachingBlock['type'][] = [
  'paragraph', 'blockMath', 'table', 'question', 'figure', 'tikz', 'divider', 'spacer',
]
