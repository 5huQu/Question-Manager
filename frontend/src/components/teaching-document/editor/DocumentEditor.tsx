/**
 * DocumentEditor — 文档级 Tiptap 编辑器
 *
 * 设计约束：
 * - 单一编辑器实例覆盖整个文档
 * - 光标、选区、键盘输入和 undo/redo 在块之间连续工作
 * - 内容变化时通过 serialization 转回 TeachingDocumentV1 并回调
 * - 外部文档更新通过 setContent 同步，带确定性比较防止回写循环
 * - NodeView 更新（题目/图片资源变化）不触发 doc 变化
 */
import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { createDocumentEditorExtensions } from './schema'
import { teachingDocumentToEditorDoc, editorDocToTeachingDocument, type EditorDocMeta } from './serialization'
import { PaperProvider, PaginationProvider, ResolverProvider, type DocumentEditorResolvers } from './NodeViews'
import { createDocumentPrintLayout, resolveDocumentPaper, type PaginationResult, type PrintLayoutSpec } from '@/utils/teachingDocument'
import type { EditorPaginationLayout } from './paginationDecorations'
import { DOCUMENT_EXTERNAL_SYNC_META, isExternalDocumentSync } from './selection'

export interface DocumentEditorProps {
  /** 文档数据（唯一事实来源） */
  document: TeachingDocumentV1
  /** 内容变更回调；外部负责 autosave */
  onChange: (doc: TeachingDocumentV1) => void
  /** 题目/图片资源解析器 */
  resolvers?: DocumentEditorResolvers
  /** 编辑器实例就绪回调 */
  onEditorReady?: (editor: Editor | null) => void
  paginationLayout?: EditorPaginationLayout | null
  pagination?: PaginationResult | null
  printLayout?: PrintLayoutSpec
  pageGapPx?: number
  /** 是否可编辑 */
  editable?: boolean
}

export function DocumentEditor({
  document,
  onChange,
  resolvers = {},
  onEditorReady,
  paginationLayout,
  pagination = null,
  printLayout,
  pageGapPx = 24,
  editable = true,
}: DocumentEditorProps) {
  /** 最近一次由编辑器产生的内容签名，用于区分自身回显与外部更新 */
  const lastEmittedSig = useRef('')
  const syncing = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  /** 文档元信息（不经过编辑器，序列化时回填） */
  const metaRef = useRef<EditorDocMeta>({
    documentType: document.documentType,
    title: document.title,
    metadata: document.metadata,
    style: document.style,
  })
  metaRef.current = {
    documentType: document.documentType,
    title: document.title,
    metadata: document.metadata,
    style: document.style,
  }

  const initialDoc = useRef(teachingDocumentToEditorDoc(document))

  /** 纸张规格：供 NodeView 计算内容区宽度（图片上限、mm 渲染） */
  const paper = useMemo(() => resolveDocumentPaper(document.style), [document.style])

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: createDocumentEditorExtensions(),
    content: initialDoc.current,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': '文档编辑器',
        'aria-multiline': 'true',
        'data-document-editor': '',
        class: 'td-document td-document-editor min-h-[300px] px-6 py-4 text-sm leading-7 text-zinc-900 outline-none dark:text-zinc-50',
      },
    },
    onUpdate: ({ editor: currentEditor, transaction }) => {
      // setContent(..., { emitUpdate: false }) 的更新在部分编辑器调度时会在
      // syncing 标志复位后才触发回调；事务标记才是可靠的外部同步边界。
      if (syncing.current || isExternalDocumentSync(transaction)) return
      const json = currentEditor.getJSON()
      const nextDoc = editorDocToTeachingDocument(json, metaRef.current)
      lastEmittedSig.current = JSON.stringify(nextDoc.content)
      onChangeRef.current(nextDoc)
    },
  })

  // editable 状态同步
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  // 编辑器实例就绪通知
  const onEditorReadyRef = useRef(onEditorReady)
  onEditorReadyRef.current = onEditorReady
  useEffect(() => {
    if (editor) onEditorReadyRef.current?.(editor)
    return () => {
      if (editor) onEditorReadyRef.current?.(null)
    }
  }, [editor])

  // 外部文档更新同步（undo/redo、revision reload、外部 dispatch）
  useEffect(() => {
    if (!editor) return
    const sig = JSON.stringify(document.content)
    // 比较当前编辑器内容是否与外部文档一致
    // 不能只依赖 lastEmittedSig：当撤销或异步更新让外层文档与编辑器
    // 暂时分叉时，缓存签名可能相同，进而留下“画布旧内容 / 大纲空”的假象。
    const currentJson = editor.getJSON()
    const currentDoc = editorDocToTeachingDocument(currentJson, metaRef.current)
    const currentSig = JSON.stringify(currentDoc.content)
    if (sig === currentSig) {
      lastEmittedSig.current = sig
      return
    }
    // 外部更新：同步编辑器内容
    syncing.current = true
    const editorDoc = teachingDocumentToEditorDoc(document)
    editor
      .chain()
      .setMeta(DOCUMENT_EXTERNAL_SYNC_META, true)
      .setMeta('addToHistory', false)
      .setContent(editorDoc, { emitUpdate: false })
      .run()
    syncing.current = false
    lastEmittedSig.current = sig
  }, [editor, document.content])

  useEffect(() => {
    if (editor) editor.commands.setPaginationLayout(paginationLayout ?? null)
  }, [editor, paginationLayout])

  if (!editor) {
    return (
      <div className="min-h-[300px] animate-pulse rounded-md border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/20" />
    )
  }

  return (
    <PaperProvider paper={paper}>
      <PaginationProvider value={{
        document,
        pagination,
        paper,
        printLayout: printLayout || createDocumentPrintLayout(paper),
        pageGapPx,
      }}>
        <ResolverProvider resolvers={resolvers}>
          <EditorContent editor={editor} />
        </ResolverProvider>
      </PaginationProvider>
    </PaperProvider>
  )
}

/** 获取编辑器实例的 hook 辅助类型 */
export type { Editor as DocumentEditorInstance }
