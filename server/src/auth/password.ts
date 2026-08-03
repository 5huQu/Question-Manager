import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { BinaryLike } from 'node:crypto'

export const scryptParams = {
  N: 2 ** 16,
  r: 8,
  p: 2,
  maxmem: 128 * 1024 * 1024,
  keylen: 64,
} as const

function scryptAsync(password: BinaryLike, salt: BinaryLike, keylen: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}

export type StoredPassword = {
  hash: Buffer
  salt: Buffer
  paramsJson: string
}

/**
 * Hash a password with async crypto.scrypt. Parameters follow the OWASP
 * recommendation (N=2^16, r=8, p=2). Never call scryptSync in request paths.
 */
export async function hashPassword(password: string): Promise<StoredPassword> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, scryptParams.keylen, {
    N: scryptParams.N,
    r: scryptParams.r,
    p: scryptParams.p,
    maxmem: scryptParams.maxmem,
  })
  return {
    hash,
    salt,
    paramsJson: JSON.stringify({ N: scryptParams.N, r: scryptParams.r, p: scryptParams.p, maxmem: scryptParams.maxmem, keylen: scryptParams.keylen }),
  }
}

export async function verifyPassword(password: string, stored: StoredPassword): Promise<boolean> {
  let params: { N: number; r: number; p: number; maxmem: number; keylen: number }
  try {
    params = JSON.parse(stored.paramsJson)
  } catch {
    return false
  }
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p) || !Number.isInteger(params.keylen)) {
    return false
  }
  if (params.N < 2 ** 14 || params.N > 2 ** 20 || params.r < 1 || params.r > 64 || params.p < 1 || params.p > 16 || params.keylen < 16 || params.keylen > 128) {
    return false
  }
  const maxmem = Number.isInteger(params.maxmem) && params.maxmem > 0 ? params.maxmem : 128 * 1024 * 1024
  let derived: Buffer
  try {
    derived = await scryptAsync(password, stored.salt, params.keylen, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem,
    })
  } catch {
    return false
  }
  if (derived.length !== stored.hash.length) return false
  return timingSafeEqual(derived, stored.hash)
}
