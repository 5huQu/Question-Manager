import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewState } from '@/api/layoutDrafts'
import { PdfPreviewCanvas } from './PdfPreviewCanvas'

const variant = { pdfUrl: '/assets/r4/student.pdf', pages: ['/assets/r4/student-page-1.png'], pageImages: ['/assets/r4/student-page-1.png'], pageCount: 1 }
function preview(overrides: Partial<PreviewState> = {}): PreviewState {
  return { revision: 5, displayRevision: 4, status: 'queued', pdfUrl: '', pages: [], pageImages: [], pageCount: 0, variants: { student: variant, teacher: variant }, warnings: [], error: '', ...overrides }
}

describe('PdfPreviewCanvas', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('keeps the previous PDF pages visible while a new revision is compiling', () => {
    act(() => root.render(<PdfPreviewCanvas preview={preview()} variant="student"/>))
    expect(container.textContent).toContain('正在生成 r5 PDF，当前显示 r4')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/r4/student-page-1.png')
  })

  it('keeps the previous pages and exposes retry after compilation fails', () => {
    const retry = vi.fn()
    act(() => root.render(<PdfPreviewCanvas preview={preview({ status: 'failed', error: '编译失败' })} variant="student" onRetry={retry}/>))
    expect(container.textContent).toContain('r5 PDF 生成失败，继续显示 r4')
    act(() => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(retry).toHaveBeenCalledOnce()
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('highlights the page associated with the selected question', () => {
    act(() => root.render(<PdfPreviewCanvas preview={preview({ revision: 4, displayRevision: 4, status: 'ready' })} variant="student" activePage={1}/>))
    expect(container.querySelector('[data-pdf-preview-page="1"]')?.className).toContain('ring-amber-400')
  })
})
