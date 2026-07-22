const command = process.argv[2] || 'status'

if (!['status', 'list', 'dry-run', 'migrate'].includes(command)) {
  console.error('Usage: node server/scripts/db-migrate.mjs [status|list|dry-run|migrate]')
  process.exit(2)
}

const { closeDatabase } = await import('../dist/db/connection.js')
const { databaseMigrationStatus, ensureSchema } = await import('../dist/db/schema.js')

try {
  const status = command === 'migrate' ? ensureSchema() : databaseMigrationStatus({ dryRun: true })
  if (command === 'list') {
    for (const item of status) console.log(`${item.version}\t${item.name}`)
  } else {
    console.log(JSON.stringify({ command, migrations: status }, null, 2))
  }
} finally {
  closeDatabase()
}
