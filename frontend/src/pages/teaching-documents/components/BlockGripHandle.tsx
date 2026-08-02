/**
 * BlockGripHandle — 顶层块拖拽手柄（Word 风格）
 *
 * 悬停在顶层块上时于左侧显示 grip 图标；按住手柄立即进入块拖拽
 * （无位移阈值），由画布根部的拖拽钩子通过 [data-block-grip] 拦截。
 *
 * 定位：手柄渲染在画布内容容器内（绝对定位），top 按块的中心相对容器计算——
 * 容器随滚动自然移动，无需 scroll 监听；仅当块尺寸/位置变化（缩放、排版）时
 * 通过 ResizeObserver 与窗口 resize 刷新。
 */
import { useLayoutEffect, useState } from 'react'
import { GripVertical } from 'lucide-react'

export function BlockGripHandle({ blockId, anchorRoot }: { blockId: string; anchorRoot: HTMLElement | null }) {
  const [top, setTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!blockId || !anchorRoot) {
      setTop(null)
      return
    }
    const updatePosition = () => {
      const block = anchorRoot.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
      if (!block) {
        setTop(null)
        return
      }
      const blockRect = block.getBoundingClientRect()
      const rootRect = anchorRoot.getBoundingClientRect()
      setTop(blockRect.top - rootRect.top + blockRect.height / 2)
    }
    updatePosition()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    observer?.observe(anchorRoot)
    window.addEventListener('resize', updatePosition)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updatePosition)
    }
  }, [anchorRoot, blockId])

  if (top === null) return null

  return (
    <div
      data-block-grip={blockId}
      title="拖拽排序（按住手柄上下拖动）"
      aria-label="拖拽排序"
      className="absolute z-20 -translate-y-1/2 cursor-grab text-zinc-300 opacity-70 transition-opacity hover:opacity-100 hover:text-zinc-500 active:cursor-grabbing dark:text-zinc-600 dark:hover:text-zinc-300"
      style={{ top, left: -26 }}
    >
      <GripVertical className="size-4" />
    </div>
  )
}
