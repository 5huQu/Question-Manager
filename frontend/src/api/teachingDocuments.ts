import { api, jsonHeaders } from './client'
import type { DocumentValidationIssue, TeachingDocumentV1 } from '@/types/teachingDocument'
import type { TeachingDocumentPrintOptions } from '@/types/teachingDocument'

export type PrintChromeTemplate = { id: string; name: string; options: TeachingDocumentPrintOptions; createdAt: string; updatedAt: string }

export type TeachingDocumentAsset = {
  id: string
  documentId: string
  originalName: string
  mimeType: string
  byteSize: number
  width: number
  height: number
  url: string
  createdAt: string
}

export type TikzRenderResult = { asset: TeachingDocumentAsset; sourceHash: string; cached: boolean; warnings: string[] }

export type TeachingDocumentSummary = {
  id: string
  title: string
  documentType: TeachingDocumentV1['documentType']
  schemaVersion: number
  revision: number
  blockCount: number
  assetCount: number
  createdAt: string
  updatedAt: string
}

export type TeachingDocumentRecord = {
  id: string
  title: string
  documentType: TeachingDocumentV1['documentType']
  schemaVersion: number
  revision: number
  content: TeachingDocumentV1
  blockCount: number
  issues: DocumentValidationIssue[]
  assets: TeachingDocumentAsset[]
  createdAt: string
  updatedAt: string
}

export type TeachingDocumentRevisionConflict = {
  error: 'revision_conflict'
  message: string
  expectedRevision: number
  actualRevision: number
  current: Pick<TeachingDocumentSummary, 'id' | 'title' | 'documentType' | 'revision' | 'blockCount' | 'updatedAt'>
}

export const teachingDocumentsApi = {
  listPrintTemplates: () => api<{ items: PrintChromeTemplate[] }>('/api/teaching-document-templates'),
  createPrintTemplate: (input: { name: string; options: TeachingDocumentPrintOptions }) => api<PrintChromeTemplate>('/api/teaching-document-templates', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }),
  updatePrintTemplate: (id: string, input: { name: string; options: TeachingDocumentPrintOptions }) => api<PrintChromeTemplate>(`/api/teaching-document-templates/${encodeURIComponent(id)}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(input) }),
  deletePrintTemplate: (id: string) => api<{ deleted: true }>(`/api/teaching-document-templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listDocuments: () => api<{ items: TeachingDocumentSummary[] }>('/api/teaching-documents'),
  getDocument: (id: string) =>
    api<TeachingDocumentRecord>(`/api/teaching-documents/${encodeURIComponent(id)}`),
  createDocument: (input: {
    title: string
    documentType: TeachingDocumentV1['documentType']
    content?: TeachingDocumentV1
  }) => api<TeachingDocumentRecord>('/api/teaching-documents', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }),
  updateDocument: (id: string, input: {
    expectedRevision: number
    title?: string
    content?: TeachingDocumentV1
  }) => api<TeachingDocumentRecord>(`/api/teaching-documents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }),
  duplicateDocument: (id: string) =>
    api<TeachingDocumentRecord>(`/api/teaching-documents/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    }),
  deleteDocument: (id: string) =>
    api<{ deleted: true; retainedAssets: number }>(`/api/teaching-documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  uploadAsset(id: string, file: File) {
    const form = new FormData()
    form.append('file', file)
    return api<TeachingDocumentAsset>(`/api/teaching-documents/${encodeURIComponent(id)}/assets`, {
      method: 'POST',
      body: form,
    })
  },
  renderTikz: (id: string, input: { source: string }) => api<TikzRenderResult>(`/api/teaching-documents/${encodeURIComponent(id)}/tikz/render`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(input),
  }),
  getAsset: (assetId: string) =>
    api<TeachingDocumentAsset>(`/api/teaching-document-assets/${encodeURIComponent(assetId)}`),
}
