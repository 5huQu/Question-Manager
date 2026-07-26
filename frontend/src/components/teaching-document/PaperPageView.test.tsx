import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { PaperPageView } from './PaperPageView'
import {
  createDefaultPrintLayout,
  DEFAULT_A4_PAPER,
  TEACHING_DOM,
  type PaginatedPage,
  type QuestionFragmentPaginationItem,
  type WholeBlockPaginationItem,
} from '@/utils/teachingDocument'

const question: QuestionItem = {
  id: 'q-1',
  serialNo: null,
  questionNo: '1',
  stage: '高中',
  questionType: '解答题',
  difficultyScore: 3,
  difficultyScore10: 6,
  difficultyLabel: '中等',
  chapter: '',
  knowledgePoints: [],
  solutionMethods: [],
  sourceTitle: '',
  bankStatus: 'ready',
  stemMarkdown: '求值。',
  answerText: '1',
  analysisMarkdown: '直接计算。',
  totalScore: 12,
  scoringRubric: [],
  sliceImagePath: '',
  figures: [],
  sourceRunId: '',
  updatedAt: '',
  hasFigures: false,
}

const teachingDoc: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '三角函数专题',
  metadata: {},
  content: [{
    type: 'question',
    id: 'q-block',
    questionId: question.id,
    display: { displayNumber: '1' },
  }],
}

const printLayout = createDefaultPrintLayout(DEFAULT_A4_PAPER)

function wholeQuestionItem(): WholeBlockPaginationItem {
  return { kind: 'whole', blockId: 'q-block', blockType: 'question', sourceIndex: 0 }
}

function questionFragmentItem(fragmentIndex: number): QuestionFragmentPaginationItem {
  return {
    kind: 'fragment',
    fragmentType: 'question',
    blockId: 'q-block',
    sourceIndex: 0,
    questionId: question.id,
    fragmentIndex,
    pageOffset: fragmentIndex,
    continuation: fragmentIndex === 0 ? 'start' : 'end',
    regionItems: [],
    height: 100,
  }
}

function makePage(index: number, items: PaginatedPage['items']): PaginatedPage {
  return { index, items, usedHeight: 200, overflow: false, showDocumentHeader: index === 0 }
}

function renderPage(page: PaginatedPage, resolveQuestion?: (id: string) => unknown) {
  return renderToStaticMarkup(
    <PaperPageView
      page={page}
      document={teachingDoc}
      paper={DEFAULT_A4_PAPER}
      printLayout={printLayout}
      totalPages={2}
      resolvers={{ resolveQuestion: resolveQuestion as never }}
    />,
  )
}

describe('PaperPageView（A4 预览与打印页共享 renderer）', () => {
  it('renders a header spacer on the first page when showOnFirstPage=false（保守统一扣除）', () => {
    const html = renderPage(makePage(0, [wholeQuestionItem()]), () => question)
    const root = document.createElement('div')
    root.innerHTML = html
    // 首页不渲染页眉内容，但保留占位元素，使 DOM 布局与分页扣除一致。
    expect(root.querySelector('[data-header-spacer="true"]')).not.toBeNull()
    expect(root.querySelector(`[${TEACHING_DOM.pageHeader}]`)?.textContent).not.toContain('三角函数专题')
  })

  it('renders the real header content on subsequent pages', () => {
    const html = renderPage(makePage(1, [wholeQuestionItem()]), () => question)
    const root = document.createElement('div')
    root.innerHTML = html
    expect(root.querySelector('[data-header-spacer="true"]')).toBeNull()
    expect(root.querySelector(`[${TEACHING_DOM.pageHeader}]`)?.textContent).toContain('三角函数专题')
  })

  it('renders footer page number and the stable page index attribute', () => {
    const html = renderPage(makePage(0, [wholeQuestionItem()]), () => question)
    const root = document.createElement('div')
    root.innerHTML = html
    expect(root.querySelector(`[${TEACHING_DOM.pageFooter}]`)?.textContent).toContain('1 / 2')
    expect(root.querySelector(`[${TEACHING_DOM.pageIndex}="0"]`)).not.toBeNull()
  })

  it('renders a stable placeholder when the question resolver fails（whole-block path）', () => {
    const html = renderPage(makePage(0, [wholeQuestionItem()]), () => ({ status: 'missing' }))
    const root = document.createElement('div')
    root.innerHTML = html
    expect(root.querySelector('[data-question-state]')).not.toBeNull()
    expect(html).toContain('题目')
  })

  it('renders the placeholder only for the first fragment when the resolver fails（fragment path）', () => {
    const failed = () => ({ status: 'missing' })
    const firstHtml = renderPage(makePage(0, [questionFragmentItem(0)]), failed)
    const laterHtml = renderPage(makePage(1, [questionFragmentItem(1)]), failed)

    const firstRoot = document.createElement('div')
    firstRoot.innerHTML = firstHtml
    // 第一个 fragment 渲染占位，保证用户看到缺失提示。
    expect(firstRoot.querySelector('[data-question-state]')).not.toBeNull()

    const laterRoot = document.createElement('div')
    laterRoot.innerHTML = laterHtml
    // 后续 fragment 不再重复整题占位，避免同一题在每页重复。
    expect(laterRoot.querySelector('[data-question-state]')).toBeNull()
    expect(laterRoot.querySelector(`[${TEACHING_DOM.questionRoot}]`)).toBeNull()
  })
})
