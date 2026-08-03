export type AuthStatus = {
  initialized: boolean
  authenticated: boolean
  admin?: { username: string }
  csrfToken?: string
  bootstrapEnabled?: boolean
}

export type AuthSessionInfo = {
  id: string
  current: boolean
  userAgent: string | null
  loginIp: string | null
  createdAt: string
  lastSeenAt: string
  idleExpiresAt: string
  absoluteExpiresAt: string
  revokedAt: string | null
}

export type AuthPhase = 'loading' | 'uninitialized' | 'unauthenticated' | 'authenticated'
