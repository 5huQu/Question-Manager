/**
 * 布局兼容读取工具
 *
 * 提供旧字段（widthRatio / heightEm）到新物理尺寸（mm）的换算逻辑。
 * 新字段优先；旧字段仅在无新字段时作为回退。
 */

import type { FigureBlock, SpacerBlock } from '@/types/teachingDocument'

/** 1em ≈ 15px ≈ 3.97mm（基于 96dpi 和 25.4mm/inch） */
export const EM_TO_MM = 15 * 25.4 / 96 // ≈ 3.9688

/**
 * 读取图片有效宽度 mm。
 * - 若 widthMm 存在且有限正数，直接使用。
 * - 否则按 widthRatio × contentWidthMm 换算。
 * - 两者都无效时返回 contentWidthMm 的 80%（与旧默认 widthRatio=0.8 一致）。
 */
export function effectiveFigureWidthMm(block: FigureBlock, contentWidthMm: number): number {
  if (block.widthMm != null && Number.isFinite(block.widthMm) && block.widthMm > 0) {
    return block.widthMm
  }
  if (block.widthRatio != null && Number.isFinite(block.widthRatio) && block.widthRatio > 0) {
    return block.widthRatio * contentWidthMm
  }
  // 兜底：旧默认 widthRatio = 0.8
  return 0.8 * contentWidthMm
}

/**
 * 读取留白有效高度 mm。
 * - 若 heightMm 存在且有限正数，直接使用。
 * - 否则按 heightEm × EM_TO_MM 换算。
 * - heightEm 缺失/非法时使用默认值 2em。
 */
export function effectiveSpacerHeightMm(block: SpacerBlock): number {
  if (block.heightMm != null && Number.isFinite(block.heightMm) && block.heightMm > 0) {
    return block.heightMm
  }
  const em = Number.isFinite(block.heightEm) && block.heightEm > 0 ? block.heightEm : 2
  return em * EM_TO_MM
}
