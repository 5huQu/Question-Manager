import net from 'node:net'

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

/**
 * Only trust forwarded client addresses when the operator explicitly opts in.
 * Arbitrary environment text is parsed and rejected before it reaches Express.
 */
export type TrustedProxySetting = false | 'loopback' | string[]

function normalizeIp(value: string) {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('::ffff:') && trimmed.slice(7).includes('.') ? trimmed.slice(7) : trimmed
}

function validIpOrCidr(value: string) {
  const [address, prefix] = value.split('/')
  const normalizedAddress = normalizeIp(address)
  const ipVersion = net.isIP(normalizedAddress)
  if (!ipVersion) return false
  if (prefix === undefined) return true
  const numericPrefix = Number(prefix)
  const maxPrefix = ipVersion === 4 ? 32 : 128
  return /^\d+$/.test(prefix) && Number.isInteger(numericPrefix) && numericPrefix >= 0 && numericPrefix <= maxPrefix
}

export function parseTrustedProxy(value: string | undefined): TrustedProxySetting {
  const raw = String(value || '').trim()
  if (!raw || raw.toLowerCase() === 'off') return false
  if (raw.toLowerCase() === 'loopback') return 'loopback'

  const entries = raw.split(',').map((item) => item.trim()).filter(Boolean)
  if (entries.length > 0 && entries.every(validIpOrCidr)) {
    return entries.map((item) => {
      const [address, prefix] = item.split('/')
      const normalizedAddress = normalizeIp(address)
      return prefix === undefined ? normalizedAddress : `${normalizedAddress}/${prefix}`
    })
  }

  console.warn('[auth] 警告：AUTH_TRUSTED_PROXY 配置无效，已按 off 处理。')
  return false
}

export const trustedProxy = parseTrustedProxy(process.env.AUTH_TRUSTED_PROXY)

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
