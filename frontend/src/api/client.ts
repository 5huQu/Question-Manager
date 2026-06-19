export const jsonHeaders = { 'Content-Type': 'application/json' }

declare global {
  interface Window {
    questionWorkbench?: {
      apiBaseUrl?: string
    }
  }
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
