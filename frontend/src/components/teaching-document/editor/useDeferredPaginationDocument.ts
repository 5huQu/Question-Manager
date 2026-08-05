import { startTransition, useEffect, useState } from 'react'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'

/**
 * 编辑器中的文字输入需要即时反映到 ProseMirror 画布，但精确分页会触发一整套
 * 隐藏渲染、资源等待与 DOM 测量。将后者延后到一段输入空闲期，避免长文档在
 * 每次键入时重建第二棵完整渲染树。
 */
export const DEFAULT_PAGINATION_LAYOUT_DELAY_MS = 700

export type LayoutRequestReason = 'typing' | 'structure' | 'view' | 'variant' | 'export'
export type LayoutRequestPriority = 'background' | 'interactive' | 'blocking'

export interface LayoutRequest {
  id: number
  reason: LayoutRequestReason
  priority: LayoutRequestPriority
}

export function createLayoutRequest(id: number, reason: LayoutRequestReason): LayoutRequest {
  return {
    id,
    reason,
    priority: reason === 'typing' ? 'background' : reason === 'export' ? 'blocking' : 'interactive',
  }
}

export const INITIAL_LAYOUT_REQUEST: LayoutRequest = createLayoutRequest(0, 'structure')

export interface DeferredPaginationDocument {
  /** 最近一次可用于精确测量与分页的稳定文档快照。 */
  layoutDocument: TeachingDocumentV1
  /** 当前编辑内容尚未进入精确分页管线。 */
  layoutPending: boolean
}

export function useDeferredPaginationDocument(
  document: TeachingDocumentV1,
  delayMs = DEFAULT_PAGINATION_LAYOUT_DELAY_MS,
  request: LayoutRequest = INITIAL_LAYOUT_REQUEST,
): DeferredPaginationDocument {
  const [layoutDocument, setLayoutDocument] = useState(document)
  const [layoutPending, setLayoutPending] = useState(false)

  useEffect(() => {
    if (layoutDocument === document) {
      setLayoutPending(false)
      return
    }

    setLayoutPending(true)
    if (request.reason !== 'typing') {
      // 明确的结构/视图/版本操作不能继承文字输入的尾随等待。仍使用 transition
      // 让控件状态与编辑回显优先提交，但不再人为增加定时器延迟。
      startTransition(() => {
        setLayoutDocument(document)
        setLayoutPending(false)
      })
      return
    }

    const timer = window.setTimeout(() => {
      // 分页本身仍会在主线程测量；把状态更新标记为非紧急，使输入回显优先。
      startTransition(() => {
        setLayoutDocument(document)
        setLayoutPending(false)
      })
    }, Math.max(0, delayMs))

    return () => window.clearTimeout(timer)
  }, [delayMs, document, layoutDocument, request.id, request.priority, request.reason])

  return { layoutDocument, layoutPending }
}
