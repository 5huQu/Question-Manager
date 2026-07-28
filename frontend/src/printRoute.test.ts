import { describe, expect, it } from 'vitest'
import appSource from './App.tsx?raw'

/**
 * 打印路由 bypass 守卫：
 * Electron 隐藏窗口打开真实路径 /print/teaching-document 时，App.tsx 必须在
 * settingsReady 与 setupCompleted 门禁之前渲染打印页，否则隐藏窗口会显示
 * SetupPage / 空白门禁页，导致 PDF 导出永远无法 ready。
 */
describe('print route bypass（App.tsx）', () => {
  it('renders /print/* before the settings/setup gates', () => {
    const printBypass = appSource.indexOf("location.pathname.startsWith('/print/')")
    const settingsGate = appSource.indexOf('if (!settingsReady)')
    const setupGate = appSource.indexOf('if (!appSettings.setupCompleted')

    expect(printBypass).toBeGreaterThan(-1)
    expect(settingsGate).toBeGreaterThan(-1)
    expect(setupGate).toBeGreaterThan(-1)
    // bypass 必须位于两个门禁之前。
    expect(printBypass).toBeLessThan(settingsGate)
    expect(printBypass).toBeLessThan(setupGate)
  })

  it('registers the teaching-document print route', () => {
    expect(appSource).toContain('path="/print/teaching-document"')
    expect(appSource).toContain('TeachingDocumentPrintPage')
  })
})
