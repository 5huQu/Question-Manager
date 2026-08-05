import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ApiError } from '@/api/client'
import {
  teachingDocumentsApi,
  type TeachingDocumentAsset,
  type TeachingDocumentRecord,
  type TeachingDocumentRevisionConflict,
} from '@/api/teachingDocuments'
import type { TeachingDocumentCommand, TeachingDocumentHistory } from '@/utils/teachingDocument'
import {
  TeachingDocumentAutosave,
  createTeachingDocumentHistory,
  executeTeachingDocumentCommand,
  hasFatalTeachingDocumentIssues,
  questionSequenceSignature,
  renumberAutomaticQuestionNumbers,
  redoTeachingDocument,
  undoTeachingDocument,
  validateTeachingDocument,
  type AutosaveState,
} from '@/utils/teachingDocument'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import type { DocumentValidationResult } from '@/types/teachingDocument'
import { structuralDocumentSignature } from '@/utils/teachingDocument/validate'
import {
  createLayoutRequest,
  INITIAL_LAYOUT_REQUEST,
  type LayoutRequest,
  type LayoutRequestReason,
} from '@/components/teaching-document/editor/useDeferredPaginationDocument'

function layoutStructureSignature(document: TeachingDocumentV1): string {
  return document.content.map((block) => {
    if (block.type !== 'box') return `${block.type}:${block.id}`
    return `box:${block.id}:${block.children.map((child) => `${child.type}:${child.id}`).join(',')}`
  }).join('|')
}

export function useTeachingDocumentEditor(documentId: string) {
  const [record, setRecord] = useState<TeachingDocumentRecord | null>(null)
  const [history, setHistory] = useState<TeachingDocumentHistory | null>(null)
  const [saveState, setSaveState] = useState<AutosaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState<TeachingDocumentRevisionConflict | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const layoutRequestIdRef = useRef(INITIAL_LAYOUT_REQUEST.id)
  const [layoutRequest, setLayoutRequest] = useState<LayoutRequest>(INITIAL_LAYOUT_REQUEST)
  const recordRef = useRef<TeachingDocumentRecord | null>(null)
  const documentRef = useRef<TeachingDocumentV1 | null>(null)
  const autosaveRef = useRef<TeachingDocumentAutosave<TeachingDocumentV1> | null>(null)
  /** 文档级编辑器实例（T3：undo/redo 由编辑器管理） */
  const editorInstanceRef = useRef<Editor | null>(null)
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  /** 由 DocumentEditor 注册；结构操作和保存前用于冲刷尚在合并窗口中的文字。 */
  const editorFlushRef = useRef<(() => void) | null>(null)
  const [editorHistoryState, setEditorHistoryState] = useState({ canUndo: false, canRedo: false })
  const editorHistoryListenerRef = useRef<((payload?: unknown) => void) | null>(null)
  const pendingEditorLayoutReasonRef = useRef<LayoutRequestReason | null>(null)
  /**
   * 校验结果按结构签名延迟计算：普通文本回显不产生结构变化，不再每次键入停顿
   * 都跑全量 validateTeachingDocument（长文档可省下每次几毫秒到几十毫秒）。
   */
  const [validation, setValidation] = useState<DocumentValidationResult>({ valid: true, issues: [] })
  const lastValidationSignatureRef = useRef('')

  const requestLayout = useCallback((reason: LayoutRequestReason) => {
    const id = layoutRequestIdRef.current + 1
    layoutRequestIdRef.current = id
    setLayoutRequest(createLayoutRequest(id, reason))
  }, [])

  const configureAutosave = useCallback((loaded: TeachingDocumentRecord) => {
    autosaveRef.current?.dispose()
    recordRef.current = loaded
    documentRef.current = loaded.content
    const autosave = new TeachingDocumentAutosave(
      () => documentRef.current || loaded.content,
      async (content) => {
        const current = recordRef.current
        if (!current) return
        const validation = validateTeachingDocument(content)
        if (hasFatalTeachingDocumentIssues(validation.issues)) {
          throw new Error(validation.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join('；'))
        }
        const saved = await teachingDocumentsApi.updateDocument(current.id, {
          expectedRevision: current.revision,
          title: content.title,
          content,
        })
        recordRef.current = saved
        setRecord(saved)
      },
      (state, error) => {
        setSaveState(state)
        if (state === 'conflict' && error instanceof ApiError) {
          setConflict(error.payload as unknown as TeachingDocumentRevisionConflict)
          setSaveError(error.message)
        } else if (state === 'failed') {
          setSaveError(error instanceof Error ? error.message : String(error))
        } else if (state === 'saved') {
          setSaveError('')
        }
      },
    )
    autosaveRef.current = autosave
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await teachingDocumentsApi.getDocument(documentId)
      setRecord(loaded)
      setHistory(createTeachingDocumentHistory(loaded.content))
      setConflict(null)
      setSaveError('')
      setSaveState('saved')
      configureAutosave(loaded)
      requestLayout('structure')
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [configureAutosave, documentId, requestLayout])

  useEffect(() => {
    void load()
    return () => autosaveRef.current?.dispose()
  }, [load])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!['dirty', 'saving', 'failed', 'conflict'].includes(saveState)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [saveState])

  useEffect(() => {
    const protectInternalNavigation = (event: MouseEvent) => {
      if (!['dirty', 'saving', 'failed', 'conflict'].includes(saveState)) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target === '_blank') return
      const next = new URL(anchor.href, window.location.href)
      if (next.origin !== window.location.origin || next.pathname === window.location.pathname) return
      if (window.confirm('当前文档仍有未保存内容，确定离开吗？')) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('click', protectInternalNavigation, true)
    return () => document.removeEventListener('click', protectInternalNavigation, true)
  }, [saveState])

  const dispatch = useCallback((command: TeachingDocumentCommand) => {
    editorFlushRef.current?.()
    requestLayout(command.type === 'setTitle' ? 'typing' : 'structure')
    setHistory((current) => {
      if (!current) return current
      const next = executeTeachingDocumentCommand(current, command)
      if (next === current) return current
      documentRef.current = next.document
      autosaveRef.current?.changed()
      return next
    })
  }, [requestLayout])

  const undo = useCallback(() => {
    // T3：优先使用编辑器内置 undo（跨块连续撤销）
    const editorInstance = editorInstanceRef.current
    if (editorInstance && editorInstance.can().undo()) {
      pendingEditorLayoutReasonRef.current = 'structure'
      requestLayout('structure')
      editorInstance.commands.undo()
      return
    }
    // 回退到外部历史（编辑器未就绪时）
    requestLayout('structure')
    setHistory((current) => {
      if (!current) return current
      const next = undoTeachingDocument(current)
      if (next === current) return current
      documentRef.current = next.document
      autosaveRef.current?.changed()
      return next
    })
  }, [requestLayout])

  const redo = useCallback(() => {
    // T3：优先使用编辑器内置 redo
    const editorInstance = editorInstanceRef.current
    if (editorInstance && editorInstance.can().redo()) {
      pendingEditorLayoutReasonRef.current = 'structure'
      requestLayout('structure')
      editorInstance.commands.redo()
      return
    }
    requestLayout('structure')
    setHistory((current) => {
      if (!current) return current
      const next = redoTeachingDocument(current)
      if (next === current) return current
      documentRef.current = next.document
      autosaveRef.current?.changed()
      return next
    })
  }, [requestLayout])

  /** 最近一次重编号前的题序签名；签名未变说明编号无需更新。 */
  const questionSequenceSignatureRef = useRef('')

  /** 编辑器内容变化回调（由 DocumentEditor onChange 调用） */
  const handleEditorChange = useCallback((doc: TeachingDocumentV1) => {
    // 普通文本回显不改变题序：题序签名未变时跳过全量重编号（长文档每次键入的
    // 停顿期都会走到这里，重编号会克隆全部题目块）。
    const nextSignature = questionSequenceSignature(doc)
    const normalized = nextSignature === questionSequenceSignatureRef.current
      ? doc
      : renumberAutomaticQuestionNumbers(doc)
    const previous = documentRef.current
    const inferredReason: LayoutRequestReason = previous
      && layoutStructureSignature(previous) !== layoutStructureSignature(normalized)
      ? 'structure'
      : 'typing'
    requestLayout(pendingEditorLayoutReasonRef.current ?? inferredReason)
    pendingEditorLayoutReasonRef.current = null
    questionSequenceSignatureRef.current = questionSequenceSignature(normalized)
    documentRef.current = normalized
    setHistory((current) => {
      if (!current) return current
      return { ...current, document: normalized }
    })
    autosaveRef.current?.changed()
  }, [requestLayout])

  /** 键入发生时立即标脏；全文模型可在编辑器合并窗口结束后再同步。 */
  const markEditorDirty = useCallback(() => {
    autosaveRef.current?.changed()
  }, [])

  /** 注册编辑器实例 */
  const registerEditor = useCallback((editor: Editor | null) => {
    const previous = editorInstanceRef.current
    if (previous && editorHistoryListenerRef.current) {
      previous.off('transaction', editorHistoryListenerRef.current)
    }
    editorHistoryListenerRef.current = null
    editorInstanceRef.current = editor
    setActiveEditor(editor)
    if (!editor) {
      setEditorHistoryState({ canUndo: false, canRedo: false })
      return
    }
    const syncHistoryState = () => {
      setEditorHistoryState({
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
      })
    }
    editorHistoryListenerRef.current = syncHistoryState
    editor.on('transaction', syncHistoryState)
    syncHistoryState()
  }, [])

  const registerEditorFlush = useCallback((flush: (() => void) | null) => {
    editorFlushRef.current = flush
  }, [])

  const flushEditorChanges = useCallback(() => {
    editorFlushRef.current?.()
  }, [])

  /**
   * 读取当前光标所在的顶层块。顶栏插入动作必须以实时编辑器选区为准，
   * 不能沿用 React 中可能滞后一帧的 selectedId，否则留白会落到上一题后面。
   */
  const activeTopLevelBlockId = useCallback((): string | undefined => {
    const currentEditor = editorInstanceRef.current
    if (!currentEditor) return undefined
    const { $from } = currentEditor.state.selection
    if ($from.depth >= 1) {
      const id = String($from.node(1).attrs.blockId || '')
      if (id) return id
    }
    const adjacent = $from.nodeAfter || $from.nodeBefore
    const adjacentId = String(adjacent?.attrs.blockId || '')
    return adjacentId || undefined
  }, [])

  const uploadAsset = useCallback(async (file: File): Promise<TeachingDocumentAsset> => {
    const asset = await teachingDocumentsApi.uploadAsset(documentId, file)
    setRecord((current) => {
      if (!current) return current
      const next = { ...current, assets: [...current.assets.filter((item) => item.id !== asset.id), asset] }
      recordRef.current = next
      return next
    })
    return asset
  }, [documentId])

  const renderTikz = useCallback(async (source: string) => {
    const result = await teachingDocumentsApi.renderTikz(documentId, { source })
    setRecord((current) => {
      if (!current) return current
      const next = { ...current, assets: [...current.assets.filter((item) => item.id !== result.asset.id), result.asset] }
      recordRef.current = next
      return next
    })
    return result
  }, [documentId])

  // 结构签名未变化时不重跑全量校验（文本回显跳过）。
  useEffect(() => {
    const doc = history?.document
    if (!doc) return
    const signature = structuralDocumentSignature(doc)
    if (signature === lastValidationSignatureRef.current) return
    lastValidationSignatureRef.current = signature
    setValidation(validateTeachingDocument(doc))
  }, [history])

  return {
    record,
    history,
    document: history?.document || null,
    loading,
    loadError,
    saveState,
    saveError,
    conflict,
    validation,
    layoutRequest,
    requestLayout,
    dispatch,
    undo,
    redo,
    saveNow: async () => {
      editorFlushRef.current?.()
      await autosaveRef.current?.flush()
    },
    reload: load,
    uploadAsset,
    renderTikz,
    /** T3：编辑器内容变化回调 */
    handleEditorChange,
    markEditorDirty,
    /** T3：注册编辑器实例 */
    registerEditor,
    /** 当前文档级编辑器，供页面级格式工具栏驱动。 */
    activeEditor,
    registerEditorFlush,
    flushEditorChanges,
    activeTopLevelBlockId,
    canUndo: editorHistoryState.canUndo || Boolean(history?.past.length),
    canRedo: editorHistoryState.canRedo || Boolean(history?.future.length),
  }
}
