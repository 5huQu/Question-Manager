import fs from 'node:fs'
import path from 'node:path'
import { activeOcrProcesses } from '../../types/index.js'
import { parseJson } from '../../utils/json.js'
import { createQuestion } from '../../db/questions.js'
import { startMigratedOcrBackground, getOcrProgress, normalizeOcrProvider, doc2xArtifactDir, glmArtifactDir } from './ocr.js'
import { tryAutoMergeSeparatedExamForRun } from './merging.js'
import { runQuestionClassification } from './classification.js'
import { configuredGradeStages } from '../settings/app-settings.js'
import { RouteError } from '../../utils/http-error.js'
import * as repo from '../../repositories/pdf-slicer/runs.repo.js'
import { getSourceDocument } from '../../repositories/source-documents.repo.js'

export function bulkOcr(body: Record<string, any>) {
  const runIds = Array.isArray(body?.runIds) ? body.runIds.map(String) : []
  const found: string[] = []
  const started: string[] = []
  const failed: Array<{ runId: string; error: string }> = []
  for (const runId of runIds) {
    if (!repo.getRun(runId)) continue
    repo.markRunQueued(runId)
    found.push(runId)
    repo.markRunRunning(runId)
    try {
      startMigratedOcrBackground(runId)
      started.push(runId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      repo.markRunFailed(runId, message)
      failed.push({ runId, error: message })
    }
  }
  return { enqueuedRunIds: found, startedRunIds: started, failed }
}

export function listOcrJobs() {
  const jobs = repo.listOcrJobs()
  return {
    summary: {
      totalJobs: jobs.length,
      queuedCount: jobs.filter((run) => run.ocrStatus === 'queued').length,
      runningCount: jobs.filter((run) => run.ocrStatus === 'running').length,
      succeededCount: jobs.filter((run) => run.ocrStatus === 'succeeded').length,
      failedCount: jobs.filter((run) => run.ocrStatus === 'failed').length,
    },
    currentRun: jobs.find((run) => run.ocrStatus === 'running') ?? null,
    queuedRuns: jobs.filter((run) => run.ocrStatus === 'queued'),
    historyRuns: jobs.filter((run) => run.ocrStatus === 'succeeded' || run.ocrStatus === 'failed'),
  }
}

export function ocrProgress(runId: string) {
  const progress = getOcrProgress(runId)
  if (!progress) throw new RouteError(404, '批次不存在。')
  return progress
}

export function runQuestions(runId: string) {
  const run = repo.getRun(runId)
  if (run) return { run, items: repo.questionsForRun(runId) }
  if (runId.startsWith('ifv2:')) {
    const sourceDocumentId = runId.slice('ifv2:'.length)
    const sourceDocument = getSourceDocument(sourceDocumentId)
    if (!sourceDocument) throw new RouteError(404, '资料不存在。')
    const items = repo.questionsForRun(runId)
    return {
      run: {
        runId,
        batchId: sourceDocumentId,
        uploadMode: 'import_flow_v2',
        paperTitle: sourceDocument.title || sourceDocument.originalFileName,
        pdfName: sourceDocument.originalFileName || sourceDocument.title,
        pdfPath: sourceDocument.filePath,
        sourceFileName: sourceDocument.originalFileName,
        sourceFileKind: sourceDocument.fileType,
        materialType: 'exam',
        fileRole: 'full',
        stage: '高三',
        classificationConfidence: 0,
        classificationReasons: [],
        runDir: '',
        documentDiagnostics: {},
        createdAt: sourceDocument.createdAt,
        updatedAt: sourceDocument.updatedAt,
        sliceStatus: 'succeeded',
        sliceError: '',
        quickReviewStatus: 'submitted',
        totalQuestions: items.length,
        approvedQuestions: items.length,
        unreviewedQuestions: 0,
        ocrStatus: 'succeeded',
        ocrError: '',
        progressPercent: 1,
        processedQuestions: items.length,
        totalOcrQuestions: items.length,
        importedQuestions: items.length,
        bankedQuestions: items.length,
        solutionItems: 0,
        ocrProvider: sourceDocument.provider === 'glm' ? 'glm' : 'legacy',
        ocrExternalUid: '',
        ocrProviderPhase: '',
        ocrProviderProgress: 100,
        ocrProviderResultPath: '',
      },
      items,
    }
  }
  throw new RouteError(404, '批次不存在。')
}

export async function classifyRun(runId: string) {
  if (!repo.getRun(runId)) throw new RouteError(404, '批次不存在。')
  try {
    const report = await runQuestionClassification(runId)
    repo.touchRun(runId)
    return { run: repo.getRun(runId), items: repo.questionsForRun(runId), report }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RouteError(500, message, undefined, { error: message, run: repo.getRun(runId) })
  }
}

export function startOcr(runId: string, options: { force?: boolean; resetOutputs?: boolean; resetFinished?: boolean } = {}) {
  if (!repo.getRun(runId) && !options.resetOutputs) throw new RouteError(404, '批次不存在。')
  if (options.resetOutputs) {
    const child = activeOcrProcesses.get(runId)
    if (child) {
      child.kill('SIGTERM')
      activeOcrProcesses.delete(runId)
    }
    repo.removeRunOcrOutputs(runId)
  }
  repo.markRunRunning(runId, Boolean(options.resetFinished))
  try {
    const totalQuestions = startMigratedOcrBackground(runId, options.force == null ? undefined : { force: options.force })
    return { run: repo.getRun(runId), totalQuestions, progress: getOcrProgress(runId) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    repo.markRunFailed(runId, message)
    throw new RouteError(500, message, undefined, { error: message, run: repo.getRun(runId) })
  }
}

export function completeOcr(runId: string) {
  const run = repo.getRun(runId)
  if (!run) throw new RouteError(404, '批次不存在。')
  repo.markRunSucceeded(runId)
  const existing = repo.sourceQuestionCount(runId)
  for (let index = existing; index < run.approvedQuestions; index += 1) {
    createQuestion({ questionNo: String(index + 1), stage: run.stage || configuredGradeStages()[0] || '高三', questionType: 'OCR题', difficultyScore: 3, chapter: '待整理', sourceTitle: run.paperTitle || run.pdfName, stemMarkdown: `【${run.pdfName}】第 ${index + 1} 题 OCR 结果待精修。`, answerText: '待补充', analysisMarkdown: '待补充解析。', sourceRunId: run.runId })
  }
  return repo.getRun(runId)
}

export function interruptOcr(runId: string) {
  const child = activeOcrProcesses.get(runId)
  if (child) {
    child.kill('SIGTERM')
    activeOcrProcesses.delete(runId)
  }
  repo.markRunFailed(runId, '用户强制中断')
  const row = repo.rawRun(runId)
  const provider = row ? normalizeOcrProvider(row.ocr_provider) : 'legacy'
  if (row && (provider === 'doc2x' || provider === 'glm')) {
    const statePath = path.join(provider === 'glm' ? glmArtifactDir(row) : doc2xArtifactDir(row), 'state.json')
    const state = parseJson<Record<string, any>>(fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '{}', {})
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify({ ...state, phase: 'interrupted', updated_at: Date.now() / 1000 }, null, 2), 'utf8')
    repo.updateProviderPhase(runId, 'interrupted')
  }
  tryAutoMergeSeparatedExamForRun(runId)
  return repo.getRun(runId)
}
