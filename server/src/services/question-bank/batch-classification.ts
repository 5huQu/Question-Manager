import { spawn } from 'node:child_process'
import path from 'node:path'
import { sourceRoot, pythonRoot } from '../../config.js'
import { parseJson } from '../../utils/json.js'
import { RouteError } from '../../utils/http-error.js'
import { pythonCommand } from '../settings/python.js'
import { ocrRunnerEnv, readOcrSettings } from '../settings/ocr-settings.js'

export type QuestionBatchClassificationScope =
  | { type: 'all'; id?: string }
  | { type: 'pdf_slicer_run'; id: string }
  | { type: 'import_job'; id: string }

export type QuestionBatchClassificationReport = {
  scopeType: QuestionBatchClassificationScope['type']
  scopeId: string
  runId?: string
  importJobId?: string
  total: number
  updated: number
  failed: number
  failures: Array<{ id: string; error: string }>
}

function normalizeScope(scope: QuestionBatchClassificationScope) {
  const id = String(scope.id || '').trim()
  if (scope.type !== 'all' && !id) throw new RouteError(400, '题目分类缺少批次 ID。')
  return { type: scope.type, id }
}

export function runQuestionBatchClassification(scope: QuestionBatchClassificationScope): Promise<QuestionBatchClassificationReport> {
  const normalized = normalizeScope(scope)
  const scriptPath = path.join(sourceRoot, 'server', 'python', 'scripts', 'classify_question_bank.py')
  const settings = readOcrSettings()
  const child = spawn(
    pythonCommand(),
    [
      scriptPath,
      '--scope-type',
      normalized.type,
      '--scope-id',
      normalized.id,
      '--concurrency',
      settings.cleanupConcurrency || '20',
    ],
    {
      cwd: pythonRoot,
      env: ocrRunnerEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      const fallback: QuestionBatchClassificationReport = {
        scopeType: normalized.type,
        scopeId: normalized.id,
        total: 0,
        updated: 0,
        failed: 0,
        failures: [],
      }
      if (code === 0) {
        resolve(parseJson<QuestionBatchClassificationReport>(stdout.trim(), fallback))
        return
      }
      reject(new Error(`题目分类异常退出：code=${code ?? 'null'} signal=${signal ?? 'null'}${stderr.trim() ? `；${stderr.trim()}` : ''}`))
    })
  })
}
