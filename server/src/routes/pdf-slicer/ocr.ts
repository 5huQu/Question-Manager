import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { getRun, removeRunOcrOutputs, mapRun } from '../../db/runs.js'
import { activeOcrProcesses } from '../../types/index.js'
import type { RunRow, QuestionRow } from '../../types/index.js'
import { parseJson } from '../../utils/json.js'
import { nowIso } from '../../utils/ids.js'
import {
  startMigratedOcrBackground,
  getOcrProgress,
  normalizeOcrProvider,
  doc2xArtifactDir,
} from '../../services/pdf-slicer/ocr.js'
import { tryAutoMergeSeparatedExamForRun } from '../../services/pdf-slicer/review.js'
import { mapQuestion, createQuestion } from '../../db/questions.js'
import { runQuestionClassification } from '../../services/pdf-slicer/classification.js'
import { configuredGradeStages } from '../../services/settings/app-settings.js'

export function mountOcrRoutes(app: Express) {
  app.post('/api/tools/pdf-slicer/runs/bulk-ocr', (req, res) => {
    const runIds = Array.isArray(req.body?.runIds) ? req.body.runIds.map(String) : []
    const update = db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'queued', ocr_error = '', updated_at = ? WHERE run_id = ?")
    const found: string[] = []
    const started: string[] = []
    const failed: Array<{ runId: string; error: string }> = []
    for (const runId of runIds) {
      if (getRun(runId)) {
        update.run(nowIso(), runId)
        found.push(runId)
        const now = nowIso()
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
          .run(now, now, runId)
        try {
          startMigratedOcrBackground(runId)
          started.push(runId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
            .run(message, nowIso(), nowIso(), runId)
          failed.push({ runId, error: message })
        }
      }
    }
    res.json({ enqueuedRunIds: found, startedRunIds: started, failed })
  })

  app.get('/api/tools/pdf-slicer/ocr-jobs', (_, res) => {
    const jobs = (db.prepare("SELECT * FROM pdf_slicer_runs WHERE ocr_status != 'idle' ORDER BY updated_at DESC").all() as RunRow[])
      .map(mapRun)
    res.json({
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
    })
  })

  app.get('/api/tools/pdf-slicer/runs/:runId/ocr-progress', (req, res) => {
    const progress = getOcrProgress(req.params.runId)
    progress ? res.json(progress) : res.status(404).json({ error: '批次不存在。' })
  })

  app.get('/api/tools/pdf-slicer/runs/:runId/questions', (req, res) => {
    const runId = req.params.runId
    const run = getRun(runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const rows = db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
    res.json({ run, items: rows.map(mapQuestion) })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/classify', (req, res) => {
    const runId = req.params.runId
    if (!getRun(runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    try {
      const report = runQuestionClassification(runId)
      db.prepare('UPDATE pdf_slicer_runs SET updated_at = ? WHERE run_id = ?').run(nowIso(), runId)
      const rows = db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
      res.json({ run: getRun(runId), items: rows.map(mapQuestion), report })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: message, run: getRun(runId) })
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/start-ocr', (req, res) => {
    if (!getRun(req.params.runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const now = nowIso()
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
      .run(now, now, req.params.runId)
    try {
      const totalQuestions = startMigratedOcrBackground(req.params.runId)
      res.json({ run: getRun(req.params.runId), totalQuestions, progress: getOcrProgress(req.params.runId) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
        .run(message, nowIso(), nowIso(), req.params.runId)
      res.status(500).json({ error: message, run: getRun(req.params.runId) })
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/resume-ocr', (req, res) => {
    if (!getRun(req.params.runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const now = nowIso()
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
      .run(now, now, req.params.runId)
    try {
      const totalQuestions = startMigratedOcrBackground(req.params.runId, { force: false })
      res.json({ run: getRun(req.params.runId), totalQuestions, progress: getOcrProgress(req.params.runId) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
        .run(message, nowIso(), nowIso(), req.params.runId)
      res.status(500).json({ error: message, run: getRun(req.params.runId) })
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/complete-ocr', (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const now = nowIso()
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'succeeded', ocr_error = '', ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
      .run(now, now, req.params.runId)
    const existing = (db.prepare('SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ?').get(req.params.runId) as { count: number }).count
    for (let index = existing; index < run.approvedQuestions; index += 1) {
      createQuestion({
        questionNo: String(index + 1),
        stage: run.stage || configuredGradeStages()[0] || '高三',
        questionType: 'OCR题',
        difficultyScore: 3,
        chapter: '待整理',
        sourceTitle: run.paperTitle || run.pdfName,
        stemMarkdown: `【${run.pdfName}】第 ${index + 1} 题 OCR 结果待精修。`,
        answerText: '待补充',
        analysisMarkdown: '待补充解析。',
        sourceRunId: run.runId,
      })
    }
    res.json(getRun(req.params.runId))
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/force-rerun-ocr', (req, res) => {
    const child = activeOcrProcesses.get(req.params.runId)
    if (child) {
      child.kill('SIGTERM')
      activeOcrProcesses.delete(req.params.runId)
    }
    removeRunOcrOutputs(req.params.runId)
    const now = nowIso()
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = ?, ocr_finished_at = '', updated_at = ? WHERE run_id = ?")
      .run(now, now, req.params.runId)
    try {
      const totalQuestions = startMigratedOcrBackground(req.params.runId, { force: true })
      res.json({ run: getRun(req.params.runId), totalQuestions, progress: getOcrProgress(req.params.runId) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
        .run(message, nowIso(), nowIso(), req.params.runId)
      res.status(500).json({ error: message, run: getRun(req.params.runId) })
    }
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/force-interrupt-ocr', (req, res) => {
    const child = activeOcrProcesses.get(req.params.runId)
    if (child) {
      child.kill('SIGTERM')
      activeOcrProcesses.delete(req.params.runId)
    }
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = '用户强制中断', ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
      .run(nowIso(), nowIso(), req.params.runId)
    const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(req.params.runId) as RunRow | undefined
    if (row && normalizeOcrProvider(row.ocr_provider) === 'doc2x') {
      const statePath = path.join(doc2xArtifactDir(row), 'state.json')
      const state = parseJson<Record<string, any>>(fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '{}', {})
      fs.mkdirSync(path.dirname(statePath), { recursive: true })
      fs.writeFileSync(statePath, JSON.stringify({ ...state, phase: 'interrupted', updated_at: Date.now() / 1000 }, null, 2), 'utf8')
      db.prepare("UPDATE pdf_slicer_runs SET ocr_provider_phase = 'interrupted', updated_at = ? WHERE run_id = ?").run(nowIso(), req.params.runId)
    }
    tryAutoMergeSeparatedExamForRun(req.params.runId)
    res.json(getRun(req.params.runId))
  })
}
