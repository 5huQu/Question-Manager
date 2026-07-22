const retentionDays = Number(process.argv[2] || process.env.IMPORT_JOB_TRASH_RETENTION_DAYS || 30)
const { ensureSchema } = await import('../dist/db/schema.js')
const { closeDatabase } = await import('../dist/db/connection.js')
const { cleanupImportJobTrash } = await import('../dist/services/import-flow-v2/import-job-trash.service.js')

try {
  ensureSchema()
  console.log(JSON.stringify(cleanupImportJobTrash({ retentionDays }), null, 2))
} finally {
  closeDatabase()
}
