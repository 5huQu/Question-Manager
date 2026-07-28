import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import TeachingDocumentPrintPage from './TeachingDocumentPrintPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getItem: vi.fn(),
}))

vi.mock('@/api/teachingDocuments', () => ({
  teachingDocumentsApi: { getDocument: mocks.getDocument },
}))

vi.mock('@/api/questionBank', () => ({
  questionBankApi: { getItem: mocks.getItem },
}))

function simpleDocument(): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: '三角函数专题',
    metadata: {},
    content: [
      { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '甲乙丙丁' }] },
    ],
  }
}

function recordWith(revision: number) {
  return {
    id: 'doc-1',
    title: '三角函数专题',
    documentType: 'lecture',
    schemaVersion: 1,
    revision,
    content: simpleDocument(),
    blockCount: 1,
    issues: [],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('TeachingDocumentPrintPage', () => {
  let container: HTMLDivElement
  let root: Root
  let notifyReady: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    notifyReady = vi.fn()
    ;(window as unknown as { questionWorkbench: unknown }).questionWorkbench = {
      pdfExport: { notifyReady },
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  function renderPrintRoute(query: string) {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[`/print/teaching-document${query}`]}>
          <Routes>
            <Route path="/print/teaching-document" element={<TeachingDocumentPrintPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })
  }

  it('immediately notifies failure when revision mismatches the server', async () => {
    // 服务端实际 revision=5，请求 revision=3 → 禁止导出并立即通知主进程失败。
    mocks.getDocument.mockResolvedValue(recordWith(5))
    renderPrintRoute('?docId=doc-1&revision=3')
    await flush()
    await flush()
    expect(notifyReady).toHaveBeenCalledTimes(1)
    const payload = notifyReady.mock.calls[0][0]
    expect(payload.error).toContain('revision 不一致')
    expect(payload.pageCount).toBeUndefined()
  })

  it('immediately notifies failure when the document fails to load', async () => {
    mocks.getDocument.mockRejectedValue(new Error('网络错误'))
    renderPrintRoute('?docId=doc-1&revision=3')
    await flush()
    await flush()
    expect(notifyReady).toHaveBeenCalledTimes(1)
    const payload = notifyReady.mock.calls[0][0]
    expect(typeof payload.error).toBe('string')
    expect(payload.error.length).toBeGreaterThan(0)
  })

  it('injects the saved document fonts into the print document', async () => {
    const record = recordWith(3)
    record.content.style = { bodyFont: 'kaiti', headingFont: 'songti' }
    mocks.getDocument.mockResolvedValue(record)
    renderPrintRoute('?docId=doc-1&revision=3')
    await flush()
    await flush()
    const printRoot = container.querySelector<HTMLElement>('[data-teaching-print-document]')
    expect(printRoot?.style.getPropertyValue('--td-body-font')).toContain('Kaiti SC')
    expect(printRoot?.style.getPropertyValue('--td-heading-font')).toContain('Songti SC')
  })

  it('notifies the main process once layout settles instead of waiting for the 30s timeout', async () => {
    vi.useFakeTimers()
    try {
      mocks.getDocument.mockResolvedValue(recordWith(3))
      renderPrintRoute('?docId=doc-1&revision=3')
      // 驱动文档加载微任务与 readiness 的 rAF/定时器，直至 notifyReady 被调用。
      for (let i = 0; i < 60 && notifyReady.mock.calls.length === 0; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50)
        })
      }
      // 关键：测量结束后必须立即通知主进程，不能静默等待主进程 30s 超时。
      expect(notifyReady).toHaveBeenCalledTimes(1)
      const payload = notifyReady.mock.calls[0][0]
      // 就绪时报告页数（降级 warning 允许）；jsdom 测量产生阻塞诊断时报告 error。二者必有其一。
      if (payload.error === undefined) {
        expect(typeof payload.pageCount).toBe('number')
        expect(payload.pageCount).toBeGreaterThanOrEqual(1)
      } else {
        expect(typeof payload.error).toBe('string')
        expect(payload.error.length).toBeGreaterThan(0)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})
