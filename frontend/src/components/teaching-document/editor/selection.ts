import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

export const DOCUMENT_EXTERNAL_SYNC_META = 'teaching-document-external-sync'
export const BOX_CHILD_SELECT_EVENT = 'teaching-document-box-child-select'

export interface BoxChildSelectDetail {
  blockId: string
  parentBlockId: string
}

export function emitBoxChildSelect(detail: BoxChildSelectDetail) {
  window.dispatchEvent(new CustomEvent<BoxChildSelectDetail>(BOX_CHILD_SELECT_EVENT, { detail }))
}

/** 外部文档回显产生的选区变化不能覆盖属性面板中正在编辑的子块。 */
export function isExternalDocumentSync(transaction: Transaction) {
  return transaction.getMeta(DOCUMENT_EXTERNAL_SYNC_META) === true
}

function nodeBlockId(node: { attrs?: Record<string, unknown> } | null | undefined) {
  const value = node?.attrs?.blockId
  return value ? String(value) : ''
}

/**
 * 将 ProseMirror 选区解析为讲义顶层块 ID。
 *
 * 原子块的 NodeSelection 位于节点起点；该位置同时也是上一节点的结束位置。
 * 因此必须优先读取 selection.node / nodeAfter，并且兜底区间采用右开区间，
 * 否则点击盒子会错误命中前一个题目。
 */
export function blockIdFromEditorSelection(state: EditorState): string {
  const selectedNode = state.selection instanceof NodeSelection ? state.selection.node : null
  const selectedNodeId = nodeBlockId(selectedNode)
  if (selectedNodeId) return selectedNodeId

  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const blockId = nodeBlockId($from.node(depth))
    if (blockId) return blockId
  }

  const nodeAfterId = nodeBlockId($from.nodeAfter)
  if (nodeAfterId) return nodeAfterId
  const nodeBeforeId = nodeBlockId($from.nodeBefore)
  if (nodeBeforeId) return nodeBeforeId

  const position = $from.pos
  let blockId = ''
  state.doc.descendants((node, nodePosition) => {
    if (blockId) return false
    if (position >= nodePosition && position < nodePosition + node.nodeSize) {
      blockId = nodeBlockId(node)
      if (blockId) return false
    }
    return true
  })
  return blockId
}
