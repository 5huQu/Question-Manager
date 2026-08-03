import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'

export function AccountManagementGuard({ children }: { children: ReactNode }) {
  const { accountManagementAvailable } = useAuth()
  return accountManagementAvailable ? <>{children}</> : <Navigate to="/settings" replace />
}
