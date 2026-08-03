import type { Express, Request, Response, NextFunction } from 'express'
import { resolvePublicAssetPath } from '../utils/paths.js'

function methodGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: '仅支持 GET 请求。', code: 'METHOD_NOT_ALLOWED' })
    return
  }
  next()
}

/**
 * Private files namespace. Serves question figures, uploads, PDF exports and
 * layout preview artifacts — everything that must be authenticated.
 *
 * The allowlist lives in resolvePublicAssetPath(); nothing outside those
 * directories is ever sent, even when the requester is authenticated.
 */
export function mountPrivateFilesRoutes(app: Express) {
  app.use('/files', methodGuard)
  app.use('/files', (req: Request, res: Response, next: NextFunction) => {
    const raw = req.path.replace(/^\/+/, '')
    if (!raw) {
      res.status(404).json({ error: '文件不存在。', code: 'NOT_FOUND' })
      return
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      next()
      return
    }
    const target = resolvePublicAssetPath(decoded)
    if (!target) {
      res.status(404).json({ error: '文件不存在。', code: 'NOT_FOUND' })
      return
    }
    res.sendFile(target)
  })
}

/**
 * Legacy bridge: old `/assets/data/...` URLs now redirect to `/files/...`.
 * The redirect itself is anonymous so the browser can follow it; the /files
 * gate then applies the real authentication check.
 */
export function mountLegacyAssetsBridge(app: Express) {
  app.use('/assets', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(req.path || '')
    } catch {
      next()
      return
    }
    if (!resolvePublicAssetPath(decoded)) {
      // Not a data artifact — let the frontend static handler pick it up.
      next()
      return
    }
    res.redirect(301, `/files${req.path}`)
  })
}
