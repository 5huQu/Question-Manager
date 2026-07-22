import type { Request } from 'express'

export const API_BASE = '/api/import-flow-v2'

export function routeId(req: Request, name = 'id') {
  return decodeURIComponent(String(req.params[name] || ''))
}
