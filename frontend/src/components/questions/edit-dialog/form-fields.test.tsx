import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiTagSelector } from './form-fields'

describe('MultiTagSelector', () => {
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

  it('searches options and supports checking multiple values', async () => {
    const onChange = vi.fn()
    await act(async () => {
      root.render(
        <MultiTagSelector
          label="知识点"
          help="帮助"
          options={['函数', '几何', '概率']}
          values={['函数']}
          onChange={onChange}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')?.click()
    })
    const search = document.body.querySelector<HTMLInputElement>('input[aria-label="搜索知识点"]')
    expect(search).not.toBeNull()
    expect(document.activeElement).toBe(search)
    expect(document.body.textContent).toContain('函数')
    expect(document.body.textContent).toContain('几何')

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, '几何')
      search?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.body.textContent).toContain('几何')
    expect(document.body.textContent).not.toContain('概率')

    await act(async () => {
      const option = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((button) => button.textContent?.includes('几何'))
      option?.click()
    })
    expect(onChange).toHaveBeenLastCalledWith(['函数', '几何'])
  })

  it('toggles a checked value off without losing the remaining selections', async () => {
    function Harness() {
      const [values, setValues] = useState(['函数', '几何'])
      return <MultiTagSelector label="知识点" help="帮助" options={['函数', '几何']} values={values} onChange={setValues} />
    }

    await act(async () => root.render(<Harness />))
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')?.click())
    await act(async () => {
      const option = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((button) => button.textContent?.includes('函数'))
      option?.click()
    })

    expect(document.body.textContent).toContain('已选择 1 项')
    expect(container.querySelector('[aria-label="移除函数"]')).toBeNull()
    expect(container.querySelector('[aria-label="移除几何"]')).not.toBeNull()
  })
})
