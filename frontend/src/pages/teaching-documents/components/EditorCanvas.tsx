/**
 * 编辑画布（T3 文档级编辑器集成）
 *
 * 使用 DocumentEditor 替代逐块 BlockInlineEditor：
 * - 单一 Tiptap 实例覆盖整个文档
 * - 文本块（heading/paragraph）直接可编辑，光标跨块连续
 * - 非文本块通过 NodeView 渲染
 * - 块选中通过 ProseMirror selection 追踪
 * - 浮动工具栏和插入菜单保留
 * - 拖拽排序暂由 moveBlock 命令替代（完整 ProseMirror 拖拽由后续迭代实现）
 */

import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Editor } from '@tiptap/react'
import type { BoxChildBlock, FigureAssetRef, TeachingBlock, TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
import { type QuestionResolution, type FigureResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import { DocumentEditor } from '@/components/teaching-document/editor'
import { FloatingBlockToolbar } from './FloatingBlockToolbar'
import { BlockInsertPoint, type HeadingLevel } from './BlockInsertMenu'
import { CARD_CHILD_TYPES } from './blockLabels'
import { useBlockDragReorder } from './useBlockDragReorder'
import { BOX_CHILD_SELECT_EVENT, blockIdFromEditorSelection, isExternalDocumentSync, type BoxChildSelectDetail } from '@/components/teaching-document/editor/selection'

export function EditorCanvas(props: {
  document: TeachingDocumentV1
  selectedId: string
  selectedTopLevelId: string
  selectedIsBoxChild: boolean
  resolveQuestion: (id: string) => QuestionResolution
  resolveFigure: (asset: FigureAssetRef) => FigureResolution
  onSelect: (blockId: string) => void
  onEditContent: (blockId: string, content: TeachingInline[]) => void
  onEditBoxTitle: (boxId: string, title: string) => void
  onInsertAfter: (type: TeachingBlock['type'], afterBlockId: string, headingLevel?: HeadingLevel) => void
  onInsertBoxChild: (type: BoxChildBlock['type'], boxId: string, afterChildId?: string) => void
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenProperties: () => void
  onReorder: (order: string[], mergeKey: string) => void
  onMoveSection?: (headingId: string, targetHeadingId: string, position: 'before' | 'after', mergeKey: string) => void
  onEditQuestion?: () => void
  /** T3：文档级编辑器内容变化回调 */
  onEditorChange?: (doc: TeachingDocumentV1) => void
  /** T3：编辑器已有未同步文字时标记草稿。 */
  onEditorDirty?: () => void
  /** T3：注册强制同步入口，供保存与结构操作使用。 */
  onEditorFlushReady?: (flush: (() => void) | null) => void
  /** T3：注册编辑器实例 */
  onEditorReady?: (editor: Editor | null) => void
}) {
  const { document } = props
  const [anchorRoot, setAnchorRoot] = useState<HTMLDivElement | null>(null)
  const [documentEditor, setDocumentEditor] = useState<Editor | null>(null)
  const [, setSelectedBlockId] = useState('')
  const [hoveredBlockId, setHoveredBlockId] = useState('')

  // 追踪 ProseMirror 选区所在的块
  const handleSelectionUpdate = useCallback((editor: Editor) => {
    const blockId = blockIdFromEditorSelection(editor.state)
    if (blockId && blockId !== '__empty__') {
      setSelectedBlockId(blockId)
      props.onSelect(blockId)
    }
  }, [props.onSelect])

  const handleEditorReady = useCallback((editor: Editor | null) => {
    setDocumentEditor(editor)
    props.onEditorReady?.(editor)
    if (!editor) return
    // 监听选区变化
    editor.on('selectionUpdate', ({ transaction }) => {
      if (!isExternalDocumentSync(transaction)) handleSelectionUpdate(editor)
    })
  }, [props.onEditorReady, handleSelectionUpdate])

  const resolvers = {
    resolveQuestion: props.resolveQuestion,
    resolveFigure: props.resolveFigure,
  }

  useEffect(() => {
    const handleChildSelect = (event: Event) => {
      const detail = (event as CustomEvent<BoxChildSelectDetail>).detail
      if (detail?.blockId) props.onSelect(detail.blockId)
    }
    window.addEventListener(BOX_CHILD_SELECT_EVENT, handleChildSelect)
    return () => window.removeEventListener(BOX_CHILD_SELECT_EVENT, handleChildSelect)
  }, [props.onSelect])

  const selectionNodeType = documentEditor && documentEditor.state.selection.$from.depth >= 1
    ? documentEditor.state.selection.$from.node(1).type.name
    : ''
  const showTextFormatting = selectionNodeType === 'docHeading' || selectionNodeType === 'docParagraph'
  const dragHandlers = useBlockDragReorder({
    document,
    onSelect: props.onSelect,
    onReorder: props.onReorder,
    onMoveSection: props.onMoveSection,
  })
  const handleBlockHover = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-block-id]') : null
    const blockId = target?.dataset.blockId || ''
    if (!blockId) return
    setHoveredBlockId((current) => {
      // 卡片正文段落与卡片外壳之间存在留白；不能在此时把锚点退回卡片底部。
      const currentOwner = document.content.find((block) => block.type === 'box' && block.children.some((child) => child.id === current))
      if (currentOwner?.id === blockId) return current
      return current === blockId ? current : blockId
    })
  }, [document.content])
  const insertAnchorId = hoveredBlockId || props.selectedId
  const insertAnchorBoxId = insertAnchorId
    ? document.content.find((block) => block.type === 'box' && block.children.some((child) => child.id === insertAnchorId))?.id || ''
    : ''

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" ref={setAnchorRoot}>
      <h1 className="mb-8 text-center text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {document.title || '未命名文档'}
      </h1>

      <div className="relative" {...dragHandlers} onPointerMoveCapture={handleBlockHover}>
        {document.content.length ? (
          <DocumentEditor
            document={document}
            onChange={props.onEditorChange || (() => {})}
            onChangePending={props.onEditorDirty}
            onFlushPendingChanges={props.onEditorFlushReady}
            resolvers={resolvers}
            onEditorReady={handleEditorReady}
            virtualizeOffscreen={document.content.length >= 24}
          />
        ) : <BlockInsertPoint empty onInsert={(type, headingLevel) => props.onInsertAfter(type, '', headingLevel)} />}

        {/* 浮动工具栏：选中块时显示 */}
        {props.selectedId ? (
          <>
            <FloatingBlockToolbar
              visible
              anchorBlockId={props.selectedId}
              anchorRoot={anchorRoot}
              isBoxChild={props.selectedIsBoxChild}
              textEditor={documentEditor}
              showTextFormatting={showTextFormatting}
              onMove={props.onMove}
              onDuplicate={props.onDuplicate}
              onDelete={props.onDelete}
              onOpenProperties={props.onOpenProperties}
              onEditQuestion={props.onEditQuestion}
            />
          </>
        ) : null}

        {insertAnchorId ? (
          <BlockInsertPoint
            anchorBlockId={insertAnchorId}
            anchorRoot={anchorRoot}
            types={insertAnchorBoxId ? CARD_CHILD_TYPES : undefined}
            onInsert={(type, headingLevel) => {
              if (insertAnchorBoxId) {
                props.onInsertBoxChild(type as BoxChildBlock['type'], insertAnchorBoxId, insertAnchorId)
                return
              }
              props.onInsertAfter(type, insertAnchorId, headingLevel)
            }}
          />
        ) : null}
      </div>

    </div>
  )
}
