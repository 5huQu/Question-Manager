import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { getReviewItems, normalizedReviewQuestionNo, syncReviewRunCounts } from '../../db/review.js'
import { getRun } from '../../db/runs.js'
import { nowIso } from '../../utils/ids.js'
import { mergeReviewImages, splitReviewImage } from '../../utils/figure-helpers.js'
import { resolveStoragePath, stripAssetPrefix } from '../../utils/paths.js'
import { parseJson } from '../../utils/json.js'
import { startMigratedOcrBackground, materializeReviewFigures } from '../../services/pdf-slicer/ocr.js'
import type { ReviewRow } from '../../types/index.js'
import { activeOcrProcesses } from '../../types/index.js'

const REVIEW_FIGURE_CROP_VERSION = 'review-slice-layout-v2'

function processAndCompareFigures(
  newRawFigures: any[],
  oldFigures: any[],
  runId: string,
  itemId: string,
  source: 'question' | 'solution',
  sourceImagePath: string,
) {
  let stemIndex = 0
  let analysisIndex = 0

  return newRawFigures
    .map((figure, index) => {
      const formulaSuspect = Boolean(figure.formula_suspect ?? figure.formulaSuspect)
      const formulaSuspectReason = String(figure.formula_suspect_reason ?? figure.formulaSuspectReason ?? '')
      const id = String(figure.id || `${source}_fig_${index + 1}`)
      const usage = String(figure.usage || figure.category || (source === 'solution' ? 'analysis' : 'stem'))
      const page_number = Number(figure.page_number ?? figure.pageNumber ?? 1)
      const optionLabel = figure.optionLabel ? String(figure.optionLabel).toUpperCase() : undefined

      const bbox = {
        x: Number(figure.bbox?.x || figure.reviewBBox?.x || 0),
        y: Number(figure.bbox?.y || figure.reviewBBox?.y || 0),
        width: Number(figure.bbox?.width || figure.reviewBBox?.width || 0),
        height: Number(figure.bbox?.height || figure.reviewBBox?.height || 0),
      }

      let attachmentId = ''
      if (usage === 'analysis') {
        analysisIndex += 1
        attachmentId = `A${analysisIndex}`
      } else {
        stemIndex += 1
        attachmentId = `F${stemIndex}`
      }

      const oldFig = oldFigures.find((o) => String(o.id) === id)
      let assetPath = oldFig?.assetPath || ''
      let assetHash = oldFig?.assetHash || ''
      let assetVersion = Number(oldFig?.assetVersion || 1)
      let ocrBindingStatus = 'pending_render'
      const createdAt = oldFig?.createdAt || nowIso()

      if (oldFig) {
        const oldBbox = oldFig.reviewBBox || oldFig.bbox || {}
        const isBboxEqual =
          Math.abs(oldBbox.x - bbox.x) < 0.0001 &&
          Math.abs(oldBbox.y - bbox.y) < 0.0001 &&
          Math.abs(oldBbox.width - bbox.width) < 0.0001 &&
          Math.abs(oldBbox.height - bbox.height) < 0.0001

        const isUsageEqual = oldFig.usage === usage && oldFig.optionLabel === optionLabel
        const isPageEqual = Number(oldFig.pageNumber ?? oldFig.page_number) === page_number

        const hasCurrentCropVersion = oldFig.cropVersion === REVIEW_FIGURE_CROP_VERSION
        if (isBboxEqual && isUsageEqual && isPageEqual && hasCurrentCropVersion) {
          ocrBindingStatus = oldFig.ocrBinding?.status || 'ready'
        } else {
          assetVersion += 1
          assetPath = ''
          assetHash = ''
          ocrBindingStatus = 'pending_render'
        }
      }

      return {
        id,
        origin: 'review_manual',
        usage,
        category: usage,
        optionLabel,
        source,
        sourceRunId: runId,
        sourceItemId: itemId,
        // The review editor stores coordinates in the coordinate system of
        // the reviewed slice. Keep that slice as the authoritative crop
        // source: it also covers answer PDFs and manually merged/split items.
        sourceImagePath: stripAssetPrefix(sourceImagePath),
        pageNumber: page_number,
        page_number,
        reviewBBox: bbox,
        bbox,
        kind: String(figure.kind || 'image'),
        formula_suspect: formulaSuspect,
        formulaSuspect,
        formula_suspect_reason: formulaSuspectReason || undefined,
        formulaSuspectReason: formulaSuspectReason || undefined,
        assetPath,
        path: assetPath,
        assetHash,
        assetVersion,
        cropVersion: oldFig?.cropVersion === REVIEW_FIGURE_CROP_VERSION ? REVIEW_FIGURE_CROP_VERSION : undefined,
        ocrBinding: {
          enabled: true,
          attachmentId,
          targetField: usage === 'options' ? 'options' : usage,
          status: ocrBindingStatus,
        },
        createdAt,
        updatedAt: nowIso(),
      }
    })
    .filter((figure) => figure.pageNumber > 0 && figure.reviewBBox.width > 0 && figure.reviewBBox.height > 0)
}

export function mountReviewRoutes(app: Express) {
  app.get('/api/tools/pdf-slicer/runs/:runId/slice-review/items', (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const items = getReviewItems(run.runId)
    res.json({ summary: { totalItems: items.length, pendingCount: items.filter((item) => item.reviewStatus === 'pending_review').length }, items })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/slice-review/items/merge', async (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const requestedIds: string[] = Array.isArray(req.body?.resultIds) ? req.body.resultIds.map(String).filter(Boolean) : []
    const uniqueIds = Array.from(new Set(requestedIds))
    if (uniqueIds.length < 2) {
      res.status(400).json({ error: '请至少选择两个题块进行合并。' })
      return
    }
    const rows = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ?').all(run.runId) as ReviewRow[]
    const rowById = new Map(rows.map((row) => [row.result_id, row]))
    const selectedRows = uniqueIds.map((id) => rowById.get(id)).filter(Boolean) as ReviewRow[]
    if (selectedRows.length !== uniqueIds.length) {
      res.status(404).json({ error: '部分题块不存在，无法合并。' })
      return
    }
    const sources = selectedRows.map((row) => stripAssetPrefix(row.auto_image_path || row.page_image_path))
    const sourceAbs = sources.map((source) => resolveStoragePath(source))
    if (sourceAbs.some((source) => !fs.existsSync(source))) {
      res.status(404).json({ error: '部分题块图片不存在，无法合并。' })
      return
    }
    const keep = selectedRows[0]
    const now = nowIso()
    const suffix = Date.now().toString(36)
    const base = keep.result_id.replace(/[^\w.-]+/g, '_')
    const mergeDirRel = path.join(stripAssetPrefix(run.runDir), 'output', 'manual_merges')
    const mergedRel = path.join(mergeDirRel, `${base}_${suffix}_merged.png`)
    let imageInfo: { width: number; height: number; parts: Array<Record<string, any>> }
    try {
      imageInfo = await mergeReviewImages(sourceAbs, resolveStoragePath(mergedRel))
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
      return
    }
    const bbox = { x: 0, y: 0, width: imageInfo.width, height: imageInfo.height }
    const removeIds = selectedRows.slice(1).map((row) => row.result_id)
    db.prepare(`
      UPDATE pdf_slicer_review_items
      SET page_start = ?, page_end = ?, page_image_path = ?, auto_image_path = ?, bbox_json = ?, segments_json = ?, text_regions_json = '[]', figures_json = '[]', review_status = 'pending_review', note = ?, updated_at = ?
      WHERE run_id = ? AND result_id = ?
    `).run(
      Math.min(...selectedRows.map((row) => row.page_start)),
      Math.max(...selectedRows.map((row) => row.page_end)),
      mergedRel,
      mergedRel,
      JSON.stringify(bbox),
      JSON.stringify([{ page_number: keep.page_start, page_image_path: mergedRel, bbox }]),
      JSON.stringify({ mergedFrom: uniqueIds, sourceImagePaths: sources, parts: imageInfo.parts }),
      now,
      run.runId,
      keep.result_id,
    )
    const deleteMerged = db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    for (const id of removeIds) deleteMerged.run(run.runId, id)
    const { items, pending } = syncReviewRunCounts(run.runId)
    res.json({ run: getRun(run.runId), summary: { totalItems: items.length, pendingCount: pending }, items, mergedId: keep.result_id, removedIds: removeIds })
  })

  app.delete('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId', (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const resultId = decodeURIComponent(req.params.resultId)
    const existing = db.prepare('SELECT result_id FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as { result_id: string } | undefined
    if (!existing) {
      res.status(404).json({ error: '题块不存在。' })
      return
    }
    db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').run(run.runId, resultId)
    const { items, pending } = syncReviewRunCounts(run.runId)
    res.json({ deleted: true, run: getRun(run.runId), summary: { totalItems: items.length, pendingCount: pending }, items })
  })

  app.patch('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId', (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const resultId = decodeURIComponent(req.params.resultId)
    const questionLabel = String(req.body?.questionLabel ?? '').trim().slice(0, 40)
    if (!questionLabel) {
      res.status(400).json({ error: '题块名称不能为空。' })
      return
    }
    const existing = db.prepare('SELECT result_id FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as { result_id: string } | undefined
    if (!existing) {
      res.status(404).json({ error: '题块不存在。' })
      return
    }
    db.prepare('UPDATE pdf_slicer_review_items SET question_label = ?, updated_at = ? WHERE run_id = ? AND result_id = ?')
      .run(questionLabel, nowIso(), run.runId, resultId)
    const item = getReviewItems(run.runId).find((entry) => entry.resultId === resultId)
    res.json({ item })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId/split', async (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const resultId = decodeURIComponent(req.params.resultId)
    const splitRatio = Number(req.body?.splitRatio)
    if (!Number.isFinite(splitRatio) || splitRatio <= 0.08 || splitRatio >= 0.92) {
      res.status(400).json({ error: '分割线位置无效。' })
      return
    }
    const row = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as ReviewRow | undefined
    if (!row) {
      res.status(404).json({ error: '题块不存在。' })
      return
    }
    const sourceRel = stripAssetPrefix(row.auto_image_path || row.page_image_path)
    const sourceAbs = resolveStoragePath(sourceRel)
    if (!sourceRel || !fs.existsSync(sourceAbs)) {
      res.status(404).json({ error: '题块图片不存在，无法细分。' })
      return
    }
    const now = nowIso()
    const base = path.basename(sourceRel, path.extname(sourceRel)).replace(/[^\w.-]+/g, '_') || resultId.replace(/[^\w.-]+/g, '_')
    const splitDirRel = path.join(stripAssetPrefix(run.runDir), 'output', 'manual_splits')
    const suffix = Date.now().toString(36)
    const topRel = path.join(splitDirRel, `${base}_${suffix}_top.png`)
    const bottomRel = path.join(splitDirRel, `${base}_${suffix}_bottom.png`)
    let imageInfo: { width: number; height: number; splitY: number; topHeight: number; bottomHeight: number }
    try {
      imageInfo = await splitReviewImage(sourceAbs, resolveStoragePath(topRel), resolveStoragePath(bottomRel), splitRatio)
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
      return
    }
    const label = row.question_label || '?'
    const topLabel = String(req.body?.topLabel || label).trim().slice(0, 40) || label
    const bottomLabel = String(req.body?.bottomLabel || `${label}-2`).trim().slice(0, 40) || `${label}-2`
    const topBBox = { x: 0, y: 0, width: imageInfo.width, height: imageInfo.topHeight }
    const bottomBBox = { x: 0, y: 0, width: imageInfo.width, height: imageInfo.bottomHeight }
    const bottomId = `${resultId}__split_${suffix}`
    const insert = db.prepare(`
      INSERT INTO pdf_slicer_review_items (
        result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    db.prepare(`
      UPDATE pdf_slicer_review_items
      SET question_label = ?, page_image_path = ?, auto_image_path = ?, bbox_json = ?, segments_json = ?, text_regions_json = '[]', figures_json = '[]', review_status = 'pending_review', note = ?, updated_at = ?
      WHERE run_id = ? AND result_id = ?
    `).run(
      topLabel,
      topRel,
      topRel,
      JSON.stringify(topBBox),
      JSON.stringify([{ page_number: row.page_start, page_image_path: topRel, bbox: topBBox }]),
      JSON.stringify({ splitFrom: resultId, splitPart: 'top', originalImagePath: sourceRel, splitRatio }),
      now,
      run.runId,
      resultId,
    )
    insert.run(
      bottomId,
      run.runId,
      bottomLabel,
      row.page_start,
      row.page_end,
      bottomRel,
      bottomRel,
      JSON.stringify(bottomBBox),
      JSON.stringify([{ page_number: row.page_start, page_image_path: bottomRel, bbox: bottomBBox }]),
      '[]',
      '[]',
      'pending_review',
      JSON.stringify({ splitFrom: resultId, splitPart: 'bottom', originalImagePath: sourceRel, splitRatio }),
      now,
      now,
    )
    const { items, pending } = syncReviewRunCounts(run.runId)
    res.json({ run: getRun(run.runId), summary: { totalItems: items.length, pendingCount: pending }, items, topId: resultId, bottomId })
  })

  app.patch('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId/figures', (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const resultId = decodeURIComponent(req.params.resultId)
    const existing = db.prepare('SELECT result_id FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as { result_id: string } | undefined
    if (!existing) {
      res.status(404).json({ error: '题块不存在。' })
      return
    }
    try {
      const oldRow = db.prepare('SELECT figures_json, auto_image_path, page_image_path FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as { figures_json: string; auto_image_path: string; page_image_path: string } | undefined
      const oldFigures = parseJson<any[]>(oldRow?.figures_json || '[]', [])
      const figures = processAndCompareFigures(
        Array.isArray(req.body?.figures) ? req.body.figures : [],
        oldFigures,
        run.runId,
        resultId,
        'question',
        oldRow?.auto_image_path || oldRow?.page_image_path || '',
      )
      db.prepare('UPDATE pdf_slicer_review_items SET figures_json = ?, updated_at = ? WHERE run_id = ? AND result_id = ?')
        .run(JSON.stringify(figures), nowIso(), run.runId, resultId)
      const item = getReviewItems(run.runId).find((entry) => entry.resultId === resultId)
      res.json({ item })
    } catch (error) {
      console.error('保存题干图框失败:', error)
      res.status(500).json({ error: `保存题干图框失败：${error instanceof Error ? error.message : String(error)}` })
    }
  })

  app.patch('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId/solution-figures', (req, res) => {
    const run = getRun(req.params.runId)
    if (!run) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const resultId = decodeURIComponent(req.params.resultId)
    const reviewRow = db.prepare('SELECT question_label FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as { question_label: string } | undefined
    if (!reviewRow) {
      res.status(404).json({ error: '题块不存在。' })
      return
    }
    const key = normalizedReviewQuestionNo(reviewRow.question_label)
    const solutions = db.prepare('SELECT id, question_no FROM pdf_slicer_solution_items WHERE source_run_id = ? ORDER BY created_at ASC').all(run.runId) as Array<{ id: string; question_no: string }>
    const solution = solutions.find((row) => normalizedReviewQuestionNo(row.question_no) === key)
    if (!solution) {
      res.status(404).json({ error: '当前题块没有匹配的解析裁图。' })
      return
    }
    const oldRow = db.prepare('SELECT figures_json, source_image_path FROM pdf_slicer_solution_items WHERE id = ? AND source_run_id = ?').get(solution.id, run.runId) as { figures_json: string; source_image_path: string } | undefined
    const oldFigures = parseJson<any[]>(oldRow?.figures_json || '[]', [])
    const figures = processAndCompareFigures(
      Array.isArray(req.body?.figures) ? req.body.figures : [],
      oldFigures,
      run.runId,
      solution.id,
      'solution',
      oldRow?.source_image_path || '',
    )
    db.prepare('UPDATE pdf_slicer_solution_items SET figures_json = ?, updated_at = ? WHERE id = ? AND source_run_id = ?')
      .run(JSON.stringify(figures), nowIso(), solution.id, run.runId)
    const item = getReviewItems(run.runId).find((entry) => entry.resultId === resultId)
    res.json({ item })
  })

  app.post('/api/tools/pdf-slicer/runs/:runId/review-figures/materialize', async (req, res) => {
    try {
      const runId = req.params.runId
      await materializeReviewFigures(runId)
      res.json({ success: true })
    } catch (err) {
      console.error('物化裁剪失败:', err)
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })


  app.post('/api/tools/pdf-slicer/runs/quick-review', (req, res) => {
    const runId = String(req.body?.runId || '')
    if (!getRun(runId)) {
      res.status(404).json({ error: '批次不存在。' })
      return
    }
    const approved = Array.isArray(req.body?.approvedResultIds) ? req.body.approvedResultIds.length : 0
    const approvedIds = new Set(Array.isArray(req.body?.approvedResultIds) ? req.body.approvedResultIds.map(String) : [])
    const reviewItems = getReviewItems(runId)
    const updateReview = db.prepare('UPDATE pdf_slicer_review_items SET review_status = ?, updated_at = ? WHERE result_id = ?')
    for (const item of reviewItems) {
      updateReview.run(approvedIds.has(item.resultId) ? 'ready_for_ocr' : 'pending_review', nowIso(), item.resultId)
    }
    db.prepare("UPDATE pdf_slicer_runs SET quick_review_status = 'submitted', approved_questions = ?, unreviewed_questions = MAX(total_questions - ?, 0), updated_at = ? WHERE run_id = ?")
      .run(approved, approved, nowIso(), runId)
    let ocrStarted = false
    let ocrStartError = ''
    const nextRun = getRun(runId)
    const autoStartOcr = req.body?.autoStartOcr !== false
    const canAutoStartOcr = autoStartOcr && approved > 0 && nextRun && !activeOcrProcesses.has(runId) && ['idle', 'failed'].includes(nextRun.ocrStatus)
    if (canAutoStartOcr) {
      const startedAt = nowIso()
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
        .run(startedAt, startedAt, runId)
      try {
        startMigratedOcrBackground(runId)
        ocrStarted = true
      } catch (error) {
        ocrStartError = error instanceof Error ? error.message : String(error)
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
          .run(`复核已提交，但自动 OCR 启动失败：${ocrStartError}`, nowIso(), nowIso(), runId)
      }
    }
    res.json({ ...getRun(runId), ocrStarted, ocrStartError })
  })
}
