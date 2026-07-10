import type { MutableRefObject } from 'react'
import type { BBox } from '@/types'
import { BBoxCanvas, type BBoxCanvasBox } from '@/components/questions/BBoxCanvas'

interface Props {
  candidate: any
  activeSourceDocumentId: string
  currentPage: number
  pageBrowseMode: 'manual' | 'continuous'
  pageNumbers: number[]
  rect: BBox
  scrollAreaRef: MutableRefObject<HTMLDivElement | null>
  pageContainerRefs: MutableRefObject<Map<number, HTMLDivElement | null>>
  getPageImageRef: (page: number) => { current: HTMLImageElement | null }
  canvasBoxesForPage: (page: number) => BBoxCanvasBox[]
  selectedBoxIdForPage: (page: number) => string | undefined
  onSelectBoxId: (id: string) => void
  onRectChange: (rect: BBox, page: number) => void
  onDeleteSelected: () => void
  onNaturalSizeReady: (size: { width: number; height: number }, page: number) => void
  onFocusPage: (page: number) => void
}

export function ManualFixDocumentViewer(props: Props) {
  const canvas = (page: number) => (
    <BBoxCanvas
      key={`${props.activeSourceDocumentId}:${page}`}
      imageUrl={`/api/import-flow-v2/source-documents/${props.activeSourceDocumentId || props.candidate.sourceDocumentId}/pages/${page}`}
      boxes={props.canvasBoxesForPage(page)}
      selectedBoxId={props.selectedBoxIdForPage(page)}
      onSelectBoxId={props.onSelectBoxId}
      rect={props.currentPage === page ? props.rect : { x: 0, y: 0, width: 0, height: 0 }}
      onRectChange={(rect) => props.onRectChange(rect, page)}
      onDeleteSelectedBox={props.onDeleteSelected}
      naturalSizeReady={(size) => props.onNaturalSizeReady(size, page)}
      imageRef={props.getPageImageRef(page)}
    />
  )
  return (
    <div ref={props.scrollAreaRef} className="flex-1 overflow-auto p-4">
      {props.candidate && props.pageBrowseMode === 'manual' ? (
        <div className="mx-auto w-full max-w-[800px]"><div ref={(node) => { props.pageContainerRefs.current.set(props.currentPage, node) }} className="scroll-mt-4">{canvas(props.currentPage)}</div></div>
      ) : null}
      {props.candidate && props.pageBrowseMode === 'continuous' ? (
        <div className="mx-auto flex w-full max-w-[800px] flex-col gap-5">
          {props.pageNumbers.map((page) => <div key={`${props.activeSourceDocumentId}:${page}`} ref={(node) => { props.pageContainerRefs.current.set(page, node) }} className="scroll-mt-4">
            <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500"><span className="font-semibold text-zinc-700 dark:text-zinc-300">第 {page} 页</span><button type="button" onClick={() => props.onFocusPage(page)} className="rounded border border-zinc-200 bg-white px-2 py-1 font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900">设为当前页</button></div>
            {canvas(page)}
          </div>)}
        </div>
      ) : null}
    </div>
  )
}
