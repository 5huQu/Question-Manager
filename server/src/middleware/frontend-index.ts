import fs from 'node:fs'
import path from 'node:path'
import { static as expressStatic } from 'express'
import type { Request, Response, Express } from 'express'
import { frontendDist } from '../config.js'

const indexPath = path.join(frontendDist, 'index.html')

/**
 * Serve the built frontend index.html. The SPA decides which page to render;
 * authentication is enforced by the page gate before this middleware runs.
 */
export function sendFrontendIndex(_req: Request, res: Response) {
  if (!fs.existsSync(indexPath)) {
    res.status(404).type('text/plain').send('前端尚未构建。')
    return
  }
  res.sendFile(indexPath)
}

/** Serve frontend JS/CSS/fonts from the built dist directory (public). */
export function mountFrontendStatic(expressApp: Express) {
  if (fs.existsSync(frontendDist)) {
    expressApp.use(expressStatic(frontendDist, { index: false }))
  }
}
