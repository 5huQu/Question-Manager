import { useCallback, useLayoutEffect, useRef, type DragEvent, type PointerEvent } from 'react'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'

interface BlockDragReorderOptions {
  document: TeachingDocumentV1
  onSelect: (blockId: string) => void
  onReorder: (order: string[], mergeKey: string) => void
}

/**
 * 为文档画布的顶层块提供原生拖放排序。
 * 块内控件维持原有交互；拖到目标块的上/下半区决定插入位置。
 */
export function useBlockDragReorder({ document, onSelect, onReorder }: BlockDragReorderOptions) {
  const draggedIdRef = useRef('')
  const dropTargetRef = useRef<HTMLElement | null>(null)
  const previousLayoutRef = useRef<Map<string, DOMRect>>(new Map())
  const rootRef = useRef<HTMLElement | null>(null)
  const topLevelIds = new Set(document.content.map((block) => block.id))

  const captureLayout = useCallback((root: HTMLElement) => {
    return new Map(
      [...root.querySelectorAll<HTMLElement>('[data-block-id]')]
        .filter((element) => topLevelIds.has(element.dataset.blockId || ''))
        .map((element) => [element.dataset.blockId || '', element.getBoundingClientRect()]),
    )
  }, [topLevelIds])

  const clearDropTarget = useCallback(() => {
    dropTargetRef.current?.classList.remove('td-block-drop-before', 'td-block-drop-after')
    dropTargetRef.current = null
  }, [])

  useLayoutEffect(() => {
    if (!previousLayoutRef.current.size || !rootRef.current) return
    const previousLayout = previousLayoutRef.current
    previousLayoutRef.current = new Map()
    for (const element of rootRef.current.querySelectorAll<HTMLElement>('[data-block-id]')) {
      const blockId = element.dataset.blockId || ''
      const previousRect = previousLayout.get(blockId)
      if (!previousRect || !topLevelIds.has(blockId)) continue
      const currentRect = element.getBoundingClientRect()
      const offsetY = previousRect.top - currentRect.top
      if (Math.abs(offsetY) < 1) continue
      element.animate(
        [{ transform: `translateY(${offsetY}px)` }, { transform: 'translateY(0)' }],
        { duration: 340, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      )
    }
  }, [document.content, topLevelIds])

  const blockFromTarget = useCallback((target: EventTarget | null) => {
    let element = target instanceof Element ? target.closest<HTMLElement>('[data-block-id]') : null
    while (element) {
      const blockId = element.dataset.blockId || ''
      if (topLevelIds.has(blockId)) return element
      element = element.parentElement?.closest<HTMLElement>('[data-block-id]') || null
    }
    return null
  }, [topLevelIds])

  const onPointerDownCapture = useCallback((event: PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest('button, input, select, textarea')) return
    const block = blockFromTarget(event.target)
    if (block) block.draggable = true
  }, [blockFromTarget])

  const onDragStartCapture = useCallback((event: DragEvent<HTMLElement>) => {
    const block = blockFromTarget(event.target)
    if (!block) {
      event.preventDefault()
      return
    }
    const blockId = block.dataset.blockId || ''
    rootRef.current = event.currentTarget
    draggedIdRef.current = blockId
    block.classList.add('td-block-dragging')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-teaching-document-block', blockId)
    event.stopPropagation()
    onSelect(blockId)
  }, [blockFromTarget, onSelect])

  const onDragEndCapture = useCallback((event: DragEvent<HTMLElement>) => {
    blockFromTarget(event.target)?.classList.remove('td-block-dragging')
    clearDropTarget()
    draggedIdRef.current = ''
    event.stopPropagation()
  }, [blockFromTarget, clearDropTarget])

  const onDragOverCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!draggedIdRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const target = blockFromTarget(event.target)
    if (!target || target.dataset.blockId === draggedIdRef.current) {
      clearDropTarget()
      return
    }
    event.dataTransfer.dropEffect = 'move'
    const rect = target.getBoundingClientRect()
    const positionClass = event.clientY > rect.top + rect.height / 2 ? 'td-block-drop-after' : 'td-block-drop-before'
    if (dropTargetRef.current !== target) clearDropTarget()
    target.classList.remove('td-block-drop-before', 'td-block-drop-after')
    target.classList.add(positionClass)
    dropTargetRef.current = target
  }, [blockFromTarget, clearDropTarget])

  const onDropCapture = useCallback((event: DragEvent<HTMLElement>) => {
    const draggedId = draggedIdRef.current
    if (!draggedId) return
    event.preventDefault()
    event.stopPropagation()
    const target = blockFromTarget(event.target)
    clearDropTarget()
    if (!target || target.dataset.blockId === draggedId) return

    const targetId = target.dataset.blockId || ''
    const order = document.content.map((block) => block.id).filter((id) => id !== draggedId)
    const targetIndex = order.indexOf(targetId)
    if (targetIndex < 0) return

    const rect = target.getBoundingClientRect()
    const insertAfter = event.clientY > rect.top + rect.height / 2
    order.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedId)
    previousLayoutRef.current = captureLayout(event.currentTarget)
    onReorder(order, `drag-block:${draggedId}:${Date.now()}`)
    onSelect(draggedId)
  }, [blockFromTarget, captureLayout, clearDropTarget, document.content, onReorder, onSelect])

  return {
    onPointerDownCapture,
    onDragStartCapture,
    onDragEndCapture,
    onDragOverCapture,
    onDropCapture,
  }
}
