import type { FigureAlignment } from '@/types/teachingDocument'
import { clampFigureWidthMm } from '@/components/teaching-document/editor/resizeLogic'

/** 题库题图在讲义中的默认物理宽度，避免未设置覆盖时占用过多版面。 */
export const DEFAULT_QUESTION_FIGURE_WIDTH_MM = 30

export type FigureLayoutPreset =
  | 'block-center'
  | 'block-left'
  | 'block-right'
  | 'full-width'

export interface FigureLayoutPresetDefinition {
  id: FigureLayoutPreset
  label: string
  description: string
  alignment: FigureAlignment
  defaultWidthMm?: number
  fillContainer?: boolean
}

export const FIGURE_LAYOUT_PRESETS: readonly FigureLayoutPresetDefinition[] = [
  { id: 'block-center', label: '居中插图', description: '图片在内容区居中显示', alignment: 'center', defaultWidthMm: 80 },
  { id: 'block-left', label: '左对齐插图', description: '图片靠内容区左侧显示', alignment: 'left', defaultWidthMm: 70 },
  { id: 'block-right', label: '右对齐插图', description: '图片靠内容区右侧显示', alignment: 'right', defaultWidthMm: 70 },
  { id: 'full-width', label: '通栏插图', description: '图片铺满当前容器有效宽度', alignment: 'center', fillContainer: true },
] as const

export const FIGURE_LAYOUT_PRESET_IDS = new Set<FigureLayoutPreset>(FIGURE_LAYOUT_PRESETS.map((item) => item.id))

export function isFigureLayoutPreset(value: unknown): value is FigureLayoutPreset {
  return typeof value === 'string' && FIGURE_LAYOUT_PRESET_IDS.has(value as FigureLayoutPreset)
}

export function resolveFigureLayout(input: {
  preset?: FigureLayoutPreset
  explicitWidthMm?: number
  legacyAlignment?: FigureAlignment
  legacyWidthRatio?: number
  containerWidthMm: number
}): { alignment: FigureAlignment; widthMm: number } {
  const definition = FIGURE_LAYOUT_PRESETS.find((item) => item.id === input.preset)
  const width = Number.isFinite(input.explicitWidthMm) && Number(input.explicitWidthMm) > 0
    ? Number(input.explicitWidthMm)
    : definition?.fillContainer
      ? input.containerWidthMm
      : definition?.defaultWidthMm
        ?? (Number.isFinite(input.legacyWidthRatio) && Number(input.legacyWidthRatio) > 0
          ? Number(input.legacyWidthRatio) * input.containerWidthMm
          : 0.8 * input.containerWidthMm)
  return {
    alignment: definition?.alignment ?? input.legacyAlignment ?? 'center',
    widthMm: clampFigureWidthMm(width, input.containerWidthMm),
  }
}
