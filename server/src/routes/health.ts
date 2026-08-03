import type { Express } from 'express'
import { sourceRoot, storageRoot, dataDir, runsRoot, sqlitePath } from '../config.js'
import { toolAvailability } from '../services/settings/tools.js'

/** Public liveness probe — reports nothing about the host or configuration. */
export function mountLivenessRoutes(app: Express) {
  app.get('/livez', (_, res) => {
    res.json({ ok: true })
  })
}

/**
 * Detailed health report. Mounted behind the /api auth gate; contains paths
 * and tool status, so it must never be reachable anonymously.
 */
export function mountHealthRoutes(app: Express) {
  app.get('/api/health', (_, res) => {
    const now = new Date()
    res.json({ ok: true, sourceRoot, storageRoot, dataDir, runsRoot, sqlitePath, serverTime: now.toISOString(), serverYear: now.getFullYear(), tools: toolAvailability() })
  })
}
