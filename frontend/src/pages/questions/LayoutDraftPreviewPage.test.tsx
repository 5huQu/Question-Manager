import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LayoutDraftPreviewPage from './LayoutDraftPreviewPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  exportPdf: vi.fn(),
}))

vi.mock('@/api/layoutDrafts', () => ({
  layoutDraftsApi: {
    get: mocks.get,
    export: mocks.exportPdf,
  },
}))

vi.mock('@/components/questions/PdfPreviewCanvas', () => ({
  PdfPreviewCanvas: ({ variant }: { variant: string }) => <div>preview:{variant}</div>,
}))

const draft = {
  id: 'draft-1',
  name: '版本选择测试',
  revision: 3,
  variant: 'teacher',
  preview: {
    status: 'ready',
    warnings: [],
    variants: {
      student: { pdfUrl: '/student.pdf', pages: [], pageImages: [], pageCount: 1 },
      teacher: { pdfUrl: '/teacher.pdf', pages: [], pageImages: [], pageCount: 1 },
    },
  },
}

describe('LayoutDraftPreviewPage', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.get.mockResolvedValue({ draft })
    mocks.exportPdf.mockResolvedValue({ url: '/export.pdf' })
    vi.spyOn(window, 'open').mockImplementation(() => null)
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/questions/layout-drafts/draft-1/preview']}>
          <Routes>
            <Route path="/questions/layout-drafts/:draftId/preview" element={<LayoutDraftPreviewPage />} />
          </Routes>
        </MemoryRouter>,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('最终导出始终使用当前正在查看的版本', async () => {
    const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)

    expect(button('导出学生版')).toBeTruthy()
    await act(async () => button('导出学生版')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(mocks.exportPdf).toHaveBeenLastCalledWith('draft-1', 3, 'student')

    act(() => button('教师版')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(button('导出教师版')).toBeTruthy()
    await act(async () => button('导出教师版')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(mocks.exportPdf).toHaveBeenLastCalledWith('draft-1', 3, 'teacher')
  })
})
