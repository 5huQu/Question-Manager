import type { OCRBBox } from './ocr-document.js'
import type { PaperKind } from '../utils/import-metadata.js'

export type QuestionCandidateStatus = 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked' | 'committed'

export type CandidateFigureUsage = 'stem' | 'analysis' | 'options' | 'unknown'

export type CandidateSourceRefKind = 'stem' | 'answer' | 'analysis' | 'figure' | 'unknown'

export type CandidateIssueCode =
  | 'missing_question_no'
  | 'duplicate_question_no'
  | 'missing_stem'
  | 'missing_answer'
  | 'missing_analysis'
  | 'missing_solution'
  | 'solution_conflict'
  | 'unmatched_solution'
  | 'unplaced_figure'
  | 'possible_cross_page'
  | 'formula_parse_error'
  | 'markdown_render_error'
  | 'possible_presentation_noise'
  | 'manual_review_required'
  | 'image_download_failed'

export type CandidateIssueSeverity = 'warning' | 'error'

export type CandidateFigure = {
  id: string
  usage: CandidateFigureUsage
  path: string
  origin?: 'manual_upload' | string
  originalName?: string
  sourceDocumentId?: string
  blockId?: string
  sourceBlockId?: string
  pageNo?: number
  bbox?: OCRBBox
  inlineMarker?: string
  optionLabel?: string
}

export type CandidateSourceRef = {
  sourceDocumentId?: string
  pageNo: number
  blockIds: string[]
  bbox?: OCRBBox
  kind: CandidateSourceRefKind
}

export type CandidateIssue = {
  code: CandidateIssueCode
  severity: CandidateIssueSeverity
  message: string
  relatedBlockIds?: string[]
  relatedFigures?: CandidateFigure[]
}

export type CandidateParseDiagnostic = {
  code: string
  severity: 'info' | 'warning' | 'error'
  questionNo?: string
  message: string
  start?: number
  end?: number
}

export type QuestionCandidate = {
  id: string
  sourceDocumentId: string
  ocrDocumentId?: string
  questionNo: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  contentRevision?: number
  questionType?: string
  difficultyScore10?: number
  difficultyLabel?: string
  knowledgePoints: string[]
  solutionMethods: string[]
  figures: CandidateFigure[]
  sourceRefs: CandidateSourceRef[]
  status: QuestionCandidateStatus
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: PaperKind
  examYear: number
  sourceOrg: string
  committedQuestionId?: string
  committedAt?: string
  issues: CandidateIssue[]
  parseDiagnostics: CandidateParseDiagnostic[]
  parserConfigSnapshot: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type QuestionCandidateRow = {
  id: string
  source_document_id: string
  ocr_document_id: string
  question_no: string
  stem_markdown: string
  answer_text: string
  analysis_markdown: string
  content_revision: number
  question_type: string
  difficulty_score_10: number
  difficulty_label: string
  knowledge_points_json: string
  solution_methods_json: string
  figures_json: string
  source_refs_json: string
  status: QuestionCandidateStatus
  province?: string
  city?: string
  paper_title?: string
  batch_name?: string
  stage?: string
  subject?: string
  paper_kind?: string
  exam_year?: number
  source_org?: string
  committed_question_id: string
  committed_at: string
  issues_json: string
  parse_diagnostics_json: string
  parser_config_snapshot_json: string
  created_at: string
  updated_at: string
}

export type CreateQuestionCandidateInput = {
  id?: string
  sourceDocumentId: string
  ocrDocumentId?: string
  questionNo?: string
  stemMarkdown?: string
  answerText?: string
  analysisMarkdown?: string
  questionType?: string
  difficultyScore10?: number
  difficultyLabel?: string
  knowledgePoints?: string[]
  solutionMethods?: string[]
  figures?: CandidateFigure[]
  sourceRefs?: CandidateSourceRef[]
  status?: QuestionCandidateStatus
  province?: string
  city?: string
  paperTitle?: string
  batchName?: string
  stage?: string
  subject?: string
  paperKind?: PaperKind
  examYear?: number
  sourceOrg?: string
  committedQuestionId?: string
  committedAt?: string
  issues?: CandidateIssue[]
  parseDiagnostics?: CandidateParseDiagnostic[]
  parserConfigSnapshot?: Record<string, unknown>
}

export type UpdateQuestionCandidateInput = Partial<{
  expectedContentRevision: number
  ocrDocumentId: string
  questionNo: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  questionType: string
  difficultyScore10: number
  difficultyLabel: string
  knowledgePoints: string[]
  solutionMethods: string[]
  figures: CandidateFigure[]
  sourceRefs: CandidateSourceRef[]
  status: QuestionCandidateStatus
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: PaperKind
  examYear: number
  sourceOrg: string
  committedQuestionId: string
  committedAt: string
  issues: CandidateIssue[]
  parseDiagnostics: CandidateParseDiagnostic[]
  parserConfigSnapshot: Record<string, unknown>
}>
