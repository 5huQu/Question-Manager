import type { DatabaseMigration } from '../migrator.js'

/**
 * Repairs databases created before the auth schema settled: auth_sessions
 * originally stored a SHA-256 of the CSRF token in `csrf_hash`, but the
 * client needs the raw token (HttpOnly cookie flow), so it must live in a
 * `csrf_token` column. Existing values are copied over and the old column is
 * dropped where the SQLite version allows it.
 */
export const authSessionsCsrfTokenMigration: DatabaseMigration = {
  version: 10,
  name: 'auth_sessions_csrf_token',
  description: 'Store the raw session CSRF token instead of its hash (v1).',
  fingerprint: 'auth-sessions-csrf-token-v1',
  up(database) {
    const columns = (database.prepare('PRAGMA table_info(auth_sessions)').all() as Array<{ name: string }>).map((column) => column.name)
    if (!columns.includes('csrf_token')) {
      database.exec("ALTER TABLE auth_sessions ADD COLUMN csrf_token TEXT NOT NULL DEFAULT ''")
      if (columns.includes('csrf_hash')) {
        // The old column stored a hash, which cannot be verified against the
        // plaintext token the client holds, so every existing session is
        // revoked instead of being carried over.
        database.exec("UPDATE auth_sessions SET csrf_token = csrf_hash WHERE csrf_token = ''")
        database.exec("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE revoked_at IS NULL")
        try {
          database.exec('ALTER TABLE auth_sessions DROP COLUMN csrf_hash')
        } catch {
          // Very old SQLite builds cannot drop columns; the leftover column is
          // harmless and only the new column is read.
        }
      }
    }
  },
}
