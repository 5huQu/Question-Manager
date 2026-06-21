import express from 'express'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { frontendDist, storageRoot, sourceRoot } from './config.js'
import { resolveStoragePath, isInside } from './utils/paths.js'

export const app = express()
app.use(express.json({ limit: '20mb' }))
app.use('/assets', (req, res, next) => {
  const decoded = decodeURIComponent(req.path || '')
  const target = resolveStoragePath(decoded)
  const allowed = target && (isInside(storageRoot, target) || isInside(sourceRoot, target))
  if (!allowed || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    next()
    return
  }
  res.sendFile(target)
})
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
}

if (fs.existsSync(frontendDist)) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/assets')) {
      next()
      return
    }
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

export function startServer(port = Number(process.env.PORT || 8797), host = process.env.HOST || '127.0.0.1') {
  const server = http.createServer(app)
  server.listen(port, host, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : port
    console.log(`Question API running at http://${host}:${actualPort}`)
  })
  return server
}
