/**
 * 图片 / 留白尺寸调整 commands
 *
 * - setFigureWidth(blockId, widthMm, mergeKey?)：更新 docFigure 的 widthMm
 * - setSpacerHeight(blockId, heightMm, mergeKey?)：更新 docSpacer 的 heightMm
 *
 * undo 合并策略：
 * - 拖拽过程不写历史，仅 pointerup 时提交一次（天然一个事务）。
 * - 连续拖拽（相同 mergeKey 且在时间窗口内）通过 `addToHistory: false`
 *   合并进上一个 undo 步骤，使「连续拖拽只产生一个 undo 步骤」。
 * - 任何非尺寸调整的内容变更事务都会重置合并状态，避免错误地并入无关历史。
 */
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import type { Transaction } from '@tiptap/pm/state'
import {
  MIN_FIGURE_WIDTH_MM,
  clampSpacerHeightMm,
  nextResizeMergeState,
  roundMm,
  shouldMergeResize,
  type ResizeMergeState,
} from './resizeLogic'

/** 标记一次事务为尺寸调整提交，供 onTransaction 识别 */
export const RESIZE_MERGE_META = 'resizeMergeKey'

/** 为自定义命令补充 Tiptap 类型 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docResize: {
      setFigureWidth: (blockId: string, widthMm: number, mergeKey?: string) => ReturnType
      setSpacerHeight: (blockId: string, heightMm: number, mergeKey?: string) => ReturnType
    }
  }
}

/** 在 doc 中按 blockId + 节点类型名查找节点位置；未找到返回 -1 */
function findBlockNodePos(doc: PMNode, blockId: string, typeName: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === typeName && node.attrs.blockId === blockId) {
      found = pos
      return false
    }
    return true
  })
  return found
}

/**
 * 为尺寸调整提交事务打上历史标记：
 * - merge=true：addToHistory:false → 并入上一个 undo 步骤（连续拖拽合并）。
 * - merge=false：closeHistory → 强制开启新 undo 步骤，避免 prosemirror-history
 *   因「相邻 + 时间接近」把本次提交误并入无关的上一步。
 */
function markResizeTransaction(tr: Transaction, mergeKey: string | undefined, merge: boolean): void {
  if (!mergeKey) return
  tr.setMeta(RESIZE_MERGE_META, mergeKey)
  if (merge) {
    tr.setMeta('addToHistory', false)
  } else {
    closeHistory(tr)
  }
}

export const ResizeCommands = Extension.create<{ merge: ResizeMergeState | null }>({
  name: 'resizeCommands',

  addStorage() {
    return { merge: null }
  },

  /**
   * 非尺寸调整的内容变更会新建历史节点，
   * 此时必须重置合并状态，防止后续拖拽错误合并进无关 undo 步骤。
   */
  onTransaction({ transaction }) {
    if (transaction.getMeta(RESIZE_MERGE_META)) return
    if (transaction.docChanged) this.storage.merge = null
  },

  addCommands() {
    return {
      setFigureWidth:
        (blockId, widthMm, mergeKey) =>
        ({ state, dispatch }) => {
          const pos = findBlockNodePos(state.doc, blockId, 'docFigure')
          if (pos < 0) return false
          const node = state.doc.nodeAt(pos)
          if (!node) return false
          if (dispatch) {
            const now = Date.now()
            const merge = shouldMergeResize(this.storage.merge, mergeKey ?? '', now)
            // 下限保护；上限（内容区宽度）由持有纸张规格的调用方保证
            const next = roundMm(Math.max(MIN_FIGURE_WIDTH_MM, widthMm))
            const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, widthMm: next })
            markResizeTransaction(tr, mergeKey, merge)
            if (mergeKey) this.storage.merge = nextResizeMergeState(mergeKey, now)
            dispatch(tr)
          }
          return true
        },

      setSpacerHeight:
        (blockId, heightMm, mergeKey) =>
        ({ state, dispatch }) => {
          const pos = findBlockNodePos(state.doc, blockId, 'docSpacer')
          if (pos < 0) return false
          const node = state.doc.nodeAt(pos)
          if (!node) return false
          if (dispatch) {
            const now = Date.now()
            const merge = shouldMergeResize(this.storage.merge, mergeKey ?? '', now)
            const next = roundMm(clampSpacerHeightMm(heightMm))
            const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, heightMm: next })
            markResizeTransaction(tr, mergeKey, merge)
            if (mergeKey) this.storage.merge = nextResizeMergeState(mergeKey, now)
            dispatch(tr)
          }
          return true
        },
    }
  },
})
