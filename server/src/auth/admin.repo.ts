import { db } from '../db/connection.js'
import { nowIso } from '../utils/ids.js'

export type AdminRow = {
  id: number
  username: string
  password_hash: Buffer
  password_salt: Buffer
  password_params_json: string
  password_changed_at: string
  created_at: string
  updated_at: string
}

export type AdminPublic = {
  username: string
}

function mapRow(row: Record<string, unknown>): AdminRow {
  return {
    id: Number(row.id),
    username: String(row.username),
    password_hash: row.password_hash as Buffer,
    password_salt: row.password_salt as Buffer,
    password_params_json: String(row.password_params_json),
    password_changed_at: String(row.password_changed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function getAdmin(): AdminRow | null {
  const row = db.prepare('SELECT * FROM auth_admin WHERE id = 1').get() as Record<string, unknown> | undefined
  return row ? mapRow(row) : null
}

export function adminExists(): boolean {
  return Boolean(db.prepare('SELECT 1 FROM auth_admin WHERE id = 1').get())
}

export function createAdmin(username: string, stored: { hash: Buffer; salt: Buffer; paramsJson: string }): AdminRow {
  const now = nowIso()
  db.prepare(`
    INSERT INTO auth_admin
      (id, username, password_hash, password_salt, password_params_json, password_changed_at, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, stored.hash, stored.salt, stored.paramsJson, now, now, now)
  return getAdmin() as AdminRow
}

export function updateAdminPassword(username: string, stored: { hash: Buffer; salt: Buffer; paramsJson: string }): AdminRow {
  const now = nowIso()
  db.prepare(`
    UPDATE auth_admin
    SET username = ?, password_hash = ?, password_salt = ?, password_params_json = ?, password_changed_at = ?, updated_at = ?
    WHERE id = 1
  `).run(username, stored.hash, stored.salt, stored.paramsJson, now, now)
  return getAdmin() as AdminRow
}

export function updateAdminUsername(username: string): AdminRow {
  const now = nowIso()
  db.prepare('UPDATE auth_admin SET username = ?, updated_at = ? WHERE id = 1').run(username, now)
  return getAdmin() as AdminRow
}
