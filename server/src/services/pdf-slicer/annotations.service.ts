import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { db } from '../../db/connection.js'
import { pythonRoot, runsRoot } from '../../config.js'
import { createId, nowIso } from '../../utils/ids.js'
import { parseJson } from '../../utils/json.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { pythonCommand, pythonEnv } from '../settings/python.js'
import { normalizedReviewQuestionNo } from '../../db/review.js'
import { updateBatchWorkflow } from '../../db/runs.js'

export interface AnnotationSegment {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface AnnotationRegion {
  id: string
  sessionId: string
  sourceRunId: string
  kind: 'question' | 'solution' | 'shared_answer_key'
  questionKey: string
  questionLabel: string
  questionKeys: string[]
  segments: AnnotationSegment[]
  sortOrder: number
  note: string
  createdAt: string
  updatedAt: string
}

export interface AnnotationSession {
  id: string
  batchId: string
  revision: number
  status: 'draft' | 'ready' | 'finalized' | 'superseded'
  sourceProfileJson: string
  createdAt: string
  updatedAt: string
  finalizedAt: string
  regions?: AnnotationRegion[]
}

function withTransaction<T>(operation: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The statement that failed may already have closed the transaction.
    }
    throw error
  }
}

export function createOrRestoreSession(batchId: string): AnnotationSession {
  const existing = db.prepare('SELECT * FROM pdf_slicer_annotation_sessions WHERE batch_id = ? AND status = ?').get(batchId, 'draft') as any
  if (existing) {
    const regions = getRegionsForSession(existing.id)
    return {
      id: existing.id,
      batchId: existing.batch_id,
      revision: existing.revision,
      status: existing.status,
      sourceProfileJson: existing.source_profile_json,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
      finalizedAt: existing.finalized_at,
      regions
    }
  }

  // A finalized session remains the batch's canonical record until the user
  // explicitly asks for a new revision. Do not silently create a blank draft
  // when they reopen the annotation workspace.
  const latest = db.prepare('SELECT * FROM pdf_slicer_annotation_sessions WHERE batch_id = ? ORDER BY revision DESC, created_at DESC LIMIT 1').get(batchId) as any
  if (latest) {
    return {
      id: latest.id,
      batchId: latest.batch_id,
      revision: latest.revision,
      status: latest.status,
      sourceProfileJson: latest.source_profile_json,
      createdAt: latest.created_at,
      updatedAt: latest.updated_at,
      finalizedAt: latest.finalized_at,
      regions: getRegionsForSession(latest.id),
    }
  }

  // Generate profiles snapshot for all runs in the batch
  const runs = db.prepare('SELECT run_id, document_diagnostics_json FROM pdf_slicer_runs WHERE batch_id = ?').all(batchId) as any[]
  const profiles: Record<string, any> = {}
  for (const run of runs) {
    const diag = parseJson<Record<string, any>>(run.document_diagnostics_json || '{}', {})
    if (diag.profile) {
      profiles[run.run_id] = diag.profile
    }
  }

  const sessionId = createId('sess')
  const now = nowIso()
  db.prepare(`
    INSERT INTO pdf_slicer_annotation_sessions (id, batch_id, revision, status, source_profile_json, created_at, updated_at)
    VALUES (?, ?, 1, 'draft', ?, ?, ?)
  `).run(sessionId, batchId, JSON.stringify(profiles), now, now)

  return {
    id: sessionId,
    batchId,
    revision: 1,
    status: 'draft',
    sourceProfileJson: JSON.stringify(profiles),
    createdAt: now,
    updatedAt: now,
    finalizedAt: '',
    regions: []
  }
}

export function getSession(sessionId: string): AnnotationSession | null {
  const row = db.prepare('SELECT * FROM pdf_slicer_annotation_sessions WHERE id = ?').get(sessionId) as any
  if (!row) return null
  const regions = getRegionsForSession(sessionId)
  return {
    id: row.id,
    batchId: row.batch_id,
    revision: row.revision,
    status: row.status,
    sourceProfileJson: row.source_profile_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
    regions
  }
}

export function getRegionsForSession(sessionId: string): AnnotationRegion[] {
  const rows = db.prepare('SELECT * FROM pdf_slicer_annotation_regions WHERE session_id = ? ORDER BY sort_order ASC, created_at ASC').all(sessionId) as any[]
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    sourceRunId: row.source_run_id,
    kind: row.kind as any,
    questionKey: row.question_key,
    questionLabel: row.question_label,
    questionKeys: parseJson<string[]>(row.question_keys_json || '[]', []),
    segments: parseJson<AnnotationSegment[]>(row.segments_json || '[]', []),
    sortOrder: row.sort_order,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

export function saveRegions(sessionId: string, regions: any[], clientRevision: number): AnnotationSession {
  const now = nowIso()
  withTransaction(() => {
    const session = db.prepare('SELECT * FROM pdf_slicer_annotation_sessions WHERE id = ?').get(sessionId) as any
    if (!session) {
      throw new Error('标注会话不存在。')
    }
    if (session.status !== 'draft') {
      throw new Error('只有草稿状态的标注会话允许保存修改。')
    }
    if (session.revision !== clientRevision) {
      throw new Error('标注草稿版本冲突，您的修改已被其他人覆盖。请刷新页面后重试。')
    }

    if (!Array.isArray(regions) || regions.length > 500) {
      throw new Error('标注区域格式无效，或区域数量超过 500 个。')
    }
    const sourceRuns = db.prepare('SELECT run_id, document_diagnostics_json FROM pdf_slicer_runs WHERE batch_id = ?').all(session.batch_id) as Array<{ run_id: string; document_diagnostics_json: string }>
    const pageCountByRun = new Map(sourceRuns.map((run) => [
      run.run_id,
      Number(parseJson<Record<string, any>>(run.document_diagnostics_json || '{}', {}).profile?.pageCount || 0),
    ]))
    const validKinds = new Set(['question', 'solution', 'shared_answer_key'])
    for (const region of regions) {
      if (!region || typeof region !== 'object' || !pageCountByRun.has(String(region.sourceRunId || ''))) {
        throw new Error('标注区域必须关联当前资料组中的原始文件。')
      }
      if (!validKinds.has(String(region.kind || ''))) {
        throw new Error('标注区域类型无效。')
      }
      if (!Array.isArray(region.segments) || region.segments.length > 30) {
        throw new Error('每个标注区域必须包含不超过 30 个框选片段。')
      }
      const pageCount = pageCountByRun.get(String(region.sourceRunId)) || 0
      for (const segment of region.segments) {
        const page = Number(segment?.page)
        const x = Number(segment?.x)
        const y = Number(segment?.y)
        const width = Number(segment?.width)
        const height = Number(segment?.height)
        if (![page, x, y, width, height].every(Number.isFinite) || page < 1 || (pageCount > 0 && page > pageCount) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
          throw new Error('标注区域含有越界页码或无效坐标。')
        }
      }
    }

    // Delete existing
    db.prepare('DELETE FROM pdf_slicer_annotation_regions WHERE session_id = ?').run(sessionId)

    // Insert new
    const insert = db.prepare(`
      INSERT INTO pdf_slicer_annotation_regions (
        id, session_id, source_run_id, kind, question_key, question_label, question_keys_json, segments_json, sort_order, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const [index, r] of regions.entries()) {
      const qKey = r.kind === 'shared_answer_key' ? '' : normalizedReviewQuestionNo(r.questionLabel || '')
      if (r.kind !== 'shared_answer_key' && !qKey) {
        throw new Error('题干或解析区域必须填写有效题号。')
      }
      const qKeys = Array.isArray(r.questionKeys) ? r.questionKeys : []
      insert.run(
        r.id || createId('reg'),
        sessionId,
        r.sourceRunId,
        r.kind,
        qKey,
        r.questionLabel || '',
        JSON.stringify(qKeys),
        JSON.stringify(r.segments || []),
        r.sortOrder !== undefined ? r.sortOrder : index,
        r.note || '',
        r.createdAt || now,
        now
      )
    }

    db.prepare('UPDATE pdf_slicer_annotation_sessions SET revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(now, sessionId)
  })

  return getSession(sessionId)!
}

export function renderRunPage(runId: string, pageNum: number): string {
  const run = db.prepare('SELECT pdf_path, run_dir FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as any
  if (!run) {
    throw new Error('批次文件不存在。')
  }

  const pdfPath = resolveStoragePath(run.pdf_path)
  const runDir = resolveStoragePath(run.run_dir)
  const pagePngDir = path.join(runDir, 'output', 'annotation-pages')
  const pagePngPath = path.join(pagePngDir, `page_${pageNum}.png`)

  if (!fs.existsSync(pagePngPath)) {
    fs.mkdirSync(pagePngDir, { recursive: true })
    const scriptPath = path.join(pythonRoot, 'scripts', 'render_pdf_page.py')
    try {
      execFileSync(pythonCommand(), [scriptPath, pdfPath, String(pageNum), pagePngPath, '--dpi', '150'], {
        env: pythonEnv(),
        encoding: 'utf8',
        timeout: 10000
      })
    } catch (err) {
      console.error(`Failed to render PDF page via Python script:`, err)
      throw new Error(`页面渲染失败：无法使用 PyMuPDF 渲染 PDF 第 ${pageNum} 页。`)
    }
  }

  return assetPathFor(pagePngPath)
}

export function validateSession(sessionId: string): { errors: string[]; warnings: string[] } {
  const regions = getRegionsForSession(sessionId)
  const errors: string[] = []
  const warnings: string[] = []

  const questions = regions.filter((r) => r.kind === 'question')
  const solutions = regions.filter((r) => r.kind === 'solution')
  const sharedKeys = regions.filter((r) => r.kind === 'shared_answer_key')

  if (questions.length === 0) {
    errors.push('原卷中没有标注任何题目（题干）。请至少标注一个题目。')
  }

  // Keep track of normalized keys to check duplicates
  const qKeysSeen = new Set<string>()
  const qLabelsMap = new Map<string, string>()

  for (const q of questions) {
    if (!q.questionLabel) {
      errors.push(`题目区域 [${q.id.slice(-6)}] 未填写题号。`)
      continue
    }
    if (!q.segments || q.segments.length === 0) {
      errors.push(`题目 ${q.questionLabel} 没有定义任何选区。`)
    }
    for (const seg of q.segments || []) {
      if (seg.x < 0 || seg.x > 1 || seg.y < 0 || seg.y > 1 || seg.width <= 0 || seg.height <= 0) {
        errors.push(`题目 ${q.questionLabel} 的选区坐标超出范围或大小为零。`)
      }
    }

    if (qKeysSeen.has(q.questionKey)) {
      errors.push(`重复的题号："${q.questionLabel}" 和 "${qLabelsMap.get(q.questionKey)}" 的规范化题号相同。`)
    } else {
      qKeysSeen.add(q.questionKey)
      qLabelsMap.set(q.questionKey, q.questionLabel)
    }
  }

  for (const s of solutions) {
    if (!s.questionLabel) {
      errors.push(`解析区域 [${s.id.slice(-6)}] 未填写关联题号。`)
      continue
    }
    if (!s.segments || s.segments.length === 0) {
      errors.push(`题号 ${s.questionLabel} 的解析没有定义任何选区。`)
    }
    // Check if solution has corresponding question
    if (!qKeysSeen.has(s.questionKey)) {
      warnings.push(`解析区域 "${s.questionLabel}" 没有在原卷中找到对应的题目。`)
    }
  }

  for (const q of questions) {
    // Check if question has corresponding solution
    const hasSol = solutions.some((s) => s.questionKey === q.questionKey)
    if (!hasSol) {
      warnings.push(`题目 "${q.questionLabel}" 缺失对应的解析标注选区。`)
    }
  }

  for (const sk of sharedKeys) {
    if (!sk.questionKeys || sk.questionKeys.length === 0) {
      errors.push(`公共答案选区 [${sk.id.slice(-6)}] 未关联任何题号。`)
    }
    for (const key of sk.questionKeys || []) {
      const normKey = normalizedReviewQuestionNo(key)
      if (!qKeysSeen.has(normKey)) {
        warnings.push(`公共答案区关联的题号 "${key}" 不存在于原卷标注的题目中。`)
      }
    }
  }

  // Check sequence continuity
  const numbers = Array.from(qKeysSeen)
    .map((k) => Number(k))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b)
  if (numbers.length > 0) {
    const min = numbers[0]
    const max = numbers[numbers.length - 1]
    const missing: number[] = []
    for (let i = min; i <= max; i++) {
      if (!numbers.includes(i)) {
        missing.push(i)
      }
    }
    if (missing.length > 0) {
      warnings.push(`标注的题号序列不连续，缺失题号：${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`)
    }
  }

  return { errors, warnings }
}

export function finalizeSession(sessionId: string): void {
  const session = getSession(sessionId)
  if (!session) {
    throw new Error('标注会话不存在。')
  }
  if (session.status !== 'draft') {
    throw new Error('只能提交草稿状态的标注会话。')
  }

  const { errors } = validateSession(sessionId)
  if (errors.length > 0) {
    throw new Error(`校验未通过，阻断性错误：\n${errors.join('\n')}`)
  }

  const batchId = session.batchId
  const regions = session.regions || []
  const questions = regions.filter((region) => region.kind === 'question')
  const sourceRuns = db.prepare('SELECT * FROM pdf_slicer_runs WHERE batch_id = ?').all(batchId) as any[]
  const sourceRunById = new Map(sourceRuns.map((run) => [run.run_id, run]))
  const primarySourceRun = sourceRunById.get(questions[0]?.sourceRunId)
  if (!primarySourceRun) {
    throw new Error('未找到原卷题干所关联的源文件。')
  }

  // Every finalization materializes a new processing run. Source PDFs remain
  // immutable evidence and previous OCR runs are never deleted or overwritten.
  const processingRunId = createId('run', 'manual_annotation')
  const processingRunDir = path.join(runsRoot, processingRunId)
  const processingOutputDir = path.join(processingRunDir, 'output')
  fs.mkdirSync(processingOutputDir, { recursive: true })

  // Group regions by sourceRunId
  const runRegionsMap = new Map<string, AnnotationRegion[]>()
  for (const r of regions) {
    if (!runRegionsMap.has(r.sourceRunId)) {
      runRegionsMap.set(r.sourceRunId, [])
    }
    runRegionsMap.get(r.sourceRunId)!.push(r)
  }

  const croppedResults = new Map<string, any>()

  // 1. Perform crop and stitch outside DB transaction to avoid locking DB too long
  for (const [runId, runRegions] of runRegionsMap.entries()) {
    const run = sourceRunById.get(runId)
    if (!run) {
      throw new Error(`标注涉及的文件批次 ${runId} 不存在。`)
    }
    const pdfPath = resolveStoragePath(run.pdf_path)
    const tempJsonFile = path.join(processingOutputDir, `manual_crop_input_${sessionId}_${runId}.json`)
    fs.writeFileSync(tempJsonFile, JSON.stringify(runRegions.map(r => ({
      id: r.id,
      kind: r.kind,
      question_key: r.questionKey,
      question_label: r.questionLabel,
      segments: r.segments
    }))))

    const scriptPath = path.join(pythonRoot, 'scripts', 'crop_manual_annotation.py')
    try {
      const outputStr = execFileSync(pythonCommand(), [
        scriptPath,
        '--pdf', pdfPath,
        '--regions-json-file', tempJsonFile,
        '--output-dir', processingOutputDir,
        '--dpi', '180'
      ], {
        env: pythonEnv(),
        encoding: 'utf8',
        timeout: 60000 // 1 min max
      })
      const resultObj = JSON.parse(outputStr)
      if (resultObj.error) {
        throw new Error(resultObj.error)
      }
      for (const item of resultObj.results || []) {
        if (item.error) {
          throw new Error(`剪裁题号 ${item.questionKey} 失败：${item.error}`)
        }
        croppedResults.set(item.regionId, item)
      }
    } catch (err) {
      console.error(`Crop failed for run ${runId}:`, err)
      throw new Error(`物理图片裁切失败，请检查标注区域范围。原因为：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      try {
        fs.unlinkSync(tempJsonFile)
      } catch {}
    }
  }

  const uncroppedQuestions = questions.filter((question) => !croppedResults.has(question.id))
  if (uncroppedQuestions.length) {
    throw new Error(`以下题干区域没有生成裁图：${uncroppedQuestions.map((question) => question.questionLabel || question.id).join('、')}`)
  }

  // 2. Perform DB operations in a transaction
  withTransaction(() => {
    const now = nowIso()
    const sourceDiagnostics = parseJson<Record<string, any>>(primarySourceRun.document_diagnostics_json || '{}', {})
    const diagnostics = {
      ...sourceDiagnostics,
      manualAnnotation: {
        sessionId,
        revision: session.revision,
        sourceRunIds: Array.from(runRegionsMap.keys()),
        materializedAt: now,
      },
    }
    db.prepare(`
      INSERT INTO pdf_slicer_runs (
        run_id, batch_id, upload_mode, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind, run_dir, document_diagnostics_json,
        material_type, file_role, stage, classification_confidence, classification_reasons_json,
        created_at, updated_at, slice_status, quick_review_status, total_questions, approved_questions, unreviewed_questions, ocr_status,
        rules_version, rules_hash, rules_fallback_used, rules_warnings_json
      ) VALUES (?, ?, 'manual_annotation', ?, ?, ?, ?, ?, ?, ?, ?, 'full', ?, ?, ?, ?, ?, 'succeeded', 'pending', ?, 0, ?, 'idle', ?, ?, ?, ?)
    `).run(
      processingRunId,
      batchId,
      primarySourceRun.paper_title,
      primarySourceRun.pdf_name,
      primarySourceRun.pdf_path,
      primarySourceRun.source_file_name,
      primarySourceRun.source_file_kind,
      assetPathFor(processingRunDir),
      JSON.stringify(diagnostics),
      primarySourceRun.material_type,
      primarySourceRun.stage,
      primarySourceRun.classification_confidence,
      primarySourceRun.classification_reasons_json,
      now,
      now,
      questions.length,
      questions.length,
      primarySourceRun.rules_version || 0,
      primarySourceRun.rules_hash || '',
      primarySourceRun.rules_fallback_used || 0,
      primarySourceRun.rules_warnings_json || '[]',
    )

    const insertReview = db.prepare(`
      INSERT INTO pdf_slicer_review_items (
        result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'pending_review', ?, ?, ?)
    `)

    const insertSolution = db.prepare(`
      INSERT INTO pdf_slicer_solution_items (
        id, batch_id, source_run_id, question_no, answer_text, analysis_markdown, figures_json, source_image_path, match_status, matched_question_id, match_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', '[]', ?, ?, '', ?, ?, ?)
    `)

    // Insert questions (review items)
    for (const q of questions) {
      const crop = croppedResults.get(q.id)
      if (!crop) continue

      const firstSeg = q.segments[0]
      const lastSeg = q.segments[q.segments.length - 1]
      const pageStart = firstSeg ? firstSeg.page : 1
      const pageEnd = lastSeg ? lastSeg.page : 1
      const imgPath = assetPathFor(crop.imagePath)

      insertReview.run(
        `${processingRunId}_${q.id}`,
        processingRunId,
        q.questionLabel,
        pageStart,
        pageEnd,
        imgPath,
        imgPath,
        JSON.stringify(crop.firstBbox || [0,0,0,0]),
        JSON.stringify(q.segments),
        q.note,
        now,
        now
      )

    }

    // Insert solutions (solution items)
    const solutions = regions.filter((r) => r.kind === 'solution')
    for (const s of solutions) {
      const crop = croppedResults.get(s.id)
      if (!crop) continue

      const imgPath = assetPathFor(crop.imagePath)

      insertSolution.run(
        `${processingRunId}_${s.id}`,
        batchId,
        processingRunId,
        s.questionLabel,
        '',
        imgPath,
        'pending',
        `人工框选解析（源文件：${s.sourceRunId}）。${s.note || ''}`,
        now,
        now
      )
    }

    // Insert shared answer keys as supplementary sources for each referenced question
    const sharedKeys = regions.filter((r) => r.kind === 'shared_answer_key')
    for (const sk of sharedKeys) {
      const crop = croppedResults.get(sk.id)
      if (!crop) continue

      const imgPath = assetPathFor(crop.imagePath)
      for (const qLabel of sk.questionKeys) {
        insertSolution.run(
          `${processingRunId}_${sk.id}_${normalizedReviewQuestionNo(qLabel)}`,
          batchId,
          processingRunId,
          qLabel,
          '',
          imgPath,
          'pending',
          `公共答案区（源文件：${sk.sourceRunId}；备注：${sk.note || '无'}）。`,
          now,
          now
        )
      }
    }

    // Finalize session
    db.prepare(`
      UPDATE pdf_slicer_annotation_sessions
      SET status = 'finalized', finalized_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, sessionId)

    // Mark other draft/ready sessions in the same batch as superseded
    db.prepare(`
      UPDATE pdf_slicer_annotation_sessions
      SET status = 'superseded', updated_at = ?
      WHERE batch_id = ? AND id != ? AND status IN ('draft', 'ready')
    `).run(now, batchId, sessionId)

    updateBatchWorkflow(batchId)
  })
}

export function reviseSession(sessionId: string): AnnotationSession {
  const session = getSession(sessionId)
  if (!session) {
    throw new Error('标注会话不存在。')
  }

  const now = nowIso()
  let nextSessionId = ''

  withTransaction(() => {
    // Check if there is already a draft session for this batch
    const existing = db.prepare('SELECT id FROM pdf_slicer_annotation_sessions WHERE batch_id = ? AND status = ?').get(session.batchId, 'draft') as any
    if (existing) {
      nextSessionId = existing.id
      return
    }

    // Create new draft session incrementing revision
    const nextRevision = session.revision + 1
    nextSessionId = createId('sess')

    db.prepare(`
      INSERT INTO pdf_slicer_annotation_sessions (id, batch_id, revision, status, source_profile_json, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', ?, ?, ?)
    `).run(nextSessionId, session.batchId, nextRevision, session.sourceProfileJson, now, now)

    // Copy regions from original session to the new session
    const oldRegions = getRegionsForSession(sessionId)
    const insert = db.prepare(`
      INSERT INTO pdf_slicer_annotation_regions (
        id, session_id, source_run_id, kind, question_key, question_label, question_keys_json, segments_json, sort_order, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const r of oldRegions) {
      insert.run(
        createId('reg'),
        nextSessionId,
        r.sourceRunId,
        r.kind,
        r.questionKey,
        r.questionLabel,
        JSON.stringify(r.questionKeys),
        JSON.stringify(r.segments),
        r.sortOrder,
        r.note,
        now,
        now
      )
    }
  })

  return getSession(nextSessionId)!
}
