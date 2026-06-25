import type { OCRBBox } from './ocr-document.js'
import type { PaperKind } from '../utils/import-metadata.js'

export type QuestionCandidateStatus = 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked' | 'committed'

export type CandidateFigureUsage = 'stem' | 'analysis' | 'option' | 'unknown'

export type CandidateSourceRefKind = 'stem' | 'answer' | 'analysis' | 'figure' | 'unknown'

export type CandidateIssueCode =
  | 'missing_question_no'
  | 'duplicate_question_no'
  | 'missing_stem'
  | 'missing_answer'
  | 'missing_analysis'
  | 'unmatched_solution'
  | 'unplaced_figure'
  | 'possible_cross_page'
  | 'formula_parse_error'
  | 'markdown_render_error'
  | 'manual_review_required'
  | 'image_download_failed'

export type CandidateIssueSeverity = 'warning' | 'error'

export type CandidateFigure = {
  id: string
  usage: CandidateFigureUsage
  path: string
  blockId?: string
  sourceBlockId?: string
  pageNo?: number
  bbox?: OCRBBox
  inlineMarker?: string
}

export type CandidateSourceRef = {
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
}

export type QuestionCandidate = {
  id: string
  sourceDocumentId: string
  ocrDocumentId?: string
  questionNo: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
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
}

export type UpdateQuestionCandidateInput = Partial<{
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
}>
