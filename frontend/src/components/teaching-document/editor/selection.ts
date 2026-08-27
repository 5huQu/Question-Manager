import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/react'

export const DOCUMENT_EXTERNAL_SYNC_META = 'teaching-document-external-sync'
export const BOX_CHILD_SELECT_EVENT = 'teaching-document-box-child-select'
/** 任一编辑器（文档级或卡片流）的选区变化广播；用于实现“全文档单选”。 */
export const DOCUMENT_SELECTION_CHANGED_EVENT = 'teaching-document-selection-changed'
/** 卡片内多选（Shift+点击）广播。 */
export const BOX_CHILD_MULTI_SELECT_EVENT = 'teaching-document-box-child-multi-select'
/** 顶层对象多选（Ctrl/Cmd+点击）广播。 */
export const TOP_LEVEL_MULTI_SELECT_EVENT = 'teaching-document-top-level-multi-select'

export interface BoxChildSelectDetail {
  blockId: string
  parentBlockId: string
}

export interface DocumentSelectionChangedDetail {
  blockId: string
}

export interface BoxChildMultiSelectDetail {
  blockId: string
  parentBlockId: string
  /** true = Shift+点击切换集合；false = 普通点击清空集合。 */
  shift: boolean
}

export interface TopLevelMultiSelectDetail {
  blockId: string
  /** true = Ctrl/Cmd+点击切换集合；false = 普通点击清空集合。 */
  modifier: boolean
}

/**
 * 顶层对象多选集合（模块级存储）：DocumentEditor 的
 * TopLevelMultiSelectDecoration 装饰插件直接读取，画布在集合变化后派发
 * 空事务刷新装饰。
 */
let topLevelMultiSelectIds: string[] = []
const topLevelMultiSelectListeners = new Set<(ids: string[]) => void>()

export function getTopLevelMultiSelectIds(): string[] {
  return topLevelMultiSelectIds
}

export function setTopLevelMultiSelectIds(ids: string[]) {
  if (ids.length === topLevelMultiSelectIds.length && ids.every((id, index) => id === topLevelMultiSelectIds[index])) return
  topLevelMultiSelectIds = ids
  for (const listener of topLevelMultiSelectListeners) listener(ids)
}

export function subscribeTopLevelMultiSelect(listener: (ids: string[]) => void): () => void {
  topLevelMultiSelectListeners.add(listener)
  return () => {
    topLevelMultiSelectListeners.delete(listener)
  }
}

/** 顶层对象多选环 decoration（只挂载在文档级编辑器）。 */
export const TopLevelMultiSelectDecoration = Extension.create({
  name: 'topLevelMultiSelectDecoration',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations(state) {
          const ids = topLevelMultiSelectIds
          if (!ids.length) return DecorationSet.empty
          const idSet = new Set(ids)
          const decorations: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (!node.isAtom) return true
            if (idSet.has(String(node.attrs?.blockId || ''))) {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'td-block-multi-selected' }))
            }
            return true
          })
          return DecorationSet.create(state.doc, decorations)
        },
      },
    })]
  },
})

export function emitBoxChildSelect(detail: BoxChildSelectDetail) {
  window.dispatchEvent(new CustomEvent<BoxChildSelectDetail>(BOX_CHILD_SELECT_EVENT, { detail }))
}

export function emitDocumentSelectionChanged(blockId: string) {
  window.dispatchEvent(new CustomEvent<DocumentSelectionChangedDetail>(DOCUMENT_SELECTION_CHANGED_EVENT, { detail: { blockId } }))
}

export function emitBoxChildMultiSelect(detail: BoxChildMultiSelectDetail) {
  window.dispatchEvent(new CustomEvent<BoxChildMultiSelectDetail>(BOX_CHILD_MULTI_SELECT_EVENT, { detail }))
}

export function emitTopLevelMultiSelect(detail: TopLevelMultiSelectDetail) {
  window.dispatchEvent(new CustomEvent<TopLevelMultiSelectDetail>(TOP_LEVEL_MULTI_SELECT_EVENT, { detail }))
}

/**
 * 把编辑器选区落到首个文本块的段首（无文本块时回退到文档起始附近），
 * 用于清除“对象选中环”。单文档内同时只允许一个对象被选中：
 * 任一编辑器选中某块后，其余编辑器的对象选中环都应消失。
 */
export function clearEditorSelectionToFirstTextBlock(editor: Editor) {
  const { state } = editor
  let caretPos = -1
  state.doc.descendants((node, pos) => {
    if (caretPos >= 0) return false
    if (node.isTextblock) {
      caretPos = pos + 1
      return false
    }
    return true
  })
  const { from, to } = state.selection
  if (from === caretPos && to === caretPos) return
  if (caretPos < 0) {
    // 文档没有文本块（如只有原子块）：落到首个可选中节点的起始附近
    editor.view.dispatch(
      state.tr.setSelection(TextSelection.near(state.doc.resolve(1))).setMeta('addToHistory', false),
    )
    return
  }
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, caretPos)).setMeta('addToHistory', false),
  )
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
export function blockIdFromSelection(selection: EditorState['selection'], doc: EditorState['doc']): string {
  const selectedNode = selection instanceof NodeSelection ? selection.node : null
  const selectedNodeId = nodeBlockId(selectedNode)
  if (selectedNodeId) return selectedNodeId

  const { $from } = selection
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
  doc.descendants((node, nodePosition) => {
    if (blockId) return false
    if (position >= nodePosition && position < nodePosition + node.nodeSize) {
      blockId = nodeBlockId(node)
      if (blockId) return false
    }
    return true
  })
  return blockId
}

export function blockIdFromEditorSelection(state: EditorState): string {
  return blockIdFromSelection(state.selection, state.doc)
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
 * - 任意编辑产生缺少 blockId 的顶层块时，在同一事务链末尾自动补齐 ID；
 * - ProseMirror split（Enter 分段）会复制原文本块的 attrs，导致新段落与
 *   原段落共享同一个 blockId；复制粘贴也会带出重复 id。对重复 id 的后续
 *   出现项自动重命名，保证每个块 id 唯一（否则序列化会产生两个同 id 块，
 *   悬停锚点、插入点与选区上报都会错乱）。
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
        const seen = new Set<string>()
        newState.doc.forEach((node, offset) => {
          if (!Object.prototype.hasOwnProperty.call(node.attrs, 'blockId')) return
          const id = String(node.attrs.blockId || '')
          if (!id || seen.has(id)) {
            transaction.setNodeMarkup(offset, undefined, {
              ...node.attrs,
              blockId: createDocumentBlockId(node.type.name),
            })
            return
          }
          seen.add(id)
        })
        if (!transaction.docChanged) return null
        transaction.setMeta('addToHistory', false)
        return transaction
      },
    })]
  },
})
