import fs from 'node:fs'
import path from 'node:path'

const command = process.argv[2] || 'audit'
if (!['audit', 'migrate'].includes(command)) {
  console.error('Usage: node server/scripts/v1-import-migrate.mjs [audit|migrate] [--output directory]')
  process.exit(2)
}
const outputIndex = process.argv.indexOf('--output')
const outputDir = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : path.resolve('data', 'migration-reports')

const { ensureSchema } = await import('../dist/db/schema.js')
const { db, closeDatabase } = await import('../dist/db/connection.js')
const { dataDir } = await import('../dist/config.js')
const { createMigrationBackup } = await import('../dist/db/migrator.js')
const {
  auditV1ImportData,
  migrateV1ImportData,
  v1MigrationReportMarkdown,
} = await import('../dist/services/import-flow-v2/v1-data-migration.service.js')

try {
  const backup = command === 'migrate'
    ? createMigrationBackup(db, {
        version: 0,
        name: 'v1_import_data_migration',
        description: 'Operator-requested backup before V1 data migration.',
        up() {},
      }, {
        directory: path.join(dataDir, 'database-backups', 'v1-import'),
        retention: Number(process.env.DATABASE_BACKUP_RETENTION || 5),
      })
    : null
  ensureSchema()
  const report = command === 'migrate' ? migrateV1ImportData() : auditV1ImportData()
  if (backup) report.backup = backup
  fs.mkdirSync(outputDir, { recursive: true })
  const baseName = `${report.createdAt.replace(/[:.]/g, '-')}-${report.reportId}`
  const jsonPath = path.join(outputDir, `${baseName}.json`)
  const markdownPath = path.join(outputDir, `${baseName}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(markdownPath, v1MigrationReportMarkdown(report), 'utf8')
  console.log(JSON.stringify({ gatePassed: report.gatePassed, jsonPath, markdownPath, counts: report.counts }, null, 2))
  if (!report.gatePassed) process.exitCode = 3
} finally {
  closeDatabase()
}
