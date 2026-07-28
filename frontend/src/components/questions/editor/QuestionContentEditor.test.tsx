import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionContentEditor } from './QuestionContentEditor'
import { joinChoices, splitChoices, suggestChoiceConversion, type QuestionContentValue } from './model'

const initial: QuestionContentValue = {
  stemMarkdown: '计算 $x+1$。\n\nA. 1\nB. 2\nC. 3\nD. 4',
  answerText: 'B',
  analysisMarkdown: '直接计算。',
}

describe('QuestionContentEditor', () => {
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

  it('renders accessible tabs, formula atoms, and structured choices', async () => {
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="question:1" value={initial} onChange={() => undefined} />)
    })
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(container.querySelector('[aria-label="行内公式，按 Enter 编辑"]')).not.toBeNull()
    expect(container.querySelector<HTMLElement>('[role="textbox"][aria-label="选项 A"]')?.textContent).toBe('1')
    expect(container.querySelector('[aria-label="为选项 A 打开公式键盘"]')).not.toBeNull()
    expect(container.textContent).toContain('内容已保存')
  })

  it('renders Doc2X delimiters and formulas inside multiline structured choices', async () => {
    const value = {
      ...initial,
      stemMarkdown: '已知函数 \\(f(x)=x^2\\)\n\nA. \\(x=0\\) 是极值点\nB. \\(x=1\\)\nC. 2\nD. 3',
    }
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="candidate:formula" value={value} onChange={() => undefined} variant="compact" />)
    })
    expect(container.querySelectorAll('[aria-label="行内公式，按 Enter 编辑"]')).toHaveLength(3)
    const optionA = container.querySelector<HTMLElement>('[role="textbox"][aria-label="选项 A"]')
    expect(optionA).not.toBeNull()
    expect(optionA?.className).toContain('min-h-20')
  })

  it('opens the formula keyboard directly from the rich toolbar and a structured choice', async () => {
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="question:formula-entry" value={initial} onChange={() => undefined} />)
    })

    const inlineButton = container.querySelector<HTMLButtonElement>('[aria-label="打开行内公式键盘"]')!
    await act(async () => { inlineButton.click() })
    expect(document.querySelector('[role="dialog"][aria-label="插入行内公式"]')).not.toBeNull()
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="关闭公式编辑器"]')!.click() })

    const choiceButton = container.querySelector<HTMLButtonElement>('[aria-label="为选项 A 打开公式键盘"]')!
    await act(async () => { choiceButton.click() })
    expect(document.querySelector('[role="dialog"][aria-label="为选项 A 插入公式"]')).not.toBeNull()
  })

  it('keeps unsupported markdown visible in source mode and exposes a warning', async () => {
    const value = { ...initial, stemMarkdown: '题干\n\n```text\nlegacy\n```' }
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="question:2" value={value} onChange={() => undefined} />)
    })
    expect(container.textContent).toContain('转换提示')
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="题干与选项 Markdown 源码"]')?.value).toContain('legacy')
  })

  it('previews and applies inline legacy choices without mutating before confirmation', async () => {
    const onChange = vi.fn()
    const value = {
      ...initial,
      stemMarkdown: '记事件 A：乘积为偶数，则 $P(A)=$\n\nA. $\\frac{3}{8}$ B. $\\frac{7}{8}$\n\nC. $\\frac{5}{8}$ D. $\\frac{1}{8}$',
    }
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="question:legacy-choice" value={value} onChange={onChange} />)
    })
    expect(container.textContent).toContain('从题干识别到 A–D 四个选项')
    expect(container.textContent).toContain('应用识别结果')
    expect(onChange).not.toHaveBeenCalled()

    const apply = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('应用识别结果'))!
    await act(async () => { apply.click() })
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0][0].stemMarkdown).toBe(
      '记事件 A：乘积为偶数，则 $P(A)=$\n\nA. $\\frac{3}{8}$\nB. $\\frac{7}{8}$\nC. $\\frac{5}{8}$\nD. $\\frac{1}{8}$',
    )
  })

  it('is controlled and saves changed content with Ctrl+S', async () => {
    const save = vi.fn()
    function Harness() {
      const [value, setValue] = useState(initial)
      return <QuestionContentEditor entityKey="question:3" value={value} onChange={setValue} onSave={save} />
    }
    await act(async () => { root.render(<Harness />) })
    const sourceButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Markdown 源码'))!
    await act(async () => { sourceButton.click() })
    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="题干与选项 Markdown 源码"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, `${initial.stemMarkdown}\n新增条件`)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('有未保存修改')
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    })
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0].stemMarkdown).toContain('新增条件')
  })
})

describe('structured choice helpers', () => {
  it('round-trips A-D choices without changing their content', () => {
    const parsed = splitChoices(initial.stemMarkdown)
    expect(parsed.choices.map((choice) => choice.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(joinChoices(parsed.body, parsed.choices)).toBe(initial.stemMarkdown)
  })

  it('recognizes empty A-D choices after they are added', () => {
    const markdown = joinChoices('题干', ['A', 'B', 'C', 'D'].map((label) => ({ label, content: '' })))

    expect(markdown).toBe('题干\n\nA. \nB. \nC. \nD.')
    expect(splitChoices(markdown)).toEqual({
      body: '题干',
      choices: ['A', 'B', 'C', 'D'].map((label) => ({ label, content: '' })),
    })
  })

  it('suggests conversion for two-options-per-line legacy content', () => {
    const suggestion = suggestChoiceConversion('题干\n\nA. 甲 B. 乙\n\nC. 丙 D. 丁')
    expect(suggestion).toEqual({
      body: '题干',
      choices: [
        { label: 'A', content: '甲' },
        { label: 'B', content: '乙' },
        { label: 'C', content: '丙' },
        { label: 'D', content: '丁' },
      ],
    })
  })
})
