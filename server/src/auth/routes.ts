import { timingSafeEqual } from 'node:crypto'
import type { Express, NextFunction, Request, Response } from 'express'
import { RouteError } from '../utils/http-error.js'
import {
  adminBootstrapToken,
  authMode,
  passwordMaxLength,
  passwordMinLength,
  publicOrigin,
  usernameMaxLength,
  originAllowed,
} from './config.js'
import { hashPassword, verifyPassword } from './password.js'
import { createAdmin, getAdmin, updateAdminPassword } from './admin.repo.js'
import { createSession, listSessions, revokeAllSessionsExcept, revokeSession } from './sessions.repo.js'
import {
  attachSession,
  clearSessionCookie,
  isAuthenticated,
  logAuthEvent,
  requireApiAuth,
  setSessionCookie,
  withScryptSlot,
} from './middleware.js'
import { clientIp, isLoginLocked, recordLoginFailure, recordLoginSuccess } from './login-limiter.js'

function refererOrigin(req: Request) {
  const referer = req.headers.referer
  if (!referer) return ''
  try {
    return new URL(referer).origin
  } catch {
    return ''
  }
}

function checkOrigin(req: Request, res: Response, next: NextFunction) {
  if (!originAllowed(req.headers.origin || refererOrigin(req))) {
    res.status(403).json({ error: '请求来源不被允许。', code: 'FORBIDDEN' })
    return
  }
  next()
}

function validateCredentials(body: unknown): { username: string; password: string } | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const username = typeof record.username === 'string' ? record.username.trim() : ''
  const password = typeof record.password === 'string' ? record.password : ''
  if (!username || username.length > usernameMaxLength) return null
  if (!password || password.length < passwordMinLength || password.length > passwordMaxLength) return null
  return { username, password }
}

/**
 * Phase 2 — public auth endpoints. No session required; the login route still
 * validates the Origin and is rate limited.
 */
export function mountPublicAuthRoutes(app: Express) {
  // Login: creates a session and sets the cookie. Origin is always checked,
  // even though this endpoint has no CSRF token yet.
  app.post('/api/auth/login', checkOrigin, async (req, res, next) => {
    try {
      const ip = clientIp(req)
      const lock = isLoginLocked(ip)
      if (lock.locked) {
        res.setHeader('Retry-After', String(lock.retryAfterSeconds))
        res.status(429).json({ error: '尝试次数过多，请稍后再试。', code: 'LOGIN_RATE_LIMITED' })
        return
      }
      const credentials = validateCredentials(req.body)
      const admin = getAdmin()
      let ok = false
      if (credentials && admin) {
        ok = await withScryptSlot(async () => {
          try {
            return await verifyPassword(credentials.password, {
              hash: admin.password_hash,
              salt: admin.password_salt,
              paramsJson: admin.password_params_json,
            })
          } catch {
            return false
          }
        })
      }
      if (ok) {
        recordLoginSuccess(ip)
        const created = createSession({ userAgent: req.headers['user-agent'], loginIp: ip })
        setSessionCookie(res, created.token)
        logAuthEvent('login', { ip, result: 'success' })
        res.json({ authenticated: true, admin: { username: admin!.username }, csrfToken: created.csrfToken })
        return
      }
      recordLoginFailure(ip)
      logAuthEvent('login', { ip, result: 'failure' })
      res.status(401).json({ error: '用户名或密码错误', code: 'INVALID_CREDENTIALS' })
    } catch (error) {
      next(error)
    }
  })

  // Optional web bootstrap: only when no admin exists AND ADMIN_BOOTSTRAP_TOKEN
  // is configured AND the request carries the matching token. Once an admin is
  // created this endpoint is permanently gone (409).
  app.post('/api/auth/bootstrap', checkOrigin, async (req, res, next) => {
    try {
      if (getAdmin()) {
        res.status(409).json({ error: '管理员已存在。', code: 'ALREADY_INITIALIZED' })
        return
      }
      if (!adminBootstrapToken) {
        res.status(404).json({ error: '接口不存在。', code: 'NOT_FOUND' })
        return
      }
      const supplied = typeof req.body?.bootstrapToken === 'string' ? req.body.bootstrapToken : ''
      const expected = Buffer.from(adminBootstrapToken)
      const actual = Buffer.from(supplied)
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        res.status(403).json({ error: '初始化令牌不正确。', code: 'BOOTSTRAP_TOKEN_INVALID' })
        return
      }
      const credentials = validateCredentials(req.body)
      if (!credentials) {
        res.status(400).json({ error: '用户名或密码不符合要求。', code: 'VALIDATION_ERROR', details: { passwordMinLength, passwordMaxLength } })
        return
      }
      const stored = await hashPassword(credentials.password)
      createAdmin(credentials.username, stored)
      logAuthEvent('bootstrap', { ip: clientIp(req), result: 'success' })
      res.status(201).json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  // Current auth state. In non-enforced modes this reports an authenticated
  // local session so the frontend never shows the login screen.
  app.get('/api/auth/state', attachSession, (req, res) => {
    if (authMode !== 'single-admin') {
      res.json({ initialized: true, authenticated: true, admin: { username: 'local' }, csrfToken: '' })
      return
    }
    const admin = getAdmin()
    if (!admin) {
      res.json({ initialized: false, authenticated: false, bootstrapEnabled: Boolean(adminBootstrapToken) })
      return
    }
    if (req.authSession) {
      const current = listSessions().find((item) => item.id === req.authSession!.id)
      res.json({
        initialized: true,
        authenticated: true,
        admin: { username: admin.username },
        csrfToken: current?.csrf_token || '',
      })
      return
    }
    res.json({ initialized: true, authenticated: false })
  })
}

/**
 * Phase 4 — auth endpoints that require a session. Mounted after attachSession;
 * each handler re-checks the session through requireApiAuth.
 */
export function mountProtectedAuthRoutes(app: Express) {
  app.use('/api/auth', requireApiAuth)

  app.post('/api/auth/logout', (req, res, next) => {
    try {
      const sessionId = req.authSession?.id
      if (sessionId) {
        revokeSession(sessionId)
        logAuthEvent('logout', { ip: clientIp(req) })
      }
      clearSessionCookie(res)
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/change-password', async (req, res, next) => {
    try {
      const sessionId = req.authSession?.id
      if (!sessionId) throw new RouteError(401, '未登录或会话已过期。')
      const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
      if (!newPassword || newPassword.length < passwordMinLength || newPassword.length > passwordMaxLength) {
        throw new RouteError(400, '新密码不符合要求。', { passwordMinLength, passwordMaxLength }, { code: 'VALIDATION_ERROR' })
      }
      const admin = getAdmin()
      if (!admin) throw new RouteError(409, '管理员尚未初始化。')
      const valid = await withScryptSlot(async () => {
        try {
          return await verifyPassword(currentPassword, {
            hash: admin.password_hash,
            salt: admin.password_salt,
            paramsJson: admin.password_params_json,
          })
        } catch {
          return false
        }
      })
      if (!valid) throw new RouteError(401, '当前密码不正确。')
      const stored = await hashPassword(newPassword)
      updateAdminPassword(admin.username, stored)
      revokeAllSessionsExcept(sessionId)
      logAuthEvent('change-password', { ip: clientIp(req) })
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/auth/sessions', (req, res, next) => {
    try {
      const currentId = req.authSession?.id || ''
      const payload = listSessions().map((session) => ({
        id: session.id,
        current: session.id === currentId,
        userAgent: session.user_agent,
        loginIp: session.login_ip,
        createdAt: session.created_at,
        lastSeenAt: session.last_seen_at,
        idleExpiresAt: session.idle_expires_at,
        absoluteExpiresAt: session.absolute_expires_at,
        revokedAt: session.revoked_at,
      }))
      res.json({ sessions: payload })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/auth/sessions/:id', (req, res, next) => {
    try {
      const targetId = String(req.params.id || '')
      const currentId = req.authSession?.id || ''
      if (!targetId) throw new RouteError(400, '缺少会话标识。')
      if (targetId === currentId) {
        revokeSession(targetId)
        clearSessionCookie(res)
        res.json({ ok: true, revoked: true, current: true })
        return
      }
      const revoked = revokeSession(targetId)
      logAuthEvent('revoke-session', { ip: clientIp(req), result: revoked ? 'revoked' : 'missing' })
      res.json({ ok: true, revoked })
    } catch (error) {
      next(error)
    }
  })
}

export { publicOrigin, isAuthenticated }
