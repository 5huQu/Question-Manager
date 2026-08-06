import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
          renderVersion="old-resources"
          geometryAdapter={geometry}
          readinessWait={controlledReadiness}
        />,
      )
    })
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['latest'])}
          renderVersion="latest-resources"
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

  it('keeps the previous document and pagination as one visible snapshot while reflowing', async () => {
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
          renderVersion="snapshot-old-resources"
          geometryAdapter={geometry}
          readinessWait={controlledReadiness}
        />,
      )
    })
    await act(async () => completions[0](ready))
    expect(container.querySelector('[data-teaching-page-index] [data-teaching-block-id="old-a"]')).not.toBeNull()

    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(['latest'])}
          renderVersion="snapshot-latest-resources"
          geometryAdapter={geometry}
          readinessWait={controlledReadiness}
        />,
      )
    })
    expect(container.querySelector('[data-teaching-layout-status]')?.textContent).toContain('正在重新排版')
    expect(container.querySelector('[data-teaching-page-index] [data-teaching-block-id="old-a"]')).not.toBeNull()
    expect(container.querySelector('[data-teaching-page-index] [data-teaching-block-id="latest"]')).toBeNull()

    await act(async () => completions[1](ready))
    expect(container.querySelector('[data-teaching-page-index] [data-teaching-block-id="old-a"]')).toBeNull()
    expect(container.querySelector('[data-teaching-page-index] [data-teaching-block-id="latest"]')).not.toBeNull()
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

  it('restores warm student/teacher snapshots and invalidates them on resource revision', async () => {
    const question: QuestionItem = {
      id: 'variant-question',
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
      stemMarkdown: '版本缓存题干',
      answerText: '版本缓存答案',
      analysisMarkdown: '版本缓存解析',
      totalScore: 10,
      scoringRubric: [],
      sliceImagePath: '',
      figures: [],
      sourceRunId: '',
      updatedAt: 'r1',
      hasFigures: false,
    }
    const source: TeachingDocumentV1 = {
      ...documentWith([]),
      content: [{ type: 'question', id: 'variant-block', questionId: question.id }],
    }
    let geometryCalls = 0
    const countedGeometry: GeometryAdapter = {
      measure(element) {
        geometryCalls += 1
        if (element.matches('[data-teaching-document-header]')) return { width: 600, height: 0, top: 0, bottom: 0 }
        return { width: 600, height: 120, top: 0, bottom: 120 }
      },
    }
    const countedReadiness = vi.fn(async () => ready)
    const resolveVariantQuestion = () => question
    const variantQuestionGeometry = { margins: () => ({ marginTop: 10, marginBottom: 10 }) }
    const container = document.createElement('div')
    root = createRoot(container)
    const render = async (variant: 'student' | 'teacher', renderVersion: string) => {
      await act(async () => {
        root?.render(
          <A4PaginationPreview
            document={source}
            variant={variant}
            renderVersion={renderVersion}
            resolveQuestion={resolveVariantQuestion}
            geometryAdapter={countedGeometry}
            paragraphGeometryAdapter={lineGeometry}
            questionGeometryAdapter={variantQuestionGeometry}
            readinessWait={countedReadiness}
          />,
        )
      })
    }

    await render('student', 'r1')
    const visibleStudent = container.querySelector('[data-teaching-page-index]')?.textContent || ''
    expect(visibleStudent).toContain('版本缓存题干')
    expect(visibleStudent).not.toContain('版本缓存答案')

    await render('teacher', 'r1')
    const visibleTeacher = container.querySelector('[data-teaching-page-index]')?.textContent || ''
    expect(visibleTeacher).toContain('版本缓存答案')
    expect(visibleTeacher).toContain('版本缓存解析')
    const callsAfterTeacher = geometryCalls

    await render('student', 'r1')
    expect(geometryCalls).toBe(callsAfterTeacher)
    expect(container.querySelector('[data-teaching-page-index]')?.textContent).not.toContain('版本缓存答案')
    expect(container.querySelector('[data-teaching-layout-status]')).toBeNull()
    expect(countedReadiness).toHaveBeenCalledTimes(1)

    await render('student', 'r2')
    expect(geometryCalls).toBeGreaterThan(callsAfterTeacher)
    expect(countedReadiness).toHaveBeenCalledTimes(2)
  })

  it('windows long A4 previews while preserving all page anchors and the full pagination snapshot', async () => {
    const states: A4PaginationState[] = []
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(Array.from({ length: 12 }, (_, index) => `block-${index}`))}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
          onPaginationState={(state) => states.push(state)}
        />,
      )
    })

    expect(container.querySelectorAll('[data-teaching-page-anchor]')).toHaveLength(12)
    expect(container.querySelectorAll('[data-teaching-preview-unit-index]')).toHaveLength(12)
    expect(container.querySelectorAll('[data-teaching-preview-unit-mounted="true"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(3)
    expect(states.at(-1)?.pagination?.pages).toHaveLength(12)
  })

  it('mounts a distant page and selected block with their surrounding buffer', async () => {
    const source = documentWith(Array.from({ length: 12 }, (_, index) => `block-${index}`))
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={source}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
          targetPageIndex={9}
        />,
      )
    })
    expect(container.querySelector('[data-teaching-page-index="9"]')).not.toBeNull()
    expect(container.querySelector('[data-teaching-page-index="9"] [data-teaching-block-id="block-9"]')).not.toBeNull()

    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={source}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
          selectedBlockId="block-6"
        />,
      )
    })
    expect(container.querySelector('[data-teaching-page-index="6"] [data-teaching-block-id="block-6"]')).not.toBeNull()
  })

  it('windows A3 spreads by physical sheet without splitting logical columns', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    const sheetPaper = createPaperSpec('A3', 'landscape')
    const pagePaper = logicalPagePaper(sheetPaper)
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(Array.from({ length: 20 }, (_, index) => `block-${index}`))}
          paper={pagePaper}
          sheetPaper={sheetPaper}
          printLayout={createDefaultPrintLayout(pagePaper)}
          geometryAdapter={geometry}
          readinessWait={readinessWait}
          targetPageIndex={18}
        />,
      )
    })

    expect(container.querySelectorAll('[data-teaching-preview-unit-index]')).toHaveLength(10)
    expect(container.querySelectorAll('[data-teaching-page-anchor]')).toHaveLength(20)
    expect(container.querySelector('[data-teaching-page-index="18"]')).not.toBeNull()
    const mountedSheets = Array.from(container.querySelectorAll<HTMLElement>('[data-teaching-preview-unit-mounted="true"]'))
    expect(mountedSheets.length).toBeLessThan(10)
    expect(mountedSheets.every((sheet) => sheet.querySelectorAll('[data-teaching-page-index]').length === 2)).toBe(true)
  })

  it('mounts a distant diagnostic target before handing off navigation', async () => {
    const navigatedPages: number[] = []
    const container = document.createElement('div')
    root = createRoot(container)
    const readinessWithDiagnostic: RenderReadinessResult = {
      ...ready,
      diagnostics: [{
        code: 'resource-timeout',
        severity: 'error',
        message: '远端页诊断',
        blockId: 'block-10',
        pageIndex: 10,
      }],
    }
    await act(async () => {
      root?.render(
        <A4PaginationPreview
          document={documentWith(Array.from({ length: 12 }, (_, index) => `block-${index}`))}
          geometryAdapter={geometry}
          readinessWait={async () => readinessWithDiagnostic}
          onDiagnosticNavigate={(_blockId, pageIndex) => navigatedPages.push(pageIndex)}
        />,
      )
    })

    const diagnosticButtons = container.querySelectorAll<HTMLButtonElement>('button')
    expect(diagnosticButtons.length).toBeGreaterThan(0)
    await act(async () => {
      diagnosticButtons.item(0).click()
    })
    const targetPage = navigatedPages.at(-1)
    expect(targetPage).toBe(10)
    expect(container.querySelector(`[data-teaching-page-index="${targetPage}"]`)).not.toBeNull()
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
