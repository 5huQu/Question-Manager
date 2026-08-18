import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AnswerSpaceSettingsPopover } from './AnswerSpaceSettingsPopover'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function SettingsHarness() {
  const [heightMm, setHeightMm] = useState(40)
  const [splitAcrossPages, setSplitAcrossPages] = useState(false)
  return (
    <AnswerSpaceSettingsPopover
      heightMm={heightMm}
      splitAcrossPages={splitAcrossPages}
      onHeightChange={setHeightMm}
      onSplitAcrossPagesChange={setSplitAcrossPages}
    />
  )
}

describe('AnswerSpaceSettingsPopover', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('在不打开页面设置抽屉的情况下编辑解答题留空属性', async () => {
    root = createRoot(container)
    await act(async () => {
      root?.render(<SettingsHarness />)
    })

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="设置解答题留空属性"]')
    expect(trigger).toBeTruthy()
    await act(async () => trigger?.click())

    const panel = document.body.querySelector<HTMLElement>('[data-answer-space-settings-popover]')
    expect(panel?.textContent).toContain('解答题留空高度')
    expect(document.body.querySelector('[aria-label="页面设置"]')).toBeNull()

    const preset = Array.from(panel!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === '50mm')
    await act(async () => preset?.click())
    expect(panel?.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('50')

    const splitCheckbox = panel?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    await act(async () => splitCheckbox?.click())
    expect(splitCheckbox?.checked).toBe(true)

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.body.querySelector('[data-answer-space-settings-popover]')).toBeNull()
  })
})
