import type { Express } from 'express'
import { sourceRoot, storageRoot, dataDir, runsRoot, sqlitePath } from '../config.js'
import { toolAvailability } from '../services/settings/tools.js'

export function mountHealthRoutes(app: Express) {
  app.get('/api/health', (_, res) => {
    const now = new Date()
    res.json({ ok: true, sourceRoot, storageRoot, dataDir, runsRoot, sqlitePath, serverTime: now.toISOString(), serverYear: now.getFullYear(), tools: toolAvailability() })
  })
}
