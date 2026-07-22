import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui'

export function Modal({ title, desc, children, onClose, wide, locked, actions }: { title: string; desc?: string; children: ReactNode; onClose: () => void; wide?: boolean; locked?: boolean; actions?: ReactNode }) {
  const widthClass = locked && wide ? 'w-full max-w-[calc(100vw-2rem)]' : wide ? 'w-full max-w-7xl' : 'w-full max-w-2xl'
  const frameClass = `${locked ? 'flex h-[92vh] flex-col overflow-hidden' : 'max-h-[92vh] overflow-auto'} rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 ${widthClass} text-zinc-950 dark:text-zinc-50`
  const bodyClass = locked ? 'min-h-0 flex-1 overflow-hidden p-4' : 'p-4'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className={frameClass}>
        <div className="flex flex-none items-start justify-between gap-4 border-b border-zinc-100 dark:border-zinc-900 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {desc ? <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{desc}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50" onClick={onClose}>
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className={bodyClass}>{children}</div>
      </div>
    </div>
  )
}

export function LargeImageDialog({ title, caption, imageUrl, secondaryImageUrl, onClose }: { title: string; caption?: string; imageUrl: string; secondaryImageUrl?: string; onClose: () => void }) {
  const [isFit, setIsFit] = useState(true)
  const [zoom, setZoom] = useState(100)
  const [naturalWidth, setNaturalWidth] = useState<number>(0)
  const [naturalWidthSecondary, setNaturalWidthSecondary] = useState<number>(0)

  const imgStyle = isFit
    ? {
        maxHeight: 'calc(92vh - 180px)',
        maxWidth: '100%',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain' as const,
      }
    : {
        width: naturalWidth ? `${naturalWidth * (zoom / 100)}px` : 'auto',
        maxWidth: 'none',
        maxHeight: 'none',
      }

  const imgStyleSecondary = isFit
    ? {
        maxHeight: 'calc(92vh - 180px)',
        maxWidth: '100%',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain' as const,
      }
    : {
        width: naturalWidthSecondary ? `${naturalWidthSecondary * (zoom / 100)}px` : 'auto',
        maxWidth: 'none',
        maxHeight: 'none',
      }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50">
        <div className="flex flex-none items-center justify-between gap-4 border-b border-zinc-100 dark:border-zinc-900 px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{title}</h3>
            {caption ? <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{caption}</p> : null}
          </div>
          <button className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 w-full overflow-auto bg-zinc-50 dark:bg-zinc-900/30 p-4">
          <div className={`w-full mx-auto flex flex-col space-y-3 min-h-full ${isFit ? 'items-center justify-center' : 'items-start justify-start'}`}>
            {secondaryImageUrl ? <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">题干裁图</div> : null}
            <img
              alt={title}
              className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm transition-all duration-200 p-2"
              style={imgStyle}
              src={imageUrl}
              onLoad={(e) => setNaturalWidth(e.currentTarget.naturalWidth)}
            />
            {secondaryImageUrl ? (
              <>
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mt-4">对应答案解析裁图</div>
                <img
                  alt={`${title} 解析裁图`}
                  className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm transition-all duration-200 p-2"
                  style={imgStyleSecondary}
                  src={secondaryImageUrl}
                  onLoad={(e) => setNaturalWidthSecondary(e.currentTarget.naturalWidth)}
                />
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-none flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setIsFit(true)
                setZoom(100)
              }}
              className={`px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                isFit
                  ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-semibold'
                  : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
              }`}
            >
              自适应大小
            </button>
            <button
              onClick={() => {
                setIsFit(false)
                setZoom(100)
              }}
              className={`px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                !isFit && zoom === 100
                  ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-950 font-semibold'
                  : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
              }`}
            >
              原始大小 (100%)
            </button>
            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1" />
            <button
              onClick={() => {
                setIsFit(false)
                setZoom(prev => Math.max(25, prev - 25))
              }}
              className="px-2 py-1 rounded border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 cursor-pointer font-bold text-sm"
              title="缩小"
            >
              -
            </button>
            <span className="w-12 text-center font-medium">
              {isFit ? '自适应' : `${zoom}%`}
            </span>
            <button
              onClick={() => {
                setIsFit(false)
                setZoom(prev => Math.min(400, prev + 25))
              }}
              className="px-2 py-1 rounded border border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 cursor-pointer font-bold text-sm"
              title="放大"
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span>中间区域可滚动查看完整题图</span>
            <Button size="sm" variant="outline" icon={X} onClick={onClose}>关闭</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
