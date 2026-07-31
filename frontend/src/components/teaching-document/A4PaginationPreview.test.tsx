import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { QuestionItem } from '@/types'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import type {
  GeometryAdapter,
  BoxChromeGeometryAdapter,
  ParagraphRangeGeometryAdapter,
  PrintLayoutSpec,
  RenderReadinessResult,
} from '@/utils/teachingDocument'
import { createDefaultPrintLayout, createPaperSpec, DEFAULT_A4_PAPER, logicalPagePaper } from '@/utils/teachingDocument'
import { A4PaginationPreview, type A4PaginationState } from './A4PaginationPreview'

const ready: RenderReadinessResult = {
  ready: true,
  timedOut: false,
  pendingFonts: false,
  pendingImages: [],
  pendingQuestions: [],
  pendingFigures: [],
  failedImages: [],
  diagnostics: [],
}

const geometry: GeometryAdapter = {
  measure(element) {
    if (element.matches('[data-teaching-document-header]')) {
      return { width: 600, height: 0, top: 0, bottom: 0 }
    }
    const height = element.matches('[data-teaching-block]') ? 600 : 0
    return { width: 600, height, top: 0, bottom: height }
  },
}

const readinessWait = async () => ready

const boxGeometry: BoxChromeGeometryAdapter = {
  boxChrome: () => ({
    headerHeight: 12,
    marginTop: 10,
    marginBottom: 10,
    borderTop: 1,
    borderBottom: 1,
    bodyPaddingTop: 3,
    bodyPaddingBottom: 3,
  }),
}

const lineGeometry: ParagraphRangeGeometryAdapter = {
  measureText(_element, startOffset) {
    const top = startOffset * 20
    return [{ width: 10, height: 20, top, bottom: top + 20 }]
  },
  measureAtomic: () => [],
  margins: () => ({ marginTop: 10, marginBottom: 10 }),
}

function documentWith(ids: string[]): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: '',
    metadata: {},
    content: ids.map((id) => ({ type: 'paragraph' as const, id, content: [{ type: 'text' as const, text: id }] })),
  }
}

describe('A4PaginationPreview', () => {
  let root: ReturnType<typeof createRoot> | null = null
  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
  })

  it('updates the visible page count when content changes', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['a', 'b'])}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
        />,
      )
    })
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(2)
    expect(container.textContent).toContain('2 页')

    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['a'])}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
        />,
      )
    })
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(1)
    expect(container.textContent).toContain('1 页')
  })

  it('flows two logical columns through one shared A3 landscape sheet chrome', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    const sheetPaper = createPaperSpec('A3', 'landscape')
    const pagePaper = logicalPagePaper(sheetPaper)
    const printLayout = createDefaultPrintLayout(pagePaper)
    printLayout.header.showOnFirstPage = true
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['a', 'b'])}
          paper={pagePaper}
          sheetPaper={sheetPaper}
          printLayout={printLayout}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
        />,
      )
    })
    expect(container.querySelectorAll('[data-teaching-paper-spread]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-header-spacer="true"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-teaching-paper-spread] [data-teaching-page-header]:not([data-header-spacer="true"])')).toHaveLength(1)
    expect(container.textContent).toContain('1 页 · 双栏')
  })

  it('exposes diagnostics and keeps the original block selectable', async () => {
    const selected: string[] = []
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['oversized'])}
          geometryAdapter={{ measure: () => ({ width: 600, height: 1200, top: 0, bottom: 1200 }) }}
          readinessWait={readinessWait}
          onBlockSelect={(blockId) => selected.push(blockId)}
        />,
      )
    })
    expect(container.textContent).toContain('block-overflow')
    const block = container.querySelector<HTMLElement>('[data-teaching-page-index] [data-teaching-block-id="oversized"]')
    act(() => block?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(selected).toEqual(['oversized'])
  })

  it('waits for image readiness before measuring the final intrinsic layout', async () => {
    let settle: ((value: RenderReadinessResult) => void) | undefined
    let measuredHeight = 200
    const controlledReadiness = () => new Promise<RenderReadinessResult>((resolve) => {
      settle = resolve
    })
    const container = document.createElement('div')
    root = createRoot(container)
    const figureDocument: TeachingDocumentV1 = {
      ...documentWith([]),
      content: [{
        type: 'figure',
        id: 'image',
        asset: { type: 'documentAsset', assetId: 'asset' },
        alignment: 'center',
      }],
    }
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={figureDocument}
          resolveFigure={() => '/image.png'}
          geometryAdapter={{ measure: () => ({ width: 600, height: measuredHeight, top: 0, bottom: measuredHeight }) }}
          readinessWait={controlledReadiness}
        />,
      )
    })
    expect(container.textContent).toContain('正在准备排版资源')
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(0)

    measuredHeight = 1200
    await act(async () => settle?.(ready))
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(1)
    expect(container.textContent).toContain('block-overflow')
  })

  it('renders a long source paragraph as selectable runtime fragments', async () => {
    const selected: string[] = []
    let measuredHeight = 1220
    const dynamicGeometry: GeometryAdapter = {
      measure: () => ({ width: 600, height: measuredHeight, top: 0, bottom: measuredHeight }),
    }
    const container = document.createElement('div')
    root = createRoot(container)
    const longDocument = documentWith(['long'])
    longDocument.content[0] = {
      type: 'paragraph',
      id: 'long',
      content: [{ type: 'text', text: '甲'.repeat(60) }],
    }
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={longDocument}
          geometryAdapter={dynamicGeometry}
          paragraphGeometryAdapter={lineGeometry}
          readinessWait={readinessWait}
          onBlockSelect={(blockId) => selected.push(blockId)}
        />,
      )
    })
    const fragments = container.querySelectorAll<HTMLElement>('[data-teaching-fragment-type="paragraph"]')
    expect(fragments).toHaveLength(2)
    expect(container.textContent).toContain('片段 2')
    expect(fragments[0].getAttribute('data-teaching-fragment-continuation')).toBe('start')
    expect(fragments[1].getAttribute('data-teaching-fragment-continuation')).toBe('end')
    act(() => fragments[1].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(selected).toEqual(['long'])

    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={longDocument}
          zoom={0.5}
          geometryAdapter={dynamicGeometry}
          paragraphGeometryAdapter={lineGeometry}
          readinessWait={readinessWait}
        />,
      )
    })
    expect(container.textContent).toContain('测量 g1')
    expect(container.querySelector<HTMLElement>('[data-teaching-page-index]')?.style.transform).toBe('scale(0.5)')
    expect(container.querySelectorAll('[data-teaching-fragment-type="paragraph"]')).toHaveLength(2)

    measuredHeight = 40
    const shortenedDocument: TeachingDocumentV1 = {
      ...longDocument,
      content: [{ type: 'paragraph', id: 'long', content: [{ type: 'text', text: '甲乙' }] }],
    }
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={shortenedDocument}
          zoom={0.5}
          geometryAdapter={dynamicGeometry}
          paragraphGeometryAdapter={lineGeometry}
          readinessWait={readinessWait}
        />,
      )
    })
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-teaching-fragment-type="paragraph"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-teaching-page-index] [data-teaching-block-id="long"]')).toHaveLength(1)
  })

  it('renders box fragments with shared chrome and maps child clicks to the source child', async () => {
    const selected: string[] = []
    const container = document.createElement('div')
    root = createRoot(container)
    const boxDocument: TeachingDocumentV1 = {
      ...documentWith([]),
      content: [{
        type: 'box',
        id: 'box',
        templateId: 'method',
        title: '方法盒',
        breakBehavior: 'allow',
        children: [
          { type: 'paragraph', id: 'child-a', content: [{ type: 'text', text: '甲' }] },
          { type: 'paragraph', id: 'child-b', content: [{ type: 'text', text: '乙' }] },
        ],
      }],
    }
    const boxBlockGeometry: GeometryAdapter = {
      measure(element) {
        if (element.matches('[data-teaching-document-header]')) {
          return { width: 600, height: 0, top: 0, bottom: 0 }
        }
        const childIndex = element.getAttribute('data-teaching-child-index')
        const height = childIndex === null ? 1220 : 600
        return { width: 600, height, top: 0, bottom: height }
      },
    }
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={boxDocument}
          geometryAdapter={boxBlockGeometry}
          boxGeometryAdapter={boxGeometry}
          readinessWait={readinessWait}
          onBlockSelect={(blockId) => selected.push(blockId)}
        />,
      )
    })

    const fragments = container.querySelectorAll<HTMLElement>('[data-teaching-fragment-type="box"]')
    expect(fragments).toHaveLength(2)
    expect(fragments[0].getAttribute('data-teaching-fragment-continuation')).toBe('start')
    expect(fragments[1].getAttribute('data-teaching-fragment-continuation')).toBe('end')
    expect(fragments[1].textContent).toContain('方法盒（续）')
    const child = fragments[1].querySelector<HTMLElement>('[data-teaching-block-id="child-b"]')
    act(() => child?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(selected).toEqual(['child-b'])
  })

  it('explains an allow-box overflow without incorrectly telling the user it is set to avoid', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    const boxDocument: TeachingDocumentV1 = {
      ...documentWith([]),
      content: [{
        type: 'box',
        id: 'allow-box',
        templateId: 'method',
        breakBehavior: 'allow',
        children: [{ type: 'paragraph', id: 'child', content: [{ type: 'text', text: '甲' }] }],
      }],
    }
    const oversizedGeometry: GeometryAdapter = {
      measure(element) {
        if (element.matches('[data-teaching-document-header]')) return { width: 600, height: 0, top: 0, bottom: 0 }
        const childIndex = element.getAttribute('data-teaching-child-index')
        const height = childIndex === null ? 1500 : 1470
        return { width: 600, height, top: 0, bottom: height }
      },
    }

    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={boxDocument}
          geometryAdapter={oversizedGeometry}
          boxGeometryAdapter={boxGeometry}
          readinessWait={readinessWait}
        />,
      )
    })

    expect(container.textContent).toContain('已启用跨页拆分')
    expect(container.textContent).not.toContain('被设置为“不拆开”')
  })

  it('renders a long question as source-backed regions and selects the source question', async () => {
    const selected: string[] = []
    const container = document.createElement('div')
    root = createRoot(container)
    const question: QuestionItem = {
      id: 'long-question',
      serialNo: null,
      questionNo: '8',
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
      stemMarkdown: '甲'.repeat(60),
      answerText: '',
      analysisMarkdown: '',
      totalScore: 12,
      scoringRubric: [],
      sliceImagePath: '',
      figures: [],
      sourceRunId: '',
      updatedAt: '',
      hasFigures: false,
    }
    const questionDocument: TeachingDocumentV1 = {
      ...documentWith([]),
      content: [{
        type: 'question',
        id: 'long-question-block',
        questionId: question.id,
        display: { displayNumber: '8' },
      }],
    }
    const questionBlockGeometry: GeometryAdapter = {
      measure(element) {
        if (element.matches('[data-teaching-document-header]')) {
          return { width: 600, height: 0, top: 0, bottom: 0 }
        }
        const region = element.getAttribute('data-teaching-question-region')
        const height = region === 'heading' ? 20 : region === 'stem' ? 1200 : 1220
        return { width: 600, height, top: 0, bottom: height }
      },
    }
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={questionDocument}
          resolveQuestion={() => question}
          geometryAdapter={questionBlockGeometry}
          paragraphGeometryAdapter={lineGeometry}
          questionGeometryAdapter={{ margins: () => ({ marginTop: 10, marginBottom: 10 }) }}
          readinessWait={readinessWait}
          onBlockSelect={(blockId) => selected.push(blockId)}
        />,
      )
    })

    const fragments = container.querySelectorAll<HTMLElement>(
      '[data-teaching-fragment-type="question"]',
    )
    expect(fragments).toHaveLength(2)
    expect(fragments[0].textContent).toContain('8.')
    expect(fragments[1].textContent).not.toContain('8.')
    expect(fragments[1].textContent).toContain('续题')
    expect(container.textContent).not.toContain('unsupported-split')
    act(() => fragments[1].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(selected).toEqual(['long-question-block'])
  })

  it('ignores stale readiness completions from an older document generation', async () => {
    const completions: Array<(value: RenderReadinessResult) => void> = []
    const controlledReadiness = () => new Promise<RenderReadinessResult>((resolve) => {
      completions.push(resolve)
    })
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['old-a', 'old-b'])}
          geometryAdapter={geometry}
          readinessWait={controlledReadiness}
        />,
      )
    })
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['latest'])}
          geometryAdapter={geometry}
          readinessWait={controlledReadiness}
        />,
      )
    })
    expect(completions).toHaveLength(2)
    await act(async () => completions[1](ready))
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(1)
    await act(async () => completions[0](ready))
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(1)
    expect(container.querySelector('[data-teaching-block-id="old-a"]')).toBeNull()
    expect(container.querySelector('[data-teaching-block-id="latest"]')).not.toBeNull()
  })

  it('re-measures when the print layout (header/footer) changes', async () => {
    const states: A4PaginationState[] = []
    const container = document.createElement('div')
    root = createRoot(container)
    const layoutA = createDefaultPrintLayout(DEFAULT_A4_PAPER)
    // 加大页眉高度 → effective metrics 内容高变化，必须触发重新测量。
    const layoutB: PrintLayoutSpec = {
      ...layoutA,
      header: { ...layoutA.header, heightMm: layoutA.header.heightMm + 20 },
    }
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['a'])}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
          printLayout={layoutA}
          onPaginationState={(state) => states.push(state)}
        />,
      )
    })
    expect(states[states.length - 1].measurementGeneration).toBe(1)

    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['a'])}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
          printLayout={layoutB}
          onPaginationState={(state) => states.push(state)}
        />,
      )
    })
    // printLayout 变化触发新一轮测量：generation 递增，且过程中发布了 preparing/null。
    expect(states[states.length - 1].measurementGeneration).toBe(2)
    expect(states.some((state) => state.measurementGeneration === 2 && state.pagination === null)).toBe(true)
  })

  it('publishes a stable failed state when readiness waiting rejects', async () => {
    const states: A4PaginationState[] = []
    const rejectingReadiness = () => Promise.reject(new Error('readiness boom'))
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['a'])}
          geometryAdapter={geometry}
          readinessWait={rejectingReadiness}
          onPaginationState={(state) => states.push(state)}
        />,
      )
    })
    // rejection 后发布稳定失败态：pagination 为 null、readiness timedOut，导出被阻塞。
    const last = states[states.length - 1]
    expect(last.pagination).toBeNull()
    expect(last.readiness.timedOut).toBe(true)
    expect(last.readiness.diagnostics.some((d) => d.code === 'resource-timeout')).toBe(true)
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(0)
  })
})
