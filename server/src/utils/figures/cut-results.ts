import fs from 'node:fs'
import path from 'node:path'
import { parseJson } from '../json.js'
import { resolveStoragePath } from '../paths.js'
import { getRun } from '../../db/runs.js'

export function loadCutResultRecord(runId: string, resultId: string): Record<string, any> | null {
  const run = getRun(runId)
  if (!run) return null
  const cutId = String(resultId || '').match(/CUT_\d+/)?.[0] || resultId.split('_').pop() || ''
  const cutPath = path.join(resolveStoragePath(run.runDir), 'output', 'cut_results.json')
  if (!fs.existsSync(cutPath)) return null
  const payload = parseJson<{ results?: Array<Record<string, any>> }>(fs.readFileSync(cutPath, 'utf8'), { results: [] })
  return payload.results?.find((item) => String(item.id || '') === cutId || String(item.question_no || '') === cutId) || null
}

export function loadSolutionCutResultRecord(runId: string, resultId: string): Record<string, any> | null {
  const run = getRun(runId)
  if (!run) return null
  const cutId = String(resultId || '').match(/SOL_\d+/)?.[0] || resultId.split('_').pop() || ''
  const cutPath = path.join(resolveStoragePath(run.runDir), 'output', 'cut_results.json')
  if (!fs.existsSync(cutPath)) return null
  const payload = parseJson<{ solution_results?: Array<Record<string, any>> }>(fs.readFileSync(cutPath, 'utf8'), { solution_results: [] })
  return payload.solution_results?.find((item) => String(item.id || '') === cutId || String(item.question_no || '') === cutId) || null
}
