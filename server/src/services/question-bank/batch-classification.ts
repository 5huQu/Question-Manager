import { spawn } from 'node:child_process'
import path from 'node:path'
import { sourceRoot, pythonRoot } from '../../config.js'
import { parseJson } from '../../utils/json.js'
import { RouteError } from '../../utils/http-error.js'
import { pythonCommand } from '../settings/python.js'
import { ocrRunnerEnv, readOcrSettings } from '../settings/ocr-settings.js'
import { createId } from '../../utils/ids.js'

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

export type QuestionBatchClassificationTask = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  scope: QuestionBatchClassificationScope
  total: number
  completed: number
  updated: number
  failed: number
  failures: Array<{ id: string; error: string }>
  startedAt: string
  finishedAt?: string
  error?: string
}

const tasks = new Map<string, QuestionBatchClassificationTask>()
const MAX_TASKS = 20

function normalizeScope(scope: QuestionBatchClassificationScope) {
  const id = String(scope.id || '').trim()
  if (scope.type !== 'all' && !id) throw new RouteError(400, '题目分类缺少批次 ID。')
  return { type: scope.type, id }
}

export function runQuestionBatchClassification(scope: QuestionBatchClassificationScope, options: { onlyMissing?: boolean } = {}): Promise<QuestionBatchClassificationReport> {
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
      ...(options.onlyMissing === false ? [] : ['--only-missing']),
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
      const report = parseJson<QuestionBatchClassificationReport>(stdout.trim(), fallback)
      const detail = stderr.trim() || report.failures[0]?.error || ''
      reject(new Error(`题目分类异常退出：code=${code ?? 'null'} signal=${signal ?? 'null'}${detail ? `；${detail}` : ''}`))
    })
  })
}

export function startQuestionBatchClassification(scope: QuestionBatchClassificationScope, options: { onlyMissing?: boolean } = {}) {
  const id = createId('classification')
  const task: QuestionBatchClassificationTask = {
    id, status: 'queued', scope, total: 0, completed: 0, updated: 0, failed: 0, failures: [], startedAt: new Date().toISOString(),
  }
  tasks.set(id, task)
  while (tasks.size > MAX_TASKS) tasks.delete(tasks.keys().next().value as string)
  void executeClassificationTask(task, options)
  return task
}

export function getQuestionBatchClassificationTask(id: string) {
  return tasks.get(id) || null
}

async function executeClassificationTask(task: QuestionBatchClassificationTask, options: { onlyMissing?: boolean }) {
  task.status = 'running'
  try {
    const report = await runQuestionBatchClassificationWithProgress(task.scope, options, (progress) => {
      task.total = progress.total ?? task.total
      task.completed = progress.completed ?? task.completed
      task.updated = progress.updated ?? task.updated
      task.failed = progress.failed ?? task.failed
      if (progress.id && progress.error) task.failures = [...task.failures.filter((item) => item.id !== progress.id), { id: progress.id, error: progress.error }]
    })
    task.total = report.total; task.completed = report.total; task.updated = report.updated; task.failed = report.failed; task.failures = report.failures
    task.status = report.failed ? 'failed' : 'succeeded'
  } catch (error) {
    task.status = 'failed'; task.error = error instanceof Error ? error.message : String(error)
  } finally {
    task.finishedAt = new Date().toISOString()
  }
}

function runQuestionBatchClassificationWithProgress(scope: QuestionBatchClassificationScope, options: { onlyMissing?: boolean }, onProgress: (progress: Record<string, any>) => void): Promise<QuestionBatchClassificationReport> {
  const normalized = normalizeScope(scope)
  const scriptPath = path.join(sourceRoot, 'server', 'python', 'scripts', 'classify_question_bank.py')
  const settings = readOcrSettings()
  const child = spawn(pythonCommand(), [scriptPath, '--scope-type', normalized.type, '--scope-id', normalized.id, '--concurrency', settings.cleanupConcurrency || '20', ...(options.onlyMissing === false ? [] : ['--only-missing'])], { cwd: pythonRoot, env: ocrRunnerEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.startsWith('CLASSIFICATION_PROGRESS ')) continue
        try { onProgress(JSON.parse(line.slice('CLASSIFICATION_PROGRESS '.length))) } catch { /* ignore malformed progress */ }
      }
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      const fallback: QuestionBatchClassificationReport = { scopeType: normalized.type, scopeId: normalized.id, total: 0, updated: 0, failed: 0, failures: [] }
      const report = parseJson<QuestionBatchClassificationReport>(stdout.trim(), fallback)
      if (code === 0 || report.total > 0) { resolve(report); return }
      reject(new Error(`题目分类异常退出：code=${code ?? 'null'} signal=${signal ?? 'null'}${stderr.trim() ? `；${stderr.trim()}` : ''}`))
    })
  })
}
