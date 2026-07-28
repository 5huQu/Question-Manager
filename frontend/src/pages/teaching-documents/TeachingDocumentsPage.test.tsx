import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TeachingDocumentsPage from './TeachingDocumentsPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  duplicateDocument: vi.fn(),
  deleteDocument: vi.fn(),
}))

vi.mock('@/api/teachingDocuments', () => ({
  teachingDocumentsApi: mocks,
}))

function Location() {
  return <div data-location>{useLocation().pathname}</div>
}

describe('TeachingDocumentsPage', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.listDocuments.mockResolvedValue({
      items: [{
        id: 'doc-1',
        title: '函数讲义',
        documentType: 'lecture',
        schemaVersion: 1,
        revision: 2,
        blockCount: 5,
        assetCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }],
    })
    mocks.createDocument.mockResolvedValue({ id: 'doc-new' })
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/teaching-documents']}>
          <Location />
          <Routes>
            <Route path="/teaching-documents" element={<TeachingDocumentsPage />} />
            <Route path="/teaching-documents/:documentId" element={<div>编辑器</div>} />
          </Routes>
        </MemoryRouter>,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('lists persisted documents and opens an existing document', () => {
    expect(container.textContent).toContain('函数讲义')
    const row = [...container.querySelectorAll('[role="button"]')].find((el) => el.textContent?.includes('函数讲义'))
    act(() => row?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('[data-location]')?.textContent).toBe('/teaching-documents/doc-1')
  })

  it('creates a document without exposing the internal document type', async () => {
    const createTrigger = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('新建文档'))
    await act(async () => {
      createTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mocks.createDocument).toHaveBeenCalledWith({ title: '未命名文档', documentType: 'lecture' })
    expect(container.querySelector('[data-location]')?.textContent).toBe('/teaching-documents/doc-new')
  })
})
