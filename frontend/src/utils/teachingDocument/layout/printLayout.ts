import { CSS_PIXELS_PER_MM } from './paper'
import type { PaperMetrics, PaperSpec } from './types'
import type {
  PrintChromeSlot,
  PrintChromeSlotPosition,
  PrintChromeSlots,
  PrintPageNumberOptions,
  TeachingDocumentPrintOptions,
} from '@/types/teachingDocument'

// ─── Print Layout Spec ────────────────────────────────────────────────────────

export interface PrintHeaderSpec {
  enabled: boolean
  slots: PrintChromeSlots
  /** 首页是否显示页眉 */
  showOnFirstPage: boolean
  /** 页眉区域高度 mm */
  heightMm: number
}

export interface PrintFooterSpec {
  enabled: boolean
  slots: PrintChromeSlots
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
  pageNumber: Required<PrintPageNumberOptions>
  theme: PrintThemeSpec
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_PRINT_HEADER: PrintHeaderSpec = {
  enabled: true,
  slots: {
    left: { type: 'none', align: 'left' },
    center: { type: 'documentTitle', align: 'center' },
    right: { type: 'none', align: 'right' },
  },
  showOnFirstPage: false,
  heightMm: 10,
}

export const DEFAULT_PRINT_FOOTER: PrintFooterSpec = {
  enabled: true,
  slots: {
    left: { type: 'none', align: 'left' },
    center: { type: 'pageNumber', align: 'center' },
    right: { type: 'none', align: 'right' },
  },
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
    pageNumber: { format: 'fraction', prefix: '', suffix: '', showTotalPages: true },
    theme: { ...DEFAULT_PRINT_THEME },
  }
}

/** 将文档已保存的打印偏好合并到稳定默认值中。 */
export function createDocumentPrintLayout(
  paper: PaperSpec,
  options?: TeachingDocumentPrintOptions,
): PrintLayoutSpec {
  const layout = createDefaultPrintLayout(paper)
  if (!options) return layout
  layout.header.enabled = options.headerEnabled ?? layout.header.enabled
  layout.header.showOnFirstPage = options.headerShowOnFirstPage ?? layout.header.showOnFirstPage
  layout.footer.enabled = options.footerEnabled ?? layout.footer.enabled
  layout.header.slots = resolveSlots(layout.header.slots, options.header, {
    showTitle: options.headerShowTitle,
    subtitle: options.headerSubtitle,
  })
  layout.footer.slots = resolveSlots(layout.footer.slots, options.footer, {
    showPageNumber: options.footerShowPageNumber,
    customText: options.footerCustomText,
  })
  layout.pageNumber = {
    format: options.pageNumber?.format ?? 'fraction',
    prefix: options.pageNumber?.prefix ?? '',
    suffix: options.pageNumber?.suffix ?? '',
    showTotalPages: options.pageNumber?.showTotalPages ?? options.footerShowTotalPages ?? true,
  }
  return layout
}

function cloneSlot(slot: PrintChromeSlot): PrintChromeSlot {
  return { ...slot }
}

function resolveSlots(
  defaults: PrintChromeSlots,
  configured: TeachingDocumentPrintOptions['header'] | TeachingDocumentPrintOptions['footer'],
  legacy: { showTitle?: boolean; subtitle?: string; showPageNumber?: boolean; customText?: string },
): PrintChromeSlots {
  if (configured) {
    return (['left', 'center', 'right'] as PrintChromeSlotPosition[]).reduce((slots, position) => {
      slots[position] = configured[position] ? { ...configured[position]! } : cloneSlot(defaults[position])
      return slots
    }, {} as PrintChromeSlots)
  }
  if (legacy.subtitle !== undefined || legacy.showTitle !== undefined) {
    return {
      left: legacy.showTitle === false ? { type: 'none', align: 'left' } : { type: 'documentTitle', align: 'left' },
      center: legacy.subtitle ? { type: 'customText', text: legacy.subtitle, align: 'center' } : { type: 'none', align: 'center' },
      right: { type: 'none', align: 'right' },
    }
  }
  if (legacy.customText !== undefined || legacy.showPageNumber !== undefined) {
    const showNumber = legacy.showPageNumber ?? true
    return {
      left: legacy.customText ? { type: 'customText', text: legacy.customText, align: 'left' } : { type: 'none', align: 'left' },
      center: showNumber ? { type: 'pageNumber', align: 'center' } : { type: 'none', align: 'center' },
      right: { type: 'none', align: 'right' },
    }
  }
  return (['left', 'center', 'right'] as PrintChromeSlotPosition[]).reduce((slots, position) => {
    slots[position] = cloneSlot(defaults[position])
    return slots
  }, {} as PrintChromeSlots)
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

export function formatPageNumber(current: number, total: number, options: PrintPageNumberOptions = {}): string {
  const showTotalPages = options.showTotalPages ?? true
  const format = options.format ?? 'fraction'
  let value: string
  if (format === 'page') value = `第 ${current} 页`
  else if (format === 'fraction') value = showTotalPages ? `${current} / ${total}` : String(current)
  else if (format === 'page-total') value = showTotalPages ? `第 ${current} 页，共 ${total} 页` : `第 ${current} 页`
  else if (format === 'dash') value = `- ${current} -`
  else value = String(current)
  return `${options.prefix ?? ''}${value}${options.suffix ?? ''}`
}

// ─── Header/Footer content ────────────────────────────────────────────────────

export function pageHeaderSlots(spec: PrintLayoutSpec, pageIndex: number): PrintChromeSlots | null {
  if (!spec.header.enabled) return null
  if (pageIndex === 0 && !spec.header.showOnFirstPage) return null
  return spec.header.slots
}

export function pageFooterSlots(spec: PrintLayoutSpec): PrintChromeSlots | null {
  if (!spec.footer.enabled) return null
  return spec.footer.slots
}

export function printDateLabel(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
