import fs from 'node:fs'
import path from 'node:path'
import childProcess from 'node:child_process'
import { db } from '../../db/connection.js'
import { dataDir, pythonRoot } from '../../config.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import * as fixRepo from '../../repositories/candidate-fix-sessions.repo.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import type { CandidateFigure, CandidateSourceRef, QuestionCandidate } from '../../types/question-candidate.js'
import type { CandidateFixRegion, CandidateFixRegionInput, CandidateFixSession } from '../../types/candidate-fix.js'
import { RouteError } from '../../utils/http-error.js'
import { assetPathFor, resolveStoragePath } from '../../utils/paths.js'
import { createId } from '../../utils/ids.js'
import { pythonCommand, pythonEnv } from '../settings/python.js'
import { loadOcrDocument } from '../import-flow-v2/ocr-document.service.js'
import { revalidateAllCandidatesForSourceDocument } from '../import-flow-v2/candidate-validation.service.js'
import { LIVE_VALIDATION_ISSUE_CODES, statusForIssues, validateQuestionCandidate } from '../question-parser/candidate-validator.js'
import { validateCandidateFixRegions } from './region-validation.js'

function withTransaction<T>(operation: () => T) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

function solutionSourceDocumentIdForCandidateSource(sourceDocumentId: string) {
  const row = db.prepare(`
    SELECT solution_doc.source_document_id AS source_document_id
    FROM import_job_documents current_doc
    JOIN import_jobs job ON job.id = current_doc.job_id
    JOIN import_job_documents solution_doc ON solution_doc.job_id = job.id AND solution_doc.role = 'solutions'
    WHERE current_doc.source_document_id = ? AND job.mode = 'separated_documents'
    ORDER BY job.updated_at DESC, job.created_at DESC, solution_doc.sort_order ASC LIMIT 1
  `).get(sourceDocumentId) as { source_document_id?: string } | undefined
  return row?.source_document_id || ''
}

function sourceDocumentsForCandidate(candidate: QuestionCandidate) {
  const solutionId = solutionSourceDocumentIdForCandidateSource(candidate.sourceDocumentId)
  return Array.from(new Set([candidate.sourceDocumentId, solutionId].filter(Boolean)))
    .map((id) => sourceRepo.getSourceDocument(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function profilesForCandidate(candidate: QuestionCandidate): CandidateFixSession['sourceProfiles'] {
  return Object.fromEntries(sourceDocumentsForCandidate(candidate).map((document) => [document.id, {
    pageCount: document.pageCount,
    pdfName: document.originalFileName,
  }]))
}

function pageSizesForSource(sourceDocumentId: string) {
  const result = new Map<number, { width: number; height: number }>()
  const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId, limit: 1 })
  if (!ocrDocument) return result
  try {
    for (const page of loadOcrDocument(ocrDocument.id).pages) result.set(page.pageNo, { width: page.width, height: page.height })
  } catch {
    // A draft remains usable even after OCR artifacts have been moved or cleaned.
  }
  return result
}

function normalizeBBox(sourceDocumentId: string, pageNo: number, bbox?: [number, number, number, number]) {
  if (!bbox) return null
  const width = bbox[2] - bbox[0]
  const height = bbox[3] - bbox[1]
  if (width <= 0 || height <= 0) return null
  const relative = bbox.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  const size = pageSizesForSource(sourceDocumentId).get(pageNo)
  const segment = relative
    ? { page: pageNo, x: bbox[0], y: bbox[1], width, height }
    : size && size.width > 0 && size.height > 0
      ? { page: pageNo, x: bbox[0] / size.width, y: bbox[1] / size.height, width: width / size.width, height: height / size.height }
      : null
  return segment && segment.x >= 0 && segment.y >= 0 && segment.width > 0 && segment.height > 0 && segment.x + segment.width <= 1 && segment.y + segment.height <= 1
    ? segment
    : null
}

function initialRegions(candidate: QuestionCandidate, profiles: CandidateFixSession['sourceProfiles']): CandidateFixRegionInput[] {
  const solutionId = Object.keys(profiles).find((id) => id !== candidate.sourceDocumentId) || ''
  const fallbackSource = (usage?: string) => usage === 'analysis' && solutionId ? solutionId : candidate.sourceDocumentId
  const regions: CandidateFixRegionInput[] = []
  const addRefs = (kind: 'question' | 'solution', refKinds: CandidateSourceRef['kind'][]) => {
    const grouped = new Map<string, CandidateSourceRef[]>()
    for (const ref of candidate.sourceRefs.filter((item) => refKinds.includes(item.kind))) {
      const sourceDocumentId = ref.sourceDocumentId || fallbackSource(kind === 'solution' ? 'analysis' : 'stem')
      grouped.set(sourceDocumentId, [...(grouped.get(sourceDocumentId) || []), ref])
    }
    for (const [sourceDocumentId, refs] of grouped) {
      const segments = refs.map((ref) => normalizeBBox(sourceDocumentId, ref.pageNo, ref.bbox)).filter((item): item is NonNullable<typeof item> => Boolean(item))
      if (segments.length) regions.push({
        sourceDocumentId, kind, questionLabel: kind === 'question' ? '题干' : '解析', questionKeys: [],
        segments, sortOrder: regions.length, note: '',
      })
    }
  }
  addRefs('question', ['stem'])
  addRefs('solution', ['answer', 'analysis'])
  for (const figure of candidate.figures) {
    if (!figure.bbox || !figure.pageNo) continue
    const sourceDocumentId = figure.sourceDocumentId || fallbackSource(figure.usage)
    const segment = normalizeBBox(sourceDocumentId, figure.pageNo, figure.bbox)
    if (segment) regions.push({
      sourceDocumentId, kind: 'shared_answer_key', questionLabel: '题图', questionKeys: [figure.id],
      segments: [segment], sortOrder: regions.length, note: figure.usage || 'stem',
    })
  }
  return regions
}

function assertEditableCandidate(candidateId: string) {
  const candidate = candidateRepo.getQuestionCandidate(candidateId)
  if (!candidate) throw new RouteError(404, '候选题不存在。')
  if (candidate.status === 'committed' || candidate.committedQuestionId) throw new RouteError(409, '已入库的候选题不允许进行修正。', undefined, {
    error: 'candidate_committed', message: '已入库的候选题不允许进行修正。', committedQuestionId: candidate.committedQuestionId,
  })
  return candidate
}

export function createOrRestoreCandidateFixSession(candidateId: string) {
  const candidate = assertEditableCandidate(candidateId)
  const profiles = profilesForCandidate(candidate)
  let session = fixRepo.getDraftForCandidate(candidateId)
  if (session) return fixRepo.updateProfiles(session.id, { ...session.sourceProfiles, ...profiles })!
  const latest = fixRepo.getLatestForCandidate(candidateId)
  if (latest?.status === 'finalized') {
    session = fixRepo.reopenSession(latest.id, candidate.contentRevision || 1)
    if (session) return fixRepo.updateProfiles(session.id, { ...session.sourceProfiles, ...profiles })!
  }
  return withTransaction(() => {
    const created = fixRepo.createSession({ candidateId, sourceProfiles: profiles, baseContentRevision: candidate.contentRevision || 1 })
    const regions = initialRegions(candidate, profiles)
    return regions.length ? fixRepo.replaceRegions(created.id, regions, created.revision)! : created
  })
}

export function getCandidateFixSession(sessionId: string) {
  const session = fixRepo.getSession(sessionId)
  if (!session) throw new RouteError(404, '修正会话不存在。')
  return session
}

function pageCounts(session: CandidateFixSession) {
  return new Map(Object.entries(session.sourceProfiles).map(([id, profile]) => [id, Number(profile.pageCount || 0)]))
}

export function saveCandidateFixRegions(sessionId: string, regions: unknown, expectedRevision: number) {
  const session = getCandidateFixSession(sessionId)
  assertEditableCandidate(session.candidateId)
  if (session.status !== 'draft') throw new RouteError(409, '只有草稿状态的修正会话允许保存修改。')
  const validated = validateCandidateFixRegions(regions, pageCounts(session))
  return withTransaction(() => {
    const updated = fixRepo.replaceRegions(sessionId, validated, expectedRevision)
    if (!updated) throw new RouteError(409, '修正草稿版本冲突，请刷新后重试。', undefined, { error: 'revision_conflict', actualRevision: fixRepo.getSession(sessionId)?.revision })
    return updated
  })
}

export function validateCandidateFixSession(sessionId: string) {
  const session = getCandidateFixSession(sessionId)
  const errors: string[] = []
  const warnings: string[] = []
  try {
    validateCandidateFixRegions(session.regions, pageCounts(session))
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  const questions = session.regions.filter((region) => region.kind === 'question')
  if (!questions.length) errors.push('至少需要保留一个题干区域。')
  if (questions.some((region) => !region.segments.length)) errors.push('题干区域不能为空。')
  if (!session.regions.some((region) => region.kind === 'solution')) warnings.push('当前候选题没有解析区域。')
  return { errors, warnings }
}

function parseCropOutput(output: string) {
  const trimmed = output.trim()
  if (!trimmed) throw new Error('裁图脚本没有返回结果。')
  try { return JSON.parse(trimmed) as { error?: string; results?: Array<Record<string, any>> } } catch {}
  for (let index = trimmed.lastIndexOf('{'); index >= 0; index = trimmed.lastIndexOf('{', index - 1)) {
    try { return JSON.parse(trimmed.slice(index)) as { error?: string; results?: Array<Record<string, any>> } } catch {}
  }
  throw new Error(`裁图脚本返回了非 JSON 输出：${trimmed.replace(/\s+/g, ' ').slice(0, 300)}`)
}

function cropRegions(session: CandidateFixSession, stagingDir: string) {
  const results = new Map<string, Record<string, any>>()
  const bySource = new Map<string, CandidateFixRegion[]>()
  for (const region of session.regions) bySource.set(region.sourceDocumentId, [...(bySource.get(region.sourceDocumentId) || []), region])
  for (const [sourceDocumentId, regions] of bySource) {
    const document = sourceRepo.getSourceDocument(sourceDocumentId)
    if (!document) throw new RouteError(400, `修正区域关联的源资料不存在：${sourceDocumentId}`)
    const inputPath = path.join(stagingDir, `regions_${sourceDocumentId}.json`)
    fs.writeFileSync(inputPath, JSON.stringify(regions.map((region) => ({
      id: region.id, kind: region.kind, question_key: region.questionKey,
      question_label: region.questionLabel, segments: region.segments,
    }))))
    const output = childProcess.execFileSync(pythonCommand(), [
      path.join(pythonRoot, 'scripts', 'crop_manual_annotation.py'), '--pdf', resolveStoragePath(document.filePath),
      '--regions-json-file', inputPath, '--output-dir', stagingDir, '--dpi', '180',
    ], { env: pythonEnv(), encoding: 'utf8', timeout: 60000 })
    const parsed = parseCropOutput(String(output || ''))
    if (parsed.error) throw new Error(parsed.error)
    for (const item of parsed.results || []) {
      if (item.error) throw new Error(`裁剪失败（${document.originalFileName || sourceDocumentId}）：${item.error}`)
      results.set(String(item.regionId), item)
    }
  }
  return results
}

function six(value: number) { return Number(value.toFixed(6)) }
function bboxFor(region: CandidateFixRegion): [number, number, number, number] {
  const segment = region.segments[0]
  return [six(segment.x), six(segment.y), six(segment.x + segment.width), six(segment.y + segment.height)]
}

export function finalizeCandidateFixSession(sessionId: string, payload: { stemMarkdown?: string; answerText?: string; analysisMarkdown?: string } = {}) {
  const session = getCandidateFixSession(sessionId)
  const candidate = assertEditableCandidate(session.candidateId)
  if (session.status !== 'draft') throw new RouteError(409, '只能提交草稿状态的修正会话。')
  const validation = validateCandidateFixSession(sessionId)
  if (validation.errors.length) throw new RouteError(400, `校验未通过：${validation.errors.join('；')}`)

  const stagingDir = path.join(dataDir, 'import-flow-v2', 'candidate-fix-staging', session.id)
  const targetDir = path.join(dataDir, 'import-flow-v2', 'source-documents', candidate.sourceDocumentId, 'assets')
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })
  fs.mkdirSync(targetDir, { recursive: true })
  const promoted: string[] = []
  try {
    const crops = cropRegions(session, stagingDir)
    const currentFigures = candidate.figures.map((figure) => ({ ...figure }))
    const figures: CandidateFigure[] = []
    const nextRegionFigureIds = new Map<string, string>()
    let stemMarkdown = payload.stemMarkdown ?? candidate.stemMarkdown
    const answerText = payload.answerText ?? candidate.answerText
    let analysisMarkdown = payload.analysisMarkdown ?? candidate.analysisMarkdown
    const appendMarker = (markdown: string, id: string) => `${String(markdown || '').trim()}\n<!-- DOC2X_FIGURE:${id} -->\n`
    const figureRegions = session.regions.filter((region) => region.kind === 'shared_answer_key')
    for (const region of figureRegions) {
      const crop = crops.get(region.id)
      if (!crop || !region.segments[0]) continue
      const rawImagePath = path.resolve(String(crop.imagePath || ''))
      let imagePath = rawImagePath
      if (rawImagePath.startsWith(`${path.resolve(stagingDir)}${path.sep}`) && fs.existsSync(rawImagePath)) {
        imagePath = path.join(targetDir, `${session.id}_${region.id}_${path.basename(rawImagePath)}`)
        fs.renameSync(rawImagePath, imagePath)
        promoted.push(imagePath)
      }
      const oldId = region.questionKeys[0]
      const existing = oldId ? currentFigures.find((figure) => figure.id === oldId) : undefined
      const figure: CandidateFigure = existing || {
        id: `fig_manual_${createId('fig')}`, usage: 'stem', path: '', sourceDocumentId: region.sourceDocumentId,
      }
      figure.usage = (region.note as CandidateFigure['usage']) || figure.usage || 'stem'
      figure.pageNo = region.segments[0].page
      figure.bbox = bboxFor(region)
      figure.path = assetPathFor(imagePath)
      figure.sourceDocumentId = region.sourceDocumentId
      figures.push(figure)
      if (!existing) {
        nextRegionFigureIds.set(region.id, figure.id)
        if (figure.usage === 'analysis') analysisMarkdown = appendMarker(analysisMarkdown, figure.id)
        else stemMarkdown = appendMarker(stemMarkdown, figure.id)
      }
    }
    for (const figure of currentFigures) {
      if (!figureRegions.some((region) => region.questionKeys.includes(figure.id))) figures.push(figure)
    }
    const sourceRefs: CandidateSourceRef[] = []
    for (const region of session.regions.filter((item) => item.kind === 'question' || item.kind === 'solution')) {
      for (const segment of region.segments) sourceRefs.push({
        sourceDocumentId: region.sourceDocumentId, pageNo: segment.page, blockIds: [],
        kind: region.kind === 'question' ? 'stem' : 'analysis', bbox: [six(segment.x), six(segment.y), six(segment.x + segment.width), six(segment.y + segment.height)],
      })
    }
    const siblingNos = new Set(candidateRepo.listQuestionCandidates({ sourceDocumentId: candidate.sourceDocumentId })
      .filter((item) => item.id !== candidate.id && item.questionNo).map((item) => item.questionNo))
    const preservedIssues = candidate.issues.filter((issue) => !LIVE_VALIDATION_ISSUE_CODES.has(issue.code))
    const candidateForValidation = { ...candidate, stemMarkdown, answerText, analysisMarkdown, figures, sourceRefs, issues: preservedIssues }
    const issues = validateQuestionCandidate(candidateForValidation, siblingNos)
    const status = statusForIssues(issues)
    const updated = withTransaction(() => {
      const latest = assertEditableCandidate(candidate.id)
      const next = candidateRepo.updateQuestionCandidate(candidate.id, {
        expectedContentRevision: latest.contentRevision,
        stemMarkdown, answerText, analysisMarkdown, figures, sourceRefs, issues, status,
      })
      if (!next) throw new RouteError(409, '候选题内容版本冲突，请刷新后重试。')
      const finalized = fixRepo.finalizeSession(sessionId, nextRegionFigureIds)
      if (!finalized) throw new RouteError(409, '修正会话状态已经变化，请刷新后重试。')
      return { session: finalized, candidate: next }
    })
    revalidateAllCandidatesForSourceDocument(candidate.sourceDocumentId)
    return { ...updated, candidate: candidateRepo.getQuestionCandidate(candidate.id)! }
  } catch (error) {
    for (const file of promoted) fs.rmSync(file, { force: true })
    if (error instanceof RouteError) throw error
    throw new RouteError(500, `物理图片裁切失败，请检查标注区域范围。原因为：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
}

export function reopenCandidateFixSession(sessionId: string) {
  const session = getCandidateFixSession(sessionId)
  const candidate = assertEditableCandidate(session.candidateId)
  if (session.status === 'draft') return session
  if (session.status !== 'finalized') throw new RouteError(409, '只有已提交的修正会话可以重新打开。')
  const reopened = fixRepo.reopenSession(sessionId, candidate.contentRevision || 1)
  if (!reopened) throw new RouteError(409, '修正会话状态已经变化，请刷新后重试。')
  return reopened
}

export function renderCandidateSourceDocumentPage(sourceDocumentId: string, pageNum: number) {
  const document = sourceRepo.getSourceDocument(sourceDocumentId)
  if (!document) throw new RouteError(404, '源资料文件不存在。')
  if (!Number.isInteger(pageNum) || pageNum < 1 || (document.pageCount > 0 && pageNum > document.pageCount)) throw new RouteError(400, '页码超出源资料范围。')
  const pageDir = path.join(dataDir, 'import-flow-v2', 'source-documents', sourceDocumentId, 'annotation-pages')
  const pagePath = path.join(pageDir, `page_${pageNum}.png`)
  if (!fs.existsSync(pagePath)) {
    fs.mkdirSync(pageDir, { recursive: true })
    try {
      childProcess.execFileSync(pythonCommand(), [path.join(pythonRoot, 'scripts', 'render_pdf_page.py'), resolveStoragePath(document.filePath), String(pageNum), pagePath, '--dpi', '150'], {
        env: pythonEnv(), encoding: 'utf8', timeout: 15000,
      })
    } catch (error) {
      throw new RouteError(500, `页面渲染失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return pagePath
}
