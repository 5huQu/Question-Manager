// Assembly Point — imports all modules and wires them together.
//
// Explicit middleware phases. Anything mounted after the API auth gate is
// protected by default; new business routes only need to be mounted here.

import { app, startServer } from './server.js'
import { closeDatabase } from './db/connection.js'
import { ensureSchema } from './db/schema.js'
import { uploadTempDir } from './config.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { cleanupStaleUploads } from './utils/upload-files.js'
import { sendFrontendIndex, mountFrontendStatic } from './middleware/frontend-index.js'
import { mountPrivateFilesRoutes, mountLegacyAssetsBridge } from './routes/files.js'

// Route mounters
import { mountLivenessRoutes, mountHealthRoutes } from './routes/health.js'
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
import { mountTeachingDocumentRoutes } from './routes/teaching-documents.js'
import { recoverInterruptedLayoutPreviews } from './services/question-bank/layout-drafts.service.js'
import { mountErrorMiddleware } from './middleware/error-handler.js'
import {
  interruptOwnedSourceDocumentOcrTasks,
  recoverInterruptedSourceDocumentOcrTasks,
} from './services/import-flow-v2/ocr-task.service.js'

// Initialize schema before any route handles requests
cleanupStaleUploads(uploadTempDir)
ensureSchema()
recoverInterruptedLayoutPreviews()
recoverInterruptedSourceDocumentOcrTasks()

// Phase 1 — public liveness check. Only reports process aliveness.
mountLivenessRoutes(app)

// Phase 2 — public auth endpoints (state/login/bootstrap). Added with the
// single-admin authentication feature.
// mountPublicAuthRoutes(app)

// Phase 3 — attach the session to every request without forcing login.
// app.use(attachSession)

// Phase 4 — authenticated-only auth endpoints (logout, change-password, sessions).
// mountProtectedAuthRoutes(app)

// Phase 5 — unified auth gate for every business API. New /api routes mounted
// after this point are protected by default.
// app.use('/api', requireApiAuth)
app.use('/api', (req, res, next) => next())

// Phase 6 — business routes
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
mountTeachingDocumentRoutes(app)

// Phase 7 — unknown API paths return JSON 404 instead of falling into the SPA.
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在。', code: 'NOT_FOUND' })
})

// Phase 8 — private files and legacy /assets bridge. Legacy /assets/data/...
// entries are redirected to /files; only allowlisted directories are served.
mountLegacyAssetsBridge(app)
mountPrivateFilesRoutes(app)

// Phase 9 — public frontend static assets (JS/CSS/fonts), so the login page
// can load without a session. index.html itself is handled by later phases.
mountFrontendStatic(app)

// Phase 10 — public pages. /login and /admin-setup are served anonymously.
// app.get('/login', sendFrontendIndex)
// app.get('/admin-setup', sendFrontendIndex)

// Phase 11 — print pages must authenticate before rendering.
// app.use('/print', requirePageAuth, (req, res) => sendFrontendIndex(req, res))

// Phase 12 — every other page requires authentication before the SPA loads.
app.use((req, res, next) => {
  if (req.method !== 'GET') {
    next()
    return
  }
  const pathname = req.path
  if (
    pathname.startsWith('/api')
    || pathname.startsWith('/assets')
    || pathname.startsWith('/files')
    || pathname.startsWith('/livez')
    || pathname.startsWith('/login')
    || pathname.startsWith('/admin-setup')
    || pathname.startsWith('/print')
  ) {
    next()
    return
  }
  sendFrontendIndex(req, res)
})

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
