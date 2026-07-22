import type { Express } from 'express'
import { assertWithSchema, parseWithSchema } from '../../contracts/runtime-schema.js'
import {
  parserConfigEnvelopeSchema, parserConfigSchema, parserPresetDeleteSchema,
  parserPresetInputSchema, parserPresetListSchema, parserPresetMutationSchema, parserPresetPatchSchema,
} from '../../contracts/import-v2-schemas.js'
import {
  createParserPreset, deleteParserPreset, getParserConfigForApi, listParserPresets,
  resetParserConfig, saveParserConfig, updateParserPreset,
} from '../../services/question-parser/parser-config.js'
import { sendRouteError } from '../errors.js'
import { API_BASE, routeId } from './common.js'

export function mountParserRoutes(app: Express) {
  app.get(`${API_BASE}/parser-config`, (_req, res) => {
    try { res.json(assertWithSchema({ config: getParserConfigForApi() }, parserConfigEnvelopeSchema)) } catch (error) { sendRouteError(res, error) }
  })
  app.put(`${API_BASE}/parser-config`, (req, res) => {
    try {
      const raw = req.body ?? {}
      const config = raw && typeof raw === 'object' && !Array.isArray(raw) && 'config' in raw
        ? parseWithSchema<Record<string, unknown>>((raw as Record<string, unknown>).config, parserConfigSchema, '请求体.config')
        : parseWithSchema<Record<string, unknown>>(raw, parserConfigSchema)
      res.json(assertWithSchema({ config: saveParserConfig(config) }, parserConfigEnvelopeSchema))
    } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/parser-config/reset`, (_req, res) => {
    try { res.json(assertWithSchema({ config: resetParserConfig() }, parserConfigEnvelopeSchema)) } catch (error) { sendRouteError(res, error) }
  })
  app.get(`${API_BASE}/parser-presets`, (_req, res) => {
    try { res.json(assertWithSchema(listParserPresets(), parserPresetListSchema)) } catch (error) { sendRouteError(res, error) }
  })
  app.post(`${API_BASE}/parser-presets`, (req, res) => {
    try {
      const raw = req.body ?? {}
      const preset = raw && typeof raw === 'object' && !Array.isArray(raw) && 'preset' in raw
        ? (raw as Record<string, unknown>).preset
        : raw
      const input = parseWithSchema<Record<string, unknown>>(preset, parserPresetInputSchema, '请求体.preset')
      res.status(201).json(assertWithSchema(createParserPreset(input), parserPresetMutationSchema))
    } catch (error) { sendRouteError(res, error) }
  })
  app.put(`${API_BASE}/parser-presets/:id`, (req, res) => {
    try {
      const raw = req.body ?? {}
      const preset = raw && typeof raw === 'object' && !Array.isArray(raw) && 'preset' in raw
        ? (raw as Record<string, unknown>).preset
        : raw
      const patch = parseWithSchema<Record<string, unknown>>(preset, parserPresetPatchSchema, '请求体.preset')
      res.json(assertWithSchema(updateParserPreset(routeId(req), patch), parserPresetMutationSchema))
    } catch (error) { sendRouteError(res, error) }
  })
  app.delete(`${API_BASE}/parser-presets/:id`, (req, res) => {
    try { res.json(assertWithSchema(deleteParserPreset(routeId(req)), parserPresetDeleteSchema)) } catch (error) { sendRouteError(res, error) }
  })
}
