import type { DatabaseMigration } from '../migrator.js'

/**
 * Single-admin authentication domain: one administrator row (enforced by
 * CHECK id = 1) plus server-side sessions keyed by SHA-256 token hashes.
 */
export const authDomainMigration: DatabaseMigration = {
  version: 9,
  name: 'auth_domain',
  description: 'Single-admin password authentication with hashed cookie sessions and CSRF tokens (v1).',
  fingerprint: 'auth-domain-v1',
  up(database) {
    database.exec(`
      CREATE TABLE auth_admin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL UNIQUE,
        password_hash BLOB NOT NULL,
        password_salt BLOB NOT NULL,
        password_params_json TEXT NOT NULL,
        password_changed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE auth_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        idle_expires_at TEXT NOT NULL,
        absolute_expires_at TEXT NOT NULL,
        revoked_at TEXT,
        user_agent TEXT,
        login_ip TEXT
      );

      CREATE INDEX idx_auth_sessions_expiry
        ON auth_sessions(absolute_expires_at);
    `)
  },
}
