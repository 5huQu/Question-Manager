/**
 * 编辑器用户视角标签
 * 将开发语意映射为面向用户的自然表达
 */

import type { TeachingBlock } from '@/types/teachingDocument'

/** 用户视角的内容类型名称 */
export const USER_BLOCK_LABEL: Record<TeachingBlock['type'], string> = {
  heading: '章节',
  paragraph: '段落',
  blockMath: '公式',
  figure: '图片',
  question: '题目',
  box: '知识卡片',
  divider: '分隔线',
  spacer: '留白',
  pageBreak: '换页',
  rawMarkdown: '自由文本',
  unknown: '未知内容',
}

/** 可插入的类型（用户视角排序：常用在前） */
export const INSERTABLE_TYPES: TeachingBlock['type'][] = [
  'paragraph', 'pageBreak', 'heading', 'blockMath', 'question', 'box',
  'figure', 'divider', 'spacer', 'rawMarkdown',
]

/** 知识卡片内允许的子内容类型 */
export const CARD_CHILD_TYPES: TeachingBlock['type'][] = [
  'paragraph', 'blockMath', 'question', 'figure', 'divider', 'spacer',
]
