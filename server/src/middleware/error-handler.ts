import type { ErrorRequestHandler, Express } from 'express'
import multer from 'multer'
import { RouteError } from '../utils/http-error.js'

export const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    res.status(status).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? '上传文件超过大小限制。' : '上传内容不符合限制。',
      code: error.code,
    })
    return
  }
  if (error instanceof RouteError) {
    res.status(error.status).json(error.body || { error: error.message, ...(error.details === undefined ? {} : { details: error.details }) })
    return
  }
  console.error('Unhandled request error:', error)
  res.status(500).json({ error: '服务器内部错误', code: 'INTERNAL_ERROR' })
}

export function mountErrorMiddleware(app: Express) {
  app.use(jsonErrorHandler)
}
