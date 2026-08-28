import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuestionBlock } from '@/types/teachingDocument'
import type { QuestionRuntimeModel } from '@/utils/teachingDocument/layout/questionRegions'

const { renderKatex } = vi.hoisted(() => ({ renderKatex: vi.fn() }))

vi.mock('@/utils/teachingDocument/katexCache', () => ({
  renderTeachingDocumentKatex: renderKatex,
}))

import { QuestionRuntimeContent } from './BlockRenderer'

const block: QuestionBlock = { type: 'question', id: 'question-block', questionId: 'question-1' }

function modelForMath(latex: string): QuestionRuntimeModel {
  return {
    blockId: block.id,
    questionId: block.questionId,
    displayNumber: '',
    score: 0,
    questionType: '解答题',
    regions: [{
      key: 'question-block:question:stem:0',
      type: 'stem',
      index: 0,
      kind: 'math',
      splitPolicy: 'never',
      latex,
    }],
  }
}

afterEach(() => {
  renderKatex.mockReset()
})

describe('QuestionRuntimeContent math regions', () => {
  it('passes the exact parsed LaTeX source directly to the teaching KaTeX renderer', () => {
    const latex = '\\begin{aligned}\na&=1\\\\\nb&=2\n\\end{aligned}'
    renderKatex.mockReturnValue('<span data-katex-direct="true"></span>')

    const html = renderToStaticMarkup(<QuestionRuntimeContent block={block} model={modelForMath(latex)} />)

    expect(renderKatex).toHaveBeenCalledTimes(1)
    expect(renderKatex).toHaveBeenCalledWith(latex, true)
    expect(html).toContain('data-katex-direct="true"')
  })

  it('keeps the LaTeX source visible when direct KaTeX rendering fails', () => {
    const latex = '\\notARealLatexCommand{'
    renderKatex.mockReturnValue('')

    const html = renderToStaticMarkup(<QuestionRuntimeContent block={block} model={modelForMath(latex)} />)

    expect(html).toContain(latex)
    expect(html).toContain('公式格式有误')
  })

  it('keeps answer and multi-paragraph analysis inside one theorem-skin solution card', () => {
    const html = renderToStaticMarkup(
      <QuestionRuntimeContent
        block={{ ...block, display: { showAnswer: true, showAnalysis: true } }}
        model={{
          ...modelForMath('x'),
          regions: [
            {
              key: 'answer', type: 'answer', index: 0, kind: 'answer', splitPolicy: 'never',
              markdown: '答案', figures: [],
            },
            {
              key: 'analysis-label', type: 'analysis', index: -1, kind: 'label', splitPolicy: 'never',
              keepWithNext: true, label: '解析：',
            },
            {
              key: 'analysis-1', type: 'analysis', index: 0, kind: 'paragraph', splitPolicy: 'paragraph',
              paragraph: { type: 'paragraph', id: 'analysis-1', content: [{ type: 'text', text: '第一段解析' }] },
            },
            {
              key: 'analysis-2', type: 'analysis', index: 1, kind: 'paragraph', splitPolicy: 'paragraph',
              paragraph: { type: 'paragraph', id: 'analysis-2', content: [{ type: 'text', text: '第二段解析' }] },
            },
          ],
        }}
      />,
    )

    expect(html.match(/td-skin-box-theorem-math/g) || []).toHaveLength(1)
    expect(html.match(/td-question-analysis-region/g) || []).toHaveLength(3)
    expect(html.match(/td-question-solution-card/g) || []).toHaveLength(1)
    expect(html.match(/td-question-solution-section-header/g) || []).toHaveLength(2)
    expect(html).toContain('data-continuation="single"')
    expect(html).toContain('解析')
  })
})
