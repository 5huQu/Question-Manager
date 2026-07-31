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

import type { QuestionContentDraft } from './questionContent'
import type { PaperOrientation, PaperSize } from '@/utils/teachingDocument/layout/types'
import type { FigureLayoutPreset } from '@/utils/teachingDocument/figureLayoutPresets'
export type { FigureLayoutPreset } from '@/utils/teachingDocument/figureLayoutPresets'

// ─── 文档类型 ────────────────────────────────────────────────────────────────

export type TeachingDocumentType = 'worksheet' | 'exam' | 'lecture'

// ─── 行内节点 ────────────────────────────────────────────────────────────────

export interface InlineText {
  type: 'text'
  text: string
  /** 支持的受约束 marks。 */
  marks?: InlineMark[]
  /** 行内字体覆盖，存字体 id（见 lectureFonts TEXT_FONT_OPTIONS）；缺省 = 继承文档默认字体。 */
  font?: string
  /** 行内文字颜色，保存为受校验的 #RRGGBB；缺省 = 继承文档颜色。 */
  color?: string
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
  /** 单个标题对文档编号规则的受控覆盖。 */
  numbering?: HeadingNumberingOverride
}

export type HeadingNumberingMode = 'inherit' | 'none' | 'manual'
export type HeadingNumberingStyle = 'arabic' | 'chinese' | 'roman-upper' | 'alpha-upper'
export type TeachingDocumentOutlinePreset =
  | 'textbook'
  | 'decimal'
  | 'chinese'
  | 'exam'
  | 'chapter-chinese'
  | 'chapter-decimal'
  | 'chapter-section'
  | 'roman'
  | 'paren'
  | 'none'

export interface HeadingNumberingOverride {
  mode?: HeadingNumberingMode
  /** mode=manual 时显示的纯文本标签。 */
  manualLabel?: string
  /** 从当前标题开始的计数值；只接受正整数。 */
  restartAt?: number
}

export interface HeadingNumberLevelOptions {
  style?: HeadingNumberingStyle
  /** 仅允许 {n}、{cn}、{parent}、{path} 占位符。 */
  template?: string
  includeParents?: boolean
}

export interface TeachingDocumentOutlineOptions {
  /** 旧文档缺省关闭，避免打开后改变既有版面。 */
  numberingEnabled?: boolean
  preset?: TeachingDocumentOutlinePreset
  levels?: Partial<Record<1 | 2 | 3 | 4, HeadingNumberLevelOptions>>
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

/** 可视化表格单元格，复用正文块的行内文字与 LaTeX 能力。 */
export interface TableCell {
  content: TeachingInline[]
}

/** 首版表格为不可拆分的整体块；长表跨页能力后续单独演进。 */
export interface TableBlock {
  type: 'table'
  id: string
  rows: TableCell[][]
  hasHeader?: boolean
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

export interface FigureGroupItem {
  id: string
  asset: FigureAssetRef
  caption?: string
  alt?: string
}

export interface FigureBlock {
  type: 'figure'
  id: string
  /** 稳定资源引用（不保存 base64，不复制文件） */
  asset: FigureAssetRef
  alt?: string
  alignment: FigureAlignment
  /** 受控图片排版预设；缺省时使用旧 alignment/width 字段。 */
  layoutPreset?: FigureLayoutPreset
  /** 宽度比例 0.1 ~ 1.0，相对于内容区域（旧数据兼容） */
  widthRatio?: number
  /** 物理宽度 mm；优先级高于 widthRatio */
  widthMm?: number
  /** 是否锁定宽高比（默认 true） */
  lockAspectRatio?: boolean
  caption?: string
  /** 存在时作为多图网格渲染；asset 保留为旧数据与单图兼容入口。 */
  groupItems?: FigureGroupItem[]
  groupColumns?: 1 | 2 | 3
  groupGapMm?: number
}

/** 受控 TikZ 源码及其最近一次成功生成的 SVG。编译中的状态不持久化。 */
export interface TikzBlock {
  type: 'tikz'
  id: string
  source: string
  sourceHash?: string
  svgAssetId?: string
  alignment: FigureAlignment
  /** 与普通图片共用的受控排版预设。 */
  layoutPreset?: FigureLayoutPreset
  widthMm?: number
  alt?: string
  caption?: string
}

export type QuestionFigureSlot =
  | 'stem-start'
  | 'stem-end'
  | 'before-options'
  | 'after-options'
  | 'before-answer'
  | 'after-answer'
  | 'analysis-start'
  | 'analysis-end'

export interface QuestionFigurePlacement {
  widthMm?: number
  alignment?: FigureAlignment
  layoutPreset?: FigureLayoutPreset
  slot?: QuestionFigureSlot
  order?: number
}

export interface QuestionInsertedFigure extends QuestionFigurePlacement {
  id: string
  asset: FigureAssetRef
  slot: QuestionFigureSlot
  order: number
  caption?: string
  alt?: string
}

export interface QuestionDisplayOptions {
  showAnswer?: boolean
  showAnalysis?: boolean
  /** 是否显示每题分数（默认不显示） */
  showScore?: boolean
  /** 覆盖题库中的分值 */
  scoreOverride?: number
  /** 覆盖题号显示 */
  displayNumber?: string
  /** 内部标记：编号由当前文档顺序自动生成，属性面板不显示为用户自定义值。 */
  displayNumberAuto?: boolean
  /** 题目回答留空 */
  answerSpace?: {
    heightMm: number
    style: 'blank' | 'lines' | 'grid'
    /** 超出当前页可用空间的部分不延续到下一页。 */
    splitAcrossPages?: boolean
  }
  /** 题目级图片尺寸覆盖，key 为 figure id */
  figureOverrides?: Record<string, QuestionFigurePlacement>
  /** 仅属于当前文档的题目插图，不写回题库。 */
  insertedFigures?: QuestionInsertedFigure[]
}

/** 题目分页策略：默认自动流动；avoid 保持整题；force-before 从新页开始。 */
export type QuestionBreakBehavior = 'auto' | 'avoid' | 'force-before'

export interface QuestionBlock {
  type: 'question'
  id: string
  /** 引用题库 question_bank_items.id */
  questionId: string
  /** 缺省 auto：按题干行、选项区域等安全边界自动跨页。 */
  breakBehavior?: QuestionBreakBehavior
  display?: QuestionDisplayOptions
  /** 文档本地题目内容覆盖；不回填题库时保存于此，渲染优先于题库 */
  localContent?: QuestionContentDraft
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
  /** 盒子子内容：允许段落、公式、表格、图片、题目，但不允许嵌套盒子 */
  children: BoxChildBlock[]
}

/** 盒子内允许的子块类型（不包含 BoxBlock 本身，避免无限递归） */
export type BoxChildBlock =
  | ParagraphBlock
  | BlockMathBlock
  | TableBlock
  | FigureBlock
  | TikzBlock
  | QuestionBlock
  | DividerBlock
  | SpacerBlock
  | RawMarkdownBlock
  | UnknownBlock

export interface DividerBlock {
  type: 'divider'
  id: string
}

export interface SpacerBlock {
  type: 'spacer'
  id: string
  /** 留白高度（em 单位），受约束 0.5 ~ 8（旧数据兼容） */
  heightEm: number
  /** 物理高度 mm；优先级高于 heightEm */
  heightMm?: number
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
  | TableBlock
  | FigureBlock
  | TikzBlock
  | QuestionBlock
  | BoxBlock
  | DividerBlock
  | SpacerBlock
  | PageBreakBlock
  | RawMarkdownBlock
  | UnknownBlock

// ─── 文档顶层 ────────────────────────────────────────────────────────────────

export type TeachingMarginPreset = 'compact' | 'normal' | 'relaxed'
/** 文档内相邻题目的垂直间距。 */
export type TeachingQuestionSpacing = 'compact' | 'normal' | 'relaxed'

export type PrintChromeSlotPosition = 'left' | 'center' | 'right'
export type PrintChromeContentType = 'none' | 'customText' | 'documentTitle' | 'documentType' | 'pageNumber' | 'totalPages' | 'date'
export type PrintChromeAlignment = 'left' | 'center' | 'right'
export type PrintPageNumberFormat = 'number' | 'page' | 'fraction' | 'page-total' | 'dash'
/** 页眉页脚允许使用的受控字体；inherit 跟随文档正文字体。 */
export type PrintChromeFont = 'inherit' | 'songti' | 'heiti' | 'kaiti' | 'fangsong' | 'times' | 'georgia' | 'arial'
/** 受控字号（px），避免任意 CSS 值影响分页稳定性。 */
export type PrintChromeFontSize = 8 | 9 | 10 | 11 | 12 | 14

/** 受控的页眉/页脚栏位；禁止存入 HTML 或 CSS。 */
export interface PrintChromeSlot {
  type: PrintChromeContentType
  text?: string
  align?: PrintChromeAlignment
  font?: PrintChromeFont
  fontSize?: PrintChromeFontSize
  bold?: boolean
  italic?: boolean
}

export type PrintChromeSlots = Record<PrintChromeSlotPosition, PrintChromeSlot>

export interface PrintChromeSectionOptions {
  left?: PrintChromeSlot
  center?: PrintChromeSlot
  right?: PrintChromeSlot
}

export interface PrintPageNumberOptions {
  format?: PrintPageNumberFormat
  prefix?: string
  suffix?: string
  /** false 时所有含总页数的模板安全回退为仅显示当前页。 */
  showTotalPages?: boolean
}

/**
 * 文档级打印版式偏好。所有字段均可选，缺省时回退到打印默认值，
 * 以兼容已有文档并避免把展示配置混入内容块。
 */
export interface TeachingDocumentPrintOptions {
  headerEnabled?: boolean
  headerShowOnFirstPage?: boolean
  footerEnabled?: boolean
  header?: PrintChromeSectionOptions
  footer?: PrintChromeSectionOptions
  pageNumber?: PrintPageNumberOptions
  /** 文档标题下方的类型标识，例如“试卷”。 */
  showDocumentType?: boolean
  /** @deprecated 旧文档字段，解析时迁移为 header 三栏配置。 */
  headerShowTitle?: boolean
  /** @deprecated 旧文档字段，解析时迁移为 header 三栏配置。 */
  headerSubtitle?: string
  /** @deprecated 旧文档字段，解析时迁移为 footer 三栏配置。 */
  footerShowPageNumber?: boolean
  /** @deprecated 旧文档字段，解析时迁移为 pageNumber 配置。 */
  footerShowTotalPages?: boolean
  /** @deprecated 旧文档字段，解析时迁移为 footer 三栏配置。 */
  footerCustomText?: string
}

/**
 * 文档级纸张选项。所有字段均可选，缺省时回退到 A4 portrait + normal margins，
 * 以兼容旧文档（无 style.paper 字段）。
 */
export interface TeachingDocumentPaperOptions {
  /** 纸张尺寸；缺省 'A4' */
  size?: PaperSize
  /** 纸张方向；缺省 'portrait' */
  orientation?: PaperOrientation
  /** 自定义边距 mm；优先级高于 marginPreset */
  margins?: { topMm: number; rightMm: number; bottomMm: number; leftMm: number }
}

/** 文档级排版预设；未设置表示用户已手动调整为自定义排版。 */
export type TeachingDocumentTypographyPreset = 'exam' | 'lecture'

/**
 * 文档级打印样式：正文/标题字体与页边距的唯一数据源。
 * 编辑视图、A4 预览、PDF 导出均从此读取，保证“所见即所得”（预览与输出一致）。
 * 仅存受约束的 id / 枚举，不存任意 CSS。
 */
export interface TeachingDocumentStyle {
  /** 正式试卷 / 阅读讲义预设；手动调整排版字段后会清除为自定义。 */
  typographyPreset?: TeachingDocumentTypographyPreset
  /** 正文字体 id（见 lectureFonts BODY_FONT_OPTIONS）；缺省 = 默认正文字体 */
  bodyFont?: string
  /** 正文英文与数字字体 id；缺省时跟随 bodyFont，兼容旧文档。 */
  bodyLatinFont?: string
  /** 正文数字字体 id；缺省时跟随 bodyLatinFont。 */
  bodyNumberFont?: string
  /** 标题字体 id（见 lectureFonts HEADING_FONT_OPTIONS）；缺省 = 默认标题字体 */
  headingFont?: string
  /** 章节英文与数字字体 id；编号也使用此字体；缺省时跟随 headingFont。 */
  headingLatinFont?: string
  /** 章节数字字体 id；章节编号优先使用此字体；缺省时跟随 headingLatinFont。 */
  headingNumberFont?: string
  /** 页边距预设（见 MARGIN_PRESETS）；缺省 = normal */
  marginPreset?: TeachingMarginPreset
  /** 题目间距；缺省 compact，适合试卷高密度排版。 */
  questionSpacing?: TeachingQuestionSpacing
  /** 纸张选项（尺寸、方向、自定义边距）；缺省 = A4 portrait */
  paper?: TeachingDocumentPaperOptions
  /** 页眉、页脚及标题区的打印偏好。 */
  print?: TeachingDocumentPrintOptions
}

export interface TeachingDocumentV1 {
  version: 1
  documentType: TeachingDocumentType
  title: string
  metadata: Record<string, unknown>
  content: TeachingBlock[]
  /** 章节结构与自动编号偏好；章节树本身始终由 content 派生。 */
  outline?: TeachingDocumentOutlineOptions
  /** 文档级打印样式（字体、边距）；缺省 = 全部使用默认值 */
  style?: TeachingDocumentStyle
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
