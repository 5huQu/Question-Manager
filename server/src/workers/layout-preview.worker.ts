import { ensureSchema } from '../db/schema.js'
import { closeDatabase } from '../db/connection.js'
import { executeLayoutPreviewJob } from '../services/question-bank/layout-drafts.service.js'

const [jobId, owner] = process.argv.slice(2)

try {
  if (!jobId || !owner) throw new Error('Layout preview worker requires job id and lease owner.')
  ensureSchema()
  const result = executeLayoutPreviewJob(jobId, owner)
  process.exitCode = result.status === 'failed' ? 1 : 0
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  closeDatabase()
}
