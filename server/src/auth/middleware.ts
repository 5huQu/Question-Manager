import type { NextFunction, Request, Response } from 'express'
import {
  authCookieSecure,
  authEnforced,
  authMode,
  originAllowed,
  sessionCookieName,
  sessionDurationMs,
  scryptMaxConcurrent,
} from './config.js'
import { validateSessionToken } from './sessions.repo.js'

declare module 'express-serve-static-core' {
  interface Request {
    authSession?: {
      id: string
      csrfValid: (supplied: string) => boolean
    }
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    if (!name) continue
    let value = part.slice(separator + 1).trim()
    try {
      value = decodeURIComponent(value)
    } catch {
      // Keep raw value if it is not percent-encoded.
    }
    if (!(name in cookies)) cookies[name] = value
  }
  return cookies
}

export function setSessionCookie(res: Response, token: string) {
  const attributes = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(sessionDurationMs / 1000)}`,
  ]
  if (authCookieSecure) attributes.push('Secure')
  res.append('Set-Cookie', `${sessionCookieName}=${token}; ${attributes.join('; ')}`)
}

export function clearSessionCookie(res: Response) {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (authCookieSecure) attributes.push('Secure')
  res.append('Set-Cookie', `${sessionCookieName}=; ${attributes.join('; ')}`)
}

export function sessionTokenFromRequest(req: Request): string {
  return parseCookies(req)[sessionCookieName] || ''
}

/**
 * Phase 3 — read the session cookie for every request. Does not reject
 * anonymous requests; the per-area gates decide that later.
 */
export function attachSession(req: Request, _res: Response, next: NextFunction) {
  const token = sessionTokenFromRequest(req)
  const validated = token ? validateSessionToken(token) : null
  if (validated) {
    req.authSession = { id: validated.session.id, csrfValid: validated.csrfValid }
  } else {
    req.authSession = undefined
  }
  next()
}

export function isAuthenticated(req: Request) {
  return Boolean(req.authSession)
}

export function currentSessionId(req: Request) {
  return req.authSession?.id || ''
}

export function writeAttemptDenied(res: Response) {
  res.status(401).json({ error: '未登录或会话已过期。', code: 'UNAUTHENTICATED' })
}

/**
 * Phase 5 — unified gate for every /api route. In single-admin mode the
 * session must be valid; state-changing methods additionally need a matching
 * X-QM-CSRF header and an allowed Origin.
 */
export function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  if (!authEnforced) {
    next()
    return
  }
  if (!isAuthenticated(req)) {
    writeAttemptDenied(res)
    return
  }
  const method = req.method
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    if (!originAllowed(req.headers.origin || refererOrigin(req))) {
      res.status(403).json({ error: '请求来源不被允许。', code: 'FORBIDDEN' })
      return
    }
    const supplied = String(req.headers['x-qm-csrf'] || '')
    if (!req.authSession || !req.authSession.csrfValid(supplied)) {
      res.status(403).json({ error: '请求校验失败。', code: 'CSRF_MISMATCH' })
      return
    }
  }
  next()
}

function refererOrigin(req: Request) {
  const referer = req.headers.referer
  if (!referer) return ''
  try {
    return new URL(referer).origin
  } catch {
    return ''
  }
}

/** Gate for /files/* — never returns login HTML, images must not receive it. */
export function requireFileAuth(req: Request, res: Response, next: NextFunction) {
  if (!authEnforced) {
    next()
    return
  }
  if (!isAuthenticated(req)) {
    writeAttemptDenied(res)
    return
  }
  next()
}

/** Gate for /print/* and SPA pages — redirects the browser to the login page. */
export function requirePageAuth(req: Request, res: Response, next: NextFunction) {
  if (!authEnforced) {
    next()
    return
  }
  if (!isAuthenticated(req)) {
    const nextPath = req.originalUrl || '/'
    res.redirect(302, `/login?next=${encodeURIComponent(nextPath)}`)
    return
  }
  next()
}

/** Serialize password verification work so at most a couple of scrypt calls run. */
let activeScrypt = 0
const scryptWaiters: Array<() => void> = []

export class ScryptBusyError extends Error {
  constructor() {
    super('scrypt capacity is busy')
    this.name = 'ScryptBusyError'
  }
}

export async function withScryptSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeScrypt < scryptMaxConcurrent) {
    activeScrypt += 1
    try {
      return await work()
    } finally {
      activeScrypt -= 1
      const next = scryptWaiters.shift()
      if (next) next()
    }
  }
  await new Promise<void>((resolve) => scryptWaiters.push(resolve))
  return withScryptSlot(work)
}

let activeBootstrapScrypt = false

/** Bootstrap never queues behind another bootstrap request. */
export async function withBootstrapScryptSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeBootstrapScrypt) throw new ScryptBusyError()
  activeBootstrapScrypt = true
  try {
    return await withScryptSlot(work)
  } finally {
    activeBootstrapScrypt = false
  }
}

export function logAuthEvent(kind: string, details: Record<string, string | number | boolean>) {
  const line = Object.entries(details)
    .map(([key, value]) => `${key}=${String(value).replace(/[^a-zA-Z0-9:.\/ _-]/g, '_')}`)
    .join(' ')
  console.log(`[auth] ${kind} ${line}`)
}

export { authMode }
