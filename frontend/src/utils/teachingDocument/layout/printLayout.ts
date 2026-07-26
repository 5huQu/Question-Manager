import { CSS_PIXELS_PER_MM } from './paper'
import type { PaperMetrics, PaperSpec } from './types'

// ─── Print Layout Spec ────────────────────────────────────────────────────────

export interface PrintHeaderSpec {
  enabled: boolean
  /** 文档标题（默认取 document.title） */
  showTitle: boolean
  /** 可选副标题或章节 */
  subtitle?: string
  /** 首页是否显示页眉 */
  showOnFirstPage: boolean
  /** 页眉区域高度 mm */
  heightMm: number
}

export interface PrintFooterSpec {
  enabled: boolean
  /** 显示当前页码 */
  showPageNumber: boolean
  /** 显示总页数 */
  showTotalPages: boolean
  /** 可选自定义短文本 */
  customText?: string
  /** 页脚区域高度 mm */
  heightMm: number
}

export interface PrintThemeSpec {
  /** 固定浅色纸张 */
  paperBackground: string
  /** 正文字体栈 */
  bodyFontFamily: string
  /** 标题字体栈 */
  headingFontFamily: string
  /** 基础字号 px */
  baseFontSizePx: number
  /** 正文文本颜色 */
  textColor: string
  /** 是否打印背景色 */
  printBackground: boolean
  /** 盒子是否使用打印色（浅色） */
  boxPrintColors: boolean
}

export interface PrintLayoutSpec {
  paper: PaperSpec
  header: PrintHeaderSpec
  footer: PrintFooterSpec
  theme: PrintThemeSpec
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_PRINT_HEADER: PrintHeaderSpec = {
  enabled: true,
  showTitle: true,
  showOnFirstPage: false,
  heightMm: 10,
}

export const DEFAULT_PRINT_FOOTER: PrintFooterSpec = {
  enabled: true,
  showPageNumber: true,
  showTotalPages: true,
  heightMm: 10,
}

export const DEFAULT_PRINT_THEME: PrintThemeSpec = {
  paperBackground: '#ffffff',
  bodyFontFamily: '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  headingFontFamily: '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  baseFontSizePx: 15,
  textColor: '#18181b',
  printBackground: true,
  boxPrintColors: true,
}

export function createDefaultPrintLayout(paper: PaperSpec): PrintLayoutSpec {
  return {
    paper,
    header: { ...DEFAULT_PRINT_HEADER },
    footer: { ...DEFAULT_PRINT_FOOTER },
    theme: { ...DEFAULT_PRINT_THEME },
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface PrintLayoutMetrics {
  /** 纸张像素尺寸 */
  pageWidthPx: number
  pageHeightPx: number
  /** 纸张 margin 区域像素 */
  marginTopPx: number
  marginRightPx: number
  marginBottomPx: number
  marginLeftPx: number
  /** 页眉像素高度 */
  headerHeightPx: number
  /** 页脚像素高度 */
  footerHeightPx: number
  /** 内容区宽度（不含左右 margin） */
  contentWidthPx: number
  /** 内容区高度（不含 margin、页眉、页脚） */
  contentHeightPx: number
  /** 不含页眉页脚的原始内容区高度（用于对比） */
  rawContentHeightPx: number
}

export function printLayoutMetrics(spec: PrintLayoutSpec): PrintLayoutMetrics {
  const { paper, header, footer } = spec
  const pageWidthPx = paper.widthMm * CSS_PIXELS_PER_MM
  const pageHeightPx = paper.heightMm * CSS_PIXELS_PER_MM
  const marginTopPx = paper.marginTopMm * CSS_PIXELS_PER_MM
  const marginRightPx = paper.marginRightMm * CSS_PIXELS_PER_MM
  const marginBottomPx = paper.marginBottomMm * CSS_PIXELS_PER_MM
  const marginLeftPx = paper.marginLeftMm * CSS_PIXELS_PER_MM
  const headerHeightPx = header.enabled ? header.heightMm * CSS_PIXELS_PER_MM : 0
  const footerHeightPx = footer.enabled ? footer.heightMm * CSS_PIXELS_PER_MM : 0
  const contentWidthPx = (paper.widthMm - paper.marginLeftMm - paper.marginRightMm) * CSS_PIXELS_PER_MM
  const rawContentHeightPx = (paper.heightMm - paper.marginTopMm - paper.marginBottomMm) * CSS_PIXELS_PER_MM
  const contentHeightPx = Math.max(0, rawContentHeightPx - headerHeightPx - footerHeightPx)
  return {
    pageWidthPx,
    pageHeightPx,
    marginTopPx,
    marginRightPx,
    marginBottomPx,
    marginLeftPx,
    headerHeightPx,
    footerHeightPx,
    contentWidthPx,
    contentHeightPx,
    rawContentHeightPx,
  }
}

/**
 * 将 PrintLayoutSpec 的有效内容高度注入 PaperMetrics，
 * 供 paginateTeachingDocument 使用。
 * 页眉页脚高度从 contentHeightPx 中扣除。
 */
export function effectivePaperMetrics(spec: PrintLayoutSpec): PaperMetrics {
  const metrics = printLayoutMetrics(spec)
  return {
    pageWidthPx: metrics.pageWidthPx,
    pageHeightPx: metrics.pageHeightPx,
    contentWidthPx: metrics.contentWidthPx,
    contentHeightPx: metrics.contentHeightPx,
  }
}

// ─── Page number formatting ───────────────────────────────────────────────────

/**
 * 总页数占位：使用固定宽度字符串避免总页数变化导致无限重排。
 * 例如 totalPages=7 → "99" 占位宽度足够覆盖 1-99 页。
 */
export function totalPagesPlaceholder(totalPages: number): string {
  const digits = Math.max(2, String(totalPages).length)
  return '9'.repeat(digits)
}

export function formatPageNumber(current: number, total: number): string {
  return `${current} / ${total}`
}

// ─── Header/Footer content ────────────────────────────────────────────────────

export interface PageHeaderContent {
  title: string
  subtitle?: string
}

export interface PageFooterContent {
  pageNumber: number
  totalPages: number
  customText?: string
}

export function pageHeaderContent(
  spec: PrintLayoutSpec,
  documentTitle: string,
  pageIndex: number,
): PageHeaderContent | null {
  if (!spec.header.enabled) return null
  if (pageIndex === 0 && !spec.header.showOnFirstPage) return null
  return {
    title: spec.header.showTitle ? documentTitle : '',
    subtitle: spec.header.subtitle,
  }
}

export function pageFooterContent(
  spec: PrintLayoutSpec,
  pageIndex: number,
  totalPages: number,
): PageFooterContent | null {
  if (!spec.footer.enabled) return null
  return {
    pageNumber: pageIndex + 1,
    totalPages,
    customText: spec.footer.customText,
  }
}
