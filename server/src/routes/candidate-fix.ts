import type { Express } from 'express'
import {
  createOrRestoreCandidateFixSession,
  finalizeCandidateFixSession,
  getCandidateFixSession,
  reopenCandidateFixSession,
  saveCandidateFixRegions,
  validateCandidateFixSession,
} from '../services/candidate-fix/candidate-fix.service.js'
import { sendRouteError } from './errors.js'

export function mountCandidateFixRoutes(app: Express) {
  app.post('/api/import-flow-v2/candidates/:candidateId/fix-session', (req, res) => {
    try { res.json(createOrRestoreCandidateFixSession(decodeURIComponent(String(req.params.candidateId || '')))) }
    catch (error) { sendRouteError(res, error) }
  })

  app.get('/api/import-flow-v2/candidate-fix-sessions/:sessionId', (req, res) => {
    try { res.json(getCandidateFixSession(decodeURIComponent(String(req.params.sessionId || '')))) }
    catch (error) { sendRouteError(res, error) }
  })

  app.put('/api/import-flow-v2/candidate-fix-sessions/:sessionId/regions', (req, res) => {
    try {
      res.json(saveCandidateFixRegions(
        decodeURIComponent(String(req.params.sessionId || '')),
        req.body?.regions,
        Number(req.body?.revision),
      ))
    } catch (error) { sendRouteError(res, error) }
  })

  app.post('/api/import-flow-v2/candidate-fix-sessions/:sessionId/validate', (req, res) => {
    try { res.json(validateCandidateFixSession(decodeURIComponent(String(req.params.sessionId || '')))) }
    catch (error) { sendRouteError(res, error) }
  })

  app.post('/api/import-flow-v2/candidate-fix-sessions/:sessionId/finalize', (req, res) => {
    try { res.json(finalizeCandidateFixSession(decodeURIComponent(String(req.params.sessionId || '')), req.body || {})) }
    catch (error) { sendRouteError(res, error) }
  })

  app.post('/api/import-flow-v2/candidate-fix-sessions/:sessionId/reopen', (req, res) => {
    try { res.json(reopenCandidateFixSession(decodeURIComponent(String(req.params.sessionId || '')))) }
    catch (error) { sendRouteError(res, error) }
  })
}
