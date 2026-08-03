import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { LoginPage } from '@/pages/auth/LoginPage'
import { AdminSetupPage } from '@/pages/auth/AdminSetupPage'

/**
 * Blocks the application shell until authentication is resolved.
 * - loading:        first auth state request in flight
 * - uninitialized:  no admin exists → render the bootstrap page
 * - unauthenticated: render the login page (server-side 302 lands here too)
 * - authenticated:  render the application
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { phase } = useAuth()
  if (phase === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-background" />
  }
  if (phase === 'uninitialized') {
    return <AdminSetupPage />
  }
  if (phase === 'unauthenticated') {
    return <LoginPage />
  }
  return <>{children}</>
}
