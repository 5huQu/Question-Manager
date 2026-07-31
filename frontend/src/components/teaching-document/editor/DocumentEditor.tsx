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
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { Transaction } from '@tiptap/pm/state'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { createDocumentEditorExtensions } from './schema'
import { teachingDocumentToEditorDoc, editorDocToTeachingDocument, type EditorDocMeta } from './serialization'
import { PaperProvider, PaginationProvider, ResolverProvider, type DocumentEditorResolvers } from './NodeViews'
import { createDocumentPrintLayout, resolveDocumentPaper, type PaginationResult, type PrintLayoutSpec } from '@/utils/teachingDocument'
import type { EditorPaginationLayout } from './paginationDecorations'
import { DOCUMENT_EXTERNAL_SYNC_META, isExternalDocumentSync } from './selection'

/** 普通键入在编辑器内即时生效；整篇领域模型同步采用短暂合并，避免逐字序列化。 */
export const DEFAULT_DOCUMENT_MODEL_SYNC_DELAY_MS = 350

export interface DocumentEditorProps {
  /** 文档数据（唯一事实来源） */
  document: TeachingDocumentV1
  /** 内容变更回调；外部负责 autosave */
  onChange: (doc: TeachingDocumentV1) => void
  /** 编辑器已有未同步内容时立即通知外层，用于保存状态与离开保护。 */
  onChangePending?: () => void
  /** 暴露强制同步入口；保存、结构操作前调用以避免使用过期的外层快照。 */
  onFlushPendingChanges?: (flush: (() => void) | null) => void
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
  /** 长文档开启离屏内容跳过，降低浏览器对不可见块的布局和绘制成本。 */
  virtualizeOffscreen?: boolean
  /** 尾随键入合并窗口；测试可设为 0 以获得同步回调。 */
  modelSyncDelayMs?: number
}

export function DocumentEditor({
  document,
  onChange,
  onChangePending,
  onFlushPendingChanges,
  resolvers = {},
  onEditorReady,
  paginationLayout,
  pagination = null,
  printLayout,
  pageGapPx = 24,
  editable = true,
  virtualizeOffscreen = false,
  modelSyncDelayMs = DEFAULT_DOCUMENT_MODEL_SYNC_DELAY_MS,
}: DocumentEditorProps) {
  /** 最近一次由编辑器产生的内容签名，用于区分自身回显与外部更新 */
  const lastEmittedContentSig = useRef('')
  const lastEmittedOutlineSig = useRef('')
  const syncing = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onChangePendingRef = useRef(onChangePending)
  onChangePendingRef.current = onChangePending
  const editorRef = useRef<Editor | null>(null)
  const pendingChangeRef = useRef(false)
  const pendingChangeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  /** 文档元信息（不经过编辑器，序列化时回填） */
  const metaRef = useRef<EditorDocMeta>({
    documentType: document.documentType,
    title: document.title,
    metadata: document.metadata,
    style: document.style,
    outline: document.outline,
  })
  metaRef.current = {
    documentType: document.documentType,
    title: document.title,
    metadata: document.metadata,
    style: document.style,
    outline: document.outline,
  }

  const initialDoc = useRef(teachingDocumentToEditorDoc(document))

  /** 纸张规格：供 NodeView 计算内容区宽度（图片上限、mm 渲染） */
  const paper = useMemo(() => resolveDocumentPaper(document.style), [document.style])

  const flushPendingChanges = useCallback(() => {
    if (pendingChangeTimerRef.current) {
      window.clearTimeout(pendingChangeTimerRef.current)
      pendingChangeTimerRef.current = null
    }
    if (!pendingChangeRef.current) return
    pendingChangeRef.current = false
    const currentEditor = editorRef.current
    if (!currentEditor || syncing.current) return
    const json = currentEditor.getJSON()
    const nextDoc = editorDocToTeachingDocument(json, metaRef.current)
    lastEmittedContentSig.current = JSON.stringify(nextDoc.content)
    lastEmittedOutlineSig.current = JSON.stringify(nextDoc.outline ?? {})
    onChangeRef.current(nextDoc)
  }, [])

  const schedulePendingChanges = useCallback((currentEditor: Editor, transaction: Transaction) => {
    // setContent(..., { emitUpdate: false }) 的更新在部分编辑器调度时会在
    // syncing 标志复位后才触发回调；事务标记才是可靠的外部同步边界。
    if (syncing.current || isExternalDocumentSync(transaction)) return
    editorRef.current = currentEditor
    pendingChangeRef.current = true
    onChangePendingRef.current?.()
    if (modelSyncDelayMs <= 0) {
      flushPendingChanges()
      return
    }
    // 尾随防抖：持续输入时不进行全篇序列化；仅在最后一次键入后同步。
    if (pendingChangeTimerRef.current) window.clearTimeout(pendingChangeTimerRef.current)
    pendingChangeTimerRef.current = window.setTimeout(flushPendingChanges, modelSyncDelayMs)
  }, [flushPendingChanges, modelSyncDelayMs])

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
        class: `td-document td-document-editor min-h-[300px] px-6 py-4 text-sm leading-7 text-zinc-900 outline-none dark:text-zinc-50${virtualizeOffscreen ? ' td-document-editor-virtualized' : ''}`,
      },
    },
    onUpdate: ({ editor: currentEditor, transaction }) => {
      schedulePendingChanges(currentEditor, transaction)
    },
    onBlur: () => flushPendingChanges(),
  })
  editorRef.current = editor

  useEffect(() => {
    onFlushPendingChanges?.(flushPendingChanges)
    return () => {
      flushPendingChanges()
      onFlushPendingChanges?.(null)
    }
  }, [flushPendingChanges, onFlushPendingChanges])

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
    // 外部结构操作必须以前一次键入的最新快照为基础，避免覆盖合并窗口中的文字。
    flushPendingChanges()
    const contentSig = JSON.stringify(document.content)
    const outlineSig = JSON.stringify(document.outline ?? {})
    // 正常键入的回显已经来自当前 editor。此前这里仍会 getJSON + 反序列化整篇
    // 文档来二次确认，长文档会在停止输入后出现明显卡顿。签名相同即可安全跳过；
    // 真正的 undo、插入、拖拽和远端 reload 都会产生不同签名，仍走完整同步。
    if (contentSig === lastEmittedContentSig.current && outlineSig === lastEmittedOutlineSig.current) return
    // 这是来自结构操作、撤销或重载的外部变化；才值得进行完整比较。
    const currentJson = editor.getJSON()
    const currentDoc = editorDocToTeachingDocument(currentJson, metaRef.current)
    const nextEditorDoc = teachingDocumentToEditorDoc(document)
    const editorMatches = JSON.stringify(currentJson) === JSON.stringify(nextEditorDoc)
    if (contentSig === JSON.stringify(currentDoc.content)
      && outlineSig === JSON.stringify(currentDoc.outline ?? {})
      && editorMatches) {
      lastEmittedContentSig.current = contentSig
      lastEmittedOutlineSig.current = outlineSig
      return
    }
    // 外部更新：同步编辑器内容
    syncing.current = true
    editor
      .chain()
      .setMeta(DOCUMENT_EXTERNAL_SYNC_META, true)
      .setMeta('addToHistory', false)
      .setContent(nextEditorDoc, { emitUpdate: false })
      .run()
    syncing.current = false
    lastEmittedContentSig.current = contentSig
    lastEmittedOutlineSig.current = outlineSig
  }, [editor, document.content, document.outline, flushPendingChanges])

  useEffect(() => {
    if (editor) editor.commands.setPaginationLayout(paginationLayout ?? null)
  }, [editor, paginationLayout])

  const resolverContextValue = useMemo(() => ({
    resolveQuestion: resolvers.resolveQuestion,
    resolveFigure: resolvers.resolveFigure,
  }), [resolvers.resolveFigure, resolvers.resolveQuestion])
  // `document` 在文字合并回传时会换引用，但分页 NodeView 只依赖分页结果和
  // chrome 元数据。稳定 context 能避免数十张知识卡片跟随一次普通键入重渲染。
  const paginationContextValue = useMemo(() => ({
    documentTitle: document.title,
    documentType: document.documentType,
    pagination,
    paper,
    printLayout: printLayout || createDocumentPrintLayout(paper),
    pageGapPx,
  }), [document.documentType, document.title, pageGapPx, pagination, paper, printLayout])

  if (!editor) {
    return (
      <div className="min-h-[300px] animate-pulse rounded-md border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/20" />
    )
  }

  return (
    <PaperProvider paper={paper}>
      <PaginationProvider value={paginationContextValue}>
        <ResolverProvider resolvers={resolverContextValue}>
          <EditorContent editor={editor} />
        </ResolverProvider>
      </PaginationProvider>
    </PaperProvider>
  )
}

/** 获取编辑器实例的 hook 辅助类型 */
export type { Editor as DocumentEditorInstance }
