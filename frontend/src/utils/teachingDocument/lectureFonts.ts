/**
 * 讲义文档字体选项
 * 编辑视图、A4 预览与 PDF 打印页共用；字体选择存于文档 style（唯一数据源）。
 */

import type { TeachingDocumentStyle, TeachingDocumentType, TeachingDocumentTypographyPreset, TeachingTextStyle } from '@/types/teachingDocument'

export interface LectureFontOption {
  id: string
  label: string
  /** CSS font-family 值 */
  stack: string
  /** 供 Unicode 范围字体面使用的本机字体名；未提供时回退到普通 font-family。 */
  localNames?: string[]
}

export const BODY_FONT_OPTIONS: LectureFontOption[] = [
  { id: 'songti', label: '思源宋体', stack: '"Noto Serif SC Variable", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif' },
  { id: 'heiti', label: '思源黑体', stack: '"Noto Sans SC Variable", "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'kaiti', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif' },
  { id: 'fangsong', label: '仿宋', stack: '"STFangsong", "FangSong", "Noto Serif CJK SC", serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", "Songti SC", "SimSun", serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", "Songti SC", serif' },
]

export const HEADING_FONT_OPTIONS: LectureFontOption[] = [
  { id: 'heiti', label: '思源黑体', stack: '"Noto Sans SC Variable", "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif' },
  { id: 'songti', label: '思源宋体', stack: '"Noto Serif SC Variable", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif' },
  { id: 'kaiti', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif' },
  { id: 'fangsong', label: '仿宋', stack: '"STFangsong", "FangSong", "Noto Serif CJK SC", serif' },
  { id: 'arial', label: 'Arial', stack: 'Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif' },
]

/** 中文字体选择器使用的选项；旧文档中的 times / arial 仍由上面的兼容列表读取。 */
export const CJK_FONT_OPTIONS: LectureFontOption[] = [
  BODY_FONT_OPTIONS[0], BODY_FONT_OPTIONS[1], BODY_FONT_OPTIONS[2], BODY_FONT_OPTIONS[3],
]

/**
 * 英文与数字字体。字体栈刻意不包含 generic family：在 CSS 中它们排在中文字体
 * 前面，缺字时应继续回退到用户选择的中文字体，而不是提前回退给系统字体。
 */
export const LATIN_FONT_OPTIONS: LectureFontOption[] = [
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", Times', localNames: ['Times New Roman', 'Times'] },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia', localNames: ['Georgia'] },
  { id: 'arial', label: 'Arial', stack: 'Arial, "Helvetica Neue"', localNames: ['Arial', 'Helvetica Neue'] },
  { id: 'cambria', label: 'Cambria', stack: 'Cambria', localNames: ['Cambria'] },
  { id: 'calibri', label: 'Calibri', stack: 'Calibri', localNames: ['Calibri'] },
  { id: 'courier', label: 'Courier New', stack: '"Courier New"', localNames: ['Courier New'] },
]

/**
 * 行内可选字体（Word 式局部改字体的下拉选项）。
 * InlineText.font 存储的是这里的 id；渲染端通过 fontStackById 派生 CSS font-family。
 */
export const TEXT_FONT_OPTIONS: LectureFontOption[] = [
  { id: 'songti', label: '思源宋体', stack: '"Noto Serif SC Variable", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif' },
  { id: 'heiti', label: '思源黑体', stack: '"Noto Sans SC Variable", "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'kaiti', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif' },
  { id: 'fangsong', label: '仿宋', stack: '"STFangsong", "FangSong", "Noto Serif CJK SC", serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", "Songti SC", "SimSun", serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", "Songti SC", serif' },
  { id: 'arial', label: 'Arial', stack: 'Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif' },
]

const DEFAULT_HEADING_STYLES: Record<1 | 2 | 3 | 4, TeachingTextStyle> = {
  1: { fontSize: 24, fontWeight: 700 },
  2: { fontSize: 20, fontWeight: 600 },
  3: { fontSize: 18, fontWeight: 600 },
  4: { fontSize: 16, fontWeight: 500 },
}

/** 返回指定标题级别的最终样式；文档只保存用户覆盖字段。 */
export function resolveHeadingStyle(style: TeachingDocumentStyle | undefined, level: 1 | 2 | 3 | 4): TeachingTextStyle {
  return { ...DEFAULT_HEADING_STYLES[level], ...(style?.headingStyles?.[level] || {}) }
}

/** 返回当前文档题目的局部覆盖；未设置时由渲染器保留现有题目默认排版。 */
export function resolveQuestionStyle(style: TeachingDocumentStyle | undefined): TeachingTextStyle {
  return { ...(style?.questionStyle || {}) }
}

function textStyleCssVars(style: TeachingTextStyle, prefix: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const stack = fontStackById(style.font)
  if (stack) vars[`${prefix}-font`] = stack
  if (style.fontSize) vars[`${prefix}-size`] = `${style.fontSize}px`
  if (style.color) vars[`${prefix}-color`] = style.color
  if (style.fontWeight) vars[`${prefix}-weight`] = String(style.fontWeight)
  if (style.italic !== undefined) vars[`${prefix}-style`] = style.italic ? 'italic' : 'normal'
  return vars
}

/** 生成编辑器、预览和打印页共同使用的章节/题目样式变量。 */
export function teachingTypographyCssVars(style?: TeachingDocumentStyle): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const level of [1, 2, 3, 4] as const) {
    Object.assign(vars, textStyleCssVars(style?.headingStyles?.[level] || {}, `--td-heading-${level}`))
  }
  const questionStyle = resolveQuestionStyle(style)
  Object.assign(vars, textStyleCssVars(questionStyle, '--td-question'))
  return vars
}

/**
 * 影响分页的文档级排版变量。展示预览、隐藏测量树和独立打印页必须使用同一份值，
 * 否则“题目间距”会只在编辑页生效，造成所见与打印分页不同。
 */
export function teachingDocumentLayoutCssVars(style?: TeachingDocumentStyle): Record<string, string> {
  const questionSpacing = style?.questionSpacing || 'compact'
  return {
    ...teachingTypographyCssVars(style),
    '--td-question-gap': {
      compact: '6px',
      normal: '12px',
      relaxed: '18px',
    }[questionSpacing],
  }
}

/** 由字体 id 查 CSS font-family 栈；未知 id 返回 undefined，渲染端回退默认字体。 */
export function fontStackById(id: string | undefined): string | undefined {
  if (!id) return undefined
  return TEXT_FONT_OPTIONS.find((option) => option.id === id)?.stack
}

export const TYPOGRAPHY_PRESETS: Record<TeachingDocumentTypographyPreset, {
  label: string
  description: string
  style: Required<Pick<TeachingDocumentStyle, 'bodyFont' | 'bodyLatinFont' | 'bodyNumberFont' | 'headingFont' | 'headingLatinFont' | 'headingNumberFont' | 'marginPreset' | 'questionSpacing' | 'typographyPreset'>>
}> = {
  exam: {
    label: '正式试卷',
    description: '紧凑页边距与题目间距，适合测验、作业和考试。',
    style: {
      typographyPreset: 'exam', bodyFont: 'songti', bodyLatinFont: 'times', bodyNumberFont: 'times',
      headingFont: 'heiti', headingLatinFont: 'arial', headingNumberFont: 'times', marginPreset: 'compact', questionSpacing: 'compact',
    },
  },
  lecture: {
    label: '阅读讲义',
    description: '保留舒展留白，适合知识讲解、例题和推导。',
    style: {
      typographyPreset: 'lecture', bodyFont: 'songti', bodyLatinFont: 'georgia', bodyNumberFont: 'times',
      headingFont: 'heiti', headingLatinFont: 'arial', headingNumberFont: 'times', marginPreset: 'normal', questionSpacing: 'normal',
    },
  },
}

/** 新建文档按用途填入预设；练习单沿用正式试卷的紧凑排版。 */
export function typographyPresetForDocumentType(documentType: TeachingDocumentType): TeachingDocumentTypographyPreset {
  return documentType === 'lecture' ? 'lecture' : 'exam'
}

export function typographyStyleForPreset(preset: TeachingDocumentTypographyPreset): TeachingDocumentStyle {
  return { ...TYPOGRAPHY_PRESETS[preset].style }
}

/**
 * 从文档级样式解析出正文/标题字体选项。
 * 未知或缺省 id 回退到各自列表首项（即默认字体）。
 * 这是编辑视图、A4 预览、PDF 打印页共用的唯一字体解析入口，
 * 保证三处“所见即所得”。
 */
export function resolveDocumentFonts(style?: TeachingDocumentStyle): {
  body: LectureFontOption
  bodyLatin: LectureFontOption
  bodyNumber: LectureFontOption
  heading: LectureFontOption
  headingLatin: LectureFontOption
  headingNumber: LectureFontOption
} {
  const body = findFontById(BODY_FONT_OPTIONS, style?.bodyFont ?? null) || BODY_FONT_OPTIONS[0]
  const heading = findFontById(HEADING_FONT_OPTIONS, style?.headingFont ?? null) || HEADING_FONT_OPTIONS[0]
  return {
    body,
    // 老文档未设置 Latin 字段时维持原来的完整 font stack，避免版式突变。
    bodyLatin: findFontById(LATIN_FONT_OPTIONS, style?.bodyLatinFont ?? null) || body,
    bodyNumber: findFontById(LATIN_FONT_OPTIONS, style?.bodyNumberFont ?? null)
      || findFontById(LATIN_FONT_OPTIONS, style?.bodyLatinFont ?? null)
      || body,
    heading,
    headingLatin: findFontById(LATIN_FONT_OPTIONS, style?.headingLatinFont ?? null) || heading,
    headingNumber: findFontById(LATIN_FONT_OPTIONS, style?.headingNumberFont ?? null)
      || findFontById(LATIN_FONT_OPTIONS, style?.headingLatinFont ?? null)
      || heading,
  }
}

/** 生成注入预览/打印容器的 CSS 变量样式 */
export function lectureFontCssVars(
  body: LectureFontOption,
  heading: LectureFontOption,
  bodyLatin: LectureFontOption = body,
  headingLatin: LectureFontOption = heading,
  bodyNumber: LectureFontOption = bodyLatin,
  headingNumber: LectureFontOption = headingLatin,
): Record<string, string> {
  return {
    '--td-body-font': `"td-body-number", "td-body-latin", ${body.stack}`,
    '--td-heading-font': `"td-heading-number", "td-heading-latin", ${heading.stack}`,
    // 编号在非编辑 renderer 中是独立 span，在 Tiptap 中则是 ::before；显式
    // 使用该变量，确保两条渲染链路都与章节字体和英文/数字字体保持一致。
    '--td-heading-number-font': `"td-heading-number", "td-heading-latin", ${heading.stack}`,
  }
}

const LATIN_UNICODE_RANGE = 'U+0041-005A, U+0061-007A, U+00C0-024F'
const NUMBER_UNICODE_RANGE = 'U+0030-0039, U+FF10-FF19'

/**
 * 英文和数字都可能被同一字体覆盖，单靠 font-family 无法把二者分开。使用受控
 * @font-face + unicode-range 将三类字符路由到各自字体，未命中时自然回退中文字体。
 */
export function lectureFontFaceCss(
  bodyLatin: LectureFontOption,
  bodyNumber: LectureFontOption,
  headingLatin: LectureFontOption,
  headingNumber: LectureFontOption,
) {
  const face = (family: string, option: LectureFontOption, range: string) => {
    if (!option.localNames?.length) return ''
    const sources = option.localNames.map((name) => `local("${name.replaceAll('"', '\\"')}")`).join(', ')
    // 打印前会等待 document.fonts.ready。使用 block 可避免 Windows 上先按回退字
    // 体测量、随后切换本机字体而导致分页快照失效。
    return `@font-face{font-family:"${family}";src:${sources};unicode-range:${range};font-display:block;}`
  }
  return [
    face('td-body-latin', bodyLatin, LATIN_UNICODE_RANGE),
    face('td-body-number', bodyNumber, NUMBER_UNICODE_RANGE),
    face('td-heading-latin', headingLatin, LATIN_UNICODE_RANGE),
    face('td-heading-number', headingNumber, NUMBER_UNICODE_RANGE),
  ].join('')
}

function findFontById(options: LectureFontOption[], id: string | null): LectureFontOption | undefined {
  return options.find((option) => option.id === id)
}
