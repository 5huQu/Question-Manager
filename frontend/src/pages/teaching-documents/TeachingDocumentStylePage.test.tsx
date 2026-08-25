import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import TeachingDocumentStylePage from './TeachingDocumentStylePage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ editor: { current: null as unknown } }))

vi.mock('./useTeachingDocumentEditor', () => ({
  useTeachingDocumentEditor: () => mocks.editor.current,
}))

vi.mock('./useTeachingDocumentQuestions', () => ({
  useTeachingDocumentQuestions: () => ({ resolveQuestion: undefined, resolveFigure: undefined }),
}))

const teachingDocument: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '函数讲义',
  metadata: {},
  content: [],
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('TeachingDocumentStylePage', () => {
  it('uses an internal anchor for returning to the editor', async () => {
    mocks.editor.current = {
      record: { id: 'doc-1', revision: 1, assets: [], title: teachingDocument.title, content: teachingDocument },
      document: teachingDocument,
      loading: false,
      loadError: '',
      saveState: 'saved',
      saveError: '',
      dispatch: vi.fn(),
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(
      <MemoryRouter initialEntries={['/teaching-documents/doc-1/style']}>
        <Routes><Route path="/teaching-documents/:documentId/style" element={<TeachingDocumentStylePage />} /></Routes>
      </MemoryRouter>,
    ))
    const returnLink = Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).find((anchor) => anchor.textContent?.includes('返回文档'))
    expect(returnLink?.getAttribute('href')).toBe('/teaching-documents/doc-1')
  })
})
