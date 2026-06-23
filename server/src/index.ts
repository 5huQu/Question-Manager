// Assembly Point — imports all modules and wires them together.

import { ensureSchema } from './db/schema.js'
import { closeDatabase } from './db/connection.js'
import { recoverInterruptedRuns } from './db/runs.js'
import { app, startServer } from './server.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Route mounters
import { mountHealthRoutes } from './routes/health.js'
import { mountSettingsRoutes } from './routes/settings.js'
import { mountTagRoutes } from './routes/question-bank/tags.js'
import { mountRuleRoutes } from './routes/pdf-slicer/rules.js'
import { mountDashboardRoutes } from './routes/pdf-slicer/dashboard.js'
import { mountUploadRoutes } from './routes/pdf-slicer/uploads.js'
import { mountBatchRoutes } from './routes/pdf-slicer/batches.js'
import { mountRunRoutes } from './routes/pdf-slicer/runs.js'
import { mountReviewRoutes } from './routes/pdf-slicer/review.js'
import { mountOcrRoutes } from './routes/pdf-slicer/ocr.js'
import { mountPendingBankRoutes } from './routes/pdf-slicer/pending-bank.js'
import { mountQuestionBankItemsRoutes } from './routes/question-bank/items.js'
import { mountQuestionBankCollectionsRoutes } from './routes/question-bank/collections.js'
import { mountExportRecordsRoutes } from './routes/question-bank/export-records.js'
import { mountActivityDashboardRoutes } from './routes/dashboard/activity.js'

// Initialize schema before any route handles requests
ensureSchema()
recoverInterruptedRuns()

// Mount all route groups
mountHealthRoutes(app)
mountSettingsRoutes(app)
mountTagRoutes(app)
mountRuleRoutes(app)
mountDashboardRoutes(app)
mountUploadRoutes(app)
mountBatchRoutes(app)
mountRunRoutes(app)
mountReviewRoutes(app)
mountOcrRoutes(app)
mountPendingBankRoutes(app)
mountQuestionBankItemsRoutes(app)
mountQuestionBankCollectionsRoutes(app)
mountExportRecordsRoutes(app)
mountActivityDashboardRoutes(app)

// Re-export for Electron and smoke tests
export { app, startServer, closeDatabase }

const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer()
}
