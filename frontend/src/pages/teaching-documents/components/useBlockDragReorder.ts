import { useCallback, useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { emitTopLevelMultiSelect } from '@/components/teaching-document/editor/selection'

interface BlockDragReorderOptions {
  document: TeachingDocumentV1
  onSelect: (blockId: string) => void
  onReorder: (order: string[], mergeKey: string) => void
  onMoveSection?: (headingId: string, targetHeadingId: string, position: 'before' | 'after', mergeKey: string) => void
}

interface PendingDrag {
  block: HTMLElement
  startX: number
  startY: number
}

interface ActiveDrag {
  pointerId: number
  block: HTMLElement
}

/**
 * 表单控件、可编辑区与链接不参与块拖拽：文本选择必须永远走浏览器原生路径，
 * 只有"在非可编辑区按下并超过位移阈值"才进入块拖拽模式。
 */
const NON_DRAGGABLE_TARGET_SELECTOR = 'button, input, select, textarea, a[href], [contenteditable], [role="textbox"]'

/** 判定"意图拖拽"的位移阈值（px），小于该值视为点击或文本选择。 */
const DRAG_THRESHOLD_PX = 6
const AUTO_SCROLL_EDGE_PX = 48
const AUTO_SCROLL_STEP_PX = 14

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element ? Boolean(target.closest(NON_DRAGGABLE_TARGET_SELECTOR)) : true
}

function elementAtPoint(clientX: number, clientY: number): Element | null {
  return typeof window.document.elementFromPoint === 'function'
    ? window.document.elementFromPoint(clientX, clientY)
    : null
}

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

/**
 * 为文档画布的顶层块提供拖拽排序（Pointer Events 实现，替代原生 HTML5 DnD）。
 *
 * 为什么不用原生 DnD：
 * - 原生 DnD 需要把目标元素标记为 draggable，而卡片内正文是 contenteditable，
 *   按下即标记会劫持文本选择（跨行多选必触发拖拽）；位移阈值方案又依赖竞态时序；
 * - Pointer Events 在确认意图（位移超过阈值、非可编辑区、左键）后才接管事件流，
 *   文本选择全程不受影响，且天然支持触摸设备。
 *
 * 块内控件维持原有交互；拖到目标块的上/下半区决定插入位置；Escape 取消。
 */
export function useBlockDragReorder({ document, onSelect, onReorder, onMoveSection }: BlockDragReorderOptions) {
  const pendingRef = useRef<PendingDrag | null>(null)
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const draggedIdRef = useRef('')
  const dropTargetRef = useRef<HTMLElement | null>(null)
  const previousLayoutRef = useRef<Map<string, DOMRect>>(new Map())
  const rootRef = useRef<HTMLElement | null>(null)
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const cancelKeydownRef = useRef<((event: KeyboardEvent) => void) | null>(null)
  const topLevelIds = new Set(document.content.map((block) => block.id))
  const [hoveredBlockId, setHoveredBlockId] = useState('')

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

  /** 拖拽中定位将要插入的位置（before/after 分区），并清理上一个指示。 */
  const updateDropTarget = useCallback((clientX: number, clientY: number) => {
    if (!draggedIdRef.current) return
    // 注意：局部 document 是文档数据，DOM 查询须走 window.document
    const element = elementAtPoint(clientX, clientY)
    const target = blockFromTarget(element)
    clearDropTarget()
    if (!target || target.dataset.blockId === draggedIdRef.current) return
    const rect = target.getBoundingClientRect()
    const positionClass = clientY > rect.top + rect.height / 2 ? 'td-block-drop-after' : 'td-block-drop-before'
    target.classList.add(positionClass)
    dropTargetRef.current = target
  }, [blockFromTarget, clearDropTarget])

  const cancelDrag = useCallback(() => {
    const active = activeDragRef.current
    activeDragRef.current = null
    draggedIdRef.current = ''
    pendingRef.current = null
    clearDropTarget()
    active?.block.classList.remove('td-block-dragging')
    const root = rootRef.current
    if (root) {
      root.classList.remove('td-block-dragging-root')
      try { root.releasePointerCapture?.(active?.pointerId ?? -1) } catch { /* 可能已释放 */ }
    }
    if (cancelKeydownRef.current) {
      window.removeEventListener('keydown', cancelKeydownRef.current)
      cancelKeydownRef.current = null
    }
  }, [clearDropTarget])

  /** 位移超过阈值且起点不在可编辑区：进入块拖拽模式。 */
  const beginDrag = useCallback((event: PointerEvent<HTMLElement>, pending: PendingDrag) => {
    pendingRef.current = null
    const blockId = pending.block.dataset.blockId || ''
    if (!blockId) return
    const root = event.currentTarget
    rootRef.current = root
    activeDragRef.current = { pointerId: event.pointerId, block: pending.block }
    draggedIdRef.current = blockId
    pending.block.classList.add('td-block-dragging')
    root.classList.add('td-block-dragging-root')
    try { root.setPointerCapture?.(event.pointerId) } catch { /* 忽略 */ }
    scrollContainerRef.current = findScrollContainer(root)
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') cancelDrag()
    }
    cancelKeydownRef.current = onKeyDown
    window.addEventListener('keydown', onKeyDown)
    onSelect(blockId)
    updateDropTarget(event.clientX, event.clientY)
  }, [cancelDrag, onSelect, updateDropTarget])

  const autoScroll = useCallback((clientY: number) => {
    const container = scrollContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (clientY < rect.top + AUTO_SCROLL_EDGE_PX) {
      container.scrollTop -= AUTO_SCROLL_STEP_PX
    } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
      container.scrollTop += AUTO_SCROLL_STEP_PX
    }
  }, [])

  /** 提交拖拽：取指针下方的目标块，计算插入位置后重排。 */
  const commitDrop = useCallback((clientX: number, clientY: number) => {
    const active = activeDragRef.current
    if (!active) return
    const draggedId = draggedIdRef.current
    const root = rootRef.current
    // 注意：局部 document 是文档数据，DOM 查询须走 window.document
    const target = blockFromTarget(elementAtPoint(clientX, clientY))
    const targetId = target?.dataset.blockId || ''
    clearDropTarget()
    active.block.classList.remove('td-block-dragging')
    root?.classList.remove('td-block-dragging-root')
    activeDragRef.current = null
    draggedIdRef.current = ''
    if (cancelKeydownRef.current) {
      window.removeEventListener('keydown', cancelKeydownRef.current)
      cancelKeydownRef.current = null
    }
    try { root?.releasePointerCapture?.(active.pointerId) } catch { /* 可能已释放 */ }
    if (!target || !targetId || targetId === draggedId) return

    const draggedBlock = document.content.find((block) => block.id === draggedId)
    const targetBlock = document.content.find((block) => block.id === targetId)
    const rect = target.getBoundingClientRect()
    const position = clientY > rect.top + rect.height / 2 ? 'after' : 'before'
    if (draggedBlock?.type === 'heading' && targetBlock?.type === 'heading' && onMoveSection) {
      previousLayoutRef.current = root ? captureLayout(root) : new Map()
      onMoveSection(draggedId, targetId, position, `drag-section:${draggedId}:${Date.now()}`)
      onSelect(draggedId)
      return
    }
    const order = document.content.map((block) => block.id).filter((id) => id !== draggedId)
    const targetIndex = order.indexOf(targetId)
    if (targetIndex < 0) return

    const insertAfter = position === 'after'
    order.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedId)
    previousLayoutRef.current = root ? captureLayout(root) : new Map()
    onReorder(order, `drag-block:${draggedId}:${Date.now()}`)
    onSelect(draggedId)
  }, [blockFromTarget, captureLayout, clearDropTarget, document.content, onMoveSection, onReorder, onSelect])

  /**
   * 悬停锚点：指针经过的最近顶层块。从卡片内段落移动到段落下方留白时，
   * 最近的 data-block-id 会变成外层卡片。保留原段落锚点，才能穿过留白点击
   * 到悬浮的 “+”。
   */
  const handleBlockHover = useCallback((target: EventTarget | null) => {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-block-id]') : null
    const blockId = element?.dataset.blockId || ''
    if (!blockId) return
    setHoveredBlockId((current) => {
      const currentOwner = document.content.find((block) => block.type === 'box' && block.children.some((child) => child.id === current))
      if (currentOwner?.id === blockId) return current
      return current === blockId ? current : blockId
    })
  }, [document.content])

  const onPointerDownCapture = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.isPrimary === false) {
      pendingRef.current = null
      return
    }
    // 拖拽手柄（grip）：按住手柄立即进入拖拽模式（Word 风格，无位移阈值）。
    // grip 是画布内的覆盖元素（data-block-grip=blockId），按下即拖。
    const gripTarget = (event.target as Element).closest<HTMLElement>('[data-block-grip]')
    if (gripTarget) {
      const gripBlockId = gripTarget.getAttribute('data-block-grip') || ''
      if (gripBlockId && topLevelIds.has(gripBlockId)) {
        let gripBlock: HTMLElement | null = null
        for (const element of event.currentTarget.querySelectorAll<HTMLElement>('[data-block-id]')) {
          if (element.dataset.blockId === gripBlockId) {
            gripBlock = element
            break
          }
        }
        if (gripBlock) {
          event.preventDefault()
          event.stopPropagation()
          beginDrag(event, { block: gripBlock, startX: event.clientX, startY: event.clientY })
          return
        }
      }
    }
    // Ctrl/Cmd+点击顶层对象：切换顶层多选集合（Word 风格的 Ctrl+点击多选）。
    // 只拦截对象块（figure/question/box/…），段落/标题保留文本语义
    // （Ctrl+点击选句、Shift+点击选范围都不被劫持）。
    if (event.ctrlKey || event.metaKey) {
      const multiBlock = blockFromTarget(event.target)
      // 实时 DOM 中段落/标题是 p/h1-h4 文本块；其余顶层块（NodeView 容器 div）是对象
      const tagName = multiBlock?.tagName || ''
      const isTextBlock = tagName === 'P' || /^H[1-4]$/.test(tagName)
      if (multiBlock && !isTextBlock) {
        event.preventDefault()
        event.stopPropagation()
        emitTopLevelMultiSelect({ blockId: multiBlock.dataset.blockId || '', modifier: true })
        return
      }
    }
    // 可编辑区与表单控件内的按下只做文本选择/输入，绝不参与块拖拽。
    if (isEditableTarget(event.target)) {
      pendingRef.current = null
      return
    }
    const block = blockFromTarget(event.target)
    if (!block) {
      pendingRef.current = null
      return
    }
    pendingRef.current = { block, startX: event.clientX, startY: event.clientY }
  }, [beginDrag, blockFromTarget, topLevelIds])

  const onPointerMoveCapture = useCallback((event: PointerEvent<HTMLElement>) => {
    // 插入锚点 hover 追踪（保持原画布行为）
    handleBlockHover(event.target)
    const pending = pendingRef.current
    if (pending) {
      if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < DRAG_THRESHOLD_PX) return
      beginDrag(event, pending)
      return
    }
    if (!activeDragRef.current) return
    updateDropTarget(event.clientX, event.clientY)
    autoScroll(event.clientY)
  }, [autoScroll, beginDrag, handleBlockHover, updateDropTarget])

  const onPointerUpCapture = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!activeDragRef.current) return
    commitDrop(event.clientX, event.clientY)
  }, [commitDrop])

  const onPointerCancelCapture = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!activeDragRef.current) return
    cancelDrag()
  }, [cancelDrag])

  /**
   * 拖拽模式期间压掉任何原生拖拽（PM 节点拖拽、img 拖拽），
   * 避免与我们自定义的块拖拽打架。挂起状态（未达阈值）下若原生拖拽抢先
   * 发起（如图片默认拖拽），则放弃挂起的块拖拽，绝不劫持文本选择。
   */
  const onDragStartCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (draggedIdRef.current) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (pendingRef.current) pendingRef.current = null
  }, [])

  return {
    hoveredBlockId,
    handlers: {
      onPointerDownCapture,
      onPointerMoveCapture,
      onPointerUpCapture,
      onPointerCancelCapture,
      onDragStartCapture,
    },
  }
}
