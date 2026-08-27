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
})
