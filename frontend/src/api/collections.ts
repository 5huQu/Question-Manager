import { api, jsonHeaders } from './client'
import type { Basket, CollectionExport, CollectionSummary } from '@/types'

export type CollectionExportPayload = {
  format?: string
  variant?: string
  template?: 'worksheet' | 'exam'
  includeAnswers?: boolean
  includeAnalysis?: boolean
}

export const collectionsApi = {
  listCollections() {
    return api<{ items: CollectionSummary[] }>('/api/question-bank/collections')
  },
  getCollection(id: string) {
    return api<Basket>(`/api/question-bank/collections/${encodeURIComponent(id)}`)
  },
  createCollection(payload: Partial<Basket>) {
    return api<Basket>('/api/question-bank/collections', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  updateCollection(id: string, payload: Record<string, unknown>) {
    return api<Basket>(`/api/question-bank/collections/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  addItem(collectionId: string, payload: { questionId: string; score?: number; sectionName?: string }) {
    return api<Basket>(`/api/question-bank/collections/${encodeURIComponent(collectionId)}/items`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  updateItem(collectionId: string, relationId: string, payload: Record<string, unknown>) {
    return api<Basket>(`/api/question-bank/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(relationId)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
  removeItem(collectionId: string, relationId: string) {
    return api(`/api/question-bank/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(relationId)}`, { method: 'DELETE' })
  },
  clearItems(collectionId: string) {
    return api(`/api/question-bank/collections/${encodeURIComponent(collectionId)}/items`, { method: 'DELETE' })
  },
  replaceItems(collectionId:string,payload:{questionIds:string[];title?:string}){
    return api<Basket>(`/api/question-bank/collections/${encodeURIComponent(collectionId)}/items`,{method:'PUT',headers:jsonHeaders,body:JSON.stringify(payload)})
  },
  reorder(collectionId: string, items: Array<{ relationId?: string; sortOrder: number }>) {
    return api<Basket>(`/api/question-bank/collections/${encodeURIComponent(collectionId)}/reorder`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ items }),
    })
  },
  exportCollection(id: string, payload: CollectionExportPayload = {}) {
    return api<CollectionExport>(`/api/question-bank/collections/${encodeURIComponent(id)}/export`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    })
  },
}
