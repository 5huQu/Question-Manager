import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AiPromptHelperDialog } from './AiPromptHelperDialog'

describe('AiPromptHelperDialog', () => {
  it('renders prompt helper modal with external links and prompt templates', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onClose = vi.fn()

    act(() => {
      root.render(<AiPromptHelperDialog open={true} onClose={onClose} />)
    })

    expect(document.body.textContent).toContain('AI 提示词辅助')
    expect(document.body.textContent).toContain('Gemini')
    expect(document.body.textContent).toContain('ChatGPT')
    expect(document.body.textContent).toContain('豆包')
    expect(document.body.textContent).toContain('QwenStudio')
    expect(document.body.textContent).toContain('截图生成可入库稿')
    expect(document.body.textContent).toContain('已 OCR 稿格式修正')
    expect(document.body.textContent).toContain('一键复制')

    act(() => {
      root.unmount()
    })
    document.body.removeChild(container)
  })

  it('copies each current OCR field separately for targeted format repair', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    await act(async () => {
      root.render(<AiPromptHelperDialog open={true} onClose={() => undefined} content={{ stemMarkdown: '题干内容', answerText: 'B', analysisMarkdown: '解析内容' }} />)
    })
    const repairTab = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('已 OCR 稿格式修正'))!
    await act(async () => { repairTab.click() })
    const copyStem = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('复制题干'))!
    const copyAnswer = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('复制答案'))!
    const copyAnalysis = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('复制解析'))!
    await act(async () => { copyStem.click() })
    await act(async () => { copyAnswer.click() })
    await act(async () => { copyAnalysis.click() })

    expect(writeText).toHaveBeenNthCalledWith(1, '题干：\n题干内容')
    expect(writeText).toHaveBeenNthCalledWith(2, '答案：\nB')
    expect(writeText).toHaveBeenNthCalledWith(3, '解析：\n解析内容')
    root.unmount()
    container.remove()
  })

  it('invokes the manual-fix PDF screenshot actions from the direct-import prompt', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const copyStem = vi.fn().mockResolvedValue(undefined)
    const copyAnalysis = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      root.render(<AiPromptHelperDialog open={true} onClose={() => undefined} onCopyStemPdfScreenshot={copyStem} onCopyAnalysisPdfScreenshot={copyAnalysis} />)
    })
    const stemButton = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('复制题干截图'))!
    const analysisButton = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes('复制解析截图'))!
    await act(async () => { stemButton.click(); analysisButton.click() })

    expect(copyStem).toHaveBeenCalledOnce()
    expect(copyAnalysis).toHaveBeenCalledOnce()
    root.unmount()
    container.remove()
  })

  it('closes immediately and delegates all three fields to the parent AI workflow', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const original = { stemMarkdown: '题干 $x$', answerText: '答案', analysisMarkdown: '解析 $y$' }
    const optimize = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    try {
      await act(async () => {
        root.render(<AiPromptHelperDialog open={true} onClose={onClose} content={original} onOptimizeWithAi={optimize} />)
      })
      const aiButton = [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'AI助手')!
      await act(async () => { aiButton.click() })

      expect(optimize).toHaveBeenCalledWith(original)
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      optimize.mockRestore()
      act(() => root.unmount())
      container.remove()
    }
  })
})
