import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { db } from '../../db/connection.js'
import { dataDir } from '../../config.js'
import { createQuestion, getQuestion } from '../../db/questions.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import type { OCRBBox, OCRDocument } from '../../types/ocr-document.js'
import type { CandidateFigure, CandidateFigureUsage, CandidateParseDiagnostic, CandidateSourceRef, QuestionCandidate, QuestionCandidateStatus, UpdateQuestionCandidateInput } from '../../types/question-candidate.js'
import { RouteError } from '../../utils/http-error.js'
import { createId, nowIso } from '../../utils/ids.js'
import { imageExtension } from '../../utils/figure-helpers.js'
import { difficultyLabel10, normalizeDifficultyScore10 } from '../../utils/search.js'
import { inferQuestionType, normalizeQuestionType } from '../../utils/question-type.js'
import { normalizeTags } from '../tags/tag-libraries.js'
import { buildParserPreview, parseQuestionCandidates } from '../question-parser/index.js'
import { figureForBlock } from '../question-parser/figure-linker.js'
import { parserConfigForRequest } from '../question-parser/parser-config.js'
import type { ImportFlowV2ParserConfig } from '../question-parser/default-parser-config.js'
import {
  LIVE_VALIDATION_ISSUE_CODES,
  refreshCandidateParseDiagnostics,
  statusForIssues,
  validateQuestionCandidate,
  validationIssueDiagnostics,
} from '../question-parser/candidate-validator.js'
import { revalidateAllCandidatesForSourceDocument } from '../pdf-slicer/annotations.service.js'
import { figuresForQuestionBank, getOcrFigureDiagnostics } from './figure-mapping.js'
import { loadOcrDocument } from './ocr-document.service.js'
import { readOcrSettings } from '../settings/ocr-settings.js'
import { runQuestionBatchClassification, type QuestionBatchClassificationReport } from '../question-bank/batch-classification.js'

function candidateStatusCounts(candidates: QuestionCandidate[]) {
  return {
    candidateCount: candidates.length,
    readyCount: candidates.filter((item) => item.status === 'ready').length,
    needsReviewCount: candidates.filter((item) => item.status === 'needs_review').length,
    needsManualFixCount: candidates.filter((item) => item.status === 'needs_manual_fix').length,
    blockedCount: candidates.filter((item) => item.status === 'blocked').length,
  }
}

function withImmediateTransaction<T>(operation: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Preserve the original failure if rollback itself cannot run.
    }
    throw error
  }
}

function normalizeListLimit(value: unknown, fallback = 500) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(1000, Math.floor(numeric)))
}

function normalizeListOffset(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function normalizeCandidateStatus(value: unknown) {
  const status = String(value || '')
  return ['ready', 'needs_review', 'needs_manual_fix', 'blocked', 'committed'].includes(status)
    ? status as QuestionCandidateStatus
    : undefined
}

function liveValidateCandidates(candidates: QuestionCandidate[]) {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    if (candidate.status === 'committed') continue
    const questionNo = candidate.questionNo.trim()
    if (!questionNo) continue
    counts.set(questionNo, (counts.get(questionNo) || 0) + 1)
  }

  const duplicateQuestionNos = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([questionNo]) => questionNo),
  )

  return candidates.map((candidate) => {
    if (candidate.status === 'committed') return candidate
    const baseIssues = candidate.issues.filter((issue) => !LIVE_VALIDATION_ISSUE_CODES.has(issue.code))
    const issues = validateQuestionCandidate({ ...candidate, issues: baseIssues }, duplicateQuestionNos)
    return {
      ...candidate,
      issues,
      parseDiagnostics: refreshCandidateParseDiagnostics(candidate, issues),
      status: statusForIssues(issues),
    }
  })
}

function enrichUnplacedFigureIssues(candidates: QuestionCandidate[]) {
  const documents = new Map<string, ReturnType<typeof loadOcrDocument>>()
  return candidates.map((candidate) => {
    const needsFigureLookup = candidate.issues.some((issue) =>
      issue.code === 'unplaced_figure'
      && issue.relatedBlockIds?.length
      && !issue.relatedFigures?.some((figure) => figure.path),
    )
    if (!needsFigureLookup || !candidate.ocrDocumentId) return candidate

    let document = documents.get(candidate.ocrDocumentId)
    if (!document) {
      document = loadOcrDocument(candidate.ocrDocumentId)
      documents.set(candidate.ocrDocumentId, document)
    }
    const blocks = new Map(document.pages.flatMap((page) => page.blocks).map((block) => [block.id, block]))
    const issues = candidate.issues.map((issue) => {
      if (issue.code !== 'unplaced_figure' || issue.relatedFigures?.some((figure) => figure.path)) return issue
      const relatedFigures = (issue.relatedBlockIds || [])
        .flatMap((blockId) => {
          const block = blocks.get(blockId)
          return block ? figureForBlock(document!, block, 'unknown') || [] : []
        })
      return relatedFigures.length ? { ...issue, relatedFigures } : issue
    })
    return { ...candidate, issues }
  })
}

function sourceTitle(sourceDocumentId: string) {
  const source = sourceRepo.getSourceDocument(sourceDocumentId)
  return source?.paperTitle || source?.title || source?.originalFileName || '资料导入 v2'
}

function importJobContextForSource(sourceDocumentId: string) {
  const row = db.prepare(`
    SELECT j.id, j.title, j.paper_title
    FROM import_jobs j
    JOIN import_job_documents d ON d.job_id = j.id
    WHERE d.source_document_id = ?
      AND j.status IN ('parsed', 'partially_parsed')
    ORDER BY j.updated_at DESC, j.created_at DESC
    LIMIT 1
  `).get(sourceDocumentId) as { id: string; title: string; paper_title: string } | undefined
  if (!row) return null
  return {
    importSourceId: row.id,
    sourceTitle: row.paper_title || row.title || sourceTitle(sourceDocumentId),
  }
}

async function maybeClassifyCommittedImportJobs(items: Array<{ importSourceId?: string }>) {
  if (readOcrSettings().classificationEnabled === 'false') return null
  const importJobIds = Array.from(new Set(items.map((item) => String(item.importSourceId || '').trim()).filter(Boolean)))
    .filter((id) => Boolean(db.prepare('SELECT id FROM import_jobs WHERE id = ?').get(id)))
  const reports: QuestionBatchClassificationReport[] = []
  for (const importJobId of importJobIds) {
    reports.push(await runQuestionBatchClassification({ type: 'import_job', id: importJobId }))
  }
  return reports.length ? reports : null
}

function sourceMetadata(sourceDocumentId: string): Partial<Pick<QuestionCandidate,
  'province' | 'city' | 'paperTitle' | 'batchName' | 'stage' | 'subject' | 'paperKind' | 'examYear' | 'sourceOrg'
>> {
  const source = sourceRepo.getSourceDocument(sourceDocumentId)
  if (!source) return {}
  const importJob = db.prepare(`
    SELECT j.province, j.city, j.paper_title, j.batch_name, j.stage, j.subject,
           j.paper_kind, j.exam_year, j.source_org
    FROM import_jobs j
    JOIN import_job_documents d ON d.job_id = j.id
    WHERE d.source_document_id = ?
    ORDER BY j.updated_at DESC, j.created_at DESC
    LIMIT 1
  `).get(sourceDocumentId) as {
    province: string
    city: string
    paper_title: string
    batch_name: string
    stage: string
    subject: string
    paper_kind: QuestionCandidate['paperKind']
    exam_year: number
    source_org: string
  } | undefined
  return importJob ? {
    province: importJob.province || source.province,
    city: importJob.city || source.city,
    paperTitle: importJob.paper_title || source.paperTitle,
    batchName: importJob.batch_name || source.batchName,
    stage: importJob.stage || source.stage,
    subject: importJob.subject || source.subject,
    paperKind: importJob.paper_kind !== 'unknown' ? importJob.paper_kind : source.paperKind,
    examYear: importJob.exam_year || source.examYear,
    sourceOrg: importJob.source_org || source.sourceOrg,
  } : {
    province: source.province,
    city: source.city,
    paperTitle: source.paperTitle,
    batchName: source.batchName,
    stage: source.stage,
    subject: source.subject,
    paperKind: source.paperKind,
    examYear: source.examYear,
    sourceOrg: source.sourceOrg,
  }
}

function attachParserDiagnostics(
  document: ReturnType<typeof loadOcrDocument>,
  candidates: QuestionCandidate[],
  config: ImportFlowV2ParserConfig,
) {
  const isLecture = candidates.some((candidate) => candidate.paperKind === 'lecture')
  const preview = isLecture ? { diagnostics: [] } : buildParserPreview(document, { config })
  const diagnosticsByQuestion = new Map<string, CandidateParseDiagnostic[]>()
  for (const diagnostic of preview.diagnostics) {
    if (!diagnostic.questionNo) continue
    const current = diagnosticsByQuestion.get(diagnostic.questionNo) || []
    current.push({
      code: diagnostic.code,
      severity: diagnostic.severity,
      questionNo: diagnostic.questionNo,
      message: diagnostic.message,
      start: diagnostic.start,
      end: diagnostic.end,
    })
    diagnosticsByQuestion.set(diagnostic.questionNo, current)
  }

  return candidates.map((candidate) => {
    const diagnostics = [
      ...(diagnosticsByQuestion.get(candidate.questionNo) || []),
      ...validationIssueDiagnostics(candidate, candidate.issues),
    ]
    const uniqueDiagnostics = Array.from(new Map(diagnostics.map((diagnostic) => [`${diagnostic.code}:${diagnostic.message}`, diagnostic])).values())
    const nextCandidate = {
      ...candidate,
      parseDiagnostics: uniqueDiagnostics,
      parserConfigSnapshot: config,
    }
    return {
      ...nextCandidate,
      parseDiagnostics: refreshCandidateParseDiagnostics(nextCandidate, candidate.issues),
    }
  })
}

export function parseCandidatesForOcrDocument(id: string, body: Record<string, unknown> = {}) {
  const document = loadOcrDocument(id)
  const existingCandidates = candidateRepo.listQuestionCandidates({ ocrDocumentId: id, limit: 1000, offset: 0 })
  if (existingCandidates.some((candidate) => candidate.status === 'committed')) {
    throw new RouteError(409, '该 OCR 文档已有题目入库。为避免题库记录与候选记录失去对应关系，不能直接重新解析。')
  }
  const config = parserConfigForRequest(body)
  const metadata = sourceMetadata(document.sourceDocumentId)
  const candidates = attachParserDiagnostics(document, parseQuestionCandidates(document, { config, paperKind: metadata.paperKind }), config)
  const saved = withImmediateTransaction(() => {
    candidateRepo.deleteQuestionCandidatesForOcrDocument(id)
    const created = candidates.map((candidate) => candidateRepo.createQuestionCandidate({ ...candidate, ...metadata })).filter(Boolean) as QuestionCandidate[]
    revalidateAllCandidatesForSourceDocument(document.sourceDocumentId)
    sourceRepo.updateSourceDocument(document.sourceDocumentId, { status: created.some((item) => item.status !== 'ready') ? 'partially_parsed' : 'parsed' })
    return created
  })
  const finalCandidates = liveValidateCandidates(candidateRepo.listQuestionCandidates({ sourceDocumentId: document.sourceDocumentId }))
  return { ...candidateStatusCounts(finalCandidates), items: finalCandidates, diagnostics: getOcrFigureDiagnostics(id, finalCandidates) }
}

export function listQuestionCandidatesForSource(sourceDocumentId: string, query: Record<string, unknown>) {
  if (!sourceRepo.getSourceDocument(sourceDocumentId)) throw new RouteError(404, '资料不存在。')
  const status = normalizeCandidateStatus(query.status)
  const limit = normalizeListLimit(query.limit)
  const offset = normalizeListOffset(query.offset)
  const allCandidates = enrichUnplacedFigureIssues(liveValidateCandidates(candidateRepo.listQuestionCandidates({ sourceDocumentId, limit: 1000, offset: 0 })))
  const matchingCandidates = status ? allCandidates.filter((candidate) => candidate.status === status) : allCandidates
  const candidates = matchingCandidates.slice(offset, offset + limit)
  const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId, limit: 1 })
  const diagnostics = ocrDocument ? getOcrFigureDiagnostics(ocrDocument.id, candidates) : undefined
  return {
    items: candidates,
    diagnostics,
  }
}

export function updateQuestionCandidate(id: string, body: Record<string, unknown>) {
  const patch = { ...((body.candidate || body) as UpdateQuestionCandidateInput) }
  if (patch.expectedContentRevision === undefined && body.expectedContentRevision !== undefined) {
    patch.expectedContentRevision = Number(body.expectedContentRevision)
  }
  const before = candidateRepo.getQuestionCandidate(id)
  if (!before) throw new RouteError(404, '候选题不存在。')
  const contentFields = ['stemMarkdown', 'answerText', 'analysisMarkdown'] as const
  const hasContentPatch = contentFields.some((field) => patch[field] !== undefined)
  if (before.status === 'committed' && hasContentPatch) {
    throw new RouteError(409, '候选题已入库，请编辑对应的正式题。', undefined, {
      error: 'candidate_committed',
      message: '候选题已入库，请编辑对应的正式题。',
      committedQuestionId: before.committedQuestionId || '',
    })
  }
  if (patch.expectedContentRevision !== undefined && Number(patch.expectedContentRevision) !== Number(before.contentRevision || 1)) {
    throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。', undefined, {
      error: 'content_revision_conflict',
      message: '内容已在其他页面更新，请刷新后重试。',
      expectedContentRevision: Number(patch.expectedContentRevision),
      actualContentRevision: Number(before.contentRevision || 1),
      current: before,
    })
  }
  const finalUpdated = withImmediateTransaction(() => {
    const updated = candidateRepo.updateQuestionCandidate(id, patch)
    if (!updated) {
      const current = candidateRepo.getQuestionCandidate(id)
      if (!current) throw new RouteError(404, '候选题不存在。')
      throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。', undefined, {
        error: 'content_revision_conflict',
        message: '内容已在其他页面更新，请刷新后重试。',
        expectedContentRevision: Number(patch.expectedContentRevision),
        actualContentRevision: current.contentRevision,
        current,
      })
    }
    revalidateAllCandidatesForSourceDocument(updated.sourceDocumentId)
    return candidateRepo.getQuestionCandidate(id)
  })
  if (!finalUpdated) throw new RouteError(404, '候选题不存在。')
  return { candidate: finalUpdated }
}

export function uploadCandidateFigure(id: string, file: Express.Multer.File | undefined, body: Record<string, unknown>) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) throw new RouteError(404, '候选题不存在。')
  if (candidate.status === 'committed') throw new RouteError(409, '该候选题已入库，不能再上传题图。')
  if (!file) throw new RouteError(400, '请上传一个图片文件。')
  if (!String(file.mimetype || '').startsWith('image/')) throw new RouteError(400, '只能上传图片文件。')

  const requestedUsage = String(body.usage || 'stem')
  const usage: CandidateFigureUsage = ['stem', 'analysis', 'options'].includes(requestedUsage)
    ? requestedUsage as CandidateFigureUsage
    : 'stem'
  const optionLabel = usage === 'options' && /^[A-D]$/i.test(String(body.optionLabel || ''))
    ? String(body.optionLabel).toUpperCase()
    : undefined
  if (usage === 'options' && !optionLabel) throw new RouteError(400, '请选择图片对应的选项。')

  const figureId = createId('fig')
  const extension = imageExtension(file.originalname, file.mimetype)
  const outputRel = path.join('data', 'import-flow-v2', 'candidate-figures', id, `${figureId}${extension}`)
  const outputPath = path.join(dataDir, 'import-flow-v2', 'candidate-figures', id, `${figureId}${extension}`)
  const figure: CandidateFigure = {
    id: figureId,
    origin: 'manual_upload',
    originalName: file.originalname,
    usage,
    path: outputRel,
    ...(optionLabel ? { optionLabel } : {}),
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, file.buffer)
  try {
    const updated = candidateRepo.updateQuestionCandidate(id, { figures: [...candidate.figures, figure] })
    if (!updated) throw new RouteError(409, '题图上传时内容已发生变化，请刷新后重试。')
    revalidateAllCandidatesForSourceDocument(candidate.sourceDocumentId)
    return { figure, candidate: candidateRepo.getQuestionCandidate(id) }
  } catch (error) {
    fs.rmSync(outputPath, { force: true })
    throw error
  }
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function figureIdentifiers(figure: CandidateFigure, block?: OCRDocument['pages'][number]['blocks'][number]) {
  return Array.from(new Set([
    figure.id,
    figure.blockId,
    figure.sourceBlockId,
    block?.id,
    block?.assetId,
  ].filter(Boolean).map(String)))
}

function sameFigure(left: CandidateFigure, identifiers: string[]) {
  return [left.id, left.blockId, left.sourceBlockId].filter(Boolean).some((value) => identifiers.includes(String(value)))
}

function removeFigureMarkup(value: string, identifiers: string[], path: string) {
  let next = String(value || '')
  for (const identifier of identifiers) {
    const markerPattern = new RegExp(`<!--\\s*DOC2X_FIGURE:${escapedPattern(identifier)}\\s*-->`, 'gi')
    let match = markerPattern.exec(next)
    while (match) {
      let removeStart = match.index
      const before = next.slice(0, match.index)
      const commentStart = before.lastIndexOf('<!--')
      if (commentStart >= 0 && /^<!--\s*figureText\s*:[\s\S]*?-->\s*$/i.test(before.slice(commentStart))) {
        removeStart = commentStart
      }
      next = `${next.slice(0, removeStart)}\n${next.slice(match.index + match[0].length)}`
      markerPattern.lastIndex = 0
      match = markerPattern.exec(next)
    }
  }
  if (path) {
    next = next.replace(/!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/g, (marker, anglePath, plainPath) => {
      const markerPath = String(anglePath || plainPath || '').replace(/\\\)/g, ')').trim()
      return markerPath === path ? '' : marker
    })
  }
  return next.replace(/\n{3,}/g, '\n\n').trim()
}

function insertFigureMarker(value: string, markerId: string, usage: CandidateFigureUsage, optionLabel?: string) {
  const source = String(value || '').trim()
  const marker = `<!-- DOC2X_FIGURE:${markerId} -->`
  if (usage === 'analysis') return source ? `${source}\n\n${marker}` : marker

  const optionPattern = /^\s*([A-DＡ-Ｄ])\s*[.．、:：]\s*/gm
  const matches = Array.from(source.matchAll(optionPattern))
  if (usage === 'options' && optionLabel) {
    const normalizedLabel = optionLabel.toUpperCase()
    const optionIndex = matches.findIndex((match) => String(match[1] || '').toUpperCase() === normalizedLabel)
    if (optionIndex >= 0) {
      const insertAt = matches[optionIndex + 1]?.index ?? source.length
      return `${source.slice(0, insertAt).trimEnd()}\n\n${marker}\n\n${source.slice(insertAt).trimStart()}`.trim()
    }
  }
  const firstOptionAt = matches[0]?.index
  if (firstOptionAt !== undefined) {
    return `${source.slice(0, firstOptionAt).trimEnd()}\n\n${marker}\n\n${source.slice(firstOptionAt).trimStart()}`.trim()
  }
  return source ? `${source}\n\n${marker}` : marker
}

function unionBBoxes(boxes: OCRBBox[]) {
  if (!boxes.length) return undefined
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ] as OCRBBox
}

function sourceRefsWithoutFigure(refs: CandidateSourceRef[], identifiers: string[], document?: OCRDocument) {
  const blockById = new Map((document?.pages.flatMap((page) => page.blocks) || []).map((block) => [block.id, block]))
  return refs.flatMap((ref) => {
    const blockIds = ref.blockIds.filter((blockId) => !identifiers.includes(blockId))
    if (blockIds.length === ref.blockIds.length) return [ref]
    if (!blockIds.length) return []
    const boxes = blockIds.map((blockId) => blockById.get(blockId)?.bbox).filter(Boolean) as OCRBBox[]
    return [{ ...ref, blockIds, bbox: boxes.length === blockIds.length ? unionBBoxes(boxes) : ref.bbox }]
  })
}

function sourceRefsWithFigure(refs: CandidateSourceRef[], figure: CandidateFigure, blockId: string) {
  const matchingRef = refs.find((ref) =>
    ref.kind === 'figure'
    && ref.sourceDocumentId === figure.sourceDocumentId
    && ref.pageNo === figure.pageNo,
  )
  if (!matchingRef) {
    return [...refs, {
      sourceDocumentId: figure.sourceDocumentId,
      pageNo: figure.pageNo || 1,
      blockIds: [blockId],
      bbox: figure.bbox,
      kind: 'figure' as const,
    }]
  }
  return refs.map((ref) => ref === matchingRef ? {
    ...ref,
    blockIds: Array.from(new Set([...ref.blockIds, blockId])),
    bbox: ref.bbox || figure.bbox,
  } : ref)
}

function assertContentRevision(candidate: QuestionCandidate, expected: unknown) {
  if (expected === undefined) return
  if (Number(expected) === Number(candidate.contentRevision || 1)) return
  throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。', undefined, {
    error: 'content_revision_conflict',
    message: '内容已在其他页面更新，请刷新后重试。',
    expectedContentRevision: Number(expected),
    actualContentRevision: Number(candidate.contentRevision || 1),
    current: candidate,
  })
}

export function moveCandidateFigure(id: string, figureId: string, body: Record<string, unknown>) {
  const sourceCandidate = candidateRepo.getQuestionCandidate(id)
  if (!sourceCandidate) throw new RouteError(404, '候选题不存在。')
  if (sourceCandidate.status === 'committed') throw new RouteError(409, '该候选题已入库，不能再移动图片。')
  assertContentRevision(sourceCandidate, body.sourceExpectedContentRevision)

  const sourceFigure = sourceCandidate.figures.find((figure) =>
    [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).some((value) => String(value) === figureId),
  )
  if (!sourceFigure) throw new RouteError(404, '未找到需要移动的图片，请刷新后重试。')

  const targetCandidateId = String(body.targetCandidateId || '').trim()
  if (!targetCandidateId) throw new RouteError(400, '请选择目标题目。')
  const targetCandidate = candidateRepo.getQuestionCandidate(targetCandidateId)
  if (!targetCandidate) throw new RouteError(404, '目标候选题不存在。')
  if (targetCandidate.sourceDocumentId !== sourceCandidate.sourceDocumentId) {
    throw new RouteError(400, '图片只能移动到同一份资料中的题目。')
  }
  if (targetCandidate.status === 'committed') throw new RouteError(409, '目标题目已入库，不能再添加图片。')
  if (targetCandidate.id !== sourceCandidate.id) assertContentRevision(targetCandidate, body.targetExpectedContentRevision)

  const requestedUsage = String(body.usage || sourceFigure.usage || 'stem')
  const usage: CandidateFigureUsage = ['stem', 'analysis', 'options'].includes(requestedUsage)
    ? requestedUsage as CandidateFigureUsage
    : 'stem'
  const optionLabel = usage === 'options' && /^[A-D]$/i.test(String(body.optionLabel || ''))
    ? String(body.optionLabel).toUpperCase()
    : undefined
  if (usage === 'options' && !optionLabel) throw new RouteError(400, '请选择图片对应的选项。')

  let document: OCRDocument | undefined
  if (sourceCandidate.ocrDocumentId) {
    try {
      document = loadOcrDocument(sourceCandidate.ocrDocumentId)
    } catch {
      // Manually uploaded figures can outlive their original OCR document.
    }
  }
  const block = document?.pages.flatMap((page) => page.blocks).find((item) =>
    (Boolean(sourceFigure.sourceBlockId) && item.id === sourceFigure.sourceBlockId)
    || (Boolean(sourceFigure.blockId) && item.id === sourceFigure.blockId)
    || (Boolean(sourceFigure.id) && item.assetId === sourceFigure.id)
    || (Boolean(sourceFigure.blockId) && item.assetId === sourceFigure.blockId),
  )
  const identifiers = figureIdentifiers(sourceFigure, block)
  const markerId = sourceFigure.blockId || sourceFigure.id
  const referenceBlockId = sourceFigure.sourceBlockId || block?.id || sourceFigure.blockId || sourceFigure.id
  const movedFigure: CandidateFigure = { ...sourceFigure, usage, optionLabel }
  if (usage !== 'options') delete movedFigure.optionLabel

  const removeFromContent = (candidate: QuestionCandidate) => ({
    stemMarkdown: removeFigureMarkup(candidate.stemMarkdown, identifiers, sourceFigure.path),
    answerText: removeFigureMarkup(candidate.answerText, identifiers, sourceFigure.path),
    analysisMarkdown: removeFigureMarkup(candidate.analysisMarkdown, identifiers, sourceFigure.path),
  })

  const result = withImmediateTransaction(() => {
    const sourceContent = removeFromContent(sourceCandidate)
    const sourceFigures = sourceCandidate.figures.filter((figure) => !sameFigure(figure, identifiers))
    const sourceRefs = sourceRefsWithoutFigure(sourceCandidate.sourceRefs, identifiers, document)

    if (targetCandidate.id === sourceCandidate.id) {
      const content = { ...sourceContent }
      if (usage === 'analysis') content.analysisMarkdown = insertFigureMarker(content.analysisMarkdown, markerId, usage)
      else content.stemMarkdown = insertFigureMarker(content.stemMarkdown, markerId, usage, optionLabel)
      const updated = candidateRepo.updateQuestionCandidate(sourceCandidate.id, {
        ...content,
        figures: [...sourceFigures, movedFigure],
        sourceRefs: sourceRefsWithFigure(sourceRefs, movedFigure, referenceBlockId),
        expectedContentRevision: sourceCandidate.contentRevision,
      })
      if (!updated) throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。')
    } else {
      const targetContent = removeFromContent(targetCandidate)
      if (usage === 'analysis') targetContent.analysisMarkdown = insertFigureMarker(targetContent.analysisMarkdown, markerId, usage)
      else targetContent.stemMarkdown = insertFigureMarker(targetContent.stemMarkdown, markerId, usage, optionLabel)
      const updatedSource = candidateRepo.updateQuestionCandidate(sourceCandidate.id, {
        ...sourceContent,
        figures: sourceFigures,
        sourceRefs,
        expectedContentRevision: sourceCandidate.contentRevision,
      })
      const targetIdentifiers = figureIdentifiers(movedFigure, block)
      const updatedTarget = candidateRepo.updateQuestionCandidate(targetCandidate.id, {
        ...targetContent,
        figures: [...targetCandidate.figures.filter((figure) => !sameFigure(figure, targetIdentifiers)), movedFigure],
        sourceRefs: sourceRefsWithFigure(
          sourceRefsWithoutFigure(targetCandidate.sourceRefs, targetIdentifiers, document),
          movedFigure,
          referenceBlockId,
        ),
        expectedContentRevision: targetCandidate.contentRevision,
      })
      if (!updatedSource || !updatedTarget) throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。')
    }
    revalidateAllCandidatesForSourceDocument(sourceCandidate.sourceDocumentId)
    return {
      sourceCandidate: candidateRepo.getQuestionCandidate(sourceCandidate.id),
      targetCandidate: candidateRepo.getQuestionCandidate(targetCandidate.id),
    }
  })
  return result
}

export function resolveCandidateUnplacedFigure(id: string, blockId: string, body: Record<string, unknown>) {
  const sourceCandidate = candidateRepo.getQuestionCandidate(id)
  if (!sourceCandidate) throw new RouteError(404, '候选题不存在。')
  if (sourceCandidate.status === 'committed') throw new RouteError(409, '该候选题已入库，不能再处理待归属图片。')

  const issueExists = sourceCandidate.issues.some((issue) =>
    issue.code === 'unplaced_figure' && issue.relatedBlockIds?.includes(blockId),
  )
  if (!issueExists) throw new RouteError(404, '未找到该待归属图片提示，请刷新后重试。')

  const action = String(body.action || 'assign')
  if (!['assign', 'ignore'].includes(action)) throw new RouteError(400, '图片处理方式不正确。')
  const nextIssues = sourceCandidate.issues.flatMap((issue) => {
    if (issue.code !== 'unplaced_figure' || !issue.relatedBlockIds?.includes(blockId)) return [issue]
    const relatedBlockIds = issue.relatedBlockIds.filter((item) => item !== blockId)
    if (!relatedBlockIds.length) return []
    return [{
      ...issue,
      relatedBlockIds,
      relatedFigures: (issue.relatedFigures || []).filter((figure) => figure.sourceBlockId !== blockId && figure.blockId !== blockId),
    }]
  })
  const nextParseDiagnostics = refreshCandidateParseDiagnostics({ ...sourceCandidate, issues: nextIssues }, nextIssues)

  let targetCandidate = sourceCandidate
  withImmediateTransaction(() => {
    if (action === 'ignore') {
      candidateRepo.updateQuestionCandidate(id, { issues: nextIssues, parseDiagnostics: nextParseDiagnostics })
      return
    }

    const targetCandidateId = String(body.targetCandidateId || id)
    targetCandidate = candidateRepo.getQuestionCandidate(targetCandidateId) as QuestionCandidate
    if (!targetCandidate) throw new RouteError(404, '目标候选题不存在。')
    if (targetCandidate.sourceDocumentId !== sourceCandidate.sourceDocumentId) {
      throw new RouteError(400, '图片只能归属到同一份资料中的题目。')
    }
    if (targetCandidate.status === 'committed') throw new RouteError(409, '目标题目已入库，不能再添加图片。')
    if (!sourceCandidate.ocrDocumentId) throw new RouteError(400, '候选题缺少 OCR 文档关联。')

    const document = loadOcrDocument(sourceCandidate.ocrDocumentId)
    const block = document.pages.flatMap((page) => page.blocks).find((item) => item.id === blockId)
    if (!block) throw new RouteError(404, '未找到图片对应的 OCR 块。')
    const usage = String(body.usage || 'stem') === 'analysis' ? 'analysis' : 'stem'
    const figure = figureForBlock(document, block, usage)
    if (!figure?.path) throw new RouteError(404, '未找到图片文件。')

    const figures = [
      ...targetCandidate.figures.filter((item) => item.id !== figure.id && item.sourceBlockId !== blockId),
      figure,
    ]
    const matchingRef = targetCandidate.sourceRefs.find((ref) =>
      ref.kind === 'figure' && ref.sourceDocumentId === document.sourceDocumentId && ref.pageNo === block.pageNo,
    )
    const sourceRefs = matchingRef
      ? targetCandidate.sourceRefs.map((ref) => ref === matchingRef ? {
        ...ref,
        blockIds: Array.from(new Set([...ref.blockIds, blockId])),
        bbox: ref.bbox || block.bbox,
      } : ref)
      : [...targetCandidate.sourceRefs, {
        sourceDocumentId: document.sourceDocumentId,
        pageNo: block.pageNo,
        blockIds: [blockId],
        bbox: block.bbox,
        kind: 'figure' as const,
      }]

    if (targetCandidate.id === sourceCandidate.id) {
      candidateRepo.updateQuestionCandidate(id, { figures, sourceRefs, issues: nextIssues, parseDiagnostics: nextParseDiagnostics })
    } else {
      candidateRepo.updateQuestionCandidate(targetCandidate.id, { figures, sourceRefs })
      candidateRepo.updateQuestionCandidate(id, { issues: nextIssues, parseDiagnostics: nextParseDiagnostics })
    }
  })
  revalidateAllCandidatesForSourceDocument(sourceCandidate.sourceDocumentId)
  return {
    sourceCandidate: candidateRepo.getQuestionCandidate(id),
    targetCandidate: candidateRepo.getQuestionCandidate(targetCandidate.id),
  }
}

export async function commitQuestionCandidate(id: string, options: { skipAutoClassification?: boolean } = {}) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) throw new RouteError(404, '候选题不存在。')
  if (candidate.status === 'committed') {
    if (!candidate.committedQuestionId) {
      throw new RouteError(409, '候选题已标记为已入库，但缺少已入库题目 ID。')
    }
    const committedItem = getQuestion(candidate.committedQuestionId)
    if (!committedItem) {
      throw new RouteError(409, `候选题已标记为已入库，但题库中不存在对应题目（${candidate.committedQuestionId}）。`)
    }
    return { candidate, item: committedItem, classificationReports: null }
  }
  if (!candidate.stemMarkdown.trim()) throw new RouteError(400, '题干为空，不能入库。')
  const difficultyScore10 = normalizeDifficultyScore10(candidate.difficultyScore10)
  const inferredQuestionType = inferQuestionType(candidate.stemMarkdown, candidate.answerText, candidate.questionType || '解答题')
  const questionType = candidate.questionType === '单选题' && inferredQuestionType === '多选题'
    ? inferredQuestionType
    : normalizeQuestionType(candidate.questionType || inferredQuestionType, candidate.stemMarkdown, candidate.answerText)
  const importJobContext = importJobContextForSource(candidate.sourceDocumentId)
  const { item, committedCandidate } = withImmediateTransaction(() => {
    const createdItem = createQuestion({
      questionNo: candidate.questionNo,
      questionType,
      difficultyScore: 0,
      difficultyScore10,
      difficultyLabel: candidate.difficultyLabel || difficultyLabel10(difficultyScore10),
      chapter: candidate.knowledgePoints[0] || '待整理',
      knowledgePoints: normalizeTags(candidate.knowledgePoints),
      solutionMethods: normalizeTags(candidate.solutionMethods),
      sourceTitle: importJobContext?.sourceTitle || sourceTitle(candidate.sourceDocumentId),
      province: candidate.province,
      city: candidate.city,
      paperTitle: candidate.paperTitle,
      batchName: candidate.batchName,
      stage: candidate.stage,
      subject: candidate.subject,
      paperKind: candidate.paperKind,
      examYear: candidate.examYear,
      sourceOrg: candidate.sourceOrg,
      importSourceId: importJobContext?.importSourceId || candidate.sourceDocumentId,
      bankStatus: 'ready',
      stemMarkdown: candidate.stemMarkdown,
      answerText: candidate.answerText,
      analysisMarkdown: candidate.analysisMarkdown,
      figures: figuresForQuestionBank(candidate.figures),
      sourceRunId: '',
    })
    if (!createdItem) throw new RouteError(500, '入库失败。')
    const updatedCandidate = candidateRepo.updateQuestionCandidate(id, {
      status: 'committed',
      committedQuestionId: createdItem.id,
      committedAt: nowIso(),
    })
    if (!updatedCandidate) throw new RouteError(500, '题目已创建，但候选题入库状态更新失败。')
    return { item: createdItem, committedCandidate: updatedCandidate }
  })
  const classificationReports = options.skipAutoClassification ? null : await maybeClassifyCommittedImportJobs([item])
  return { candidate: committedCandidate, item, classificationReports }
}

export async function commitQuestionCandidates(body: Record<string, unknown>) {
  const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : []
  if (!ids.length) throw new RouteError(400, '请指定要入库的候选题。')
  const items = []
  const errors = []
  for (const id of ids) {
    try {
      items.push((await commitQuestionCandidate(id, { skipAutoClassification: true })).item)
    } catch (error) {
      errors.push({ id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const classificationReports = await maybeClassifyCommittedImportJobs(items)
  return { success: items.length, failed: errors.length, items, errors, classificationReports }
}

export function skipQuestionCandidates(body: Record<string, unknown>) {
  const ids = Array.from(new Set(Array.isArray(body.candidateIds) ? body.candidateIds.map(String).filter(Boolean) : []))
  if (!ids.length) throw new RouteError(400, '请指定要跳过的候选题。')

  const candidates = ids.map((id) => {
    const candidate = candidateRepo.getQuestionCandidate(id)
    if (!candidate) throw new RouteError(404, `候选题不存在：${id}`)
    if (candidate.status === 'committed' || candidate.committedQuestionId) {
      throw new RouteError(409, `第 ${candidate.questionNo || '？'} 题已经入库，不能跳过。`)
    }
    return candidate
  })
  const sourceDocumentIds = new Set(candidates.map((candidate) => candidate.sourceDocumentId))

  withImmediateTransaction(() => {
    for (const candidate of candidates) {
      const sessionId = `sess_candidate_${candidate.id}`
      db.prepare('DELETE FROM pdf_slicer_annotation_regions WHERE session_id = ?').run(sessionId)
      db.prepare('DELETE FROM pdf_slicer_annotation_sessions WHERE id = ?').run(sessionId)
      candidateRepo.deleteQuestionCandidate(candidate.id)
    }
  })

  for (const sourceDocumentId of sourceDocumentIds) {
    revalidateAllCandidatesForSourceDocument(sourceDocumentId)
  }
  return { success: ids.length, skippedIds: ids }
}

export function deleteQuestionCandidate(id: string) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) {
    throw new RouteError(404, '候选题不存在。')
  }

  const sessionId = `sess_candidate_${id}`
  const sourceDocumentId = candidate.sourceDocumentId

  db.exec('BEGIN IMMEDIATE')
  try {
    // 删除该候选题关联的手动修正标注选区与会话
    db.prepare('DELETE FROM pdf_slicer_annotation_regions WHERE session_id = ?').run(sessionId)
    db.prepare('DELETE FROM pdf_slicer_annotation_sessions WHERE id = ?').run(sessionId)
    // 删除候选题本身
    candidateRepo.deleteQuestionCandidate(id)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  }

  revalidateAllCandidatesForSourceDocument(sourceDocumentId)

  return { success: true }
}
