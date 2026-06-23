import fs from 'node:fs'
import { db } from '../../db/connection.js'
import { nowIso } from '../../utils/ids.js'
import { normalizeFileRole } from '../../utils/ocr-helpers.js'
import { buildSearchText } from '../../utils/search.js'
import { updateBatchWorkflow } from '../../db/runs.js'
import { parseJson } from '../../utils/json.js'
import { figuresForSolutionItem } from '../../utils/figure-helpers.js'
import { resolveStoragePath, stripAssetPrefix } from '../../utils/paths.js'
import type { RunRow, QuestionRow, SolutionRow } from '../../types/index.js'

function normalizedQuestionNo(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const compact = raw
    .replace(/[第题\s]/g, '')
    .replace(/[.．、:：）)]$/g, '')
    .replace(/^[（(]/, '')
  const numberMatch = compact.match(/\d{1,3}/)
  return numberMatch ? String(Number(numberMatch[0])) : compact.toUpperCase()
}

function figurePathExists(figure: Record<string, unknown>) {
  const figurePath = stripAssetPrefix(String(figure.path || ''))
  return Boolean(figurePath && fs.existsSync(resolveStoragePath(figurePath)))
}

function mergeFigures(existingFigures: Array<Record<string, unknown>>, solutionFigures: Array<Record<string, unknown>>) {
  const merged: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const figure of [...existingFigures, ...solutionFigures]) {
    const figurePath = stripAssetPrefix(String(figure.path || ''))
    if (!figurePath || !fs.existsSync(resolveStoragePath(figurePath))) continue
    const key = [
      String(figure.usage || figure.category || ''),
      figurePath,
      JSON.stringify(figure.bbox || {}),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ ...figure, path: figurePath })
  }
  return merged
}

export function tryAutoMergeSeparatedExamForRun(runId: string) {
  const runRow = db.prepare('SELECT batch_id FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as Pick<RunRow, 'batch_id'> | undefined
  if (!runRow?.batch_id) return
  tryAutoMergeSeparatedExam(runRow.batch_id)
}

export function tryAutoMergeSameRunSolutions(runId: string) {
  const runRow = db.prepare('SELECT batch_id FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as Pick<RunRow, 'batch_id'> | undefined
  const solutionRows = db.prepare('SELECT * FROM pdf_slicer_solution_items WHERE source_run_id = ? ORDER BY created_at ASC').all(runId) as SolutionRow[]
  if (!solutionRows.length) return { merged: 0, unresolved: 0, skipped: true, reason: '当前批次没有同卷解析条目。' }

  const questionRows = db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
  if (!questionRows.length) {
    if (runRow?.batch_id) updateBatchWorkflow(runRow.batch_id)
    return { merged: 0, unresolved: solutionRows.length, skipped: true, reason: '等待题干 OCR 入库后合并。' }
  }

  const solutionsByNo = new Map<string, SolutionRow[]>()
  for (const solution of solutionRows) {
    const key = normalizedQuestionNo(solution.question_no)
    if (!key) {
      db.prepare("UPDATE pdf_slicer_solution_items SET match_status = 'unmatched', match_note = ?, updated_at = ? WHERE id = ?")
        .run('解析题号缺失，无法自动合并。', nowIso(), solution.id)
      continue
    }
    const list = solutionsByNo.get(key) || []
    list.push(solution)
    solutionsByNo.set(key, list)
  }

  let merged = 0
  let unresolved = 0
  const updateQuestion = db.prepare(`
    UPDATE question_bank_items SET
      answer_text = CASE WHEN TRIM(answer_text) = '' THEN ? ELSE answer_text END,
      analysis_markdown = CASE WHEN TRIM(analysis_markdown) = '' THEN ? ELSE analysis_markdown END,
      search_text = ?,
      figures_json = ?,
      source_solution_run_id = ?,
      merge_status = ?,
      merge_note = ?,
      bank_status = ?,
      updated_at = ?
    WHERE id = ?
  `)
  const updateSolution = db.prepare("UPDATE pdf_slicer_solution_items SET match_status = ?, matched_question_id = ?, match_note = ?, updated_at = ? WHERE id = ?")
  for (const question of questionRows) {
    const key = normalizedQuestionNo(question.question_no)
    const matches = key ? (solutionsByNo.get(key) || []) : []
    if (!key) {
      unresolved += 1
      updateQuestion.run('', '', question.search_text, question.figures_json, '', 'missing_question_no', '原卷题号缺失，无法匹配同卷解析。', 'blocked', nowIso(), question.id)
      continue
    }
    if (matches.length === 1) {
      const solution = matches[0]
      const existingFigures = parseJson<Array<Record<string, unknown>>>(question.figures_json || '[]', [])
      const solutionFigures = figuresForSolutionItem(solution, question.id).filter(figurePathExists)
      const figures = mergeFigures(existingFigures, solutionFigures)
      const mergedAnswer = question.answer_text || solution.answer_text
      const mergedAnalysis = question.analysis_markdown || solution.analysis_markdown
      updateQuestion.run(
        solution.answer_text,
        solution.analysis_markdown,
        buildSearchText(question.stem_markdown, mergedAnswer, mergedAnalysis, [question.source_title, question.knowledge_points_json, question.solution_methods_json]),
        JSON.stringify(figures),
        solution.source_run_id,
        'merged',
        '已按题号合并同卷原卷题干与参考答案/解析。',
        question.bank_status === 'skipped' || question.bank_status === 'banked' ? question.bank_status : 'ready',
        nowIso(),
        question.id
      )
      updateSolution.run('matched', question.id, '已按题号匹配同卷题目。', nowIso(), solution.id)
      merged += 1
      continue
    }
    unresolved += 1
    const note = matches.length > 1 ? '同卷解析中存在重复题号，需人工确认。' : '未找到同题号同卷解析，需人工补充。'
    updateQuestion.run('', '', question.search_text, question.figures_json, '', matches.length > 1 ? 'duplicate_solution' : 'missing_solution', note, 'blocked', nowIso(), question.id)
    for (const solution of matches) updateSolution.run('duplicate', '', note, nowIso(), solution.id)
  }

  for (const solution of solutionRows) {
    const key = normalizedQuestionNo(solution.question_no)
    const hasQuestion = key && questionRows.some((question) => normalizedQuestionNo(question.question_no) === key)
    if (!hasQuestion) {
      updateSolution.run('unmatched', '', '未找到同题号原卷题目。', nowIso(), solution.id)
      unresolved += 1
    }
  }

  if (runRow?.batch_id) updateBatchWorkflow(runRow.batch_id)
  return { merged, unresolved, skipped: false }
}

export function tryAutoMergeSeparatedExam(batchId: string) {
  const runs = db.prepare('SELECT * FROM pdf_slicer_runs WHERE batch_id = ?').all(batchId) as RunRow[]
  const sameRunRows = db.prepare(`
    SELECT DISTINCT source_run_id AS run_id
    FROM pdf_slicer_solution_items
    WHERE batch_id = ?
      AND source_run_id IN (
        SELECT run_id FROM pdf_slicer_runs
        WHERE batch_id = ? AND file_role != 'solutions'
      )
  `).all(batchId, batchId) as Array<{ run_id: string }>
  let sameRunMerged = 0
  let sameRunUnresolved = 0
  for (const row of sameRunRows) {
    const result = tryAutoMergeSameRunSolutions(row.run_id)
    sameRunMerged += result?.merged || 0
    sameRunUnresolved += result?.unresolved || 0
  }

  const questionRuns = runs.filter((run) => normalizeFileRole(run.file_role) === 'questions')
  const solutionRuns = runs.filter((run) => normalizeFileRole(run.file_role) === 'solutions')
  if (!questionRuns.length || !solutionRuns.length) {
    updateBatchWorkflow(batchId)
    if (sameRunRows.length) return { merged: sameRunMerged, unresolved: sameRunUnresolved, skipped: false }
    return { merged: 0, unresolved: 0, skipped: true, reason: '不是原卷+解析分离批次。' }
  }
  const relevantRuns = [...questionRuns, ...solutionRuns]
  if (!relevantRuns.every((run) => run.ocr_status === 'succeeded')) {
    updateBatchWorkflow(batchId)
    return { merged: 0, unresolved: 0, skipped: true, reason: '等待原卷和解析文件 OCR 完成。' }
  }

  const questionRows = db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id IN (SELECT run_id FROM pdf_slicer_runs WHERE batch_id = ? AND file_role = 'questions')
    ORDER BY serial_no ASC
  `).all(batchId) as QuestionRow[]
  const solutionRows = db.prepare(`
    SELECT * FROM pdf_slicer_solution_items
    WHERE batch_id = ?
      AND source_run_id IN (
        SELECT run_id FROM pdf_slicer_runs WHERE batch_id = ? AND file_role = 'solutions'
      )
    ORDER BY created_at ASC
  `).all(batchId, batchId) as SolutionRow[]
  const solutionsByNo = new Map<string, SolutionRow[]>()
  for (const solution of solutionRows) {
    const key = normalizedQuestionNo(solution.question_no)
    if (!key) {
      db.prepare("UPDATE pdf_slicer_solution_items SET match_status = 'unmatched', match_note = ?, updated_at = ? WHERE id = ?")
        .run('解析题号缺失，无法自动合并。', nowIso(), solution.id)
      continue
    }
    const list = solutionsByNo.get(key) || []
    list.push(solution)
    solutionsByNo.set(key, list)
  }

  let merged = 0
  let unresolved = 0
  const updateQuestion = db.prepare(`
    UPDATE question_bank_items SET
      answer_text = CASE WHEN TRIM(answer_text) = '' THEN ? ELSE answer_text END,
      analysis_markdown = CASE WHEN TRIM(analysis_markdown) = '' THEN ? ELSE analysis_markdown END,
      search_text = ?,
      figures_json = ?,
      source_solution_run_id = ?,
      merge_status = ?,
      merge_note = ?,
      bank_status = ?,
      updated_at = ?
    WHERE id = ?
  `)
  const updateSolution = db.prepare("UPDATE pdf_slicer_solution_items SET match_status = ?, matched_question_id = ?, match_note = ?, updated_at = ? WHERE id = ?")
  for (const question of questionRows) {
    const key = normalizedQuestionNo(question.question_no)
    const matches = key ? (solutionsByNo.get(key) || []) : []
    if (!key) {
      unresolved += 1
      updateQuestion.run('', '', question.search_text, question.figures_json, '', 'missing_question_no', '原卷题号缺失，无法匹配解析。', 'blocked', nowIso(), question.id)
      continue
    }
    if (matches.length === 1) {
      const solution = matches[0]
      const existingFigures = parseJson<Array<Record<string, unknown>>>(question.figures_json || '[]', [])
      const solutionFigures = figuresForSolutionItem(solution, question.id).filter(figurePathExists)
      const figures = mergeFigures(existingFigures, solutionFigures)
      const mergedAnswer = question.answer_text || solution.answer_text
      const mergedAnalysis = question.analysis_markdown || solution.analysis_markdown
      updateQuestion.run(
        solution.answer_text,
        solution.analysis_markdown,
        buildSearchText(question.stem_markdown, mergedAnswer, mergedAnalysis, [question.source_title, question.knowledge_points_json, question.solution_methods_json]),
        JSON.stringify(figures),
        solution.source_run_id,
        'merged',
        '已按题号合并原卷题干与解析文件。',
        question.bank_status === 'skipped' || question.bank_status === 'banked' ? question.bank_status : 'ready',
        nowIso(),
        question.id
      )
      updateSolution.run('matched', question.id, '已按题号匹配原卷题目。', nowIso(), solution.id)
      merged += 1
      continue
    }
    unresolved += 1
    const note = matches.length > 1 ? '解析文件中存在重复题号，需人工确认。' : '未找到同题号解析，需人工补充。'
    updateQuestion.run('', '', question.search_text, question.figures_json, '', matches.length > 1 ? 'duplicate_solution' : 'missing_solution', note, 'blocked', nowIso(), question.id)
    for (const solution of matches) updateSolution.run('duplicate', '', note, nowIso(), solution.id)
  }

  for (const solution of solutionRows) {
    const key = normalizedQuestionNo(solution.question_no)
    const hasQuestion = key && questionRows.some((question) => normalizedQuestionNo(question.question_no) === key)
    if (!hasQuestion) {
      updateSolution.run('unmatched', '', '未找到同题号原卷题目。', nowIso(), solution.id)
      unresolved += 1
    }
  }

  updateBatchWorkflow(batchId)
  return { merged: merged + sameRunMerged, unresolved: unresolved + sameRunUnresolved, skipped: false }
}
