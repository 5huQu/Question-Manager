import { act, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import type {
  GeometryAdapter,
  PaginationResult,
  RenderReadinessResult,
} from '@/utils/teachingDocument'
import {
  createDefaultPrintLayout,
  DEFAULT_A4_PAPER,
  waitForRenderReadiness,
} from '@/utils/teachingDocument'
import { TeachingDocumentRenderer } from '../TeachingDocumentRenderer'
import { A4PaginationPreview } from '../A4PaginationPreview'
import { usePagination } from './usePagination'
import { createLayoutRequest, type LayoutRequest } from './useDeferredPaginationDocument'
import { TeachingDocumentLayoutCoordinator } from './layoutCoordinator'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * usePagination 单元测试（T5）
 *
 * 覆盖三个关键行为：
 * 1. 父层把分页结果回写为自身状态并触发重渲染时，measurement generation
 *    不得无限增长（对应 a4-generation 回归的历史故障）。
 * 2. 字体/图片未就绪（readiness.ready=false）时禁止宣称排版完成。
 * 3. 文档内容变化后分页结果随之更新（依赖未被掩盖）。
 *
 * 测试通过注入 geometryAdapter/readinessWait 绕过 JSDOM 无真实布局的限制，
 * 测量管线与 PaginatedCanvas/独立预览完全一致。
 */

const READY: RenderReadinessResult = {
  ready: true,
  timedOut: false,
  pendingFonts: false,
  pendingImages: [],
  pendingQuestions: [],
  pendingFigures: [],
  failedImages: [],
  diagnostics: [],
}

/** 每个顶层块测得 600px 高：A4 normal 有效内容高约 910px，故 1 块=1 页、2 块=2 页。 */
const geometry: GeometryAdapter = {
  measure(element) {
    if (element.matches('[data-teaching-document-header]')) {
      return { width: 600, height: 0, top: 0, bottom: 0 }
    }
    const height = element.matches('[data-teaching-block]') ? 600 : 0
    return { width: 600, height, top: 0, bottom: height }
  },
}

function documentWith(ids: string[]): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: '',
    metadata: {},
    content: ids.map((id) => ({
      type: 'paragraph' as const,
      id,
      content: [{ type: 'text' as const, text: id }],
    })),
  }
}

interface HarnessProps {
  document: TeachingDocumentV1
  readinessWait: typeof waitForRenderReadiness
  geometryAdapter?: GeometryAdapter
  debounceMs?: number
  defaultDebounce?: boolean
  layoutRequest?: LayoutRequest
  renderVersion?: string
  coordinator?: TeachingDocumentLayoutCoordinator
  /** 模拟父层把分页结果回写为自身状态（如页面层的 paginationState）。 */
  onPagination?: (pagination: PaginationResult | null) => void
}

/** 复刻 PaginatedCanvas 对 usePagination 的用法：隐藏测量树 + 派生分页状态。 */
function Harness(props: HarnessProps) {
  const [measureRoot, setMeasureRoot] = useState<HTMLElement | null>(null)
  const printLayout = useMemo(() => createDefaultPrintLayout(DEFAULT_A4_PAPER), [])
  const resolveQuestion = useCallback(() => ({ status: 'missing' as const, message: 'n/a' }), [])
  const resolveFigure = useCallback(() => ({ status: 'missing' as const }), [])
  const result = usePagination({
    document: props.document,
    paper: DEFAULT_A4_PAPER,
    printLayout,
    measureRoot,
    resolveQuestion,
    debounceMs: props.defaultDebounce ? undefined : props.debounceMs ?? 0,
    geometryAdapter: props.geometryAdapter ?? geometry,
    readinessWait: props.readinessWait,
    layoutRequest: props.layoutRequest,
    renderVersion: props.renderVersion,
    coordinator: props.coordinator,
  })
  const { onPagination } = props
  // 回写仅依赖 pagination 引用：与页面层用法一致，引用不变则不重复回写。
  useEffect(() => {
    onPagination?.(result.pagination)
  }, [result.pagination, onPagination])
  return (
    <>
      <div ref={setMeasureRoot} data-testid="measure-root">
        <TeachingDocumentRenderer
          document={props.document}
          resolveQuestion={resolveQuestion}
          resolveFigure={resolveFigure}
          eagerImages
          surface="paper"
        />
      </div>
      <div
        data-testid="pagination-state"
        data-ready={String(result.readiness.ready)}
        data-settled={String(result.settled)}
        data-generation={String(result.generation)}
        data-pages={String(result.pagination?.pages.length ?? 0)}
      />
    </>
  )
}

describe('usePagination', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
    vi.useRealTimers()
  })

  /** 推进假定时器并冲刷 React 更新，让防抖测量管线完整跑完。 */
  async function settle(rounds = 3) {
    for (let i = 0; i < rounds; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5)
      })
    }
  }

  function stateAttr(name: string): string | null {
    return container.querySelector('[data-testid="pagination-state"]')?.getAttribute(name) ?? null
  }

  it('内容变化后分页结果更新（依赖未被掩盖）', async () => {
    const readinessWait = vi.fn(async () => READY)
    root = createRoot(container)
    await act(async () => {
      root?.render(<Harness document={documentWith(['a', 'b'])} readinessWait={readinessWait} />)
    })
    await settle()
    expect(stateAttr('data-pages')).toBe('2')
    expect(stateAttr('data-ready')).toBe('true')
    expect(stateAttr('data-settled')).toBe('true')
    const callsBefore = readinessWait.mock.calls.length
    expect(callsBefore).toBeGreaterThanOrEqual(1)

    // 内容从 2 块变为 1 块 → 触发新一轮测量，页数随之更新。
    await act(async () => {
      root?.render(<Harness document={documentWith(['a'])} readinessWait={readinessWait} />)
    })
    await settle()
    expect(stateAttr('data-pages')).toBe('1')
    // 正文变化会重新测量并更新页数，但资源 revision 未变，不重复等待字体/图片/题目。
    expect(readinessWait.mock.calls.length).toBe(callsBefore)
  })

  it('re-measures only an edited top-level block', async () => {
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const readinessWait = vi.fn(async () => READY)
    const countedGeometry = { measure: vi.fn(geometry.measure) }
    const before = documentWith(['a', 'b', 'c'])
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <Harness
          document={before}
          readinessWait={readinessWait}
          geometryAdapter={countedGeometry}
          coordinator={coordinator}
        />,
      )
    })
    await settle()
    countedGeometry.measure.mockClear()

    const after: TeachingDocumentV1 = {
      ...before,
      content: before.content.map((block) => block.id === 'b'
        ? { ...block, content: [{ type: 'text' as const, text: 'changed' }] }
        : block),
    }
    await act(async () => {
      root?.render(
        <Harness
          document={after}
          readinessWait={readinessWait}
          geometryAdapter={countedGeometry}
          coordinator={coordinator}
        />,
      )
    })
    await settle()

    expect(countedGeometry.measure).toHaveBeenCalledTimes(1)
    expect(countedGeometry.measure.mock.calls[0][0].getAttribute('data-teaching-block-id')).toBe('b')
  })

  it('inserts a page break without re-measuring content blocks', async () => {
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const readinessWait = vi.fn(async () => READY)
    const countedGeometry = { measure: vi.fn(geometry.measure) }
    const before = documentWith(['a', 'b'])
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <Harness
          document={before}
          readinessWait={readinessWait}
          geometryAdapter={countedGeometry}
          coordinator={coordinator}
        />,
      )
    })
    await settle()
    countedGeometry.measure.mockClear()

    const after: TeachingDocumentV1 = {
      ...before,
      content: [before.content[0], { type: 'pageBreak', id: 'break' }, before.content[1]],
    }
    await act(async () => {
      root?.render(
        <Harness
          document={after}
          readinessWait={readinessWait}
          geometryAdapter={countedGeometry}
          coordinator={coordinator}
          layoutRequest={createLayoutRequest(1, 'structure', {
            dirtyBlockIds: ['break'],
            firstDirtyTopLevelIndex: 1,
            structureChanged: true,
            paperOrGlobalStyleChanged: false,
            resourceIdsChanged: [],
          })}
        />,
      )
    })
    await settle()

    expect(countedGeometry.measure).not.toHaveBeenCalled()
    expect(stateAttr('data-pages')).toBe('2')
  })

  it('serves undo and redo revisions from settled layout caches', async () => {
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const readinessWait = vi.fn(async () => READY)
    const countedGeometry = { measure: vi.fn(geometry.measure) }
    const before = documentWith(['a', 'b'])
    const after: TeachingDocumentV1 = {
      ...before,
      content: before.content.map((block) => block.id === 'b'
        ? { ...block, content: [{ type: 'text' as const, text: 'changed' }] }
        : block),
    }
    const render = async (document: TeachingDocumentV1) => {
      await act(async () => {
        root?.render(
          <Harness
            document={document}
            readinessWait={readinessWait}
            geometryAdapter={countedGeometry}
            coordinator={coordinator}
          />,
        )
      })
      await settle()
    }
    root = createRoot(container)
    await render(before)
    await render(after)
    countedGeometry.measure.mockClear()

    await render(before)
    await render(after)

    expect(countedGeometry.measure).not.toHaveBeenCalled()
    expect(stateAttr('data-settled')).toBe('true')
  })

  it('invalidates every block measurement when the resource revision changes', async () => {
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const readinessWait = vi.fn(async () => READY)
    const countedGeometry = { measure: vi.fn(geometry.measure) }
    const source = documentWith(['a', 'b'])
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <Harness
          document={source}
          readinessWait={readinessWait}
          geometryAdapter={countedGeometry}
          renderVersion="r1"
          coordinator={coordinator}
        />,
      )
    })
    await settle()
    countedGeometry.measure.mockClear()

    await act(async () => {
      root?.render(
        <Harness
          document={source}
          readinessWait={readinessWait}
          geometryAdapter={countedGeometry}
          renderVersion="r2"
          coordinator={coordinator}
        />,
      )
    })
    await settle()

    expect(countedGeometry.measure).toHaveBeenCalledTimes(2)
  })

  it('reuses stable resource readiness and invalidates it on render revision changes', async () => {
    const readinessWait = vi.fn(async () => READY)
    const source = documentWith(['a'])
    root = createRoot(container)
    await act(async () => {
      root?.render(<Harness document={source} readinessWait={readinessWait} renderVersion="r1" />)
    })
    await settle()
    expect(readinessWait).toHaveBeenCalledTimes(1)

    await act(async () => {
      root?.render(<Harness document={documentWith(['b'])} readinessWait={readinessWait} renderVersion="r1" />)
    })
    await settle()
    expect(readinessWait).toHaveBeenCalledTimes(1)

    await act(async () => {
      root?.render(<Harness document={documentWith(['b'])} readinessWait={readinessWait} renderVersion="r2" />)
    })
    await settle()
    expect(readinessWait).toHaveBeenCalledTimes(2)
  })

  it('only typing keeps the default 300ms pagination debounce', async () => {
    const readinessWait = vi.fn(async () => READY)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <Harness
          document={documentWith(['a'])}
          readinessWait={readinessWait}
          defaultDebounce
          layoutRequest={createLayoutRequest(1, 'typing')}
        />,
      )
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    expect(readinessWait).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(readinessWait).toHaveBeenCalled()

    act(() => root?.unmount())
    root = createRoot(container)
    readinessWait.mockClear()
    await act(async () => {
      root?.render(
        <Harness
          document={documentWith(['b'])}
          readinessWait={readinessWait}
          defaultDebounce
          layoutRequest={createLayoutRequest(2, 'structure')}
        />,
      )
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(readinessWait).toHaveBeenCalled()
  })

  it('字体/图片未就绪时 ready=false，且未 settled 前不产出分页', async () => {
    let releaseReadiness: ((value: RenderReadinessResult) => void) | undefined
    const controlledReadiness = () =>
      new Promise<RenderReadinessResult>((resolve) => {
        releaseReadiness = resolve
      })
    root = createRoot(container)
    await act(async () => {
      root?.render(<Harness document={documentWith(['a'])} readinessWait={controlledReadiness} />)
    })
    await settle()
    // readiness 悬挂：ready=false、pagination 为空，禁止宣称排版完成。
    expect(stateAttr('data-ready')).toBe('false')
    expect(stateAttr('data-pages')).toBe('0')
    expect(stateAttr('data-settled')).toBe('false')

    // 以“字体未就绪”结算：ready 仍为 false（即便随后完成测量也不宣称稳定）。
    await act(async () => {
      releaseReadiness?.({ ...READY, ready: false, pendingFonts: true })
    })
    await settle()
    expect(stateAttr('data-ready')).toBe('false')
  })

  it('父层回写分页结果不导致 measurement generation 无限增长', async () => {
    const readinessWait = vi.fn(async () => READY)
    // 失控守卫：若回写引发 resolver/effect 循环，readinessWait 调用将无界增长；
    // 超过 20 次即同步抛错，使回归快速失败（与 a4-generation 测试一致）。
    readinessWait.mockImplementation(async () => {
      if (readinessWait.mock.calls.length > 20) {
        throw new Error('检测到 measurement generation 失控循环：readinessWait 调用超过 20 次')
      }
      return READY
    })

    const doc = documentWith(['a', 'b'])
    function Parent() {
      const [mirror, setMirror] = useState<PaginationResult | null>(null)
      const [tick, setTick] = useState(0)
      return (
        <>
          <Harness document={doc} readinessWait={readinessWait} onPagination={setMirror} />
          <div data-testid="mirror-pages">{mirror?.pages.length ?? 0}</div>
          <span data-testid="tick">{tick}</span>
          <button type="button" data-testid="force-rerender" onClick={() => setTick((value) => value + 1)}>
            rerender
          </button>
        </>
      )
    }

    root = createRoot(container)
    await act(async () => {
      root?.render(<Parent />)
    })
    await settle()

    // 初始分页完成并已回写父层。
    expect(container.querySelector('[data-testid="mirror-pages"]')?.textContent).toBe('2')
    const callsAfterSettle = readinessWait.mock.calls.length
    expect(callsAfterSettle).toBeGreaterThanOrEqual(1)
    expect(callsAfterSettle).toBeLessThanOrEqual(2)

    // 多次触发父层重渲染（回写 + 手动 rerender）：generation 不得增长。
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="force-rerender"]')?.click()
      })
      await settle()
    }
    expect(readinessWait.mock.calls.length).toBe(callsAfterSettle)
    expect(container.querySelector('[data-testid="mirror-pages"]')?.textContent).toBe('2')
    expect(stateAttr('data-pages')).toBe('2')
  })

  it('deduplicates one layout key across editor pagination and A4 preview', async () => {
    const coordinator = new TeachingDocumentLayoutCoordinator()
    const readinessWait = vi.fn(async () => READY)
    const countedGeometry = { measure: vi.fn(geometry.measure) }
    const source = documentWith(['shared'])
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <>
          <Harness
            document={source}
            readinessWait={readinessWait}
            geometryAdapter={countedGeometry}
            coordinator={coordinator}
          />
          <A4PaginationPreview
            document={source}
            paper={DEFAULT_A4_PAPER}
            printLayout={createDefaultPrintLayout(DEFAULT_A4_PAPER)}
            geometryAdapter={countedGeometry}
            readinessWait={readinessWait}
            coordinator={coordinator}
          />
        </>,
      )
    })
    await settle()

    expect(readinessWait).toHaveBeenCalledTimes(1)
    expect(countedGeometry.measure).toHaveBeenCalledTimes(1)
    expect(stateAttr('data-pages')).toBe('1')
    expect(container.querySelectorAll('[data-teaching-page-index]')).toHaveLength(1)
  })
})
