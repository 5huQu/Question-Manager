import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionFigure, QuestionItem } from '@/types'
import { FigureGallery, MarkdownWithInlineFigures, QuestionMarkdownContent } from './QuestionContent'
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

  it('can hide figure captions on teaching-document surfaces', async () => {
    await act(async () => {
      root.render(<FigureGallery figures={[figure]} showCaption={false} />)
    })

    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('figcaption')).toBeNull()
    expect(container.textContent).not.toContain('题干图')
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

    const toggle = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('查看解析'))
    await act(async () => toggle?.click())

    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.textContent).toContain('暂无答案')
    expect(container.textContent).toContain('解析文本')
  })
})
