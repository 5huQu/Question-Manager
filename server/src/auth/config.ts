/**
 * Single-admin authentication configuration.
 *
 * Modes:
 * - `single-admin` (default): password login required for every API, file,
 *   print and page request. Requires `npm run admin:init` (or a configured
 *   ADMIN_BOOTSTRAP_TOKEN) before the server will start.
 * - `trusted-desktop`: used by the packaged Electron app. The local loopback
 *   server auto-authenticates the renderer; no login screen.
 * - `disabled`: development convenience — authentication is completely off.
 */
export type AuthMode = 'single-admin' | 'trusted-desktop' | 'disabled'

function parseAuthMode(value: string | undefined): AuthMode {
  if (value === 'trusted-desktop' || value === 'disabled') return value
  return 'single-admin'
}

function boundedPositiveInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function truthy(value: string | undefined) {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export const authMode: AuthMode = parseAuthMode(process.env.QUESTION_AUTH_MODE)

/** Fixed external origin for CSRF checks; never derived from the Host header. */
export const publicOrigin = (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '')

export const authCookieSecure = truthy(process.env.AUTH_COOKIE_SECURE) || publicOrigin.startsWith('https://')

/**
 * `__Host-` cookie names are rejected by browsers unless Secure is set, so the
 * name degrades to a plain name for local HTTP development.
 */
export const sessionCookieName = authCookieSecure ? '__Host-qm_session' : 'qm_session'

export const sessionDurationMs = boundedPositiveInt(process.env.AUTH_SESSION_DAYS, 7, 1, 90) * 24 * 60 * 60 * 1000

/** Sessions whose activity predates this window are considered idle-expired. */
export const idleTimeoutMs = sessionDurationMs

/** Optional bootstrap secret that enables the /api/auth/bootstrap flow. */
export const adminBootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || ''

export const authEnforced = authMode === 'single-admin'

export const scryptMaxConcurrent = Math.max(1, Math.min(2, boundedPositiveInt(process.env.AUTH_SCRYPT_CONCURRENCY, 2, 1, 4)))

export const passwordMinLength = 8
export const passwordMaxLength = 128
export const usernameMaxLength = 64

export function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  } catch {
    return false
  }
}

/** CSRF origin must equal PUBLIC_ORIGIN; falls back to loopback only for local dev. */
export function originAllowed(origin: string) {
  if (!origin) return false
  if (publicOrigin) return origin === publicOrigin
  return isLoopbackOrigin(origin)
}
