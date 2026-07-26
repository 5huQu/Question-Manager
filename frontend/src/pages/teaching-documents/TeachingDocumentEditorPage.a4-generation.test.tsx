import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionItem } from '@/types'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import TeachingDocumentEditorPage from './TeachingDocumentEditorPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 回归测试：父层状态回写不得导致重复 generation/readiness 循环。
 *
 * 历史故障：TeachingDocumentEditorPage 每次 render 重建 resolveQuestion/resolveFigure，
 * A4PaginationPreview 的测量 effect 依赖 resolveQuestion，onPaginationState 回写父状态后
 * 父 render 使 resolver 引用变化，effect 重跑，measurement generation 无限增长（实测 g15716），
 * 预览永远停在"正在准备排版资源"，最终 resource-timeout + measurement-missing，0 页。
 */

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  waitForRenderReadiness: vi.fn(),
  editor: { current: null as unknown },
}))

vi.mock('@/api/questionBank', () => ({
  questionBankApi: { getItem: mocks.getItem, listItems: vi.fn() },
}))

vi.mock('./useTeachingDocumentEditor', () => ({
  useTeachingDocumentEditor: () => mocks.editor.current,
}))

// readiness 等待立即就绪：使循环机制（若存在）只由 React 调度驱动，测试有界且确定。
vi.mock('@/utils/teachingDocument', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/teachingDocument')>()
  return { ...actual, waitForRenderReadiness: mocks.waitForRenderReadiness }
})

const questionItem: QuestionItem = {
  id: 'q1',
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
  content: [
    { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '本讲内容' }] },
    { type: 'question', id: 'qb1', questionId: 'q1', display: { displayNumber: '1' } },
  ],
}

function makeEditor() {
  return {
    record: { id: 'doc-1', revision: 3, assets: [], title: teachingDoc.title, content: teachingDoc },
    history: { past: [], future: [], document: teachingDoc },
    document: teachingDoc,
    loading: false,
    loadError: '',
    saveState: 'saved',
    saveError: '',
    conflict: null,
    validation: { valid: true, issues: [] },
    dispatch: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    saveNow: vi.fn(),
    reload: vi.fn(),
    uploadAsset: vi.fn(),
  }
}

describe('TeachingDocumentEditorPage A4 分页 generation 稳定性', () => {
  let root: Root | null = null
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getItem.mockReset()
    mocks.getItem.mockResolvedValue(questionItem)
    mocks.waitForRenderReadiness.mockReset()
    // 失控守卫：若 resolver 引用不稳定导致测量 effect 反复重跑，readinessWait 调用次数会
    // 无界增长并在 act 内部形成自持循环（挂死）。超过 20 次即同步抛错，使回归快速失败。
    mocks.waitForRenderReadiness.mockImplementation(() => {
      if (mocks.waitForRenderReadiness.mock.calls.length > 20) {
        throw new Error('检测到 measurement generation 失控循环：readinessWait 调用超过 20 次')
      }
      return Promise.resolve({
        ready: true,
        timedOut: false,
        pendingFonts: false,
        pendingImages: [],
        pendingQuestions: [],
        pendingFigures: [],
        failedImages: [],
        diagnostics: [],
      })
    })
    mocks.editor.current = makeEditor()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
    vi.useRealTimers()
  })

  async function flush(times: number) {
    for (let i = 0; i < times; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25)
      })
    }
  }

  it('父层 paginationState 回写不导致重复 generation/readiness 循环', async () => {
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/teaching-documents/doc-1']}>
          <Routes>
            <Route path="/teaching-documents/:documentId" element={<TeachingDocumentEditorPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    // 切到 A4 分页实验
    const a4Button = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('A4 分页实验'))
    expect(a4Button).toBeTruthy()
    await act(async () => {
      a4Button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 驱动测量流水线，直到状态栏产出分页页数（有界，防止回归时挂死）
    for (let i = 0; i < 40 && !/\d+ 页/.test(container.textContent ?? ''); i += 1) {
      await flush(1)
    }
    // 再充分冲刷若干轮，让所有合法重测（questionMap loading→loaded）完成
    await flush(8)

    // 分页稳定产出且无 resource-timeout（readiness 立即就绪）
    expect(container.textContent).toMatch(/\d+ 页/)
    expect(container.textContent).toContain('资源与布局已稳定')
    expect(container.textContent).not.toContain('正在准备排版资源')
    expect(container.textContent).not.toContain('resource-timeout')
    // 题目经 questionBank API wrapper 真实装载（resolver 数据依赖未被掩盖）
    expect(mocks.getItem).toHaveBeenCalledWith('q1')

    // generation/readiness 循环次数以 readinessWait 实际调用为准：
    // DOM 文本中 "测量 g1" 会与相邻的诊断计数拼接（如 "测量 g16 项诊断"），
    // 用正则从 textContent 提取 generation 不可靠。
    const settledGenerations = mocks.waitForRenderReadiness.mock.calls.length
    // 合法 generation：初始 1 次 + questionMap 装载引起的重测（≤2 次），绝不允许无限增长
    expect(settledGenerations).toBeGreaterThanOrEqual(1)
    expect(settledGenerations).toBeLessThanOrEqual(3)

    // 关键回归断言：此后父层 paginationState 回写触发的重渲染，
    // 不得再引发新的 measurement generation / readiness 循环。
    const pageCountBefore = container.textContent?.match(/(\d+) 页/)?.[1]
    await flush(12)
    expect(mocks.waitForRenderReadiness.mock.calls.length).toBe(settledGenerations)
    // 页数保持稳定，状态栏无 preparing/timeout
    expect(container.textContent?.match(/(\d+) 页/)?.[1]).toBe(pageCountBefore)
    expect(container.textContent).not.toContain('正在准备排版资源')
  })

  it('questionMap 数据变化（题目装载）仍触发正确的重新测量，依赖未被掩盖', async () => {
    // 门控 getItem：让题目在 A4 挂载后才完成装载，以验证 useCallback 稳定引用
    // 没有掩盖真实数据依赖（questionMap 变化仍应重测，且只重测一轮）。
    let releaseGetItem: ((question: QuestionItem) => void) | null = null
    mocks.getItem.mockImplementation(() => new Promise<QuestionItem>((resolve) => {
      releaseGetItem = resolve
    }))

    root = createRoot(container)
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/teaching-documents/doc-1']}>
          <Routes>
            <Route path="/teaching-documents/:documentId" element={<TeachingDocumentEditorPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    // 切到 A4（此时题目仍为 loading 占位）
    const a4Button = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('A4 分页实验'))
    expect(a4Button).toBeTruthy()
    await act(async () => {
      a4Button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    for (let i = 0; i < 40 && !/\d+ 页/.test(container.textContent ?? ''); i += 1) {
      await flush(1)
    }
    await flush(4)

    // 初始测量完成（题目 loading 占位），记录当前 generation 数
    const generationsBeforeLoad = mocks.waitForRenderReadiness.mock.calls.length
    expect(generationsBeforeLoad).toBeGreaterThanOrEqual(1)

    // 题目装载完成 → questionMap 变化 → resolver 引用变化 → 应触发重新测量
    expect(releaseGetItem).not.toBeNull()
    await act(async () => {
      releaseGetItem?.(questionItem)
    })
    await flush(8)

    const generationsAfterLoad = mocks.waitForRenderReadiness.mock.calls.length
    // 数据依赖未被掩盖：题目装载恰好触发一轮重测——
    // 若引用稳定被误用为掩盖依赖，则为 +0；若形成循环，则远大于 +1。
    expect(generationsAfterLoad).toBe(generationsBeforeLoad + 1)
    // 分页稳定产出、无 resource-timeout
    expect(container.textContent).toMatch(/\d+ 页/)
    expect(container.textContent).toContain('资源与布局已稳定')
    expect(container.textContent).not.toContain('resource-timeout')
    // 重测使用的是新鲜 resolver（非过期闭包）：题目题干应渲染出来，
    // 若 resolveQuestion 依赖被掩盖（如 deps=[]），重测会拿到过期 questionMap，
    // 题目渲染为 missing，题干不会出现。
    expect(container.textContent).toContain('求值。')
  })
})
