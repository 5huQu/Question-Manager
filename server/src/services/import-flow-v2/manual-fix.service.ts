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
      console.error(`Failed to render PDF page via Python script:`, err)
      throw new RouteError(500, `页面渲染失败：无法使用 PyMuPDF 渲染 PDF 第 ${pageNum} 页。`)
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

  const sourceDocument = sourceRepo.getSourceDocument(candidate.sourceDocumentId)
  if (!sourceDocument) {
    throw new RouteError(404, '源资料文件不存在。')
  }
  const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId: candidate.sourceDocumentId, limit: 1 })
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
  const normalizeBBoxSegment = (pageNo: number, bbox: [number, number, number, number] | undefined) => {
    if (!bbox) return null
    const pageSize = pageSizeByPage.get(pageNo)
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

  const sessionId = `sess_candidate_${candidate.id}`
  const existing = db.prepare('SELECT * FROM pdf_slicer_annotation_sessions WHERE id = ?').get(sessionId) as any
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

  const now = nowIso()
  const profiles = {
    [candidate.sourceDocumentId]: {
      pageCount: sourceDocument.pageCount,
      pdfName: sourceDocument.originalFileName
    }
  }

  db.prepare(`
    INSERT INTO pdf_slicer_annotation_sessions (id, batch_id, revision, status, source_profile_json, created_at, updated_at)
    VALUES (?, ?, 1, 'draft', ?, ?, ?)
  `).run(sessionId, candidate.id, JSON.stringify(profiles), now, now)

  const insertRegion = db.prepare(`
    INSERT INTO pdf_slicer_annotation_regions (
      id, session_id, source_run_id, kind, question_key, question_label, question_keys_json, segments_json, sort_order, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let sortOrder = 0

  // 1. 映射题干 (stem)
  const stemRefs = candidate.sourceRefs.filter(r => r.kind === 'stem')
  if (stemRefs.length > 0) {
    const segments = stemRefs.map(r => normalizeBBoxSegment(r.pageNo, r.bbox)).filter(Boolean)

    if (segments.length > 0) {
      insertRegion.run(
        createId('reg'),
        sessionId,
        candidate.sourceDocumentId,
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
  const analysisRefs = candidate.sourceRefs.filter(r => r.kind === 'analysis' || r.kind === 'answer')
  if (analysisRefs.length > 0) {
    const segments = analysisRefs.map(r => normalizeBBoxSegment(r.pageNo, r.bbox)).filter(Boolean)

    if (segments.length > 0) {
      insertRegion.run(
        createId('reg'),
        sessionId,
        candidate.sourceDocumentId,
        'solution',
        'analysis',
        '解析',
        JSON.stringify([]),
        JSON.stringify(segments),
        sortOrder++,
        '',
        now,
        now
      )
    }
  }

  // 3. 映射已有关联的 figures (如果有 bbox 信息的话)
  for (const figure of candidate.figures) {
    if (figure.bbox && figure.pageNo) {
      const seg = normalizeBBoxSegment(figure.pageNo, figure.bbox)
      if (seg) {
        insertRegion.run(
          createId('reg'),
          sessionId,
          candidate.sourceDocumentId,
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
    batchId: candidate.id,
    revision: 1,
    status: 'draft',
    sourceProfileJson: JSON.stringify(profiles),
    createdAt: now,
    updatedAt: now,
    finalizedAt: '',
    regions: getRegionsForSession(sessionId)
  }
}
