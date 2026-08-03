import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AUTH_EXPIRED_EVENT, setCsrfToken } from '@/api/client'
import * as authApi from './authApi'
import type { AuthPhase } from './authTypes'

type AuthContextValue = {
  phase: AuthPhase
  admin: { username: string } | null
  csrfToken: string
  accountManagementAvailable: boolean
  refresh: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  bootstrap: (username: string, password: string, bootstrapToken: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<AuthPhase>('loading')
  const [admin, setAdmin] = useState<{ username: string } | null>(null)
  const [csrfToken, setToken] = useState('')
  const [accountManagementAvailable, setAccountManagementAvailable] = useState(false)

  const applyStatus = useCallback((status: Awaited<ReturnType<typeof authApi.getAuthState>>) => {
    if (typeof status.accountManagementAvailable === 'boolean') {
      setAccountManagementAvailable(status.accountManagementAvailable)
    }
    if (!status.initialized) {
      setPhase('uninitialized')
      setAdmin(null)
      setToken('')
      setCsrfToken(null)
      return
    }
    if (!status.authenticated) {
      setPhase('unauthenticated')
      setAdmin(null)
      setToken('')
      setCsrfToken(null)
      return
    }
    setPhase('authenticated')
    setAdmin(status.admin || null)
    setToken(status.csrfToken || '')
    setCsrfToken(status.csrfToken || null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      applyStatus(await authApi.getAuthState())
    } catch {
      setPhase('unauthenticated')
      setAdmin(null)
      setToken('')
      setAccountManagementAvailable(false)
      setCsrfToken(null)
    }
  }, [applyStatus])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const handleExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ next?: string }>).detail
      const next = detail?.next || ''
      setPhase('unauthenticated')
      setAdmin(null)
      setToken('')
      setCsrfToken(null)
      const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : ''
      navigate(safeNext ? `/login?reason=expired&next=${encodeURIComponent(safeNext)}` : '/login?reason=expired')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired)
  }, [navigate])

  const login = useCallback(async (username: string, password: string) => {
    applyStatus(await authApi.login(username, password))
  }, [applyStatus])

  const logout = useCallback(async () => {
    if (!accountManagementAvailable) return
    try {
      await authApi.logout()
    } catch {
      // Local session cleanup must still proceed.
    }
    setPhase('unauthenticated')
    setAdmin(null)
    setToken('')
    setCsrfToken(null)
  }, [accountManagementAvailable])

  const bootstrap = useCallback(async (username: string, password: string, bootstrapToken: string) => {
    await authApi.bootstrapAdmin(username, password, bootstrapToken)
  }, [])

  const value = useMemo(() => ({ phase, admin, csrfToken, accountManagementAvailable, refresh, login, logout, bootstrap }), [phase, admin, csrfToken, accountManagementAvailable, refresh, login, logout, bootstrap])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
