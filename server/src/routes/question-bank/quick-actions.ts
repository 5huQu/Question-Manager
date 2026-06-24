import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import {
  getDailyQuestion,
  generateRandomPaper,
} from '../../services/question-bank/quick-actions.service.js'

export function mountQuickActionsRoutes(app: Express) {
  app.get('/api/question-bank/daily-question', (req, res) => {
    try {
      const knowledgePoint = req.query.knowledgePoint ? String(req.query.knowledgePoint) : undefined
      const solutionMethod = req.query.solutionMethod ? String(req.query.solutionMethod) : undefined
      res.json(getDailyQuestion({ knowledgePoint, solutionMethod }))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.post('/api/question-bank/random-paper', (req, res) => {
    try {
      res.json(generateRandomPaper(req.body || {}))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}
