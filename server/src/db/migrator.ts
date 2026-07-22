import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type DatabaseMigration = {
  version: number
  name: string
  description: string
  /** Stable, explicit input for the migration checksum. Bump when `up` changes. */
  fingerprint: string
  destructive?: boolean
  acceptLegacyChecksum?: boolean
  legacyChecksums?: Array<{
    checksum: string
    description: string
    validate: (database: DatabaseSync) => void
  }>
  up: (database: DatabaseSync) => void
}

export type MigrationStatus = {
  version: number
  name: string
  checksum: string
  appliedAt: string | null
  pending: boolean
  destructive: boolean
  reconciliation: null | {
    legacyChecksum: string
    description: string
  }
}

export type MigrationBackupOptions = {
  directory: string
  retention?: number
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function sha256File(filePath: string) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function pruneBackups(directory: string, retention: number) {
  const backups = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => ({ name, path: path.join(directory, name), modified: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified || right.name.localeCompare(left.name))
  for (const backup of backups.slice(retention)) {
    fs.rmSync(backup.path, { force: true })
    fs.rmSync(`${backup.path}.json`, { force: true })
  }
}

export function createMigrationBackup(database: DatabaseSync, migration: DatabaseMigration, options: MigrationBackupOptions) {
  const retention = Math.max(1, Math.floor(Number(options.retention || 5)))
  fs.mkdirSync(options.directory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(options.directory, `${timestamp}-before-v${migration.version}.sqlite`)
  database.exec(`VACUUM INTO ${sqlString(backupPath)}`)
  const verification = new DatabaseSync(backupPath, { readOnly: true })
  try {
    const integrity = verification.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (integrity.integrity_check !== 'ok') throw new Error(`Backup integrity check failed: ${integrity.integrity_check}`)
  } finally {
    verification.close()
  }
  const schemaVersion = Number((database.prepare('PRAGMA schema_version').get() as { schema_version: number }).schema_version || 0)
  const metadata = {
    migrationVersion: migration.version,
    migrationName: migration.name,
    createdAt: new Date().toISOString(),
    size: fs.statSync(backupPath).size,
    sha256: sha256File(backupPath),
    schemaVersion,
  }
  fs.writeFileSync(`${backupPath}.json`, JSON.stringify(metadata, null, 2), 'utf8')
  pruneBackups(options.directory, retention)
  return { path: backupPath, metadata }
}

export function migrationChecksum(migration: DatabaseMigration) {
  return createHash('sha256')
    .update(`${migration.version}\n${migration.name}\n${migration.description}\n${migration.fingerprint}`)
    .digest('hex')
}

function legacyChecksumFor(migration: DatabaseMigration) {
  return createHash('sha256')
    .update(`${migration.version}\n${migration.name}\n${migration.description}`)
    .digest('hex')
}

function ensureMigrationTable(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

function ensureMigrationReconciliationTable(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration_reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      legacy_checksum TEXT NOT NULL,
      current_checksum TEXT NOT NULL,
      validation_description TEXT NOT NULL,
      reconciled_at TEXT NOT NULL
    )
  `)
}

function orderedMigrations(migrations: DatabaseMigration[]) {
  const ordered = [...migrations].sort((left, right) => left.version - right.version)
  const versions = new Set<number>()
  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid database migration version: ${migration.version}`)
    }
    if (!migration.fingerprint?.trim()) throw new Error(`Missing database migration fingerprint: ${migration.version} (${migration.name})`)
    if (versions.has(migration.version)) throw new Error(`Duplicate database migration version: ${migration.version}`)
    versions.add(migration.version)
  }
  return ordered
}

export function listMigrationStatus(database: DatabaseSync, migrations: DatabaseMigration[]): MigrationStatus[] {
  const migrationTableExists = Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'
  `).get())
  const applied = (migrationTableExists
    ? database.prepare('SELECT version, name, checksum, applied_at FROM schema_migrations').all()
    : []) as Array<{
    version: number
    name: string
    checksum: string
    applied_at: string
  }>
  const appliedByVersion = new Map(applied.map((row) => [Number(row.version), row]))
  return orderedMigrations(migrations).map((migration) => {
    const row = appliedByVersion.get(migration.version)
    const checksum = migrationChecksum(migration)
    const legacyMatch = row && migration.legacyChecksums?.find((candidate) => candidate.checksum === row.checksum)
    if (legacyMatch) legacyMatch.validate(database)
    const checksumMatches = row?.checksum === checksum
      || Boolean(row && migration.acceptLegacyChecksum && row.checksum === legacyChecksumFor(migration))
      || Boolean(legacyMatch)
    if (row && (row.name !== migration.name || !checksumMatches)) {
      throw new Error(`Database migration ${migration.version} (${migration.name}) checksum mismatch`)
    }
    return {
      version: migration.version,
      name: migration.name,
      checksum,
      appliedAt: row?.applied_at || null,
      pending: !row,
      destructive: Boolean(migration.destructive),
      reconciliation: legacyMatch ? {
        legacyChecksum: legacyMatch.checksum,
        description: legacyMatch.description,
      } : null,
    }
  })
}

export function migrateDatabase(database: DatabaseSync, migrations: DatabaseMigration[], options: { dryRun?: boolean; backup?: MigrationBackupOptions } = {}) {
  const status = listMigrationStatus(database, migrations)
  if (options.dryRun) return status
  ensureMigrationTable(database)

  for (const item of status) {
    if (!item.reconciliation) continue
    const migration = migrations.find((candidate) => candidate.version === item.version)
    const legacyMatch = migration?.legacyChecksums?.find((candidate) => candidate.checksum === item.reconciliation?.legacyChecksum)
    if (!migration || !legacyMatch) throw new Error(`Missing reconciliation definition for database migration ${item.version}`)
    database.exec('BEGIN IMMEDIATE')
    try {
      const applied = database.prepare('SELECT name, checksum FROM schema_migrations WHERE version = ?').get(item.version) as {
        name: string
        checksum: string
      } | undefined
      if (!applied || applied.name !== migration.name || applied.checksum !== legacyMatch.checksum) {
        throw new Error(`Database migration ${item.version} changed while reconciliation was pending`)
      }
      legacyMatch.validate(database)
      ensureMigrationReconciliationTable(database)
      database.prepare(`
        INSERT INTO schema_migration_reconciliations
          (version, name, legacy_checksum, current_checksum, validation_description, reconciled_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(item.version, migration.name, legacyMatch.checksum, item.checksum, legacyMatch.description, new Date().toISOString())
      const updated = database.prepare(`
        UPDATE schema_migrations SET checksum = ?
        WHERE version = ? AND name = ? AND checksum = ?
      `).run(item.checksum, item.version, migration.name, legacyMatch.checksum)
      if (updated.changes !== 1) throw new Error(`Database migration ${item.version} reconciliation update was not exclusive`)
      database.exec('COMMIT')
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK')
      throw error
    }
  }

  for (const item of status) {
    if (!item.pending) continue
    const migration = migrations.find((candidate) => candidate.version === item.version)
    if (!migration) continue
    if (migration.destructive) {
      if (!options.backup) throw new Error(`Destructive database migration ${migration.version} requires backup configuration`)
      createMigrationBackup(database, migration, options.backup)
    }
    database.exec('BEGIN IMMEDIATE')
    try {
      migration.up(database)
      database.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(migration.version, migration.name, item.checksum, new Date().toISOString())
      database.exec('COMMIT')
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK')
      throw error
    }
  }
  return listMigrationStatus(database, migrations)
}
