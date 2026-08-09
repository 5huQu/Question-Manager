import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_A4_PAPER } from '@/utils/teachingDocument'
import { ExportPdfPanel } from './ExportPdfPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ExportPdfPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.documentElement.style.fontSize = ''
    vi.restoreAllMocks()
  })

  it('passes the editor root font size to the standalone print page', () => {
    document.documentElement.style.fontSize = '18.4px'
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    act(() => {
      root.render(
        <ExportPdfPanel
          documentId="doc-1"
          revision={3}
          saveState="saved"
          hasRevisionConflict={false}
          paginationState={null}
          variant="student"
          paper={DEFAULT_A4_PAPER}
        />,
      )
    })

    act(() => container.querySelector('button')?.click())
    const url = new URL(open.mock.calls[0][0] as string)
    expect(url.searchParams.get('rootFontSize')).toBe('18.4')
  })
})
