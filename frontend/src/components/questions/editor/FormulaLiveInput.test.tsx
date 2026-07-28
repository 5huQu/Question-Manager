import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { FormulaLiveInput } from './FormulaLiveInput'

describe('FormulaLiveInput', () => {
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

  it('renders LaTeX input and live KaTeX preview', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <FormulaLiveInput
          value="E=mc^2"
          onChange={onChange}
        />
      )
    })

    expect(container.textContent).toContain('公式代码')
    expect(container.textContent).toContain('即时渲染预览')
    const textarea = container.querySelector('textarea')
    expect(textarea?.value).toBe('E=mc^2')
  })

  it('calls onChange when user types in textarea', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <FormulaLiveInput
          value=""
          onChange={onChange}
        />
      )
    })

    const textarea = container.querySelector('textarea')!
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      nativeSetter?.call(textarea, 'x^2')
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('x^2')
  })

  it('triggers onOpenKeyboard when formula keyboard button is clicked', () => {
    const onOpenKeyboard = vi.fn()
    act(() => {
      root.render(
        <FormulaLiveInput
          value="a+b"
          onChange={() => undefined}
          onOpenKeyboard={onOpenKeyboard}
        />
      )
    })

    const keyboardBtn = container.querySelector('button')!
    act(() => {
      keyboardBtn.click()
    })
    expect(onOpenKeyboard).toHaveBeenCalledTimes(1)
  })
})
