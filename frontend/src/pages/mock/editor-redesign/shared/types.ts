/**
 * Mock 内部类型定义
 * 简化真实 TeachingDocumentV1 结构用于 UI 原型展示
 */

export type MockBlockType =
  | 'heading'
  | 'paragraph'
  | 'blockMath'
  | 'figure'
  | 'question'
  | 'box'
  | 'divider'
  | 'spacer'
  | 'pageBreak'
  | 'rawMarkdown'

export interface MockBlock {
  id: string
  type: MockBlockType
  /** heading level */
  level?: 1 | 2 | 3 | 4
  /** text content for heading/paragraph */
  text?: string
  /** latex for blockMath */
  latex?: string
  /** markdown for rawMarkdown */
  markdown?: string
  /** figure placeholder label */
  figureLabel?: string
  /** question display number */
  questionNo?: string
  /** box template id */
  templateId?: string
  /** box title */
  boxTitle?: string
  /** box children */
  children?: MockBlock[]
  /** spacer height em */
  heightEm?: number
}

export interface MockDocument {
  title: string
  documentType: 'lecture' | 'worksheet' | 'exam'
  blocks: MockBlock[]
}

export interface MockPage {
  index: number
  blocks: MockBlock[]
}

export const BLOCK_LABEL: Record<MockBlockType, string> = {
  heading: '标题',
  paragraph: '段落',
  blockMath: '块公式',
  figure: '图片',
  question: '题目',
  box: '盒子',
  divider: '分隔线',
  spacer: '留白',
  pageBreak: '分页标记',
  rawMarkdown: 'Markdown',
}

export const INSERTABLE_TYPES: MockBlockType[] = [
  'heading', 'paragraph', 'blockMath', 'box', 'question', 'figure',
  'divider', 'spacer', 'pageBreak', 'rawMarkdown',
]
