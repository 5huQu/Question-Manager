import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { db } from '../../db/connection.js'
import { dataDir, pythonRoot } from '../../config.js'
import { pythonCommand, pythonEnv } from '../settings/python.js'
import { getRegionsForSession } from '../pdf-slicer/annotations.service.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import { resolveStoragePath } from '../../utils/paths.js'
import { loadOcrDocument } from './ocr-document.service.js'

function solutionSourceDocumentIdForCandidateSource(sourceDocumentId: string) {
  const row = db.prepare(`
    SELECT solution_doc.source_document_id AS source_document_id
    FROM import_job_documents current_doc
    JOIN import_jobs job ON job.id = current_doc.job_id
    JOIN import_job_documents solution_doc ON solution_doc.job_id = job.id AND solution_doc.role = 'solutions'
    WHERE current_doc.source_document_id = ?
      AND job.mode = 'separated_documents'
    ORDER BY job.updated_at DESC, job.created_at DESC, solution_doc.sort_order ASC
    LIMIT 1
  `).get(sourceDocumentId) as { source_document_id?: string } | undefined
  return row?.source_document_id || ''
}

export function renderSourceDocumentPage(sourceDocumentId: string, pageNum: number): string {
  const doc = sourceRepo.getSourceDocument(sourceDocumentId)
  if (!doc) {
    throw new RouteError(404, '源资料文件不存在。')
  }
  const pdfPath = resolveStoragePath(doc.filePath)
  const pagePngDir = path.join(dataDir, 'import-flow-v2', 'source-documents', sourceDocumentId, 'annotation-pages')
  const pagePngPath = path.join(pagePngDir, `page_${pageNum}.png`)

  if (!fs.existsSync(pagePngPath)) {
    fs.mkdirSync(pagePngDir, { recursive: true })
    const scriptPath = path.join(pythonRoot, 'scripts', 'render_pdf_page.py')
    try {
      execFileSync(pythonCommand(), [scriptPath, pdfPath, String(pageNum), pagePngPath, '--dpi', '150'], {
        env: pythonEnv(),
        encoding: 'utf8',
        timeout: 15000
      })
    } catch (err) {
      const execError = err as { stdout?: unknown; stderr?: unknown; message?: string }
      const stdout = Buffer.isBuffer(execError.stdout) ? execError.stdout.toString('utf8') : String(execError.stdout || '')
      const stderr = Buffer.isBuffer(execError.stderr) ? execError.stderr.toString('utf8') : String(execError.stderr || '')
      const reason = (stderr || stdout || execError.message || String(err)).trim()
      console.error(`Failed to render PDF page via Python script:`, reason || err)
      throw new RouteError(500, `页面渲染失败：无法使用 PyMuPDF 渲染 PDF 第 ${pageNum} 页。${reason ? `原因：${reason}` : ''}`)
    }
  }
  return pagePngPath
}

export function createOrRestoreCandidateManualFixSession(candidateId: string) {
  const candidate = candidateRepo.getQuestionCandidate(candidateId)
  if (!candidate) {
    throw new RouteError(404, '候选题不存在。')
  }
  if (candidate.status === 'committed') {
    throw new RouteError(403, '已入库的候选题不允许进行修正。')
  }
  const currentCandidate = candidate

  const sourceDocument = sourceRepo.getSourceDocument(currentCandidate.sourceDocumentId)
  if (!sourceDocument) {
    throw new RouteError(404, '源资料文件不存在。')
  }
  const solutionSourceDocumentId = solutionSourceDocumentIdForCandidateSource(currentCandidate.sourceDocumentId)
  const sourceDocumentIds = Array.from(new Set([currentCandidate.sourceDocumentId, solutionSourceDocumentId].filter(Boolean)))
  const pageSizeBySourceAndPage = new Map<string, Map<number, { width: number; height: number }>>()
  for (const sourceDocumentId of sourceDocumentIds) {
    const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId, limit: 1 })
    const pageSizeByPage = new Map<number, { width: number; height: number }>()
    if (ocrDocument) {
      try {
        const document = loadOcrDocument(ocrDocument.id)
        for (const page of document.pages) {
          pageSizeByPage.set(page.pageNo, { width: page.width, height: page.height })
        }
      } catch {
        // Existing manual-fix sessions should still be restorable if OCR artifacts are missing.
      }
    }
    pageSizeBySourceAndPage.set(sourceDocumentId, pageSizeByPage)
  }
  const normalizeBBoxSegment = (sourceDocumentId: string, pageNo: number, bbox: [number, number, number, number] | undefined) => {
    if (!bbox) return null
    const pageSize = pageSizeBySourceAndPage.get(sourceDocumentId)?.get(pageNo)
    const rawWidth = bbox[2] - bbox[0]
    const rawHeight = bbox[3] - bbox[1]
    if (rawWidth <= 0 || rawHeight <= 0) return null
    const alreadyRelative = bbox.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    const segment = alreadyRelative
      ? { page: pageNo, x: bbox[0], y: bbox[1], width: rawWidth, height: rawHeight }
      : pageSize && pageSize.width > 0 && pageSize.height > 0
        ? {
            page: pageNo,
            x: bbox[0] / pageSize.width,
            y: bbox[1] / pageSize.height,
            width: rawWidth / pageSize.width,
            height: rawHeight / pageSize.height,
          }
        : null
    if (!segment) return null
    return segment.x >= 0 && segment.y >= 0 && segment.width > 0 && segment.height > 0 && segment.x + segment.width <= 1 && segment.y + segment.height <= 1
      ? segment
      : null
  }

  const sessionId = `sess_candidate_${currentCandidate.id}`
  const existing = db.prepare('SELECT * FROM pdf_slicer_annotation_sessions WHERE id = ?').get(sessionId) as any
  const profileForSourceDocument = (item: typeof sourceDocument) => ({
    pageCount: item.pageCount,
    pdfName: item.originalFileName
  })
  const profiles = {
    [currentCandidate.sourceDocumentId]: profileForSourceDocument(sourceDocument),
    ...(solutionSourceDocumentId
      ? (() => {
          const solutionSource = sourceRepo.getSourceDocument(solutionSourceDocumentId)
          return solutionSource ? { [solutionSourceDocumentId]: profileForSourceDocument(solutionSource) } : {}
        })()
      : {}),
  }
  const fallbackSourceDocumentIdForUsage = (usage: string | undefined) => (
    solutionSourceDocumentId && String(usage || '') === 'analysis'
      ? solutionSourceDocumentId
      : currentCandidate.sourceDocumentId
  )

  function insertSolutionRegions(sessionIdForInsert: string, insertRegion: ReturnType<typeof db.prepare>, startSortOrder: number) {
    const analysisRefs = currentCandidate.sourceRefs.filter(r => r.kind === 'analysis' || r.kind === 'answer')
    if (!analysisRefs.length) return startSortOrder
    const refsBySourceDocument = new Map<string, typeof analysisRefs>()
    for (const ref of analysisRefs) {
      const refSourceDocumentId = ref.sourceDocumentId || fallbackSourceDocumentIdForUsage('analysis')
      refsBySourceDocument.set(refSourceDocumentId, [...(refsBySourceDocument.get(refSourceDocumentId) || []), ref])
    }
    for (const [analysisSourceDocumentId, refs] of refsBySourceDocument) {
      const segments = refs.map(r => normalizeBBoxSegment(analysisSourceDocumentId, r.pageNo, r.bbox)).filter(Boolean)
      if (!segments.length) continue
      insertRegion.run(
        createId('reg'),
        sessionIdForInsert,
        analysisSourceDocumentId,
        'solution',
        'analysis',
        '解析',
        JSON.stringify([]),
        JSON.stringify(segments),
        startSortOrder++,
        '',
        nowIso(),
        nowIso()
      )
    }
    return startSortOrder
  }

  function repairExistingFigureRegions(sessionIdForRepair: string) {
    if (!solutionSourceDocumentId) return
    const analysisFigureIds = new Set(
      currentCandidate.figures
        .filter((figure) => String(figure.usage || '') === 'analysis')
        .flatMap((figure) => [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).map(String))
    )
    if (!analysisFigureIds.size) return
    const rows = db.prepare(`
      SELECT id, source_run_id, note, question_keys_json
      FROM pdf_slicer_annotation_regions
      WHERE session_id = ? AND kind = ?
    `).all(sessionIdForRepair, 'shared_answer_key') as Array<{ id: string; source_run_id: string; note: string; question_keys_json: string }>
    for (const row of rows) {
      if (row.source_run_id === solutionSourceDocumentId) continue
      let keys: string[] = []
      try {
        keys = JSON.parse(row.question_keys_json || '[]') as string[]
      } catch {
        keys = []
      }
      const isAnalysisFigure = String(row.note || '') === 'analysis' || keys.some((key) => analysisFigureIds.has(String(key)))
      if (!isAnalysisFigure) continue
      db.prepare(`
        UPDATE pdf_slicer_annotation_regions
        SET source_run_id = ?, updated_at = ?
        WHERE id = ?
      `).run(solutionSourceDocumentId, nowIso(), row.id)
    }
  }

  if (existing) {
    let row = existing
    if (existing.status !== 'draft') {
      const now = nowIso()
      db.prepare(`
        UPDATE pdf_slicer_annotation_sessions
        SET status = 'draft', revision = revision + 1, finalized_at = '', updated_at = ?
        WHERE id = ?
      `).run(now, sessionId)
      row = db.prepare('SELECT * FROM pdf_slicer_annotation_sessions WHERE id = ?').get(sessionId) as any
    }
    const currentProfiles = { ...JSON.parse(row.source_profile_json || '{}'), ...profiles }
    db.prepare(`
      UPDATE pdf_slicer_annotation_sessions
      SET source_profile_json = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(currentProfiles), nowIso(), sessionId)
    row = db.prepare('SELECT * FROM pdf_slicer_annotation_sessions WHERE id = ?').get(sessionId) as any
    const regions = getRegionsForSession(sessionId)
    const hasSolutionRegionOnSolutionDocument = Boolean(solutionSourceDocumentId && regions.some((region) => region.kind === 'solution' && region.sourceRunId === solutionSourceDocumentId))
    if (solutionSourceDocumentId && !hasSolutionRegionOnSolutionDocument) {
      db.prepare('DELETE FROM pdf_slicer_annotation_regions WHERE session_id = ? AND kind = ?').run(sessionId, 'solution')
      const insertRegion = db.prepare(`
        INSERT INTO pdf_slicer_annotation_regions (
          id, session_id, source_run_id, kind, question_key, question_label, question_keys_json, segments_json, sort_order, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      insertSolutionRegions(sessionId, insertRegion, regions.length)
    }
    repairExistingFigureRegions(sessionId)
    return {
      id: row.id,
      batchId: row.batch_id,
      revision: row.revision,
      status: row.status,
      sourceProfileJson: row.source_profile_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finalizedAt: row.finalized_at,
      regions: getRegionsForSession(sessionId)
    }
  }

  const now = nowIso()
  db.prepare(`
    INSERT INTO pdf_slicer_annotation_sessions (id, batch_id, revision, status, source_profile_json, created_at, updated_at)
    VALUES (?, ?, 1, 'draft', ?, ?, ?)
  `).run(sessionId, currentCandidate.id, JSON.stringify(profiles), now, now)

  const insertRegion = db.prepare(`
    INSERT INTO pdf_slicer_annotation_regions (
      id, session_id, source_run_id, kind, question_key, question_label, question_keys_json, segments_json, sort_order, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let sortOrder = 0

  // 1. 映射题干 (stem)
  const stemRefs = currentCandidate.sourceRefs.filter(r => r.kind === 'stem')
  if (stemRefs.length > 0) {
    const segments = stemRefs.map(r => normalizeBBoxSegment(currentCandidate.sourceDocumentId, r.pageNo, r.bbox)).filter(Boolean)

    if (segments.length > 0) {
      insertRegion.run(
        createId('reg'),
        sessionId,
        currentCandidate.sourceDocumentId,
        'question',
        'stem',
        '题干',
        JSON.stringify([]),
        JSON.stringify(segments),
        sortOrder++,
        '',
        now,
        now
      )
    }
  }

  // 2. 映射解析 (analysis / answer)
  sortOrder = insertSolutionRegions(sessionId, insertRegion, sortOrder)

  // 3. 映射已有关联的 figures (如果有 bbox 信息的话)
  for (const figure of currentCandidate.figures) {
    if (figure.bbox && figure.pageNo) {
      const figureSourceDocumentId = figure.sourceDocumentId || fallbackSourceDocumentIdForUsage(figure.usage)
      const seg = normalizeBBoxSegment(figureSourceDocumentId, figure.pageNo, figure.bbox)
      if (seg) {
        insertRegion.run(
          createId('reg'),
          sessionId,
          figureSourceDocumentId,
          'shared_answer_key',
          'figure',
          '题图',
          JSON.stringify([figure.id]),
          JSON.stringify([seg]),
          sortOrder++,
          figure.usage || 'stem',
          now,
          now
        )
      }
    }
  }

  return {
    id: sessionId,
    batchId: currentCandidate.id,
    revision: 1,
    status: 'draft',
    sourceProfileJson: JSON.stringify(profiles),
    createdAt: now,
    updatedAt: now,
    finalizedAt: '',
    regions: getRegionsForSession(sessionId)
  }
}
