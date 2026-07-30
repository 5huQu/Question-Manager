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

import { useCallback, useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { FigureAssetRef, TeachingBlock, TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
import { type QuestionResolution, type FigureResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import { DocumentEditor } from '@/components/teaching-document/editor'
import { FloatingBlockToolbar } from './FloatingBlockToolbar'
import { BlockInsertPoint, type HeadingLevel } from './BlockInsertMenu'
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
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenProperties: () => void
  onReorder: (order: string[], mergeKey: string) => void
  onMoveSection?: (headingId: string, targetHeadingId: string, position: 'before' | 'after', mergeKey: string) => void
  onEditQuestion?: () => void
  /** T3：文档级编辑器内容变化回调 */
  onEditorChange?: (doc: TeachingDocumentV1) => void
  /** T3：注册编辑器实例 */
  onEditorReady?: (editor: Editor | null) => void
}) {
  const { document } = props
  const [anchorRoot, setAnchorRoot] = useState<HTMLDivElement | null>(null)
  const [documentEditor, setDocumentEditor] = useState<Editor | null>(null)
  const [, setSelectedBlockId] = useState('')

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

  // 找到选中块的索引，用于显示插入点
  const selectedBlockIndex = document.content.findIndex((block) => block.id === props.selectedTopLevelId)
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" ref={setAnchorRoot}>
      <h1 className="mb-8 text-center text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {document.title || '未命名文档'}
      </h1>

      <div className="relative" {...dragHandlers}>
        {document.content.length ? (
          <DocumentEditor
            document={document}
            onChange={props.onEditorChange || (() => {})}
            resolvers={resolvers}
            onEditorReady={handleEditorReady}
          />
        ) : <BlockInsertPoint empty onInsert={(type, headingLevel) => props.onInsertAfter(type, '', headingLevel)} />}

        {/* 浮动工具栏：选中块时显示 */}
        {props.selectedId ? (
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
        ) : null}
      </div>

      {/* 块间插入点：选中块后在其下方显示 */}
      {selectedBlockIndex >= 0 ? (
        <BlockInsertPoint onInsert={(type, headingLevel) => props.onInsertAfter(type, props.selectedTopLevelId, headingLevel)} />
      ) : null}

    </div>
  )
}
