import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aiAssistantApi, type AiAssistantContentFormatResult } from '@/api/aiAssistant'
import { QuestionContentEditor } from './QuestionContentEditor'
import { choiceAnswerMode, extractChoiceAnswerLabels, joinChoices, splitChoices, suggestChoiceConversion, type QuestionContentValue } from './model'

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

  it('highlights a selected single-choice answer and replaces it when another option is clicked', async () => {
    const onChange = vi.fn()
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="question:single-choice" value={initial} questionType="单选题" onChange={onChange} />)
    })

    const selected = container.querySelector<HTMLButtonElement>('[aria-label="设置答案选项 B"]')!
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    const optionC = container.querySelector<HTMLButtonElement>('[aria-label="设置答案选项 C"]')!
    await act(async () => { optionC.click() })
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, answerText: 'C' })
  })

  it('toggles multiple-choice answers in structured options', async () => {
    const onChange = vi.fn()
    const value = { ...initial, answerText: 'B' }
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="question:multiple-choice" value={value} questionType="多选题" onChange={onChange} />)
    })

    const optionA = container.querySelector<HTMLButtonElement>('[aria-label="切换答案选项 A"]')!
    await act(async () => { optionA.click() })
    expect(onChange).toHaveBeenLastCalledWith({ ...value, answerText: 'A、B' })
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
    expect(container.textContent).toContain('示例：```text legacy ```')
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="题干与选项 Markdown 源码"]')?.value).toContain('legacy')
  })

  it('opens fields with Doc2X figure markers in source mode without a conversion warning', async () => {
    const value = { ...initial, analysisMarkdown: '解析前\n\n<!-- DOC2X_FIGURE:asset-1 -->\n\n解析后' }
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="question:figure-marker" value={value} onChange={() => undefined} />)
    })
    expect(container.textContent).not.toContain('转换提示')
    expect(container.textContent).toContain('Markdown 源码')
  })

  it('opens imported HTML tables visually and retains merged cell attributes', async () => {
    const value = {
      ...initial,
      stemMarkdown: '统计结果如下：\n\n<table border="1"><tr><td rowspan="2">性别</td><td colspan="2">冰雪运动</td></tr><tr><td>了解</td><td>不了解</td></tr></table>',
      analysisMarkdown: '<table border="1"><tr><td>附： $\\chi^2$</td><td>0.050</td></tr></table>',
    }
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="candidate:html-table" value={value} onChange={() => undefined} />)
    })

    expect(container.querySelector('[aria-label="题干与选项 Markdown 源码"]')).toBeNull()
    expect(container.querySelector('td[rowspan="2"]')?.textContent).toContain('性别')
    expect(container.querySelector('td[colspan="2"]')?.textContent).toContain('冰雪运动')
    expect(container.textContent).not.toContain('转换提示')
  })

  it('shows row, column, merge, and header controls when a table is selected', async () => {
    const onChange = vi.fn()
    const value = {
      ...initial,
      stemMarkdown: '<table border="1"><tr><td>甲</td><td>乙</td></tr><tr><td>1</td><td>2</td></tr></table>',
    }
    await act(async () => {
      root.render(<QuestionContentEditor entityKey="candidate:table-actions" value={value} onChange={onChange} />)
    })

    expect(container.querySelector('[aria-label="表格操作"]')).not.toBeNull()
    const addRow = container.querySelector<HTMLButtonElement>('[aria-label="在下方插入行"]')!
    expect(addRow).not.toBeNull()
    expect(container.querySelector('[aria-label="合并选中的单元格"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="切换首行表头"]')).not.toBeNull()
    await act(async () => { addRow.click() })
    expect(onChange.mock.calls.at(-1)?.[0].stemMarkdown).toBe('<table border="1"><tr><td>甲</td><td>乙</td></tr><tr><td></td><td></td></tr><tr><td>1</td><td>2</td></tr></table>')
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

  it('closes the prompt, shows AI progress, then lets the user revert the backfilled fields', async () => {
    let resolveRequest!: (result: AiAssistantContentFormatResult) => void
    const pending = new Promise<AiAssistantContentFormatResult>((resolve) => { resolveRequest = resolve })
    const optimize = vi.spyOn(aiAssistantApi, 'formatQuestionContent').mockReturnValue(pending)
    const optimized = {
      stemMarkdown: '优化后的题干',
      answerText: '优化后的答案',
      analysisMarkdown: '优化后的解析',
    }

    function Harness() {
      const [value, setValue] = useState(initial)
      return <QuestionContentEditor entityKey="question:ai-workflow" value={value} onChange={setValue} />
    }

    try {
      await act(async () => { root.render(<Harness />) })
      const openHelper = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('AI 辅助'))!
      await act(async () => { openHelper.click() })
      expect(document.body.textContent).toContain('AI 提示词辅助')

      const aiButton = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'AI助手')!
      await act(async () => { aiButton.click() })
      expect(optimize).toHaveBeenCalledWith(initial)
      expect(container.textContent).toContain('AI 助手正在优化题干、答案和解析')
      expect(document.body.textContent).not.toContain('AI 提示词辅助')

      await act(async () => {
        resolveRequest({ content: optimized, model: 'test-model' })
        await pending
      })
      expect(container.textContent).toContain('AI 格式优化已回填到题干、答案和解析')
      expect(container.textContent).toContain('保留优化结果')
      expect(container.textContent).toContain('撤销 AI 优化')

      const revert = [...container.querySelectorAll('button')].find((button) => button.textContent === '撤销 AI 优化')!
      await act(async () => { revert.click() })
      expect(container.textContent).not.toContain('AI 格式优化已回填到题干、答案和解析')
      expect(container.textContent).toContain('计算')
    } finally {
      optimize.mockRestore()
    }
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

  it('recognizes common answer-key formats only for choice question types', () => {
    const choices = splitChoices(initial.stemMarkdown).choices
    expect(choiceAnswerMode('单项选择题')).toBe('single')
    expect(choiceAnswerMode('多选题')).toBe('multiple')
    expect(choiceAnswerMode('填空题')).toBeNull()
    expect(extractChoiceAnswerLabels('故选 B', choices, 'single')).toEqual(['B'])
    expect(extractChoiceAnswerLabels('答案为 **A**', choices, 'single')).toEqual(['A'])
    expect(extractChoiceAnswerLabels('答案：A，C', choices, 'multiple')).toEqual(['A', 'C'])
    expect(extractChoiceAnswerLabels('B，因为导数为零', choices, 'single')).toEqual([])
  })
})
