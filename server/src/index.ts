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
import { mountPublicAuthRoutes, mountProtectedAuthRoutes } from './auth/routes.js'
import { attachSession, requireApiAuth, requireFileAuth, requirePageAuth } from './auth/middleware.js'
import { authMode, readOnlyMode } from './auth/config.js'
import { adminExists } from './auth/admin.repo.js'

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
import { mountAiAssistantRoutes } from './routes/ai-assistant.js'
import { recoverInterruptedLayoutPreviews } from './services/question-bank/layout-drafts.service.js'
import { mountErrorMiddleware } from './middleware/error-handler.js'
import {
  interruptOwnedSourceDocumentOcrTasks,
  recoverInterruptedSourceDocumentOcrTasks,
} from './services/import-flow-v2/ocr-task.service.js'

// Initialize schema before any route handles requests
if (!readOnlyMode) cleanupStaleUploads(uploadTempDir)
ensureSchema()
if (!readOnlyMode) {
  recoverInterruptedLayoutPreviews()
  recoverInterruptedSourceDocumentOcrTasks()
}

if (authMode === 'single-admin') {
  if (!adminExists()) {
    console.warn('')
    console.warn('[auth] 尚未初始化管理员账号。首次访问站点时会进入管理员安装界面；')
    console.warn('[auth] 也可以在本机运行 npm run admin:init 初始化。')
    console.warn('[auth] 公开部署建议配置 ADMIN_BOOTSTRAP_TOKEN，防止他人抢先创建管理员。')
    console.warn('')
  }
  if (!process.env.PUBLIC_ORIGIN) {
    console.warn('[auth] 警告：未配置 PUBLIC_ORIGIN，CSRF 来源校验将只接受本机回环地址。云端部署请设置 PUBLIC_ORIGIN=https://你的域名')
  }
}

// Phase 1 — public liveness check. Only reports process aliveness.
mountLivenessRoutes(app)

// Phase 2 — public auth endpoints (state/login/bootstrap).
mountPublicAuthRoutes(app)

// Phase 3 — attach the session to every request without forcing login.
app.use(attachSession)

// Phase 4 — authenticated-only auth endpoints (logout, change-password, sessions).
mountProtectedAuthRoutes(app)

// Phase 5 — unified auth gate for every business API. New /api routes mounted
// after this point are protected by default.
app.use('/api', requireApiAuth)

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
mountAiAssistantRoutes(app)

// Phase 7 — unknown API paths return JSON 404 instead of falling into the SPA.
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在。', code: 'NOT_FOUND' })
})

// Phase 8 — private files and legacy /assets bridge. Legacy /assets/data/...
// entries are redirected to /files; only allowlisted directories are served.
mountLegacyAssetsBridge(app)
app.use('/files', requireFileAuth)
mountPrivateFilesRoutes(app)

// Phase 9 — public frontend static assets (JS/CSS/fonts), so the login page
// can load without a session. index.html itself is handled by later phases.
mountFrontendStatic(app)

// Phase 10 — public pages. /login and /admin-setup are served anonymously.
app.get('/login', sendFrontendIndex)
app.get('/admin-setup', sendFrontendIndex)

// Phase 11 — print pages must authenticate before rendering. A hidden print
// window must never receive the login page silently.
app.use('/print', (req, res, next) => {
  if (req.method !== 'GET') {
    next()
    return
  }
  requirePageAuth(req, res, () => sendFrontendIndex(req, res))
})

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
  requirePageAuth(req, res, () => sendFrontendIndex(req, res))
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
