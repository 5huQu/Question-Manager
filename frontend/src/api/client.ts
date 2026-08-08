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
          /** 导出版本：学生版隐藏答案与解析，教师版显示答案与解析。 */
          variant?: PdfExportVariant
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

export type PdfExportVariant = 'student' | 'teacher'

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

export async function apiStream(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {})
  if (csrfToken && WRITE_METHODS.has((init?.method || 'GET').toUpperCase())) {
    headers.set('X-QM-CSRF', csrfToken)
  }
  const response = await fetch(apiUrl(url), { ...init, headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (response.status === 401 && !isAuthEndpoint(url)) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, {
        detail: { next: window.location.pathname + window.location.search },
      }))
    }
    throw new ApiError(String(payload.message || payload.error || `HTTP ${response.status}`), response.status, payload)
  }
  return response
}

/**
 * Session-bound CSRF token supplied by the auth state. The client attaches it
 * to every state-changing request so pages never handle it themselves.
 */
let csrfToken: string | null = null

export function setCsrfToken(token: string | null) {
  csrfToken = token
}

export function getCsrfToken() {
  return csrfToken
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Fired when a normal business request returns 401 (expired session). */
export const AUTH_EXPIRED_EVENT = 'qm-auth-expired'

function isAuthEndpoint(url: string) {
  return url.includes('/api/auth/login') || url.includes('/api/auth/state')
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {})
  if (csrfToken && WRITE_METHODS.has((init?.method || 'GET').toUpperCase())) {
    headers.set('X-QM-CSRF', csrfToken)
  }
  const response = await fetch(apiUrl(url), { ...init, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && !isAuthEndpoint(url)) {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, {
        detail: { next: window.location.pathname + window.location.search },
      }))
    }
    throw new ApiError(payload.message || payload.error || `HTTP ${response.status}`, response.status, payload)
  }
  return payload as T
}
