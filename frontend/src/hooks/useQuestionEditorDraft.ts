import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { QuestionContentDraft } from '@/types/questionContent'

interface StoredQuestionEditorDraft {
  version: 1
  entityKey: string
  baseContentRevision?: number
  value: QuestionContentDraft
  savedAt: string
}

export interface UseQuestionEditorDraftOptions {
  entityType: string
  entityId: string
  initialValue: QuestionContentDraft
  contentRevision?: number
  enabled?: boolean
  warnBeforeUnload?: boolean
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

export interface UseQuestionEditorDraftResult {
  value: QuestionContentDraft
  setValue: Dispatch<SetStateAction<QuestionContentDraft>>
  updateField: (field: keyof QuestionContentDraft, value: string) => void
  dirty: boolean
  hasRecoveredDraft: boolean
  recoveredAt: Date | null
  markSaved: (savedValue?: QuestionContentDraft) => void
  discardDraft: () => void
  reset: (nextValue?: QuestionContentDraft) => void
}

const EMPTY_DRAFT: QuestionContentDraft = { stemMarkdown: '', answerText: '', analysisMarkdown: '' }

export function questionEditorDraftKey(entityType: string, entityId: string) {
  return `question-editor-draft:${encodeURIComponent(entityType)}:${encodeURIComponent(entityId)}`
}

function normalized(value: QuestionContentDraft): QuestionContentDraft {
  return {
    stemMarkdown: String(value?.stemMarkdown ?? ''),
    answerText: String(value?.answerText ?? ''),
    analysisMarkdown: String(value?.analysisMarkdown ?? ''),
  }
}

function equal(left: QuestionContentDraft, right: QuestionContentDraft) {
  return left.stemMarkdown === right.stemMarkdown && left.answerText === right.answerText && left.analysisMarkdown === right.analysisMarkdown
}

function readStoredDraft(storage: UseQuestionEditorDraftOptions['storage'], key: string, entityKey: string): StoredQuestionEditorDraft | null {
  try {
    const parsed = JSON.parse(storage?.getItem(key) || 'null') as Partial<StoredQuestionEditorDraft> | null
    if (!parsed || parsed.version !== 1 || parsed.entityKey !== entityKey || !parsed.value || typeof parsed.savedAt !== 'string') return null
    return { ...parsed, value: normalized(parsed.value), version: 1, entityKey, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

export function useQuestionEditorDraft(options: UseQuestionEditorDraftOptions): UseQuestionEditorDraftResult {
  const enabled = options.enabled !== false
  const storage = options.storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
  const entityKey = `${options.entityType}:${options.entityId}`
  const key = questionEditorDraftKey(options.entityType, options.entityId)
  const initialValue = useMemo(() => normalized(options.initialValue ?? EMPTY_DRAFT), [options.entityType, options.entityId, options.initialValue])
  const initialRef = useRef(initialValue)
  const restored = useMemo(() => enabled ? readStoredDraft(storage, key, entityKey) : null, [enabled, entityKey, key, storage])
  const recovered = Boolean(restored && !equal(restored.value, initialValue))
  const [value, setValue] = useState<QuestionContentDraft>(() => recovered ? restored!.value : initialValue)
  const [hasRecoveredDraft, setHasRecoveredDraft] = useState(recovered)
  const [recoveredAt, setRecoveredAt] = useState<Date | null>(() => recovered ? new Date(restored!.savedAt) : null)

  useEffect(() => {
    initialRef.current = initialValue
    const stored = enabled ? readStoredDraft(storage, key, entityKey) : null
    const shouldRecover = Boolean(stored && !equal(stored.value, initialValue))
    setValue(shouldRecover ? stored!.value : initialValue)
    setHasRecoveredDraft(shouldRecover)
    setRecoveredAt(shouldRecover ? new Date(stored!.savedAt) : null)
  }, [enabled, entityKey, key, options.contentRevision, storage])

  const dirty = !equal(value, initialRef.current)

  useEffect(() => {
    if (!enabled || !storage) return
    if (!dirty) {
      storage.removeItem(key)
      return
    }
    const envelope: StoredQuestionEditorDraft = {
      version: 1,
      entityKey,
      baseContentRevision: options.contentRevision,
      value,
      savedAt: new Date().toISOString(),
    }
    try {
      storage.setItem(key, JSON.stringify(envelope))
    } catch {
      // An unavailable or full localStorage must not make editing fail.
    }
  }, [dirty, enabled, entityKey, key, options.contentRevision, storage, value])

  useEffect(() => {
    if (!dirty || options.warnBeforeUnload === false || typeof window === 'undefined') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, options.warnBeforeUnload])

  const updateField = useCallback((field: keyof QuestionContentDraft, next: string) => {
    setValue((current) => ({ ...current, [field]: next }))
  }, [])

  const markSaved = useCallback((savedValue?: QuestionContentDraft) => {
    const next = normalized(savedValue ?? value)
    initialRef.current = next
    setValue(next)
    setHasRecoveredDraft(false)
    setRecoveredAt(null)
    storage?.removeItem(key)
  }, [key, storage, value])

  const discardDraft = useCallback(() => {
    storage?.removeItem(key)
    setValue(initialRef.current)
    setHasRecoveredDraft(false)
    setRecoveredAt(null)
  }, [key, storage])

  const reset = useCallback((nextValue?: QuestionContentDraft) => {
    const next = normalized(nextValue ?? initialRef.current)
    initialRef.current = next
    setValue(next)
    setHasRecoveredDraft(false)
    setRecoveredAt(null)
    storage?.removeItem(key)
  }, [key, storage])

  return { value, setValue, updateField, dirty, hasRecoveredDraft, recoveredAt, markSaved, discardDraft, reset }
}
