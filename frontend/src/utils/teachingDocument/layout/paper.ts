import type { TeachingDocumentStyle, TeachingMarginPreset } from '@/types/teachingDocument'
import type { PaperMetrics, PaperOrientation, PaperSize, PaperSpec, RenderDiagnostic } from './types'

export const CSS_PIXELS_PER_MM = 96 / 25.4

// ─── 标准纸张尺寸（portrait 基准，宽×高 mm） ────────────────────────────────

export const STANDARD_PAPER_SIZES: Record<Exclude<PaperSize, 'custom'>, { widthMm: number; heightMm: number }> = {
  A3: { widthMm: 297, heightMm: 420 },
  A4: { widthMm: 210, heightMm: 297 },
}

// ─── 工厂函数 ─────────────────────────────────────────────────────────────────

export interface PaperMargins {
  topMm: number
  rightMm: number
  bottomMm: number
  leftMm: number
}

/**
 * 创建完整 PaperSpec。
 * - orientation 为 landscape 时交换标准宽高。
 * - margins 缺省时使用该尺寸 + preset 的默认边距。
 */
export function createPaperSpec(
  size: Exclude<PaperSize, 'custom'>,
  orientation: PaperOrientation = 'portrait',
  margins?: PaperMargins,
  marginPreset: TeachingMarginPreset = 'normal',
): PaperSpec {
  const standard = STANDARD_PAPER_SIZES[size]
  const widthMm = orientation === 'landscape' ? standard.heightMm : standard.widthMm
  const heightMm = orientation === 'landscape' ? standard.widthMm : standard.heightMm
  const presetMargins = margins ?? MARGIN_PRESETS[size][marginPreset]
  return {
    size,
    orientation,
    widthMm,
    heightMm,
    marginTopMm: presetMargins.topMm,
    marginRightMm: presetMargins.rightMm,
    marginBottomMm: presetMargins.bottomMm,
    marginLeftMm: presetMargins.leftMm,
  }
}

// ─── 边距预设（按纸张尺寸分别提供） ───────────────────────────────────────────

export const MARGIN_PRESETS: Record<Exclude<PaperSize, 'custom'>, Record<TeachingMarginPreset, PaperMargins>> = {
  A4: {
    compact: { topMm: 12, rightMm: 12, bottomMm: 12, leftMm: 12 },
    normal: { topMm: 18, rightMm: 16, bottomMm: 18, leftMm: 16 },
    relaxed: { topMm: 24, rightMm: 22, bottomMm: 24, leftMm: 22 },
  },
  A3: {
    compact: { topMm: 14, rightMm: 14, bottomMm: 14, leftMm: 14 },
    normal: { topMm: 22, rightMm: 20, bottomMm: 22, leftMm: 20 },
    relaxed: { topMm: 30, rightMm: 26, bottomMm: 30, leftMm: 26 },
  },
}

/** @deprecated 兼容导出；等价于 createPaperSpec('A4', 'portrait')。 */
export const DEFAULT_A4_PAPER: PaperSpec = createPaperSpec('A4', 'portrait')

/** @deprecated 兼容导出；请使用 MARGIN_PRESETS.A4。 */
export const A4_MARGIN_PRESETS: Record<TeachingMarginPreset, PaperSpec> = {
  compact: createPaperSpec('A4', 'portrait', undefined, 'compact'),
  normal: DEFAULT_A4_PAPER,
  relaxed: createPaperSpec('A4', 'portrait', undefined, 'relaxed'),
}

// ─── 文档纸张解析 ─────────────────────────────────────────────────────────────

/**
 * 从文档 style 解析完整 PaperSpec。
 * 优先级：style.paper.margins > style.paper.size/orientation + marginPreset > 默认 A4 portrait normal。
 * 旧文档（无 style.paper）回退为 A4 portrait + marginPreset 映射，渲染结果不变。
 */
export function resolveDocumentPaper(style?: TeachingDocumentStyle): PaperSpec {
  const paperOptions = style?.paper
  const size = paperOptions?.size ?? 'A4'
  const orientation = paperOptions?.orientation ?? 'portrait'
  const marginPreset = style?.marginPreset ?? 'normal'

  if (size === 'custom') {
    // custom 尺寸必须由调用方通过 paperOptions.margins + 外部宽高提供；
    // 当前阶段回退为 A4，避免无效规格进入分页。
    return createPaperSpec('A4', orientation, paperOptions?.margins, marginPreset)
  }

  return createPaperSpec(size, orientation, paperOptions?.margins, marginPreset)
}

/** A3 横向采用常见的双栏版式：一张物理纸面包含两个连续逻辑栏。 */
export function isA3LandscapeSpread(paper: PaperSpec): boolean {
  return paper.size === 'A3' && paper.orientation === 'landscape'
}

/**
 * 返回用于内容测量和分页的逻辑页规格。
 * A3 横向的物理尺寸为 420×297mm，分页引擎以两个 A4 宽度的逻辑栏续排；
 * 其余纸张保持单页语义。
 */
export function logicalPagePaper(paper: PaperSpec): PaperSpec {
  if (!isA3LandscapeSpread(paper)) return paper
  return createPaperSpec('A4', 'portrait', {
    topMm: paper.marginTopMm,
    rightMm: paper.marginRightMm,
    bottomMm: paper.marginBottomMm,
    leftMm: paper.marginLeftMm,
  })
}

export function validatePaperSpec(paper: PaperSpec): RenderDiagnostic[] {
  const values = [
    paper.widthMm,
    paper.heightMm,
    paper.marginTopMm,
    paper.marginRightMm,
    paper.marginBottomMm,
    paper.marginLeftMm,
  ]
  if (values.some((value) => !Number.isFinite(value) || value < 0)
    || paper.widthMm <= paper.marginLeftMm + paper.marginRightMm
    || paper.heightMm <= paper.marginTopMm + paper.marginBottomMm) {
    return [{
      code: 'invalid-paper-spec',
      severity: 'error',
      message: '纸张尺寸或页边距无效，无法计算内容区域。',
    }]
  }
  if (paper.orientation !== 'portrait' && paper.orientation !== 'landscape') {
    return [{
      code: 'invalid-paper-spec',
      severity: 'error',
      message: '纸张方向无效，仅支持 portrait 或 landscape。',
    }]
  }
  if (paper.size !== 'custom') {
    const standard = STANDARD_PAPER_SIZES[paper.size]
    const expectedWidth = paper.orientation === 'landscape' ? standard.heightMm : standard.widthMm
    const expectedHeight = paper.orientation === 'landscape' ? standard.widthMm : standard.heightMm
    if (paper.widthMm !== expectedWidth || paper.heightMm !== expectedHeight) {
      return [{
        code: 'invalid-paper-spec',
        severity: 'error',
        message: `纸张尺寸与 ${paper.size} ${paper.orientation} 标准不符（期望 ${expectedWidth}×${expectedHeight}mm）。`,
      }]
    }
  }
  return []
}

export function paperMetrics(paper: PaperSpec): PaperMetrics {
  return {
    pageWidthPx: paper.widthMm * CSS_PIXELS_PER_MM,
    pageHeightPx: paper.heightMm * CSS_PIXELS_PER_MM,
    contentWidthPx: (paper.widthMm - paper.marginLeftMm - paper.marginRightMm) * CSS_PIXELS_PER_MM,
    contentHeightPx: (paper.heightMm - paper.marginTopMm - paper.marginBottomMm) * CSS_PIXELS_PER_MM,
  }
}

// ─── 纸张比较与解析（导出一致性校验） ────────────────────────────────────────

/**
 * 判断两个 PaperSpec 是否完全一致（尺寸、方向与四边边距）。
 * 用于校验“文档纸张”与“导出期望纸张”是否匹配。
 */
export function paperSpecsEqual(a: PaperSpec, b: PaperSpec): boolean {
  return a.size === b.size
    && a.orientation === b.orientation
    && a.widthMm === b.widthMm
    && a.heightMm === b.heightMm
    && a.marginTopMm === b.marginTopMm
    && a.marginRightMm === b.marginRightMm
    && a.marginBottomMm === b.marginBottomMm
    && a.marginLeftMm === b.marginLeftMm
}

/**
 * 将外部传入的未知值（如打印页 URL query 中 JSON 解析后的对象）安全地解析为 PaperSpec。
 * 字段缺失或数值非法时返回 null，绝不抛出；size/orientation 必须为合法枚举。
 */
export function parsePaperSpec(raw: unknown): PaperSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const size = candidate.size === 'A3' || candidate.size === 'A4' || candidate.size === 'custom'
    ? candidate.size
    : null
  const orientation = candidate.orientation === 'portrait' || candidate.orientation === 'landscape'
    ? candidate.orientation
    : null
  if (!size || !orientation) return null
  const widthMm = Number(candidate.widthMm)
  const heightMm = Number(candidate.heightMm)
  const marginTopMm = Number(candidate.marginTopMm)
  const marginRightMm = Number(candidate.marginRightMm)
  const marginBottomMm = Number(candidate.marginBottomMm)
  const marginLeftMm = Number(candidate.marginLeftMm)
  const values = [widthMm, heightMm, marginTopMm, marginRightMm, marginBottomMm, marginLeftMm]
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null
  return {
    size,
    orientation,
    widthMm,
    heightMm,
    marginTopMm,
    marginRightMm,
    marginBottomMm,
    marginLeftMm,
  }
}
