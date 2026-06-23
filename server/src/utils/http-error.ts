import type { Response } from 'express'

export class RouteError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public body?: Record<string, unknown>) {
    super(message)
    this.name = 'RouteError'
  }
}

export function sendRouteError(res: Response, error: unknown) {
  if (error instanceof RouteError) {
    if (error.body) {
      res.status(error.status).json(error.body)
      return
    }
    const payload: { error: string; details?: unknown } = { error: error.message }
    if (error.details !== undefined) payload.details = error.details
    res.status(error.status).json(payload)
    return
  }
  if (error instanceof Error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(500).json({ error: '服务器内部错误' })
}
