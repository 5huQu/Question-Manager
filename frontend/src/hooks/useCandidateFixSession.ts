import { useCallback, useEffect, useState } from 'react'
import { importV2Api } from '@/api/importV2'
import { pdfSlicerApi } from '@/api/pdfSlicer'
import type { ManualFixRegion } from '@/components/import-v2/manual-fix/types'

interface CandidateTextDraft {
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  figures: any[]
}

export function useCandidateFixSession(sourceDocumentId: string, candidateId?: string) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [candidate, setCandidate] = useState<any>(null)
  const [session, setSession] = useState<any>(null)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [textDirty, setTextDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (!candidateId || !sourceDocumentId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError('')
      try {
        const data = await importV2Api.listCandidates(sourceDocumentId)
        const currentCandidate = data.items.find(item => item.id === candidateId)
        if (!currentCandidate) throw new Error('未找到当前候选题目。')
        const currentSession = await importV2Api.createManualFixSession(candidateId)
        if (!cancelled) {
          setCandidate(currentCandidate)
          setSession(currentSession)
          setTextDirty(false)
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [candidateId, sourceDocumentId])

  const saveDraft = useCallback(async (regions: ManualFixRegion[], draft: CandidateTextDraft) => {
    if (!session || !candidateId) return null
    setSaving(true)
    setSaveError('')
    try {
      const updatedSession = await pdfSlicerApi.saveAnnotationRegions(session.id, regions, session.revision)
      const updated = await importV2Api.updateCandidate(candidateId, draft)
      setSession(updatedSession)
      setCandidate(updated.candidate)
      setTextDirty(false)
      setLastSavedAt(new Date())
      return { session: updatedSession, candidate: updated.candidate }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(message)
      throw error
    } finally {
      setSaving(false)
    }
  }, [candidateId, session])

  const saveRegions = useCallback(async (regions: ManualFixRegion[]) => {
    if (!session) return null
    setSaving(true)
    try {
      const updated = await pdfSlicerApi.saveAnnotationRegions(session.id, regions, session.revision)
      setSession(updated)
      return updated
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      setSaving(false)
    }
  }, [session])

  const finalize = useCallback(async (regions: ManualFixRegion[], draft: CandidateTextDraft) => {
    if (!session || !candidateId) return false
    setFinalizing(true)
    setSaveError('')
    try {
      const saved = await pdfSlicerApi.saveAnnotationRegions(session.id, regions, session.revision)
      const updated = await importV2Api.updateCandidate(candidateId, draft)
      const response = await fetch(`/api/tools/pdf-slicer/annotation-sessions/${encodeURIComponent(session.id)}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stemMarkdown: draft.stemMarkdown, answerText: draft.answerText, analysisMarkdown: draft.analysisMarkdown }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || '提交裁剪与校对失败。')
      }
      setSession(saved)
      setCandidate(updated.candidate)
      setTextDirty(false)
      setLastSavedAt(new Date())
      return true
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setFinalizing(false)
    }
  }, [candidateId, session])

  return { loading, saving, finalizing, candidate, session, loadError, saveError, textDirty, lastSavedAt, setSession, setTextDirty, saveDraft, saveRegions, finalize }
}
