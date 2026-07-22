import type { Express } from 'express'
import { readOcrSettings, writeOcrSettings } from '../services/settings/ocr-settings.js'

export function mountSettingsRoutes(app: Express) {
  app.get('/api/settings', (_, res) => {
    res.json(readOcrSettings())
  })

  app.patch('/api/settings', (req, res) => {
    res.json(writeOcrSettings(req.body || {}))
  })
}
