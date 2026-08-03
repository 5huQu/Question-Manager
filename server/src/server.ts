import express from 'express'
import http from 'node:http'
import { trustedProxy } from './auth/config.js'

export const app = express()

// Phase 0: base middleware. Route mounting happens in index.ts so that the
// authentication gates can wrap every business route from a single place.
export function configureBaseMiddleware(expressApp = app) {
  expressApp.set('trust proxy', trustedProxy)
  expressApp.use(express.json({ limit: '20mb' }))
}

configureBaseMiddleware()

export function startServer(port = Number(process.env.PORT || 8797), host = process.env.HOST || '127.0.0.1') {
  const server = http.createServer(app)
  server.listen(port, host, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : port
    console.log(`Question API running at http://${host}:${actualPort}`)
  })
  return server
}
