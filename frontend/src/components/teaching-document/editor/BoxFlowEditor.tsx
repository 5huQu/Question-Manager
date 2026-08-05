/**
 * 卡片连续编辑流（类 Word 文本框）
 *
 * 卡片不再是“一组独立插槽 + 块间插入点”，而是单一 Tiptap 文本框：
 * - 连续段落直接编辑，Enter 续段，Shift+Enter 仅换行；
 * - figure/question/blockMath/table/tikz 等子块作为流内嵌入对象（atom NodeView），
 *   点击选中后可复用其自带工具栏（对齐/缩放/表格行列等）；
 * - 复用文档级序列化（blockToEditorNode / editorNodeToBlock）保证往返无损；
 * - 卡片内子块仍以独立数据块保存（分页、撤销和结构化导入不受影响）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { BoxChildBlock, TeachingBlock } from '@/types/teachingDocument'
import {
  hasProtectedInlineContent,
  newTeachingBlock,
  pastedHtmlToSafeInlines,
  protectedInlineReason,
  teachingInlinesToTiptapDoc,
} from '@/utils/teachingDocument'
import { createDocumentEditorExtensions } from './schema'
import { blockToEditorNode, cachedJsonSignature, editorNodeToBlock } from './serialization'
import { clearCardEditorFocus, registerCardEditorFocus } from './cardEditorRegistry'
import {
  blockIdFromEditorSelection,
  BOX_CHILD_MULTI_SELECT_EVENT,
  clearEditorSelectionToFirstTextBlock,
  DOCUMENT_SELECTION_CHANGED_EVENT,
  emitBoxChildMultiSelect,
  emitDocumentSelectionChanged,
  type BoxChildMultiSelectDetail,
  type DocumentSelectionChangedDetail,
} from './selection'

function childrenToEditorDoc(children: BoxChildBlock[]): JSONContent {
  const content = children.map((child) => blockToEditorNode(child as TeachingBlock))
  // ProseMirror 要求 doc 至少有一个块；空卡片放一个空段落占位。
  if (!content.length) content.push({ type: 'docParagraph', attrs: { blockId: '__empty__' } })
  return { type: 'doc', content }
}

function docToChildren(json: JSONContent, previous: BoxChildBlock[]): BoxChildBlock[] {
  const result: BoxChildBlock[] = []
  let previousIndex = 0
  for (const rawNode of json.content || []) {
    // 兜底：粘贴或外部插入的节点可能没有 blockId；补齐后按块序列化。
    const node = rawNode.attrs && typeof rawNode.attrs === 'object'
      && !String((rawNode.attrs as Record<string, unknown>).blockId || '')
      ? { ...rawNode, attrs: { ...rawNode.attrs, blockId: newTeachingBlock('paragraph').id } }
      : rawNode
    const block = editorNodeToBlock(node)
    if (!block) continue
    // 空卡片占位符不落盘
    if (block.id === '__empty__' && block.type === 'paragraph' && block.content.length === 0) continue
    const existing = previous[previousIndex]
    const id = block.id || existing?.id || newTeachingBlock('paragraph').id
    result.push({ ...block, id } as BoxChildBlock)
    previousIndex += 1
  }
  return result
}

export function BoxFlowEditor({
  children,
  boxId = '',
  onChange,
  onActiveChildChange,
  autoFocusChildId,
}: {
  children: BoxChildBlock[]
  /** 所属卡片 id：多选事件按卡片归属过滤。 */
  boxId?: string
  onChange: (children: BoxChildBlock[]) => void
  /** 光标所在子块同步给外层选择/插入锚点。 */
  onActiveChildChange?: (childId: string) => void
  /** 新插入的段落需要聚焦时传入其 id。 */
  autoFocusChildId?: string | null
}) {
  const protectedReason = useMemo(() => {
    const protectedChild = children.find((child): child is Extract<BoxChildBlock, { type: 'paragraph' }> =>
      child.type === 'paragraph' && hasProtectedInlineContent(child.content))
    return protectedChild ? protectedInlineReason(protectedChild.content) : ''
  }, [children])
  const editable = !protectedReason
  const childrenRef = useRef(children)
  childrenRef.current = children
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onActiveChildChangeRef = useRef(onActiveChildChange)
  onActiveChildChangeRef.current = onActiveChildChange
  const syncing = useRef(false)
  const lastEmittedSig = useRef('')
  /** 程序化清理选区期间不对外上报（避免清理动作反过来触发其他编辑器清理形成乒乓）。 */
  const suppressReportRef = useRef(false)
  const [, refreshToolbar] = useState(0)

  // ─── 多选（Shift+点击卡片内对象） ───────────────────────────────────────
  const [extraSelectedIds, setExtraSelectedIds] = useState<string[]>([])
  const extraSelectedRef = useRef<string[]>([])
  extraSelectedRef.current = extraSelectedIds
  /** 多选环 decoration：给集合内的原子块加视觉环；装饰随事务重算，故状态变化后派发空事务刷新。 */
  const MultiSelectDecoration = useMemo(() => Extension.create({
    name: 'boxMultiSelectDecoration',
    addProseMirrorPlugins() {
      return [new Plugin({
        props: {
          decorations(state) {
            const ids = extraSelectedRef.current
            if (!ids.length) return DecorationSet.empty
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isAtom) return true
              if (ids.includes(String(node.attrs?.blockId || ''))) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'td-block-multi-selected' }))
              }
              return true
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      })]
    },
  }), [])
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      ...createDocumentEditorExtensions({ textBlockSelectionRing: false }),
      MultiSelectDecoration,
    ],
    content: childrenToEditorDoc(children),
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': '卡片正文',
        'aria-multiline': 'true',
        'data-box-text-editor': '',
        class: 'min-h-0 px-0 py-1 text-sm leading-7 text-zinc-900 outline-none dark:text-zinc-50',
      },
      handlePaste: (_view, event) => {
        if (!editable) return true
        const html = event.clipboardData?.getData('text/html') || ''
        if (!html) return false
        event.preventDefault()
        const safe = pastedHtmlToSafeInlines(html)
        const nodes = teachingInlinesToTiptapDoc(safe).content?.[0]?.content || []
        if (nodes.length) editor?.chain().focus().insertContent(nodes).run()
        return true
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (syncing.current) return
      const next = docToChildren(currentEditor.getJSON(), childrenRef.current)
      childrenRef.current = next
      lastEmittedSig.current = JSON.stringify(next)
      onChangeRef.current(next)
    },
  })

  // ─── 多选（Shift+点击）事件接入 ─────────────────────────────────────────
  useEffect(() => {
    if (!editor) return
    // 空事务触发 decorations 重算（不改变文档与选区）
    editor.view.dispatch(editor.state.tr.setMeta('box-multi-select-refresh', true))
  }, [editor, extraSelectedIds])
  useEffect(() => {
    if (!editor) return
    const handleMultiSelect = (event: Event) => {
      const detail = (event as CustomEvent<BoxChildMultiSelectDetail>).detail
      if (!detail) return
      if (detail.parentBlockId !== boxId || !detail.shift) {
        setExtraSelectedIds((current) => current.length ? [] : current)
        return
      }
      setExtraSelectedIds((current) => current.includes(detail.blockId)
        ? current.filter((id) => id !== detail.blockId)
        : [...current, detail.blockId])
    }
    window.addEventListener(BOX_CHILD_MULTI_SELECT_EVENT, handleMultiSelect)
    return () => window.removeEventListener(BOX_CHILD_MULTI_SELECT_EVENT, handleMultiSelect)
  }, [boxId, editor])

  const reportActiveChild = () => {
    if (suppressReportRef.current) return
    if (!editor) return
    const blockId = blockIdFromEditorSelection(editor.state)
    if (blockId && blockId !== '__empty__') {
      onActiveChildChangeRef.current?.(blockId)
      // 全文档单选：把本次选区变化广播出去，其他卡片编辑器的选中环随之清除。
      emitDocumentSelectionChanged(blockId)
    }
  }

  // 全文档单选：文档内其他块被选中时，清除本卡片内的对象选中环。
  useEffect(() => {
    if (!editor) return
    const handleSelectionChanged = (event: Event) => {
      const detail = (event as CustomEvent<DocumentSelectionChangedDetail>).detail
      if (!detail?.blockId) return
      if (childrenRef.current.some((child) => child.id === detail.blockId)) return
      suppressReportRef.current = true
      clearEditorSelectionToFirstTextBlock(editor)
      suppressReportRef.current = false
    }
    window.addEventListener(DOCUMENT_SELECTION_CHANGED_EVENT, handleSelectionChanged)
    return () => window.removeEventListener(DOCUMENT_SELECTION_CHANGED_EVENT, handleSelectionChanged)
  }, [editor])

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editable, editor])

  useEffect(() => {
    if (!editor) return
    const update = () => refreshToolbar((value) => value + 1)
    editor.on('selectionUpdate', update)
    editor.on('focus', update)
    editor.on('blur', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('focus', update)
      editor.off('blur', update)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', reportActiveChild)
    editor.on('focus', reportActiveChild)
    return () => {
      editor.off('selectionUpdate', reportActiveChild)
      editor.off('focus', reportActiveChild)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const nextSig = cachedJsonSignature(children)
    if (nextSig === lastEmittedSig.current) return
    const current = docToChildren(editor.getJSON(), childrenRef.current)
    if (nextSig === JSON.stringify(current)) {
      lastEmittedSig.current = nextSig
      return
    }
    syncing.current = true
    editor.commands.setContent(childrenToEditorDoc(children), { emitUpdate: false })
    syncing.current = false
    lastEmittedSig.current = nextSig
  }, [editor, children])

  // 焦点注册：全文同时只有一个卡片流编辑器处于活跃态，
  // 顶栏插入与浮动格式工具栏据此路由。
  useEffect(() => {
    if (!editor) return
    const handleFocus = () => registerCardEditorFocus(editor)
    const handleBlur = () => clearCardEditorFocus(editor)
    editor.on('focus', handleFocus)
    editor.on('blur', handleBlur)
    return () => {
      editor.off('focus', handleFocus)
      editor.off('blur', handleBlur)
      clearCardEditorFocus(editor)
    }
  }, [editor])

  // 新插入段落聚焦：等外部数据回写完成后再把光标落到段落末尾。
  useEffect(() => {
    if (!editor || !autoFocusChildId) return
    let targetPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (targetPos >= 0) return false
      if (node.isTextblock && String(node.attrs?.blockId || '') === autoFocusChildId) {
        targetPos = pos
        return false
      }
      return true
    })
    if (targetPos < 0) return
    const node = editor.state.doc.nodeAt(targetPos)
    if (!node) return
    editor.chain().focus().setTextSelection(targetPos + 1 + node.content.size).run()
  }, [autoFocusChildId, editor])

  if (!editor) return <div className="min-h-8 animate-pulse rounded bg-zinc-100/60 dark:bg-zinc-800/40" />

  return (
    <div
      className="td-box-text-group relative"
      onMouseDownCapture={(event) => {
        const target = event.target as Element
        // 原子块（figure/question/table…）区域：原生 PM mousedown 会被本容器
        // 的拦截挡住，无法建立 NodeSelection，导致对齐/缩放等工具栏不出现。
        // 这里按 blockId 手动建立 NodeSelection，再统一阻止冒泡，避免外层
        // 文档编辑器把整张卡片选成 NodeSelection。
        // 判定：段落是可编辑的 p[data-block-id]；其余带 data-block-id 的
        // 节点视图都是卡片内的原子块。
        const atom = target.closest<HTMLElement>('[data-block-id]')
        const blockId = atom && atom.tagName !== 'P' ? atom.dataset.blockId || '' : ''
        if (blockId) {
          if (event.shiftKey) {
            // Shift+点击：切换多选集合，不移动单选选区
            emitBoxChildMultiSelect({ parentBlockId: boxId, blockId, shift: true })
            event.preventDefault()
            event.stopPropagation()
            return
          }
          // 普通点击：清空多选集合
          emitBoxChildMultiSelect({ parentBlockId: boxId, blockId, shift: false })
          let targetPos = -1
          editor.state.doc.descendants((node, pos) => {
            if (targetPos >= 0) return false
            if (node.isAtom && String(node.attrs?.blockId || '') === blockId) {
              targetPos = pos
              return false
            }
            return true
          })
          if (targetPos >= 0) {
            event.preventDefault()
            editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, targetPos)))
            // 选区可能本就停留在此原子块（重复点击），selectionUpdate 不会触发，
            // 但外层属性面板必须跟随每次点击打开——直接上报，等价于旧实现
            // 在指针事件里无条件 emitBoxChildSelect。
            onActiveChildChangeRef.current?.(blockId)
          }
        }
        event.stopPropagation()
      }}
    >
      <div className="td-box-text-editor relative rounded-sm outline-none transition-colors focus-within:bg-white/45 [&_.ProseMirror>p]:my-2.5 [&_.ProseMirror>p:first-child]:mt-0 [&_.ProseMirror>p:last-child]:mb-0 dark:focus-within:bg-zinc-950/20">
        {protectedReason ? (
          <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">{protectedReason}</p>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
