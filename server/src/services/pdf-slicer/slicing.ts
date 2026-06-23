import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { db } from '../../db/connection.js'
import { sourceRoot, runsRoot, pythonRoot, storageRoot } from '../../config.js'
import { nowIso, createId } from '../../utils/ids.js'
import { parseJson } from '../../utils/json.js'
import { pythonCommand, pythonEnv } from '../settings/python.js'
import { readPdfSlicerRules, computeJsonHash, takePdfSlicerRulesSnapshot, pdfSlicerRulesPath } from './rules.js'
import { getReviewItems } from '../../db/review.js'
import { getRun, updateBatchWorkflow } from '../../db/runs.js'
import { mergeDiagnostics } from '../../utils/document-conversion.js'
import { resolveStoragePath } from '../../utils/paths.js'
import type { RunRow } from '../../types/index.js'

function removeDirectoryOutsideApi(targetPath: string) {
  if (!targetPath || !fs.existsSync(targetPath)) return
  const parent = path.dirname(targetPath)
  const basename = path.basename(targetPath)
  const trashPath = path.join(parent, `${basename}.deleted-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`)
  let cleanupPath = targetPath
  try {
    fs.renameSync(targetPath, trashPath)
    cleanupPath = trashPath
  } catch {
    cleanupPath = targetPath
  }
  const script = [
    'const fs = require("node:fs");',
    'const target = process.argv[1];',
    'if (target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });',
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script, cleanupPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

async function importSliceResults(runId: string, row: RunRow, outputDir: string) {
  const resultPath = path.join(outputDir, 'cut_results.json')
  const payload = JSON.parse(await fs.promises.readFile(resultPath, 'utf8')) as { results?: Array<Record<string, any>>; solution_results?: Array<Record<string, any>>; summary?: Record<string, any> }
  const results = payload.results ?? []
  const solutionResults = payload.solution_results ?? []
  const diagnostics = payload.summary?.diagnostics ?? ({} as Record<string, any>)
  const rulesMeta: Record<string, unknown> = {}
  if (diagnostics.rules_version !== undefined) {
    rulesMeta.rulesVersion = diagnostics.rules_version
    rulesMeta.rulesHash = diagnostics.rules_hash
    rulesMeta.rulesFallbackUsed = Boolean(diagnostics.rules_fallback_used)
    rulesMeta.rulesWarnings = Array.isArray(diagnostics.rules_warnings) ? diagnostics.rules_warnings : []
  }
  const nextDiagnostics = mergeDiagnostics(parseJson<Record<string, any>>(row.document_diagnostics_json || '{}', {}), { cutDiagnostics: diagnostics, ...rulesMeta })
  db.prepare('UPDATE pdf_slicer_runs SET document_diagnostics_json = ?, rules_fallback_used = ?, rules_warnings_json = ?, updated_at = ? WHERE run_id = ?')
    .run(JSON.stringify(nextDiagnostics), rulesMeta.rulesFallbackUsed ? 1 : 0, JSON.stringify(rulesMeta.rulesWarnings || []), nowIso(), runId)
  const insert = db.prepare(`INSERT INTO pdf_slicer_review_items (result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertSolution = db.prepare(`
    INSERT INTO pdf_slicer_solution_items (
      id, batch_id, source_run_id, question_no, answer_text, analysis_markdown, figures_json, source_image_path, match_status, matched_question_id, match_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?)
  `)
  const now = nowIso()
  const cutterFigures = (figures: unknown) => Array.isArray(figures)
    ? figures.map((figure) => ({ ...figure, origin: String((figure as Record<string, unknown>).origin || 'cutter_auto') }))
    : []
  db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(runId)
  for (const [index, item] of results.entries()) {
    const pageSpan = Array.isArray(item.page_span) ? item.page_span : [item.page ?? 1, item.page ?? 1]
    insert.run(`${runId}_${item.id || createId('CUT')}`, runId, String(item.question_no || item.id || ''), Number(pageSpan[0] || item.page || 1), Number(pageSpan[1] || item.page || 1), String(item.page_image_path || ''), String(item.auto_image_path || ''), JSON.stringify(item.bbox || {}), JSON.stringify(item.segments || []), JSON.stringify(item.text_regions || []), JSON.stringify(cutterFigures(item.figures)), String(item.status || 'pending_review'), String(item.note || ''), now, now)
    if (index > 0 && index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  for (const [index, item] of solutionResults.entries()) {
    const pageSpan = Array.isArray(item.page_span) ? item.page_span : [item.page ?? 1, item.page ?? 1]
    insertSolution.run(
      `${runId}_${item.id || createId('SOL')}`,
      row.batch_id,
      runId,
      String(item.question_no || ''),
      String(item.answer_text || ''),
      String(item.analysis_markdown || item.note || ''),
      JSON.stringify(cutterFigures(item.figures)),
      String(item.auto_image_path || item.page_image_path || ''),
      '同卷参考答案/解析已按题号抽取，等待题干 OCR 后合并。',
      now,
      now,
    )
    if (index > 0 && index % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return getReviewItems(runId)
}

function prepareSlicingRun(runId: string) {
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
  removeDirectoryOutsideApi(outputDir)
  fs.mkdirSync(outputDir, { recursive: true })
  db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ?').run(runId)
  db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(runId)

  // Record rules config version before running
  const rulesFile = pdfSlicerRulesPath()
  const rulesConfig = readPdfSlicerRules()
  const rulesHash = computeJsonHash(rulesConfig)
  const rulesVersion = Number(rulesConfig.version || 1)
  db.prepare('UPDATE pdf_slicer_runs SET rules_version = ?, rules_hash = ?, updated_at = ? WHERE run_id = ?')
    .run(rulesVersion, rulesHash, nowIso(), runId)

  const rulesArgs = fs.existsSync(rulesFile) ? ['--rules-config', rulesFile] : []
  return { row, outputDir, args: [scriptPath, '--input-pdf', inputPdf, '--output-dir', outputDir, '--asset-root', storageRoot, '--dpi', '180', ...rulesArgs] }
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
    const prepared = prepareSlicingRun(run.runId)
    const child = spawn(pythonCommand(), prepared.args, { cwd: pythonRoot, env: pythonEnv(), stdio: ['ignore', 'ignore', 'pipe'] })
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    let settled = false
    const finish = async (error?: Error) => {
      if (settled) return
      settled = true
      try {
        if (error) throw error
        const items = await importSliceResults(run.runId, prepared.row, prepared.outputDir)
        db.prepare("UPDATE pdf_slicer_runs SET slice_status = 'succeeded', total_questions = ?, unreviewed_questions = ?, quick_review_status = 'pending', updated_at = ? WHERE run_id = ?").run(items.length, items.length, nowIso(), run.runId)
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure)
        db.prepare("UPDATE pdf_slicer_runs SET slice_status = 'failed', slice_error = ?, updated_at = ? WHERE run_id = ?").run(message, nowIso(), run.runId)
      }
      updateBatchWorkflow(run.batchId)
    }
    child.once('error', (error) => { void finish(error) })
    child.once('close', (code) => {
      if (code !== 0) void finish(new Error(Buffer.concat(stderr).toString('utf8').trim() || `切题进程异常退出：code=${code ?? 'null'}`))
      else void finish()
    })
    return { run: getRun(run.runId), items: getReviewItems(run.runId) }
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
