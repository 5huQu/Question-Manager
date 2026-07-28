import type { PaperSpec } from '@/utils/teachingDocument/layout/types'

export const jsonHeaders = { 'Content-Type': 'application/json' }

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

declare global {
  interface Window {
    questionWorkbench?: {
      apiBaseUrl?: string
      updates?: {
        check: (options?: { silent?: boolean }) => Promise<UpdateCheckResult>
        download: () => Promise<UpdateDownloadResult>
        openDownloaded: () => Promise<{ opened: boolean; message: string }>
        onProgress: (callback: (payload: UpdateProgress) => void) => () => void
        onStatus: (callback: (payload: UpdateStatus) => void) => () => void
      }
      pdfExport?: {
        start: (options: {
          documentId: string
          revision?: number
          pageCount?: number
          title?: string
          /** 文档纸张规格：供主进程生成 printToPDF 参数与打印页交叉校验。 */
          paper?: PaperSpec
        }) => Promise<PdfExportResult>
        cancel: () => Promise<{ success: boolean }>
        notifyReady: (payload: {
          pageCount?: number
          warnings?: string[]
          error?: string
        }) => void
      }
    }
  }
}

export interface PdfExportResult {
  success: boolean
  canceled?: boolean
  fileName?: string
  fileSize?: number
  htmlPageCount?: number
  warnings?: string[]
  error?: string
}

export type UpdateAsset = {
  url: string
  sha256: string
  size: number
}

export type UpdateCheckResult = {
  currentVersion: string
  latestVersion?: string
  releaseDate?: string
  notes?: string
  mandatory?: boolean
  platformKey: string
  updateAvailable: boolean
  configured?: boolean
  manifestUrl?: string
  asset?: UpdateAsset | null
  downloadedPath?: string
  message?: string
  error?: string
}

export type UpdateDownloadResult = {
  path: string
  version: string
  platformKey: string
  sha256: string
  size: number
  message?: string
}

export type UpdateProgress = {
  downloaded: number
  total: number
  percent: number
}

export type UpdateStatus = {
  phase?: 'downloading' | 'downloaded' | 'error'
  message?: string
  version?: string
  downloadedPath?: string
}

function apiUrl(url: string) {
  const baseUrl = window.questionWorkbench?.apiBaseUrl?.replace(/\/+$/, '') || ''
  if (!baseUrl || /^https?:\/\//i.test(url)) return url
  return `${baseUrl}${url.startsWith('/') ? url : `/${url}`}`
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(payload.message || payload.error || `HTTP ${response.status}`, response.status, payload)
  }
  return payload as T
}
