// Assembly Point — imports all modules and wires them together.

import { ensureSchema } from './db/schema.js'
import { closeDatabase } from './db/connection.js'
import { app, startServer } from './server.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Route mounters
import { mountHealthRoutes } from './routes/health.js'
import { mountSettingsRoutes } from './routes/settings.js'
import { mountTagRoutes } from './routes/question-bank/tags.js'
import { mountQuestionBankItemsRoutes } from './routes/question-bank/items.js'
import { mountQuestionBankCollectionsRoutes } from './routes/question-bank/collections.js'
import { mountExportRecordsRoutes } from './routes/question-bank/export-records.js'
import { mountActivityDashboardRoutes } from './routes/dashboard/activity.js'
import { mountQuickActionsRoutes } from './routes/question-bank/quick-actions.js'
import { mountImportFlowV2Routes } from './routes/import-flow-v2.js'
import { mountCandidateFixRoutes } from './routes/candidate-fix.js'
import { mountLayoutDraftRoutes } from './routes/question-bank/layout-drafts.js'
import { recoverInterruptedLayoutPreviews } from './services/question-bank/layout-drafts.service.js'
import { mountErrorMiddleware } from './middleware/error-handler.js'
import {
  interruptOwnedSourceDocumentOcrTasks,
  recoverInterruptedSourceDocumentOcrTasks,
} from './services/import-flow-v2/ocr-task.service.js'

// Initialize schema before any route handles requests
ensureSchema()
recoverInterruptedLayoutPreviews()
recoverInterruptedSourceDocumentOcrTasks()

// Mount all route groups
mountHealthRoutes(app)
mountSettingsRoutes(app)
mountTagRoutes(app)
mountQuestionBankItemsRoutes(app)
mountQuestionBankCollectionsRoutes(app)
mountExportRecordsRoutes(app)
mountActivityDashboardRoutes(app)
mountQuickActionsRoutes(app)
mountImportFlowV2Routes(app)
mountCandidateFixRoutes(app)
mountLayoutDraftRoutes(app)
mountErrorMiddleware(app)

// Re-export for Electron and smoke tests
export { app, startServer, closeDatabase }

const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = startServer()
  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    interruptOwnedSourceDocumentOcrTasks()
    const timeout = setTimeout(() => process.exit(1), 5_000)
    timeout.unref()
    server.close(() => {
      clearTimeout(timeout)
      closeDatabase()
    })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
