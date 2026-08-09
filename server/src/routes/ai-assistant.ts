import type { Express } from 'express'
import { formatQuestionContent } from '../services/ai-assistant/content-format.service.js'
import { sendRouteError } from './errors.js'

export function mountAiAssistantRoutes(app: Express) {
  app.post('/api/ai-assistant/format-question-content', async (req, res) => {
    try {
      res.json(await formatQuestionContent(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}
