import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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

/**
 * 文本块不像 atom 节点那样天然拥有 NodeSelection。为光标所在的标题/段落
 * 加一个不影响排版的 decoration，让对象被选中时也有清晰轮廓。
 */
export const ActiveTextBlockDecoration = Extension.create({
  name: 'activeTextBlockDecoration',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations(state) {
          const { $from } = state.selection
          for (let depth = $from.depth; depth >= 1; depth -= 1) {
            const node = $from.node(depth)
            if (node.type.name !== 'docHeading' && node.type.name !== 'docParagraph') continue
            const from = $from.before(depth)
            return DecorationSet.create(state.doc, [
              Decoration.node(from, from + node.nodeSize, { class: 'td-text-block-active' }),
            ])
          }
          return DecorationSet.empty
        },
      },
    })]
  },
})

function createDocumentBlockId(nodeType: string) {
  const prefix = nodeType.replace(/^doc/, '').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`) || 'block'
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid
    ? `${prefix}_${uuid}`
    : `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function selectCurrentTextBlock(state: EditorState, dispatch?: (transaction: Transaction) => void) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 1; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'docHeading' && node.type.name !== 'docParagraph') continue
    const from = $from.before(depth) + 1
    const to = from + node.content.size
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
    return true
  }
  return false
}

/**
 * 保护文档结构：
 * - Mod+A 只选中光标所在标题/段落的文字，避免输入替换整个文档节点；
 * - 任意编辑产生缺少 blockId 的顶层块时，在同一事务链末尾自动补齐 ID。
 */
export const DocumentSelectionSafety = Extension.create({
  name: 'documentSelectionSafety',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-a': () => selectCurrentTextBlock(
        this.editor.state,
        (transaction) => this.editor.view.dispatch(transaction),
      ),
    }
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key.toLowerCase() !== 'a' || (!event.metaKey && !event.ctrlKey) || event.altKey) return false
          const handled = selectCurrentTextBlock(view.state, view.dispatch)
          if (handled) event.preventDefault()
          return handled
        },
      },
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null
        const transaction = newState.tr
        newState.doc.forEach((node, offset) => {
          if (!Object.prototype.hasOwnProperty.call(node.attrs, 'blockId')) return
          if (String(node.attrs.blockId || '')) return
          transaction.setNodeMarkup(offset, undefined, {
            ...node.attrs,
            blockId: createDocumentBlockId(node.type.name),
          })
        })
        if (!transaction.docChanged) return null
        transaction.setMeta('addToHistory', false)
        return transaction
      },
    })]
  },
})
