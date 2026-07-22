import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { importV2Api } from '@/api/importV2'
import { useCandidateFixSession } from './useCandidateFixSession'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/api/importV2', () => ({
  importV2Api: {
    listCandidates: vi.fn(),
    createManualFixSession: vi.fn(),
    saveCandidateFixRegions: vi.fn(),
    finalizeCandidateFixSession: vi.fn(),
    updateCandidate: vi.fn(),
  },
}))

let container: HTMLDivElement
let root: Root
let latest: ReturnType<typeof useCandidateFixSession>

function Harness() {
  latest = useCandidateFixSession('source-1', 'candidate-1')
  return null
}

beforeEach(async () => {
  container = document.createElement('div')
  root = createRoot(container)
  vi.mocked(importV2Api.listCandidates).mockResolvedValue({
    items: [{ id: 'candidate-1', status: 'needs_manual_fix', contentRevision: 5 } as never],
  })
  vi.mocked(importV2Api.createManualFixSession).mockResolvedValue({
    id: 'session-1', candidateId: 'candidate-1', revision: 2, status: 'draft', sourceProfiles: {},
    baseContentRevision: 5, regions: [], createdAt: '', updatedAt: '', finalizedAt: '',
  })
  vi.mocked(importV2Api.saveCandidateFixRegions).mockResolvedValue({
    id: 'session-1', candidateId: 'candidate-1', revision: 3, status: 'draft', sourceProfiles: {},
    baseContentRevision: 5, regions: [], createdAt: '', updatedAt: '', finalizedAt: '',
  })
  await act(async () => { root.render(<Harness />) })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('useCandidateFixSession', () => {
  it('保存候选内容时传递当前 contentRevision 并接收新版本', async () => {
    const updatedCandidate = { id: 'candidate-1', status: 'needs_manual_fix', contentRevision: 6 }
    vi.mocked(importV2Api.updateCandidate).mockResolvedValue({ candidate: updatedCandidate as never })
    const draft = { stemMarkdown: '题干', answerText: '答案', analysisMarkdown: '解析', figures: [] }

    await act(async () => { await latest.saveDraft([], draft) })

    expect(importV2Api.saveCandidateFixRegions).toHaveBeenCalledWith('session-1', [], 2)
    expect(importV2Api.updateCandidate).toHaveBeenCalledWith('candidate-1', draft, 5)
    expect(latest.candidate).toEqual(updatedCandidate)
  })

  it('通过 V2 session API 保存并 finalize', async () => {
    const updatedCandidate = { id: 'candidate-1', status: 'needs_review', contentRevision: 6 }
    const finalizedCandidate = { ...updatedCandidate, status: 'ready', contentRevision: 7 }
    const finalizedSession = {
      id: 'session-1', candidateId: 'candidate-1', revision: 3, status: 'finalized' as const,
      sourceProfiles: {}, baseContentRevision: 5, regions: [], createdAt: '', updatedAt: '', finalizedAt: 'now',
    }
    vi.mocked(importV2Api.updateCandidate).mockResolvedValue({ candidate: updatedCandidate as never })
    vi.mocked(importV2Api.finalizeCandidateFixSession).mockResolvedValue({ session: finalizedSession, candidate: finalizedCandidate as never })
    const draft = { stemMarkdown: '题干', answerText: '答案', analysisMarkdown: '解析', figures: [] }

    let done = false
    await act(async () => { done = await latest.finalize([], draft) })

    expect(done).toBe(true)
    expect(importV2Api.finalizeCandidateFixSession).toHaveBeenCalledWith('session-1', {
      stemMarkdown: '题干', answerText: '答案', analysisMarkdown: '解析',
    })
    expect(latest.session.status).toBe('finalized')
    expect(latest.candidate).toEqual(finalizedCandidate)
  })

  it('409 冲突使用 ApiError payload 呈现服务器版本', async () => {
    vi.mocked(importV2Api.updateCandidate).mockRejectedValue(new ApiError('内容已更新', 409, {
      message: '内容已在其他页面更新',
      actualContentRevision: 8,
    }))

    let thrown: unknown
    await act(async () => {
      try {
        await latest.saveDraft([], { stemMarkdown: '本地题干', answerText: '', analysisMarkdown: '', figures: [] })
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toBeInstanceOf(ApiError)
    expect(latest.conflict).toEqual({ message: '内容已在其他页面更新', actualContentRevision: 8 })
    expect(latest.candidate.contentRevision).toBe(5)
  })
})
