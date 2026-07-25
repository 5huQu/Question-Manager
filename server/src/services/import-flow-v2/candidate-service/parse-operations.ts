import * as sourceRepo from '../../../repositories/source-documents.repo.js'
import * as ocrRepo from '../../../repositories/ocr-documents.repo.js'
import * as candidateRepo from '../../../repositories/question-candidates.repo.js'
import type { CandidateParseDiagnostic, QuestionCandidate } from '../../../types/question-candidate.js'
import { RouteError } from '../../../utils/http-error.js'
import { buildParserPreview, parseQuestionCandidates } from '../../question-parser/index.js'
import { parserConfigForRequest } from '../../question-parser/parser-config.js'
import type { ImportFlowV2ParserConfig } from '../../question-parser/default-parser-config.js'
import {
  refreshCandidateParseDiagnostics,
  validationIssueDiagnostics,
} from '../../question-parser/candidate-validator.js'
import { revalidateAllCandidatesForSourceDocument } from '../candidate-validation.service.js'
import { getOcrFigureDiagnostics } from '../figure-mapping.js'
import { loadOcrDocument } from '../ocr-document.service.js'
import { candidateStatusCounts, enrichUnplacedFigureIssues, liveValidateCandidates, normalizeCandidateStatus, normalizeListLimit, normalizeListOffset, withImmediateTransaction } from './helpers.js'
import { sourceMetadata } from './source-metadata.js'

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
