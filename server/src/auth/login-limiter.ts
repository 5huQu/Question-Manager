import type { Request } from 'express'

type Bucket = {
  failures: number[]
  lockedUntil: number
}

const buckets = new Map<string, Bucket>()

const WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS_PER_WINDOW = 10
const BASE_LOCK_MS = 60_000

export function clientIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const first = forwarded.split(',')[0].trim()
    if (first && (first === '127.0.0.1' || first === '::1' || /^10\./.test(first) || /^192\.168\./.test(first) || /^172\.(1[6-9]|2\d|3[01])\./.test(first))) {
      return first
    }
  }
  return req.socket.remoteAddress || 'unknown'
}

function prune() {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.lockedUntil > now) continue
    bucket.failures = bucket.failures.filter((timestamp) => now - timestamp < WINDOW_MS)
    if (bucket.failures.length === 0) buckets.delete(key)
  }
}

function lockoutMsForFailureCount(count: number) {
  return BASE_LOCK_MS * Math.min(16, 2 ** Math.max(0, count - 5))
}

/** True when the client must wait before another login attempt. */
export function isLoginLocked(key: string): { locked: boolean; retryAfterSeconds: number } {
  const bucket = buckets.get(key)
  if (!bucket) return { locked: false, retryAfterSeconds: 0 }
  if (bucket.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSeconds: Math.ceil((bucket.lockedUntil - Date.now()) / 1000) }
  }
  return { locked: false, retryAfterSeconds: 0 }
}

export function recordLoginFailure(key: string) {
  prune()
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { failures: [], lockedUntil: 0 }
    buckets.set(key, bucket)
  }
  bucket.failures.push(now)
  bucket.failures = bucket.failures.filter((timestamp) => now - timestamp < WINDOW_MS)
  if (bucket.failures.length >= MAX_ATTEMPTS_PER_WINDOW) {
    bucket.lockedUntil = now + lockoutMsForFailureCount(bucket.failures.length)
  } else if (bucket.failures.length >= 5) {
    // 5 failures: one minute lockout, escalating with further failures.
    bucket.lockedUntil = now + lockoutMsForFailureCount(bucket.failures.length)
  }
}

export function recordLoginSuccess(key: string) {
  buckets.delete(key)
}
