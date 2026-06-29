import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import {
  getDailyQuestion,
  getQuickActionMetadata,
  generateRandomPaper,
} from '../../services/question-bank/quick-actions.service.js'
import type { DifficultyMode } from '../../services/question-bank/quick-actions.service.js'

const difficultyModes: DifficultyMode[] = ['foundation', 'standard', 'advanced', 'challenge', 'custom']

function queryText(value: unknown) {
  return value ? String(value) : undefined
}

function queryList(value: unknown) {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean)
  return value ? String(value).split(',').map((item) => item.trim()).filter(Boolean) : []
}

function queryNumber(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

export function mountQuickActionsRoutes(app: Express) {
  app.get('/api/question-bank/quick-action-metadata', (req, res) => {
    try {
      const difficultyMin = queryNumber(req.query.difficultyMin)
      const difficultyMax = queryNumber(req.query.difficultyMax)
      res.json(getQuickActionMetadata({
        stage: queryText(req.query.stage),
        knowledgePoints: queryList(req.query.knowledgePoints),
        solutionMethods: queryList(req.query.solutionMethods),
        matchMode: req.query.matchMode === 'loose' ? 'loose' : 'strict',
        difficultyMode: difficultyModes.includes(String(req.query.difficultyMode) as DifficultyMode)
          ? String(req.query.difficultyMode) as DifficultyMode
          : undefined,
        difficultyRange: difficultyMin || difficultyMax ? { min: difficultyMin ?? 1, max: difficultyMax ?? 10 } : undefined,
      }))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/question-bank/daily-question', (req, res) => {
    try {
      const stage = req.query.stage ? String(req.query.stage) : undefined
      const knowledgePoint = req.query.knowledgePoint ? String(req.query.knowledgePoint) : undefined
      const solutionMethod = req.query.solutionMethod ? String(req.query.solutionMethod) : undefined
      res.json(getDailyQuestion({ stage, knowledgePoint, solutionMethod }))
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
