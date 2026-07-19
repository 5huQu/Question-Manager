import { db } from '../../db/connection.js'
import * as importJobRepo from '../../repositories/import-jobs.repo.js'
import * as sourceRepo from '../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../repositories/ocr-documents.repo.js'
import * as candidateRepo from '../../repositories/question-candidates.repo.js'
import type { ImportJob, ImportJobDocument, ImportJobDocumentRole, ImportJobMode } from '../../types/import-job.js'
import type { SourceDocument } from '../../types/source-document.js'
import type { CandidateParseDiagnostic, QuestionCandidate } from '../../types/question-candidate.js'
import { RouteError } from '../../utils/http-error.js'
import { parseQuestionCandidates } from '../question-parser/question-candidate.parser.js'
import { parseSolutionDocument } from '../question-parser/solution-document.parser.js'
import { mergeQuestionCandidatesWithSolutions } from '../question-parser/question-solution-merge.js'
import { buildParserPreview } from '../question-parser/parser-preview.js'
import { parserConfigForRequest } from '../question-parser/parser-config.js'
import { refreshCandidateParseDiagnostics, validationIssueDiagnostics } from '../question-parser/candidate-validator.js'
import type { ImportFlowV2ParserConfig } from '../question-parser/default-parser-config.js'
import { revalidateAllCandidatesForSourceDocument } from '../pdf-slicer/annotations.service.js'
import { getOcrFigureDiagnostics } from './figure-mapping.js'
import { loadOcrDocument } from './ocr-document.service.js'
import { deleteSourceDocument } from './source-document.service.js'


const VALID_IMPORT_JOB_MODES: ImportJobMode[] = ['single_document', 'separated_documents']
const VALID_IMPORT_JOB_DOCUMENT_ROLES: ImportJobDocumentRole[] = ['full', 'questions', 'solutions']

function candidateStatusCounts(candidates: QuestionCandidate[]) {
  return {
    candidateCount: candidates.length,
    readyCount: candidates.filter((item) => item.status === 'ready').length,
    needsReviewCount: candidates.filter((item) => item.status === 'needs_review').length,
    needsManualFixCount: candidates.filter((item) => item.status === 'needs_manual_fix').length,
    blockedCount: candidates.filter((item) => item.status === 'blocked').length,
  }
}

function requireImportJob(id: string) {
  const importJob = importJobRepo.getImportJob(id)
  if (!importJob) throw new RouteError(404, '导入任务不存在。')
  return importJob
}

function requireSourceDocument(id: string) {
  const sourceDocument = sourceRepo.getSourceDocument(id)
  if (!sourceDocument) throw new RouteError(404, '资料不存在。')
  return sourceDocument
}

function normalizeModeForApi(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return 'single_document' as const
  if (!VALID_IMPORT_JOB_MODES.includes(text as ImportJobMode)) {
    throw new RouteError(400, '导入任务 mode 只能是 single_document 或 separated_documents。')
  }
  return text as ImportJobMode
}

function normalizeRoleForApi(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return 'full' as const
  if (!VALID_IMPORT_JOB_DOCUMENT_ROLES.includes(text as ImportJobDocumentRole)) {
    throw new RouteError(400, '导入任务文档 role 只能是 full、questions 或 solutions。')
  }
  return text as ImportJobDocumentRole
}

function normalizeSortOrder(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function firstDocumentByRole(documents: ImportJobDocument[], role: ImportJobDocumentRole) {
  return documents.find((document) => document.role === role)
}

function latestOcrDocumentForSource(sourceDocumentId: string) {
  const [ocrDocument] = ocrRepo.listOcrDocuments({ sourceDocumentId, limit: 1 })
  if (!ocrDocument) throw new RouteError(400, `资料 ${sourceDocumentId} 尚未生成 OCRDocument。`)
  return ocrDocument
}

function metadataForCandidates(importJob: ImportJob, questionSource: SourceDocument) {
  return {
    province: importJob.province || questionSource.province,
    city: importJob.city || questionSource.city,
    paperTitle: importJob.paperTitle || questionSource.paperTitle,
    batchName: importJob.batchName || questionSource.batchName,
    stage: importJob.stage || questionSource.stage,
    subject: importJob.subject || questionSource.subject,
    paperKind: importJob.paperKind !== 'unknown' ? importJob.paperKind : questionSource.paperKind,
    examYear: importJob.examYear || questionSource.examYear,
    sourceOrg: importJob.sourceOrg || questionSource.sourceOrg,
  }
}

function parseBodyMetadata(body: Record<string, unknown>) {
  return body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, unknown>
    : undefined
}

function saveParsedCandidates(
  importJob: ImportJob,
  questionSource: SourceDocument,
  questionOcrDocumentId: string,
  candidates: QuestionCandidate[],
) {
  const metadata = metadataForCandidates(importJob, questionSource)
  db.exec('BEGIN IMMEDIATE')
  try {
    candidateRepo.deleteQuestionCandidatesForOcrDocument(questionOcrDocumentId)
    const saved = candidates
      .map((candidate) => candidateRepo.createQuestionCandidate({
        ...candidate,
        ...metadata,
        sourceDocumentId: questionSource.id,
        ocrDocumentId: questionOcrDocumentId,
      }))
      .filter(Boolean) as QuestionCandidate[]

    revalidateAllCandidatesForSourceDocument(questionSource.id)
    const finalCandidates = candidateRepo.listQuestionCandidates({ sourceDocumentId: questionSource.id })
    const nextStatus = finalCandidates.some((item) => item.status !== 'ready') ? 'partially_parsed' : 'parsed'
    importJobRepo.updateImportJob(importJob.id, { status: nextStatus })
    sourceRepo.updateSourceDocument(questionSource.id, { status: nextStatus })
    db.exec('COMMIT')
    return { saved, finalCandidates, nextStatus }
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore rollback errors
    }
    throw error
  }
}

function attachParserDiagnostics(
  diagnosticDocument: ReturnType<typeof loadOcrDocument>,
  candidates: QuestionCandidate[],
  config: ImportFlowV2ParserConfig,
) {
  const isLecture = candidates.some((candidate) => candidate.paperKind === 'lecture')
  const preview = isLecture ? { diagnostics: [] } : buildParserPreview(diagnosticDocument, { config })
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

export function createImportJob(body: Record<string, unknown>) {
  const importJob = importJobRepo.createImportJob({
    id: body.id ? String(body.id) : undefined,
    title: String(body.title || ''),
    mode: normalizeModeForApi(body.mode),
    status: 'draft',
    metadata: parseBodyMetadata(body),
    province: body.province === undefined ? undefined : String(body.province),
    city: body.city === undefined ? undefined : String(body.city),
    paperTitle: body.paperTitle === undefined && body.paper_title === undefined ? undefined : String(body.paperTitle ?? body.paper_title ?? ''),
    batchName: body.batchName === undefined && body.batch_name === undefined ? undefined : String(body.batchName ?? body.batch_name ?? ''),
    stage: body.stage === undefined ? undefined : String(body.stage),
    subject: body.subject === undefined ? undefined : String(body.subject),
    paperKind: body.paperKind === undefined && body.paper_kind === undefined ? undefined : String(body.paperKind ?? body.paper_kind) as any,
    examYear: body.examYear === undefined && body.exam_year === undefined ? undefined : Number(body.examYear ?? body.exam_year),
    sourceOrg: body.sourceOrg === undefined && body.source_org === undefined ? undefined : String(body.sourceOrg ?? body.source_org ?? ''),
  })
  if (!importJob) throw new RouteError(500, '导入任务创建失败。')
  return { importJob, documents: [] }
}

export function getImportJob(id: string) {
  const importJob = requireImportJob(id)
  return { importJob, documents: importJobRepo.listImportJobDocuments(id) }
}

export function addSourceDocumentToImportJob(id: string, body: Record<string, unknown>) {
  const importJob = requireImportJob(id)
  const sourceDocumentId = String(body.sourceDocumentId || body.source_document_id || '')
  if (!sourceDocumentId) throw new RouteError(400, '请指定 sourceDocumentId。')
  const sourceDocument = requireSourceDocument(sourceDocumentId)
  const document = importJobRepo.addSourceDocumentToImportJob({
    jobId: importJob.id,
    sourceDocumentId: sourceDocument.id,
    role: normalizeRoleForApi(body.role),
    sortOrder: normalizeSortOrder(body.sortOrder ?? body.sort_order),
  })
  if (!document) throw new RouteError(500, '导入任务文档添加失败。')
  return { importJob: importJobRepo.getImportJob(importJob.id), document, sourceDocument, documents: importJobRepo.listImportJobDocuments(importJob.id) }
}

export function listImportJobDocuments(id: string) {
  requireImportJob(id)
  return { items: importJobRepo.listImportJobDocuments(id) }
}

export function parseCandidatesForImportJob(id: string, body: Record<string, unknown> = {}) {
  const importJob = requireImportJob(id)
  const documents = importJobRepo.listImportJobDocuments(id)
  const config = parserConfigForRequest(body)
  importJobRepo.updateImportJob(importJob.id, { status: 'parsing' })

  try {
    const questionDocument = importJob.mode === 'single_document'
      ? firstDocumentByRole(documents, 'full')
      : firstDocumentByRole(documents, 'questions')
    if (!questionDocument) {
      throw new RouteError(400, importJob.mode === 'single_document' ? '导入任务缺少 full 文档。' : '导入任务缺少 questions 文档。')
    }

    const questionSource = requireSourceDocument(questionDocument.sourceDocumentId)
    const questionOcrRecord = latestOcrDocumentForSource(questionSource.id)
    const questionOcrDocument = loadOcrDocument(questionOcrRecord.id)
    const candidateMetadata = metadataForCandidates(importJob, questionSource)
    let candidates = parseQuestionCandidates(questionOcrDocument, { config, paperKind: candidateMetadata.paperKind })
    let diagnosticDocument = questionOcrDocument

    if (importJob.mode === 'separated_documents') {
      const solutionDocument = firstDocumentByRole(documents, 'solutions')
      if (!solutionDocument) throw new RouteError(400, '导入任务缺少 solutions 文档。')
      const solutionSource = requireSourceDocument(solutionDocument.sourceDocumentId)
      const solutionOcrRecord = latestOcrDocumentForSource(solutionSource.id)
      const solutionOcrDocument = loadOcrDocument(solutionOcrRecord.id)
      const solutionMatches = parseSolutionDocument(solutionOcrDocument, { config })
      candidates = mergeQuestionCandidatesWithSolutions(candidates, solutionMatches, solutionOcrDocument)
      diagnosticDocument = solutionOcrDocument
      sourceRepo.updateSourceDocument(solutionSource.id, { status: 'parsed' })
    }

    candidates = attachParserDiagnostics(diagnosticDocument, candidates, config)
    const { finalCandidates, nextStatus } = saveParsedCandidates(importJob, questionSource, questionOcrDocument.id, candidates)
    return {
      importJob: importJobRepo.getImportJob(importJob.id),
      mode: importJob.mode,
      status: nextStatus,
      ...candidateStatusCounts(finalCandidates),
      items: finalCandidates,
      diagnostics: getOcrFigureDiagnostics(questionOcrDocument.id, finalCandidates),
    }
  } catch (error) {
    importJobRepo.updateImportJob(importJob.id, { status: 'failed' })
    throw error
  }
}

export function deleteImportJob(id: string) {
  const importJob = requireImportJob(id)
  const documents = importJobRepo.listImportJobDocuments(id)

  for (const doc of documents) {
    try {
      deleteSourceDocument(doc.sourceDocumentId)
    } catch (err) {
      console.error(`Failed to delete source document ${doc.sourceDocumentId} for job ${id}:`, err)
    }
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM import_job_documents WHERE job_id = ?').run(id)
    db.prepare('DELETE FROM import_jobs WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  }

  return { success: true }
}

export function updateImportJob(id: string, body: Record<string, unknown>) {
  const importJob = requireImportJob(id)

  const updated = importJobRepo.updateImportJob(importJob.id, {
    title: body.title === undefined ? undefined : String(body.title),
    province: body.province === undefined ? undefined : String(body.province),
    city: body.city === undefined ? undefined : String(body.city),
    paperTitle: body.paperTitle === undefined ? undefined : String(body.paperTitle),
    batchName: body.batchName === undefined ? undefined : String(body.batchName),
    stage: body.stage === undefined ? undefined : String(body.stage),
    subject: body.subject === undefined ? undefined : String(body.subject),
    paperKind: body.paperKind === undefined ? undefined : String(body.paperKind) as any,
    examYear: body.examYear === undefined ? undefined : (body.examYear ? Number(body.examYear) : null) as any,
    sourceOrg: body.sourceOrg === undefined ? undefined : String(body.sourceOrg),
    status: body.status === undefined ? undefined : String(body.status) as any,
  })

  if (!updated) throw new RouteError(500, '更新导入任务失败。')

  const documents = importJobRepo.listImportJobDocuments(id)
  for (const doc of documents) {
    sourceRepo.updateSourceDocument(doc.sourceDocumentId, {
      province: updated.province,
      city: updated.city,
      paperTitle: updated.paperTitle,
      batchName: updated.batchName,
      stage: updated.stage,
      subject: updated.subject,
      paperKind: updated.paperKind,
      examYear: updated.examYear,
      sourceOrg: updated.sourceOrg,
    })

    const candidates = candidateRepo.listQuestionCandidates({ sourceDocumentId: doc.sourceDocumentId })
    for (const cand of candidates) {
      candidateRepo.updateQuestionCandidate(cand.id, {
        province: updated.province,
        city: updated.city,
        paperTitle: updated.paperTitle,
        batchName: updated.batchName,
        stage: updated.stage,
        subject: updated.subject,
        paperKind: updated.paperKind,
        examYear: updated.examYear,
        sourceOrg: updated.sourceOrg,
      })
    }
  }

  return { importJob: updated, documents }
}
