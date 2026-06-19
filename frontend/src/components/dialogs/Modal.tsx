import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui'
import type { SliceReviewItem } from '@/types'

export function Modal({ title, desc, children, onClose, wide, locked, actions }: { title: string; desc?: string; children: ReactNode; onClose: () => void; wide?: boolean; locked?: boolean; actions?: ReactNode }) {
  const widthClass = locked && wide ? 'w-full max-w-[calc(100vw-2rem)]' : wide ? 'w-full max-w-7xl' : 'w-full max-w-2xl'
  const frameClass = `${locked ? 'flex h-[92vh] flex-col overflow-hidden' : 'max-h-[92vh] overflow-auto'} rounded-2xl border bg-white shadow-2xl ${widthClass}`
  const bodyClass = locked ? 'min-h-0 flex-1 overflow-hidden p-4' : 'p-4'
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"><div className={frameClass}><div className="flex flex-none items-start justify-between gap-4 border-b px-4 py-3"><div><h3 className="text-base font-semibold">{title}</h3>{desc ? <p className="mt-1 text-xs text-zinc-500">{desc}</p> : null}</div><div className="flex items-center gap-2">{actions}<button className="rounded-md border p-2 hover:bg-zinc-50" onClick={onClose}><X className="size-4" /></button></div></div><div className={bodyClass}>{children}</div></div></div>
}

export function ImagePreviewDialog({ item, onClose }: { item: SliceReviewItem; onClose: () => void }) {
  return (
    <LargeImageDialog
      caption={`P${item.pageStart}${item.pageEnd !== item.pageStart ? `-P${item.pageEnd}` : ''}`}
      imageUrl={item.imageUrl}
      onClose={onClose}
      title={`第 ${item.questionLabel || '?'} 题大图`}
    />
  )
}

export function LargeImageDialog({ title, caption, imageUrl, onClose }: { title: string; caption?: string; imageUrl: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex flex-none items-center justify-between gap-4 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{title}</h3>
            {caption ? <p className="mt-1 text-xs text-zinc-500">{caption}</p> : null}
          </div>
          <button className="rounded-md border p-2 hover:bg-zinc-50" onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-zinc-100 p-4">
          <div className="mx-auto w-full max-w-5xl">
            <img alt={title} className="w-full rounded-xl border bg-white shadow-sm" src={imageUrl} />
          </div>
        </div>
        <div className="flex flex-none items-center justify-between gap-3 border-t bg-white px-4 py-3 text-xs text-zinc-500">
          <span>中间区域可滚动查看完整题图</span>
          <Button size="sm" variant="outline" icon={X} onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  )
}
