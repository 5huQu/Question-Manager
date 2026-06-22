import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../db/connection.js'
import { sourceRoot, pythonRoot } from '../../config.js'
import { pythonCommand } from '../settings/python.js'
import { parseJson } from '../../utils/json.js'
import { ocrRunnerEnv, readOcrSettings } from '../settings/ocr-settings.js'
import { nowIso } from '../../utils/ids.js'

export function runQuestionClassification(runId: string): Promise<Record<string, any>> {
  const scriptPath = path.join(sourceRoot, 'server', 'python', 'scripts', 'classify_question_bank.py')
  const settings = readOcrSettings()
  const child = spawn(pythonCommand(), [scriptPath, '--run-id', runId, '--concurrency', settings.cleanupConcurrency || '20'], {
    cwd: pythonRoot,
    env: ocrRunnerEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve(parseJson<Record<string, any>>(stdout.trim(), { runId, total: 0, updated: 0, failed: 0, failures: [] }))
        return
      }
      reject(new Error(`题目分类异常退出：code=${code ?? 'null'} signal=${signal ?? 'null'}${stderr.trim() ? `；${stderr.trim()}` : ''}`))
    })
  })
}

export async function classifyRunAfterImport(runId: string, logPath?: string) {
  const settings = readOcrSettings()
  if (settings.classificationEnabled === 'false') return null
  try {
    const report = await runQuestionClassification(runId)
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
