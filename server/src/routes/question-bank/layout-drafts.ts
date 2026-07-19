import type { Express } from 'express'
import { sendRouteError } from '../errors.js'
import * as service from '../../services/question-bank/layout-drafts.service.js'
export function mountLayoutDraftRoutes(app:Express){
  app.get('/api/question-bank/layout-drafts',(req,res)=>{try{res.json(service.searchLayoutDrafts(req.query))}catch(e){sendRouteError(res,e)}})
  app.get('/api/question-bank/collections/:id/layout-drafts',(req,res)=>{try{res.json(service.listLayoutDrafts(decodeURIComponent(req.params.id)))}catch(e){sendRouteError(res,e)}})
  app.post('/api/question-bank/collections/:id/layout-drafts',(req,res)=>{try{const draft=service.createLayoutDraft(decodeURIComponent(req.params.id),req.body||{});res.status(201).json({draftId:draft.id,draft,preview:draft.preview})}catch(e){sendRouteError(res,e)}})
  app.get('/api/question-bank/layout-drafts/:draftId',(req,res)=>{try{const draft=service.getLayoutDraft(decodeURIComponent(req.params.draftId));res.json({draft,preview:draft.preview})}catch(e){sendRouteError(res,e)}})
  app.patch('/api/question-bank/layout-drafts/:draftId',(req,res)=>{try{const draft=service.updateLayoutDraft(decodeURIComponent(req.params.draftId),req.body||{});res.json({draft,preview:draft.preview})}catch(e){sendRouteError(res,e)}})
  app.post('/api/question-bank/layout-drafts/:draftId/refresh-content',(req,res)=>{try{res.json(service.refreshLayoutDraftContent(decodeURIComponent(req.params.draftId),req.body?.revision))}catch(e){sendRouteError(res,e)}})
  app.post('/api/question-bank/layout-drafts/:draftId/content/:relationId/sync-to-bank',(req,res)=>{try{res.json(service.syncLayoutContentToBank(decodeURIComponent(req.params.draftId),decodeURIComponent(req.params.relationId),req.body||{}))}catch(e){sendRouteError(res,e)}})
  app.delete('/api/question-bank/layout-drafts/:draftId',(req,res)=>{try{res.json(service.deleteLayoutDraft(decodeURIComponent(req.params.draftId)))}catch(e){sendRouteError(res,e)}})
  app.post('/api/question-bank/layout-drafts/:draftId/preview',(req,res)=>{try{res.json({preview:service.generateLayoutPreview(decodeURIComponent(req.params.draftId),req.body?.revision)})}catch(e){sendRouteError(res,e)}})
  app.get('/api/question-bank/layout-drafts/:draftId/preview-status',(req,res)=>{try{res.json(service.getPreviewStatus(decodeURIComponent(req.params.draftId)))}catch(e){sendRouteError(res,e)}})
  app.get('/api/question-bank/layout-drafts/:draftId/pages',(req,res)=>{try{res.json(service.getPreviewPages(decodeURIComponent(req.params.draftId)))}catch(e){sendRouteError(res,e)}})
  app.post('/api/question-bank/layout-drafts/:draftId/export',(req,res)=>{try{res.json(service.exportLayoutDraft(decodeURIComponent(req.params.draftId),req.body||{}))}catch(e){sendRouteError(res,e)}})
}
