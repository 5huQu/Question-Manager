import { api, jsonHeaders } from './client'
import type { LearningTagLibrary, TagLibraries } from '@/types'

export const learningTagsApi = {
  getQuestionBankTagLibraries() {
    return api<TagLibraries>('/api/question-bank/tag-libraries')
  },
  listLibraries() {
    return api<{ libraries: LearningTagLibrary[] }>('/api/learning-tags/libraries')
  },
  createLibrary(payload: Partial<LearningTagLibrary> | Record<string, unknown>) {
    return api<{ library: LearningTagLibrary }>('/api/learning-tags/libraries', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  updateLibrary(id: string, payload: Partial<LearningTagLibrary>) {
    return api<{ library: LearningTagLibrary }>(`/api/learning-tags/libraries/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  deleteLibrary(id: string) {
    return api<{ ok: boolean }>(`/api/learning-tags/libraries/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}
