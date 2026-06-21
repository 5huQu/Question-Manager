import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { db } from '../../db/connection.js'
import { sourceRoot, runsRoot, pythonRoot, storageRoot } from '../../config.js'
import { nowIso, createId } from '../../utils/ids.js'
import { parseJson } from '../../utils/json.js'
import { pythonCommand } from '../settings/python.js'
import { readPdfSlicerRules, computeJsonHash, takePdfSlicerRulesSnapshot, pdfSlicerRulesPath } from './rules.js'
import { getReviewItems } from '../../db/review.js'
import { getRun, updateBatchWorkflow } from '../../db/runs.js'
import { mergeDiagnostics } from '../../utils/document-conversion.js'
import { resolveStoragePath } from '../../utils/paths.js'
import type { RunRow } from '../../types/index.js'

export function runMigratedPdfSlicer(runId: string) {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  if (!row) {
    throw new Error('批次不存在。')
  }
  const inputPdf = resolveStoragePath(row.pdf_path)
  if (path.extname(inputPdf).toLowerCase() !== '.pdf') {
    throw new Error('切题引擎需要 PDF 输入；当前批次没有可用的转换后 PDF，请重新上传或检查 Word 转 PDF 流程。')
  }
  if (!fs.existsSync(inputPdf)) {
    throw new Error(`切题 PDF 文件不存在：${row.pdf_path}`)
  }

  const runDir = resolveStoragePath(row.run_dir)
  const outputDir = path.join(runDir, 'output')
  const scriptPath = path.join(sourceRoot, 'server', 'python', 'scripts', 'run_cut_for_question.py')
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ?').run(runId)

  // Record rules config version before running
  const rulesFile = pdfSlicerRulesPath()
  const rulesConfig = readPdfSlicerRules()
  const rulesHash = computeJsonHash(rulesConfig)
  const rulesVersion = Number(rulesConfig.version || 1)
  db.prepare('UPDATE pdf_slicer_runs SET rules_version = ?, rules_hash = ?, updated_at = ? WHERE run_id = ?')
    .run(rulesVersion, rulesHash, nowIso(), runId)

  const rulesArgs = fs.existsSync(rulesFile) ? ['--rules-config', rulesFile] : []
  execFileSync(pythonCommand(), [
    scriptPath,
    '--input-pdf', inputPdf,
    '--output-dir', outputDir,
    '--asset-root', storageRoot,
    '--dpi', '180',
    ...rulesArgs,
  ], { cwd: pythonRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  const resultPath = path.join(outputDir, 'cut_results.json')
  const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as { results?: Array<Record<string, any>>; summary?: Record<string, any> }
  const results = payload.results ?? []
  const diagnostics = payload.summary?.diagnostics ?? ({} as Record<string, any>)
  const rulesMeta: Record<string, unknown> = {}
  if (diagnostics.rules_version !== undefined) {
    rulesMeta.rulesVersion = diagnostics.rules_version
    rulesMeta.rulesHash = diagnostics.rules_hash
    rulesMeta.rulesFallbackUsed = Boolean(diagnostics.rules_fallback_used)
    rulesMeta.rulesWarnings = Array.isArray(diagnostics.rules_warnings) ? diagnostics.rules_warnings : []
  }
  const nextDiagnostics = mergeDiagnostics(
    parseJson<Record<string, any>>(row.document_diagnostics_json || '{}', {}),
    { cutDiagnostics: diagnostics, ...rulesMeta }
  )
  // Update both document_diagnostics_json and the extracted rule columns
  db.prepare('UPDATE pdf_slicer_runs SET document_diagnostics_json = ?, rules_fallback_used = ?, rules_warnings_json = ?, updated_at = ? WHERE run_id = ?')
    .run(
      JSON.stringify(nextDiagnostics),
      rulesMeta.rulesFallbackUsed ? 1 : 0,
      JSON.stringify(rulesMeta.rulesWarnings || []),
      nowIso(),
      runId,
    )
  const insert = db.prepare(`
    INSERT INTO pdf_slicer_review_items (
      result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = nowIso()
  for (const item of results) {
    const pageSpan = Array.isArray(item.page_span) ? item.page_span : [item.page ?? 1, item.page ?? 1]
    const resultId = `${runId}_${item.id || createId('CUT')}`
    insert.run(
      resultId,
      runId,
      String(item.question_no || item.id || ''),
      Number(pageSpan[0] || item.page || 1),
      Number(pageSpan[1] || item.page || 1),
      String(item.page_image_path || ''),
      String(item.auto_image_path || ''),
      JSON.stringify(item.bbox || {}),
      JSON.stringify(item.segments || []),
      JSON.stringify(item.text_regions || []),
      JSON.stringify(item.figures || []),
      String(item.status || 'pending_review'),
      String(item.note || ''),
      now,
      now
    )
  }
  return getReviewItems(runId)
}

export function startSlicingRun(runId: string) {
  const run = getRun(runId)
  if (!run) {
    throw new Error('批次不存在。')
  }
  if (run.sliceStatus === 'running') {
    return { run, items: getReviewItems(run.runId) }
  }
  db.prepare("UPDATE pdf_slicer_runs SET slice_status = 'running', slice_error = '', updated_at = ? WHERE run_id = ?").run(nowIso(), run.runId)
  try {
    const items = runMigratedPdfSlicer(run.runId)
    db.prepare(`
      UPDATE pdf_slicer_runs
      SET slice_status = 'succeeded', total_questions = ?, unreviewed_questions = ?, quick_review_status = 'pending', updated_at = ?
      WHERE run_id = ?
    `).run(items.length, items.length, nowIso(), run.runId)
    updateBatchWorkflow(run.batchId)
    return { run: getRun(run.runId), items }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.prepare("UPDATE pdf_slicer_runs SET slice_status = 'failed', slice_error = ?, updated_at = ? WHERE run_id = ?").run(message, nowIso(), run.runId)
    updateBatchWorkflow(run.batchId)
    throw error
  }
}

export function startSlicingRunInBackground(runId: string) {
  setTimeout(() => {
    try {
      startSlicingRun(runId)
    } catch (error) {
      console.error(`[pdf-slicer] 自动切题失败 ${runId}:`, error)
    }
  }, 0)
}
