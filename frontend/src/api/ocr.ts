import { api, jsonHeaders } from './client'
import type { OcrJobs, OcrProgress } from '@/types'

export const ocrApi = {
  getJobs() {
    return api<OcrJobs>('/api/tools/pdf-slicer/ocr-jobs')
  },
  startOcr(runId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/start-ocr`, { method: 'POST' })
  },
  resumeOcr(runId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/resume-ocr`, { method: 'POST' })
  },
  getOcrProgress(runId: string) {
    return api<OcrProgress>(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/ocr-progress`)
  },
  forceRerunOcr(runId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/force-rerun-ocr`, { method: 'POST' })
  },
  forceInterruptOcr(runId: string) {
    return api(`/api/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/force-interrupt-ocr`, { method: 'POST' })
  },
  bulkOcr(runIds: string[]) {
    return api('/api/tools/pdf-slicer/runs/bulk-ocr', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ runIds }),
    })
  },
}
