import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export type RunStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'
export type ReviewStatus = 'pending' | 'submitted'
export type BankStatus = 'blocked' | 'ready' | 'banked' | 'skipped'
export type MaterialType = 'exam' | 'lecture' | 'unknown'
export type FileRole = 'full' | 'questions' | 'solutions' | 'unknown'
export type WorkflowMode = 'single' | 'separated_exam'
export type WorkflowStatus = 'ready' | 'needs_classification' | 'processing' | 'ready_for_bank' | 'needs_review'
export type OcrProvider = 'legacy' | 'doc2x'

export type RichInline =
  | { type: 'text'; text: string }
  | { type: 'inline_math'; tex: string }

export type RichBlock =
  | { type: 'paragraph'; content: RichInline[] }
  | { type: 'display_math'; tex: string }
  | { type: 'choices'; options: Array<{ label: string; blocks: RichBlock[] }> }
  | { type: 'table'; rows: Array<{ header?: boolean; cells: RichInline[][] }> }

export type BatchRow = {
  id: string
  title: string
  material_type: MaterialType
  workflow_mode: WorkflowMode
  workflow_status: WorkflowStatus
  created_at: string
  uploaded_count: number
}

export type RunRow = {
  run_id: string
  batch_id: string
  upload_mode: string
  paper_title: string
  pdf_name: string
  pdf_path: string
  source_file_name: string
  source_file_kind: string
  material_type: MaterialType
  file_role: FileRole
  stage: string
  classification_confidence: number
  classification_reasons_json: string
  run_dir: string
  document_diagnostics_json: string
  created_at: string
  updated_at: string
  slice_status: RunStatus
  slice_error: string
  quick_review_status: ReviewStatus
  total_questions: number
  approved_questions: number
  unreviewed_questions: number
  ocr_status: RunStatus
  ocr_error: string
  ocr_started_at: string
  ocr_finished_at: string
  ocr_provider: string
  ocr_external_uid: string
  ocr_provider_phase: string
  ocr_provider_progress: number
  ocr_provider_result_path: string
  rules_version: number
  rules_hash: string
  rules_fallback_used: number
  rules_warnings_json: string
}

export type SlicerRuleEntry = { id: string; term: string; matchMode: 'contains' | 'exact'; enabled: boolean }
export type SlicerRulesData = Record<string, unknown> & { version: number }

export const SLICER_RULES_CATEGORIES = ['auxiliaryMarkers', 'noticeTerms', 'referenceFormulaMarkers', 'trainingMarkers', 'nonQuestionRemainders', 'sectionMarkers'] as const
export const VALID_MATCH_MODES = ['contains', 'exact']

export type QuestionRow = {
  id: string
  serial_no: number
  question_no: string
  stage: string
  question_type: string
  difficulty_score: number
  difficulty_score_10: number
  difficulty_label: string
  chapter: string
  knowledge_points_json: string
  solution_methods_json: string
  source_title: string
  bank_status: BankStatus
  stem_markdown: string
  answer_text: string
  analysis_markdown: string
  search_text: string
  slice_image_path: string
  figures_json: string
  source_run_id: string
  source_solution_run_id: string
  merge_status: string
  merge_note: string
  format_review_required: number
  format_review_reasons_json: string
  created_at: string
  updated_at: string
}

export type SolutionRow = {
  id: string
  batch_id: string
  source_run_id: string
  question_no: string
  answer_text: string
  analysis_markdown: string
  figures_json: string
  source_image_path: string
  match_status: string
  matched_question_id: string
  match_note: string
  created_at: string
  updated_at: string
}

export type ReviewRow = {
  result_id: string
  run_id: string
  question_label: string
  page_start: number
  page_end: number
  page_image_path: string
  auto_image_path: string
  bbox_json: string
  segments_json: string
  text_regions_json: string
  figures_json: string
  review_status: string
  note: string
  created_at: string
  updated_at: string
}

export type CollectionRow = {
  id: string
  title: string
  subtitle: string
  description: string
  kind: string
  status: string
  total_score: number
  time_limit: number
  export_format: string
  created_at: string
  updated_at: string
}

export type CollectionItemRow = QuestionRow & {
  relation_id: string
  collection_id: string
  collection_title: string
  sort_order: number
  score: number
  section_name: string
}

export type ExportRecordSourceType = 'collection' | 'run'
export type ExportRecordRow = {
  id: string
  source_type: ExportRecordSourceType
  collection_id: string
  run_id: string
  title: string
  format: string
  variant: string
  filename: string
  path: string
  url: string
  items_json: string
  content_length: number
  question_count: number
  status: string
  error: string
  created_at: string
}

export type ExportRecordItemSnapshot = {
  questionId: string
  exportOrder: number
}

export const activeOcrProcesses = new Map<string, ChildProcessWithoutNullStreams>()
export const duplicateSimilarityThreshold = 0.62
