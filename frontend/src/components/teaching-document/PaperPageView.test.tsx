import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { PaperPageView } from './PaperPageView'
import {
  createDefaultPrintLayout,
  DEFAULT_A4_PAPER,
  effectivePaperMetrics,
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

function renderPage(page: PaginatedPage, resolveQuestion?: (id: string) => unknown, layout = printLayout) {
  return renderToStaticMarkup(
    <PaperPageView
      page={page}
      document={teachingDoc}
      paper={DEFAULT_A4_PAPER}
      printLayout={layout}
      totalPages={2}
      resolvers={{ resolveQuestion: resolveQuestion as never }}
    />,
  )
}

describe('PaperPageView（纸张预览与打印页共享 renderer）', () => {
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

  it('renders all three header and footer slots from one shared document configuration', () => {
    const layout = createDefaultPrintLayout(DEFAULT_A4_PAPER)
    layout.header.showOnFirstPage = true
    layout.header.slots = {
      left: { type: 'documentTitle', align: 'left' },
      center: { type: 'customText', text: '数学', align: 'center' },
      right: { type: 'date', align: 'right', font: 'kaiti', fontSize: 12, bold: true, italic: true },
    }
    layout.footer.slots = {
      left: { type: 'customText', text: '内部资料', align: 'left' },
      center: { type: 'pageNumber', align: 'center' },
      right: { type: 'totalPages', align: 'right' },
    }
    const html = `${renderPage(makePage(0, [wholeQuestionItem()]), () => question, layout)}${renderPage(makePage(1, [wholeQuestionItem()]), () => question, layout)}`
    const root = document.createElement('div')
    root.innerHTML = html
    expect(root.querySelectorAll('[data-teaching-page-header]')).toHaveLength(2)
    expect(root.textContent).toContain('三角函数专题')
    expect(root.textContent).toContain('数学')
    expect(root.textContent).toContain('内部资料')
    expect(root.textContent).toContain('1 / 2')
    expect(root.textContent).toContain('2 / 2')
    const dateSlot = root.querySelector<HTMLElement>('[data-teaching-page-header] [data-chrome-slot="right"]')
    expect(dateSlot?.style.fontSize).toBe('12px')
    expect(dateSlot?.style.fontWeight).toBe('700')
    expect(dateSlot?.style.fontStyle).toBe('italic')
    expect(dateSlot?.style.fontFamily).toContain('Kaiti')
  })

  it('moves print chrome toward the physical page edge without changing its reserved height', () => {
    const html = renderPage(makePage(1, [wholeQuestionItem()]), () => question)
    const root = document.createElement('div')
    root.innerHTML = html
    const header = root.querySelector<HTMLElement>(`[${TEACHING_DOM.pageHeader}]`)
    const footer = root.querySelector<HTMLElement>(`[${TEACHING_DOM.pageFooter}]`)
    expect(header?.style.height).toBe('10mm')
    expect(footer?.style.height).toBe('10mm')
    expect(header?.style.transform).toBe('translateY(-7mm)')
    expect(footer?.style.transform).toBe('translateY(7mm)')
  })

  it('keeps the footer in a fixed, non-shrinking page region', () => {
    const html = renderPage(makePage(0, [wholeQuestionItem()]), () => question)
    const root = document.createElement('div')
    root.innerHTML = html
    const content = root.querySelector<HTMLElement>(`[${TEACHING_DOM.pageContent}]`)
    const footer = root.querySelector<HTMLElement>(`[${TEACHING_DOM.pageFooter}]`)
    expect(content?.style.flex).toBe('1 1 0px')
    expect(content?.style.minHeight).toBe('0px')
    expect(footer?.style.height).toBe('10mm')
  })

  it('uses the paper content height instead of the browser viewport for figures', () => {
    const html = renderPage(makePage(0, [wholeQuestionItem()]), () => question)
    const root = document.createElement('div')
    root.innerHTML = html
    const page = root.querySelector<HTMLElement>(`[${TEACHING_DOM.paperPage}]`)
    expect(page?.style.getPropertyValue('--td-paper-content-height'))
      .toBe(`${effectivePaperMetrics(printLayout).contentHeightPx}px`)
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
