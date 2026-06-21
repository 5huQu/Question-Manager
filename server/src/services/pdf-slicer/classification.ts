import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../db/connection.js'
import { sourceRoot, pythonRoot } from '../../config.js'
import { pythonCommand } from '../settings/python.js'
import { parseJson } from '../../utils/json.js'
import { readOcrSettings } from '../settings/ocr-settings.js'
import { nowIso } from '../../utils/ids.js'

export function runQuestionClassification(runId: string) {
  const scriptPath = path.join(sourceRoot, 'server', 'python', 'scripts', 'classify_question_bank.py')
  const settings = readOcrSettings()
  const stdout = execFileSync(pythonCommand(), [scriptPath, '--run-id', runId, '--concurrency', settings.cleanupConcurrency || '20'], {
    cwd: pythonRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  return parseJson<Record<string, any>>(stdout, { runId, total: 0, updated: 0, failed: 0, failures: [] })
}

export function classifyRunAfterImport(runId: string, logPath?: string) {
  const settings = readOcrSettings()
  if (settings.classificationEnabled === 'false') return null
  try {
    const report = runQuestionClassification(runId)
    if (logPath) {
      fs.appendFileSync(logPath, `[${nowIso()}] classification updated=${report.updated ?? 0} failed=${report.failed ?? 0}\n`)
    }
    return report
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (logPath) fs.appendFileSync(logPath, `[${nowIso()}] classification skipped/failed: ${message}\n`)
    return { failed: true, error: message }
  }
}
