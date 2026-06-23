import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import { getActivityHeatmap } from '../../services/dashboard/activity.service.js'

export function mountActivityDashboardRoutes(app: Express) {
  app.get('/api/dashboard/activity-heatmap', (req, res) => {
    try {
      res.json(getActivityHeatmap(req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}
