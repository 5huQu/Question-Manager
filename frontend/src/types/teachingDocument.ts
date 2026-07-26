/**
 * TeachingDocumentV1 — 结构化教学文档模型
 *
 * 用于讲义、试卷、练习单的统一内容表示。
 * 设计原则：
 * - 可辨识联合类型块节点
 * - 稳定 id 用于未来编辑和分页引擎
 * - 不保存任意 CSS 字符串
 * - 未知节点/版本不静默丢失
 * - 保留 marks、表格、嵌套结构的扩展空间
 */

// ─── 文档类型 ────────────────────────────────────────────────────────────────

export type TeachingDocumentType = 'worksheet' | 'exam' | 'lecture'

// ─── 行内节点 ────────────────────────────────────────────────────────────────

export interface InlineText {
  type: 'text'
  text: string
  /** 支持的受约束 marks。 */
  marks?: InlineMark[]
  /** 解析旧数据时保留暂不支持的 mark 原值。 */
  unknownMarks?: unknown[]
}

export interface InlineMath {
  type: 'inlineMath'
  latex: string
}

export interface InlineHardBreak {
  type: 'hardBreak'
}

export type InlineMark = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code'

/** 未识别的行内节点：读取异常数据时保留完整原值。 */
export interface UnknownInline {
  type: 'unknown'
  originalType: string
  rawData: unknown
}

export type TeachingInline = InlineText | InlineMath | InlineHardBreak | UnknownInline

// ─── 块节点 ──────────────────────────────────────────────────────────────────

export interface HeadingBlock {
  type: 'heading'
  id: string
  level: 1 | 2 | 3 | 4
  content: TeachingInline[]
}

export interface ParagraphBlock {
  type: 'paragraph'
  id: string
  content: TeachingInline[]
}

export interface BlockMathBlock {
  type: 'blockMath'
  id: string
  latex: string
  /** 可选编号，如 (1)、(2) */
  label?: string
}

export type FigureAlignment = 'left' | 'center' | 'right'

/**
 * 稳定资源引用：持久化数据不应依赖可变文件路径。
 * - questionFigure: 引用题库题目的图片（通过 questionId + figureId 定位）
 * - documentAsset: 引用文档级上传资源（通过 assetId 定位）
 * - legacyPath: 兼容已有实验数据中的相对路径
 */
export type FigureAssetRef =
  | { type: 'questionFigure'; questionId: string; figureId: string }
  | { type: 'documentAsset'; assetId: string }
  | { type: 'legacyPath'; path: string }

export interface FigureBlock {
  type: 'figure'
  id: string
  /** 稳定资源引用（不保存 base64，不复制文件） */
  asset: FigureAssetRef
  alt?: string
  alignment: FigureAlignment
  /** 宽度比例 0.1 ~ 1.0，相对于内容区域 */
  widthRatio?: number
  caption?: string
}

export interface QuestionDisplayOptions {
  showAnswer?: boolean
  showAnalysis?: boolean
  /** 覆盖题库中的分值 */
  scoreOverride?: number
  /** 覆盖题号显示 */
  displayNumber?: string
}

export interface QuestionBlock {
  type: 'question'
  id: string
  /** 引用题库 question_bank_items.id */
  questionId: string
  display?: QuestionDisplayOptions
}

export type BoxBreakBehavior = 'auto' | 'avoid' | 'allow' | 'force-before'

export interface BoxBlock {
  type: 'box'
  id: string
  /** 引用盒子模板注册表中的 templateId */
  templateId: string
  title?: string
  /** 语义图标标记，如 "lightbulb"、"alert" */
  icon?: string
  breakBehavior: BoxBreakBehavior
  /** 盒子子内容：允许段落、公式、图片、题目，但不允许嵌套盒子 */
  children: BoxChildBlock[]
}

/** 盒子内允许的子块类型（不包含 BoxBlock 本身，避免无限递归） */
export type BoxChildBlock =
  | ParagraphBlock
  | BlockMathBlock
  | FigureBlock
  | QuestionBlock
  | DividerBlock
  | SpacerBlock
  | UnknownBlock

export interface DividerBlock {
  type: 'divider'
  id: string
}

export interface SpacerBlock {
  type: 'spacer'
  id: string
  /** 留白高度（em 单位），受约束 0.5 ~ 8 */
  heightEm: number
}

export interface PageBreakBlock {
  type: 'pageBreak'
  id: string
}

export interface RawMarkdownBlock {
  type: 'rawMarkdown'
  id: string
  markdown: string
  /** 保留原因：降级展示或用户主动插入 */
  reason?: 'fallback' | 'user-inserted' | 'unsupported-structure'
}

/** 未知块：反序列化时遇到未识别 type 时保留原始数据 */
export interface UnknownBlock {
  type: 'unknown'
  id: string
  /** 原始 type 值 */
  originalType: string
  /** 原始 JSON 值；允许保留 null、字符串等异常节点。 */
  rawData: unknown
}

// ─── 块联合类型 ──────────────────────────────────────────────────────────────

export type TeachingBlock =
  | HeadingBlock
  | ParagraphBlock
  | BlockMathBlock
  | FigureBlock
  | QuestionBlock
  | BoxBlock
  | DividerBlock
  | SpacerBlock
  | PageBreakBlock
  | RawMarkdownBlock
  | UnknownBlock

// ─── 文档顶层 ────────────────────────────────────────────────────────────────

export interface TeachingDocumentV1 {
  version: 1
  documentType: TeachingDocumentType
  title: string
  metadata: Record<string, unknown>
  content: TeachingBlock[]
}

/** 顶层文档联合：未来版本扩展 */
export type TeachingDocument = TeachingDocumentV1

// ─── 验证结果 ────────────────────────────────────────────────────────────────

export interface DocumentValidationIssue {
  level: 'error' | 'warning'
  blockId?: string
  code: string
  message: string
}

export interface DocumentValidationResult {
  valid: boolean
  issues: DocumentValidationIssue[]
}
