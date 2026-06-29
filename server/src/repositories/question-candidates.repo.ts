import { db } from '../db/connection.js'
import type {
  CandidateFigure,
  CandidateIssue,
  CandidateParseDiagnostic,
  CandidateSourceRef,
  CreateQuestionCandidateInput,
  QuestionCandidate,
  QuestionCandidateRow,
  QuestionCandidateStatus,
  UpdateQuestionCandidateInput,
} from '../types/question-candidate.js'
import { createId, nowIso } from '../utils/ids.js'
import { normalizeImportMetadata, importMetadataPatch } from '../utils/import-metadata.js'
import { parseJson } from '../utils/json.js'

type SqlValue = string | number | bigint | null | Buffer

export type ListQuestionCandidatesFilters = {
  sourceDocumentId?: string
  ocrDocumentId?: string
  status?: QuestionCandidateStatus
  limit?: number
  offset?: number
}

function normalizeLimit(value: number | undefined, fallback = 200) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(1000, Math.floor(numeric)))
}

function normalizeOffset(value: number | undefined) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function normalizeScore10(value: number | undefined) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(10, Math.round(numeric)))
}

function stringifyArray(value: unknown[] | undefined) {
  return JSON.stringify(Array.isArray(value) ? value : [])
}

export function mapQuestionCandidate(row: QuestionCandidateRow): QuestionCandidate {
  const metadata = normalizeImportMetadata({
    province: row.province,
    city: row.city,
    paper_title: row.paper_title,
    batch_name: row.batch_name,
    stage: row.stage,
    subject: row.subject,
    paper_kind: row.paper_kind,
    exam_year: row.exam_year,
    source_org: row.source_org,
  })
  return {
    id: row.id,
    sourceDocumentId: row.source_document_id,
    ocrDocumentId: row.ocr_document_id || undefined,
    questionNo: row.question_no,
    stemMarkdown: row.stem_markdown,
    answerText: row.answer_text,
    analysisMarkdown: row.analysis_markdown,
    questionType: row.question_type || undefined,
    difficultyScore10: row.difficulty_score_10 || undefined,
    difficultyLabel: row.difficulty_label || undefined,
    knowledgePoints: parseJson<string[]>(row.knowledge_points_json || '[]', []),
    solutionMethods: parseJson<string[]>(row.solution_methods_json || '[]', []),
    figures: parseJson<CandidateFigure[]>(row.figures_json || '[]', []),
    sourceRefs: parseJson<CandidateSourceRef[]>(row.source_refs_json || '[]', []),
    status: row.status,
    ...metadata,
    committedQuestionId: row.committed_question_id || undefined,
    committedAt: row.committed_at || undefined,
    issues: parseJson<CandidateIssue[]>(row.issues_json || '[]', []),
    parseDiagnostics: parseJson<CandidateParseDiagnostic[]>(row.parse_diagnostics_json || '[]', []),
    parserConfigSnapshot: parseJson<Record<string, unknown>>(row.parser_config_snapshot_json || '{}', {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createQuestionCandidate(input: CreateQuestionCandidateInput) {
  const now = nowIso()
  const id = input.id || createId('candidate', input.questionNo || input.sourceDocumentId)
  const metadata = normalizeImportMetadata(input as Record<string, unknown>)
  db.prepare(`
    INSERT INTO question_candidates (
      id, source_document_id, ocr_document_id, question_no, stem_markdown, answer_text, analysis_markdown,
      question_type, difficulty_score_10, difficulty_label, knowledge_points_json, solution_methods_json,
      figures_json, source_refs_json, status, province, city, paper_title, batch_name, stage, subject, paper_kind, exam_year, source_org,
      committed_question_id, committed_at, issues_json, parse_diagnostics_json, parser_config_snapshot_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.sourceDocumentId,
    input.ocrDocumentId || '',
    input.questionNo || '',
    input.stemMarkdown || '',
    input.answerText || '',
    input.analysisMarkdown || '',
    input.questionType || '',
    normalizeScore10(input.difficultyScore10),
    input.difficultyLabel || '',
    stringifyArray(input.knowledgePoints),
    stringifyArray(input.solutionMethods),
    stringifyArray(input.figures),
    stringifyArray(input.sourceRefs),
    input.status || 'needs_review',
    metadata.province,
    metadata.city,
    metadata.paperTitle,
    metadata.batchName,
    metadata.stage,
    metadata.subject,
    metadata.paperKind,
    metadata.examYear,
    metadata.sourceOrg,
    input.committedQuestionId || '',
    input.committedAt || '',
    stringifyArray(input.issues),
    stringifyArray(input.parseDiagnostics),
    JSON.stringify(input.parserConfigSnapshot || {}),
    now,
    now,
  )
  return getQuestionCandidate(id)
}

export function getQuestionCandidate(id: string) {
  const row = db.prepare(`SELECT * FROM question_candidates WHERE id = ?`).get(id) as QuestionCandidateRow | undefined
  return row ? mapQuestionCandidate(row) : null
}

export function listQuestionCandidates(filters: ListQuestionCandidatesFilters = {}) {
  const where: string[] = []
  const values: SqlValue[] = []
  if (filters.sourceDocumentId) {
    where.push('source_document_id = ?')
    values.push(filters.sourceDocumentId)
  }
  if (filters.ocrDocumentId) {
    where.push('ocr_document_id = ?')
    values.push(filters.ocrDocumentId)
  }
  if (filters.status) {
    where.push('status = ?')
    values.push(filters.status)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = normalizeLimit(filters.limit)
  const offset = normalizeOffset(filters.offset)
  const rows = db.prepare(`
    SELECT * FROM question_candidates
    ${whereSql}
    ORDER BY
      CASE WHEN question_no GLOB '[0-9]*' THEN CAST(question_no AS INTEGER) ELSE 999999 END ASC,
      question_no ASC,
      created_at ASC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as QuestionCandidateRow[]
  return rows.map(mapQuestionCandidate)
}

export function updateQuestionCandidate(id: string, input: UpdateQuestionCandidateInput) {
  const assignments: string[] = []
  const values: SqlValue[] = []
  const add = (column: string, value: SqlValue | undefined) => {
    if (value === undefined) return
    assignments.push(`${column} = ?`)
    values.push(value)
  }

  add('ocr_document_id', input.ocrDocumentId)
  add('question_no', input.questionNo)
  add('stem_markdown', input.stemMarkdown)
  add('answer_text', input.answerText)
  add('analysis_markdown', input.analysisMarkdown)
  add('question_type', input.questionType)
  add('difficulty_score_10', input.difficultyScore10 === undefined ? undefined : normalizeScore10(input.difficultyScore10))
  add('difficulty_label', input.difficultyLabel)
  add('knowledge_points_json', input.knowledgePoints === undefined ? undefined : stringifyArray(input.knowledgePoints))
  add('solution_methods_json', input.solutionMethods === undefined ? undefined : stringifyArray(input.solutionMethods))
  add('figures_json', input.figures === undefined ? undefined : stringifyArray(input.figures))
  add('source_refs_json', input.sourceRefs === undefined ? undefined : stringifyArray(input.sourceRefs))
  add('status', input.status)
  const metadata = importMetadataPatch(input as Record<string, unknown>)
  add('province', metadata.province)
  add('city', metadata.city)
  add('paper_title', metadata.paperTitle)
  add('batch_name', metadata.batchName)
  add('stage', metadata.stage)
  add('subject', metadata.subject)
  add('paper_kind', metadata.paperKind)
  add('exam_year', metadata.examYear)
  add('source_org', metadata.sourceOrg)
  add('committed_question_id', input.committedQuestionId)
  add('committed_at', input.committedAt)
  add('issues_json', input.issues === undefined ? undefined : stringifyArray(input.issues))
  add('parse_diagnostics_json', input.parseDiagnostics === undefined ? undefined : stringifyArray(input.parseDiagnostics))
  add('parser_config_snapshot_json', input.parserConfigSnapshot === undefined ? undefined : JSON.stringify(input.parserConfigSnapshot || {}))

  if (!assignments.length) return getQuestionCandidate(id)
  add('updated_at', nowIso())
  db.prepare(`UPDATE question_candidates SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id)
  return getQuestionCandidate(id)
}

export function deleteQuestionCandidatesForOcrDocument(ocrDocumentId: string) {
  db.prepare('DELETE FROM question_candidates WHERE ocr_document_id = ?').run(ocrDocumentId)
}

export function deleteUncommittedQuestionCandidatesForSourceDocument(sourceDocumentId: string) {
  db.prepare(`
    DELETE FROM question_candidates
    WHERE source_document_id = ?
      AND status != 'committed'
  `).run(sourceDocumentId)
}

export function deleteQuestionCandidate(id: string) {
  db.prepare('DELETE FROM question_candidates WHERE id = ?').run(id)
}
