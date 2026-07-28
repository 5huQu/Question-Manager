/**
 * 图片 / 留白拖拽调整尺寸的纯逻辑
 *
 * 本模块不依赖 React 与 Tiptap，只包含可单测的常量与纯函数：
 * - 尺寸限制（clamp）与吸附（snap）
 * - mm ↔ CSS px 换算
 * - mergeKey 合并判定（连续拖拽合并为一个 undo 步骤）
 */
import { CSS_PIXELS_PER_MM } from '@/utils/teachingDocument/layout/paper'

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 图片最小物理宽度 mm */
export const MIN_FIGURE_WIDTH_MM = 10
/** 留白最小物理高度 mm */
export const MIN_SPACER_HEIGHT_MM = 2
/** 留白最大物理高度 mm */
export const MAX_SPACER_HEIGHT_MM = 200
/** 留白高度吸附步进 mm */
export const SPACER_SNAP_MM = 1
/** 键盘微调步进 mm */
export const KEYBOARD_STEP_MM = 1
/** 键盘 Shift 粗调步进 mm */
export const KEYBOARD_SHIFT_STEP_MM = 5
/** 连续拖拽合并为一个 undo 步骤的时间窗口 ms */
export const RESIZE_MERGE_WINDOW_MS = 1500

// ─── mm ↔ px 换算 ────────────────────────────────────────────────────────────

/** mm 转 CSS px（96dpi 下 1mm = 96/25.4 px） */
export function mmToPx(mm: number): number {
  return mm * CSS_PIXELS_PER_MM
}

/** CSS px 转 mm */
export function pxToMm(px: number): number {
  return px / CSS_PIXELS_PER_MM
}

// ─── 尺寸限制与吸附 ──────────────────────────────────────────────────────────

/**
 * 将图片宽度限制在 [MIN_FIGURE_WIDTH_MM, contentWidthMm] 内。
 * contentWidthMm 为纸张内容区宽度；若其小于最小值则退化为最小值上限。
 */
export function clampFigureWidthMm(widthMm: number, contentWidthMm: number): number {
  const upper = Math.max(MIN_FIGURE_WIDTH_MM, contentWidthMm)
  if (Number.isNaN(widthMm)) return MIN_FIGURE_WIDTH_MM
  // +Infinity 会被钳制到上限，-Infinity 钳制到下限
  return Math.min(upper, Math.max(MIN_FIGURE_WIDTH_MM, widthMm))
}

/** 将留白高度限制在 [MIN_SPACER_HEIGHT_MM, MAX_SPACER_HEIGHT_MM] 内 */
export function clampSpacerHeightMm(heightMm: number): number {
  if (!Number.isFinite(heightMm)) return MIN_SPACER_HEIGHT_MM
  return Math.min(MAX_SPACER_HEIGHT_MM, Math.max(MIN_SPACER_HEIGHT_MM, heightMm))
}

/**
 * 留白高度吸附：先按 snapMm（默认 1mm）四舍五入，再做上下限约束。
 */
export function snapSpacerHeightMm(heightMm: number, snapMm: number = SPACER_SNAP_MM): number {
  if (!Number.isFinite(heightMm)) return MIN_SPACER_HEIGHT_MM
  const step = snapMm > 0 ? snapMm : SPACER_SNAP_MM
  const snapped = Math.round(heightMm / step) * step
  return clampSpacerHeightMm(snapped)
}

/** 将 mm 值四舍五入到 0.1mm，避免存储过长小数 */
export function roundMm(mm: number): number {
  return Math.round(mm * 10) / 10
}

// ─── mergeKey 合并判定 ───────────────────────────────────────────────────────

export interface ResizeMergeState {
  mergeKey: string
  committedAt: number
}

/**
 * 判断本次提交是否应合并进上一个 undo 步骤。
 * 条件：mergeKey 相同，且距上次提交在 RESIZE_MERGE_WINDOW_MS 之内。
 * 配合「非调整事务重置 + addToHistory:false」可实现：
 * 连续拖拽只产生一个 undo 步骤，撤销一次恢复原始尺寸。
 */
export function shouldMergeResize(
  state: ResizeMergeState | null,
  mergeKey: string,
  now: number,
): boolean {
  if (!state || !mergeKey) return false
  if (state.mergeKey !== mergeKey) return false
  return now - state.committedAt <= RESIZE_MERGE_WINDOW_MS
}

/** 生成下一次提交对应的合并状态 */
export function nextResizeMergeState(mergeKey: string, now: number): ResizeMergeState {
  return { mergeKey, committedAt: now }
}
