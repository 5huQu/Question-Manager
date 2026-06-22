export const jsonHeaders = { 'Content-Type': 'application/json' }

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
    }
  }
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
    throw new Error(payload.error || payload.message || `HTTP ${response.status}`)
  }
  return payload as T
}
