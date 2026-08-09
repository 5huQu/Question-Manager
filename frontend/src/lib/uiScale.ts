import { useCallback, useEffect, useState } from 'react'

/** Web 应用 UI 缩放的本地偏好。文档 / 打印几何不使用这个比例。 */
export const UI_SCALE_STORAGE_KEY = 'question-manager.ui-scale-mode'
export const UI_SCALE_MODE_CHANGED_EVENT = 'question-manager:ui-scale-mode-changed'

export const MANUAL_UI_SCALES = [0.9, 1, 1.05, 1.1, 1.15, 1.25] as const
export type ManualUiScale = typeof MANUAL_UI_SCALES[number]
export type UiScaleMode = 'auto' | ManualUiScale

export const UI_SCALE_OPTIONS: ReadonlyArray<{ mode: UiScaleMode; label: string }> = [
  { mode: 'auto', label: '自动' },
  { mode: 0.9, label: '90%' },
  { mode: 1, label: '100%' },
  { mode: 1.05, label: '105%' },
  { mode: 1.1, label: '110%' },
  { mode: 1.15, label: '115%' },
  { mode: 1.25, label: '125%' },
]

const ROOT_FONT_SIZE_PX = 16

export function autoUiScaleForViewport(viewportWidth: number): ManualUiScale {
  if (viewportWidth >= 2400) return 1.15
  if (viewportWidth >= 1920) return 1.1
  if (viewportWidth >= 1680) return 1.05
  return 1
}

export function parseUiScaleMode(value: unknown): UiScaleMode {
  if (value === 'auto') return 'auto'
  const numericValue = typeof value === 'number' ? value : Number(value)
  return MANUAL_UI_SCALES.includes(numericValue as ManualUiScale)
    ? numericValue as ManualUiScale
    : 'auto'
}

export function readUiScaleMode(): UiScaleMode {
  if (typeof window === 'undefined') return 'auto'
  try {
    return parseUiScaleMode(window.localStorage.getItem(UI_SCALE_STORAGE_KEY))
  } catch {
    return 'auto'
  }
}

/**
 * UI 使用根 rem 尺度而不是祖先 zoom：Tailwind 的尺寸 token 会同步放大，
 * 而 TeachingDocument 的 mm / 明确 px 纸张几何不会进入缩放坐标系。
 */
export function applyUiScaleMode(mode: UiScaleMode, root: HTMLElement = document.documentElement) {
  if (mode === 'auto') {
    root.style.removeProperty('--app-ui-scale')
    root.style.removeProperty('--app-ui-root-font-size')
    return
  }
  root.style.setProperty('--app-ui-scale', String(mode))
  root.style.setProperty('--app-ui-root-font-size', `${ROOT_FONT_SIZE_PX * mode}px`)
}

/** Print route 必须回到不受 UI 偏好影响的根字号。 */
export function applyPrintSafeUiScale(root: HTMLElement = document.documentElement) {
  root.style.setProperty('--app-ui-scale', '1')
  root.style.setProperty('--app-ui-root-font-size', `${ROOT_FONT_SIZE_PX}px`)
}

export function saveUiScaleMode(mode: UiScaleMode) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(mode))
  } catch {
    // 私密浏览或被禁用的 storage 不应阻塞界面缩放。
  }
  applyUiScaleMode(mode)
  window.dispatchEvent(new CustomEvent<UiScaleMode>(UI_SCALE_MODE_CHANGED_EVENT, { detail: mode }))
}

/** 供设置页与 App shell 共享的本地偏好状态；不监听 resize，自动档由 CSS media query 完成。 */
export function useUiScaleMode() {
  const [mode, setMode] = useState<UiScaleMode>(() => readUiScaleMode())

  useEffect(() => {
    const sync = () => setMode(readUiScaleMode())
    const syncFromOtherTab = (event: StorageEvent) => {
      if (event.key === UI_SCALE_STORAGE_KEY) sync()
    }
    window.addEventListener(UI_SCALE_MODE_CHANGED_EVENT, sync)
    window.addEventListener('storage', syncFromOtherTab)
    return () => {
      window.removeEventListener(UI_SCALE_MODE_CHANGED_EVENT, sync)
      window.removeEventListener('storage', syncFromOtherTab)
    }
  }, [])

  const updateMode = useCallback((nextMode: UiScaleMode) => {
    saveUiScaleMode(nextMode)
    setMode(nextMode)
  }, [])

  return [mode, updateMode] as const
}

export function useAppUiScale(enabled = true) {
  const [mode] = useUiScaleMode()

  useEffect(() => {
    if (!enabled) {
      applyPrintSafeUiScale()
      return
    }
    applyUiScaleMode(mode)
  }, [enabled, mode])
}
