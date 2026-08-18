import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionFigure, QuestionItem } from '@/types'
import { ChoiceOptions, FigureGallery, MarkdownWithInlineFigures, QuestionMarkdownContent } from './QuestionContent'
import { WorkbenchQuestionCard } from './WorkbenchQuestionCard'

const figure = {
  id: 'doc2x_asset_1',
  blockId: 'blk_p0_4',
  path: 'data/import/figure.jpg',
  usage: 'stem',
  category: 'question',
} as QuestionFigure

describe('question figure rendering', () => {
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

  it('resolves an inline marker by figure id when the figure also has a block id', async () => {
    await act(async () => {
      root.render(
        <MarkdownWithInlineFigures
          content={'标记前\n\n<!-- DOC2X_FIGURE:doc2x_asset_1 -->\n\n标记后'}
          figures={[figure]}
        />,
      )
    })

    expect(container.querySelectorAll('img')).toHaveLength(1)
    const children = Array.from(container.children)
    expect(children.map((child) => child.textContent?.trim())).toEqual(['标记前', '题干图 #1', '标记后'])
  })

  it('keeps legacy block-id markers renderable after switching new markers to figure ids', async () => {
    await act(async () => {
      root.render(
        <MarkdownWithInlineFigures
          content={'标记前\n\n<!-- DOC2X_FIGURE:blk_p0_4 -->\n\n标记后'}
          figures={[figure]}
        />,
      )
    })

    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('does not append an inline figure again in the stem gallery', async () => {
    await act(async () => {
      root.render(
        <QuestionMarkdownContent
          content={'题干\n\n<!-- DOC2X_FIGURE:doc2x_asset_1 -->'}
          figures={[figure]}
        />,
      )
    })

    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('does not append an option figure after rendering its inline marker', async () => {
    const optionFigure = { ...figure, id: 'doc2x_option_a', usage: 'options', optionLabel: 'A' }
    await act(async () => {
      root.render(
        <QuestionMarkdownContent
          content={'选择正确答案。\nA. 图示 <!-- DOC2X_FIGURE:doc2x_option_a -->\nB. 乙\nC. 丙\nD. 丁'}
          figures={[optionFigure]}
        />,
      )
    })

    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.textContent).not.toContain('选项图 #1')
  })

  it('renders an inline option marker even when the saved figure usage is stale', async () => {
    const staleOptionFigure = { ...figure, id: 'doc2x_option_a', usage: 'stem', category: 'question', optionLabel: '' }
    await act(async () => {
      root.render(
        <QuestionMarkdownContent
          content={'选择正确答案。\nA. <!-- DOC2X_FIGURE:doc2x_option_a -->\nB. 乙\nC. 丙\nD. 丁'}
          figures={[staleOptionFigure]}
        />,
      )
    })

    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.textContent).toContain('选项图 A #1')
    expect(container.textContent).not.toContain('DOC2X_FIGURE')
  })

  it('does not show a raw marker when its image cannot be resolved', async () => {
    await act(async () => {
      root.render(<MarkdownWithInlineFigures content={'<!-- DOC2X_FIGURE:missing_figure -->'} figures={[]} />)
    })

    expect(container.textContent).not.toContain('DOC2X_FIGURE')
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('can hide figure captions on teaching-document surfaces', async () => {
    await act(async () => {
      root.render(<FigureGallery figures={[figure]} showCaption={false} />)
    })

    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('figcaption')).toBeNull()
    expect(container.textContent).not.toContain('题干图')
  })

  it('renders teaching-document option figures without captions or card chrome', async () => {
    const optionFigure = { ...figure, id: 'doc2x_option_c', usage: 'options', optionLabel: 'C' }
    await act(async () => {
      root.render(
        <ChoiceOptions
          options={[{ label: 'C', content: '<!-- DOC2X_FIGURE:doc2x_option_c -->' }]}
          figures={[optionFigure]}
          showFigureCaptions={false}
          bareFigures
        />,
      )
    })

    expect(container.textContent).not.toContain('选项图')
    expect(container.querySelector('figcaption')).toBeNull()
    expect(container.querySelector('figure')?.className).not.toContain('border')
    expect(container.querySelector('button')?.className).not.toContain('h-48')
    expect(container.querySelector('img')?.className).toContain('h-auto')
  })

  it('supports natural aspect ratio without changing the legacy gallery default', async () => {
    await act(async () => {
      root.render(<FigureGallery figures={[figure]} showCaption={false} naturalAspectRatio />)
    })

    expect(container.querySelector('figure')?.className).toContain('w-full')
    expect(container.querySelector('button')?.className).toContain('h-auto')
    expect(container.querySelector('img')?.className).toContain('h-auto')

    await act(async () => {
      root.render(<FigureGallery figures={[figure]} showCaption={false} />)
    })
    expect(container.querySelector('button')?.className).toContain('h-44')
    expect(container.querySelector('img')?.className).toContain('h-full')
  })

  it('supports independent columns at a shared image height for side-by-side question figures', async () => {
    await act(async () => {
      root.render(
        <FigureGallery
          figures={[figure, { ...figure, id: 'doc2x_asset_2', path: 'question_figures/doc2x_asset_2.png' }]}
          showCaption={false}
          naturalAspectRatio
          columns={2}
          columnRatios={[2, 1]}
          equalHeightPx={120}
        />,
      )
    })

    const gallery = container.querySelector<HTMLElement>('div.grid')
    expect(gallery?.style.gridTemplateColumns).toBe('2fr 1fr')
    expect(gallery?.style.height).toBe('120px')
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(container.querySelector('img')?.className).toContain('h-full')
  })

  it('renders the image preview in the document body so global floating controls stay behind it', async () => {
    await act(async () => {
      root.render(<FigureGallery figures={[figure]} />)
    })

    const previewButton = container.querySelector<HTMLButtonElement>('figure button')
    await act(async () => previewButton?.click())

    const dialog = document.body.querySelector('[data-large-image-dialog]')
    expect(dialog).not.toBeNull()
    expect(container.contains(dialog)).toBe(false)
  })

  it('keeps stem figures out of the answer and analysis sections', async () => {
    const item = {
      id: 'question-1',
      serialNo: 706,
      stemMarkdown: '题干\n\n<!-- DOC2X_FIGURE:doc2x_asset_1 -->',
      answerText: '',
      analysisMarkdown: '解析文本',
      figures: [figure],
      knowledgePoints: [],
      solutionMethods: [],
    } as unknown as QuestionItem

    await act(async () => {
      root.render(
        <WorkbenchQuestionCard
          item={item}
          onAddToBasket={vi.fn()}
          onDelete={vi.fn()}
          onReload={vi.fn()}
        />,
      )
    })
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.textContent).toContain('导入审核')

    const toggle = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('查看解析'))
    await act(async () => toggle?.click())

    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.textContent).toContain('暂无答案')
    expect(container.textContent).toContain('解析文本')
  })
})
