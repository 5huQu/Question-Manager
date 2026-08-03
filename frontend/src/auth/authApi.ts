import { api } from '@/api/client'
import type { AuthSessionInfo, AuthStatus } from './authTypes'

export async function getAuthState(): Promise<AuthStatus> {
  return api<AuthStatus>('/api/auth/state')
}

export async function login(username: string, password: string): Promise<AuthStatus> {
  return api<AuthStatus>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export async function logout(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export async function bootstrapAdmin(username: string, password: string, bootstrapToken: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, bootstrapToken }),
  })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export async function listSessions(): Promise<AuthSessionInfo[]> {
  const payload = await api<{ sessions: AuthSessionInfo[] }>('/api/auth/sessions')
  return payload.sessions
}

export async function revokeSession(id: string): Promise<{ ok: boolean; revoked: boolean; current?: boolean }> {
  return api<{ ok: boolean; revoked: boolean; current?: boolean }>(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
