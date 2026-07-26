import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  redoTeachingDocument,
  undoTeachingDocument,
  validateTeachingDocument,
  type AutosaveState,
} from '@/utils/teachingDocument'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'

export function useTeachingDocumentEditor(documentId: string) {
  const [record, setRecord] = useState<TeachingDocumentRecord | null>(null)
  const [history, setHistory] = useState<TeachingDocumentHistory | null>(null)
  const [saveState, setSaveState] = useState<AutosaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState<TeachingDocumentRevisionConflict | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const recordRef = useRef<TeachingDocumentRecord | null>(null)
  const documentRef = useRef<TeachingDocumentV1 | null>(null)
  const autosaveRef = useRef<TeachingDocumentAutosave<TeachingDocumentV1> | null>(null)

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
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [configureAutosave, documentId])

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
    setHistory((current) => {
      if (!current) return current
      const next = executeTeachingDocumentCommand(current, command)
      if (next === current) return current
      documentRef.current = next.document
      autosaveRef.current?.changed()
      return next
    })
  }, [])

  const undo = useCallback(() => {
    setHistory((current) => {
      if (!current) return current
      const next = undoTeachingDocument(current)
      if (next === current) return current
      documentRef.current = next.document
      autosaveRef.current?.changed()
      return next
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((current) => {
      if (!current) return current
      const next = redoTeachingDocument(current)
      if (next === current) return current
      documentRef.current = next.document
      autosaveRef.current?.changed()
      return next
    })
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

  const validation = useMemo(
    () => history ? validateTeachingDocument(history.document) : { valid: true, issues: [] },
    [history],
  )

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
    dispatch,
    undo,
    redo,
    saveNow: () => autosaveRef.current?.flush(),
    reload: load,
    uploadAsset,
  }
}
