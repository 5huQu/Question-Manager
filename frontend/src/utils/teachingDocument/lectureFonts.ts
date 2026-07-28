/**
 * 讲义文档字体选项
 * 编辑视图、A4 预览与 PDF 打印页共用；字体选择存于文档 style（唯一数据源）。
 */

import type { TeachingDocumentStyle } from '@/types/teachingDocument'

export interface LectureFontOption {
  id: string
  label: string
  /** CSS font-family 值 */
  stack: string
}

export const BODY_FONT_OPTIONS: LectureFontOption[] = [
  { id: 'songti', label: '宋体', stack: '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", serif' },
  { id: 'heiti', label: '黑体', stack: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
  { id: 'kaiti', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif' },
  { id: 'fangsong', label: '仿宋', stack: '"STFangsong", "FangSong", "Noto Serif CJK SC", serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", "Songti SC", "SimSun", serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", "Songti SC", serif' },
]

export const HEADING_FONT_OPTIONS: LectureFontOption[] = [
  { id: 'heiti', label: '黑体', stack: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif' },
  { id: 'songti', label: '宋体', stack: '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif' },
  { id: 'kaiti', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif' },
  { id: 'arial', label: 'Arial', stack: 'Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif' },
]

/**
 * 行内可选字体（Word 式局部改字体的下拉选项）。
 * InlineText.font 存储的是这里的 id；渲染端通过 fontStackById 派生 CSS font-family。
 */
export const TEXT_FONT_OPTIONS: LectureFontOption[] = [
  { id: 'songti', label: '宋体', stack: '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", serif' },
  { id: 'heiti', label: '黑体', stack: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
  { id: 'kaiti', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif' },
  { id: 'fangsong', label: '仿宋', stack: '"STFangsong", "FangSong", "Noto Serif CJK SC", serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", "Songti SC", "SimSun", serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", "Songti SC", serif' },
  { id: 'arial', label: 'Arial', stack: 'Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif' },
]

/** 由字体 id 查 CSS font-family 栈；未知 id 返回 undefined，渲染端回退默认字体。 */
export function fontStackById(id: string | undefined): string | undefined {
  if (!id) return undefined
  return TEXT_FONT_OPTIONS.find((option) => option.id === id)?.stack
}

/**
 * 从文档级样式解析出正文/标题字体选项。
 * 未知或缺省 id 回退到各自列表首项（即默认字体）。
 * 这是编辑视图、A4 预览、PDF 打印页共用的唯一字体解析入口，
 * 保证三处“所见即所得”。
 */
export function resolveDocumentFonts(style?: TeachingDocumentStyle): { body: LectureFontOption; heading: LectureFontOption } {
  return {
    body: findFontById(BODY_FONT_OPTIONS, style?.bodyFont ?? null) || BODY_FONT_OPTIONS[0],
    heading: findFontById(HEADING_FONT_OPTIONS, style?.headingFont ?? null) || HEADING_FONT_OPTIONS[0],
  }
}

/** 生成注入预览/打印容器的 CSS 变量样式 */
export function lectureFontCssVars(body: LectureFontOption, heading: LectureFontOption): Record<string, string> {
  return {
    '--td-body-font': body.stack,
    '--td-heading-font': heading.stack,
  }
}

function findFontById(options: LectureFontOption[], id: string | null): LectureFontOption | undefined {
  return options.find((option) => option.id === id)
}
