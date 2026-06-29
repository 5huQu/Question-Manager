import { api, jsonHeaders } from './client'
import type { OcrSettings } from '@/types'

export type HealthResponse = {
  serverTime?: string
  serverYear?: number
  tools?: {
    soffice?: boolean
    sofficePath?: string
  }
}

export const settingsApi = {
  getHealth() {
    return api<HealthResponse>('/api/health')
  },
  getSettings() {
    return api<OcrSettings>('/api/settings')
  },
  updateSettings(settings: Partial<OcrSettings>) {
    return api<OcrSettings>('/api/settings', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(settings),
    })
  },
  getOcrSettings() {
    return api<OcrSettings>('/api/tools/pdf-slicer/ocr-settings')
  },
  updateOcrSettings(settings: Partial<OcrSettings>) {
    return api<OcrSettings>('/api/tools/pdf-slicer/ocr-settings', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(settings),
    })
  },
}
