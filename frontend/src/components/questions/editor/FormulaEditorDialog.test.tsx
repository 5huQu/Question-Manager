import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormulaEditorDialog } from './FormulaEditorDialog'

vi.mock('mathlive', () => {
  class MockMathfieldElement extends HTMLElement {
    static strings: Record<string, Record<string, string>> = {}
    static locale = ''
    value = ''
  }

  if (!customElements.get('math-field')) {
    customElements.define('math-field', MockMathfieldElement)
  }

  return { MathfieldElement: MockMathfieldElement }
})

describe('FormulaEditorDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('syncs MathLive input directly to the preview and apply action', async () => {
    const onApply = vi.fn()
    await act(async () => {
      root.render(<FormulaEditorDialog title="测试公式" onApply={onApply} onClose={() => undefined} />)
    })

    const field = document.querySelector<HTMLElement & { value: string }>('math-field')
    expect(field).not.toBeNull()

    await act(async () => {
      field!.value = String.raw`\frac{1}{2}`
      field!.dispatchEvent(new Event('input'))
    })

    const applyButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '应用公式')
    expect(applyButton?.disabled).toBe(false)
    expect(document.querySelector('.katex')?.textContent).toContain('12')

    await act(async () => {
      applyButton!.click()
    })
    expect(onApply).toHaveBeenCalledWith(String.raw`\frac{1}{2}`)
  })
})
