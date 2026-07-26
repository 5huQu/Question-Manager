import type { PaperMetrics, PaperSpec, RenderDiagnostic } from './types'

export const CSS_PIXELS_PER_MM = 96 / 25.4

export const DEFAULT_A4_PAPER: PaperSpec = {
  size: 'A4',
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 18,
  marginRightMm: 16,
  marginBottomMm: 18,
  marginLeftMm: 16,
}

export const A4_MARGIN_PRESETS = {
  compact: { ...DEFAULT_A4_PAPER, marginTopMm: 12, marginRightMm: 12, marginBottomMm: 12, marginLeftMm: 12 },
  normal: DEFAULT_A4_PAPER,
  relaxed: { ...DEFAULT_A4_PAPER, marginTopMm: 24, marginRightMm: 22, marginBottomMm: 24, marginLeftMm: 22 },
} as const satisfies Record<string, PaperSpec>

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
