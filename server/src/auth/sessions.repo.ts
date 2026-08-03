import { createHash, randomBytes } from 'node:crypto'
import { db } from '../db/connection.js'
import { nowIso } from '../utils/ids.js'
import { idleTimeoutMs, sessionDurationMs } from './config.js'

export type SessionRow = {
  id: string
  token_hash: string
  csrf_token: string
  created_at: string
  last_seen_at: string
  idle_expires_at: string
  absolute_expires_at: string
  revoked_at: string | null
  user_agent: string | null
  login_ip: string | null
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url')
}

export type NewSessionInput = {
  userAgent?: string
  loginIp?: string
}

export function createSession(input: NewSessionInput = {}): { session: SessionRow; token: string; csrfToken: string } {
  const token = newSessionToken()
  const csrfToken = newSessionToken()
  const now = new Date().toISOString()
  const idleExpiresAt = new Date(Date.now() + idleTimeoutMs).toISOString()
  const absoluteExpiresAt = new Date(Date.now() + sessionDurationMs).toISOString()
  db.prepare(`
    INSERT INTO auth_sessions
      (id, token_hash, csrf_token, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, user_agent, login_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(newSessionToken(), sha256Hex(token), csrfToken, now, now, idleExpiresAt, absoluteExpiresAt, input.userAgent || null, input.loginIp || null)
  const session = getSessionByTokenHash(sha256Hex(token))
  if (!session) throw new Error('Failed to persist auth session')
  return { session, token, csrfToken }
}

export function getSessionByTokenHash(tokenHash: string): SessionRow | null {
  const row = db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').get(tokenHash) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: String(row.id),
    token_hash: String(row.token_hash),
    csrf_token: String(row.csrf_token),
    created_at: String(row.created_at),
    last_seen_at: String(row.last_seen_at),
    idle_expires_at: String(row.idle_expires_at),
    absolute_expires_at: String(row.absolute_expires_at),
    revoked_at: row.revoked_at === null ? null : String(row.revoked_at),
    user_agent: row.user_agent === null ? null : String(row.user_agent),
    login_ip: row.login_ip === null ? null : String(row.login_ip),
  }
}

/**
 * Look up a session by its raw cookie token, checking revocation and expiry.
 * Returns the session plus whether the CSRF token supplied by the client
 * matches. Touches last_seen at most once per minute per session.
 */
export function validateSessionToken(token: string): { session: SessionRow; csrfValid: (supplied: string) => boolean } | null {
  if (!token) return null
  const session = getSessionByTokenHash(sha256Hex(token))
  if (!session) return null
  if (session.revoked_at) return null
  const now = Date.now()
  if (now >= Date.parse(session.absolute_expires_at)) return null
  if (now >= Date.parse(session.idle_expires_at)) return null
  try {
    if (now - Date.parse(session.last_seen_at) > 60_000) {
      db.prepare('UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?').run(
        nowIso(),
        new Date(now + idleTimeoutMs).toISOString(),
        session.id,
      )
    }
  } catch {
    // Session refresh must never fail a request.
  }
  return {
    session,
    csrfValid: (supplied) => Boolean(supplied) && supplied === session.csrf_token,
  }
}

export function listSessions(): SessionRow[] {
  db.prepare('DELETE FROM auth_sessions WHERE absolute_expires_at < ?').run(nowIso())
  const rows = db.prepare('SELECT * FROM auth_sessions ORDER BY last_seen_at DESC').all() as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    token_hash: String(row.token_hash),
    csrf_token: String(row.csrf_token),
    created_at: String(row.created_at),
    last_seen_at: String(row.last_seen_at),
    idle_expires_at: String(row.idle_expires_at),
    absolute_expires_at: String(row.absolute_expires_at),
    revoked_at: row.revoked_at === null ? null : String(row.revoked_at),
    user_agent: row.user_agent === null ? null : String(row.user_agent),
    login_ip: row.login_ip === null ? null : String(row.login_ip),
  }))
}

export function revokeSession(id: string): boolean {
  const result = db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), id)
  return Number(result.changes) > 0
}

export function revokeAllSessionsExcept(keepId: string): number {
  const result = db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id != ? AND revoked_at IS NULL').run(nowIso(), keepId)
  return Number(result.changes)
}

export function revokeAllSessions(): number {
  const result = db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL').run(nowIso())
  return Number(result.changes)
}
