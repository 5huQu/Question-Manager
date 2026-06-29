import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import { getActivityHeatmap, getActivityHours } from '../../services/dashboard/activity.service.js'

export function mountActivityDashboardRoutes(app: Express) {
  app.get('/api/dashboard/activity-heatmap', (req, res) => {
    try {
      res.json(getActivityHeatmap(req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })

  app.get('/api/dashboard/activity-hours', (req, res) => {
    try {
      res.json(getActivityHours(req.query))
    } catch (error) {
      sendRouteError(res, error)
    }
  })
}
