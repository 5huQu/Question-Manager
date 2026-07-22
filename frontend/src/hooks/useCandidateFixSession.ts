import { useCallback, useEffect, useState } from 'react'
import { importV2Api } from '@/api/importV2'
import type { CandidateFixRegion, CandidateFixSession } from '@/api/importV2'
import { ApiError } from '@/api/client'
import type { ManualFixRegion } from '@/components/import-v2/manual-fix/types'

interface CandidateTextDraft {
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  figures: any[]
}

export interface CandidateEditorConflict {
  message: string
  actualContentRevision?: number
  committedQuestionId?: string
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
  const [conflict, setConflict] = useState<CandidateEditorConflict | null>(null)

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
        if (currentCandidate.status === 'committed') {
          if (!cancelled) {
            setCandidate(currentCandidate)
            setSession(null)
            setTextDirty(false)
          }
          return
        }
        const currentSession = toWorkbenchSession(await importV2Api.createManualFixSession(candidateId))
        if (!cancelled) {
          setCandidate(currentCandidate)
          setSession(currentSession)
          setTextDirty(false)
          setConflict(null)
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
    setConflict(null)
    try {
      const updatedSession = toWorkbenchSession(await importV2Api.saveCandidateFixRegions(session.id, toApiRegions(regions), session.revision))
      const updated = await importV2Api.updateCandidate(candidateId, draft, Number(candidate?.contentRevision || 1))
      setSession(updatedSession)
      setCandidate(updated.candidate)
      setTextDirty(false)
      setLastSavedAt(new Date())
      return { session: updatedSession, candidate: updated.candidate }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof ApiError && error.status === 409) {
        setConflict({
          message: String(error.payload.message || message),
          actualContentRevision: typeof error.payload.actualContentRevision === 'number' ? error.payload.actualContentRevision : undefined,
          committedQuestionId: typeof error.payload.committedQuestionId === 'string' ? error.payload.committedQuestionId : undefined,
        })
      }
      setSaveError(message)
      throw error
    } finally {
      setSaving(false)
    }
  }, [candidate?.contentRevision, candidateId, session])

  const saveRegions = useCallback(async (regions: ManualFixRegion[]) => {
    if (!session) return null
    setSaving(true)
    try {
      const updated = toWorkbenchSession(await importV2Api.saveCandidateFixRegions(session.id, toApiRegions(regions), session.revision))
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
    setConflict(null)
    try {
      const saved = toWorkbenchSession(await importV2Api.saveCandidateFixRegions(session.id, toApiRegions(regions), session.revision))
      const updated = await importV2Api.updateCandidate(candidateId, draft, Number(candidate?.contentRevision || 1))
      const finalized = await importV2Api.finalizeCandidateFixSession(saved.id, {
        stemMarkdown: draft.stemMarkdown, answerText: draft.answerText, analysisMarkdown: draft.analysisMarkdown,
      })
      setSession(toWorkbenchSession(finalized.session))
      setCandidate(finalized.candidate || updated.candidate)
      setTextDirty(false)
      setLastSavedAt(new Date())
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict({
          message: String(error.payload.message || error.message),
          actualContentRevision: typeof error.payload.actualContentRevision === 'number' ? error.payload.actualContentRevision : undefined,
          committedQuestionId: typeof error.payload.committedQuestionId === 'string' ? error.payload.committedQuestionId : undefined,
        })
      }
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setFinalizing(false)
    }
  }, [candidate?.contentRevision, candidateId, session])

  return { loading, saving, finalizing, candidate, session, loadError, saveError, conflict, textDirty, lastSavedAt, setSession, setTextDirty, saveDraft, saveRegions, finalize }
}

function toApiRegions(regions: ManualFixRegion[]): CandidateFixRegion[] {
  return regions.map((region) => ({
    id: region.id, sourceDocumentId: region.sourceRunId, kind: region.kind,
    questionLabel: region.questionLabel, questionKeys: region.questionKeys || [], segments: region.segments,
    sortOrder: region.sortOrder, note: region.note,
  }))
}

function toWorkbenchSession(session: CandidateFixSession) {
  return {
    ...session,
    sourceProfileJson: JSON.stringify(session.sourceProfiles || {}),
    regions: session.regions.map((region) => ({ ...region, sourceRunId: region.sourceDocumentId })),
  }
}
