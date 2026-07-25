import { normalizeQuestionType, stripLeadingQuestionNo } from '../../../utils/question-type.js'
import { markdownWithInlineFigures, questionPlainText } from '../../../utils/figure-export.js'
import type { QuestionRow } from '../../../types/index.js'
import type { ExportCollection } from './types.js'

export function collectionQuestionRows(collection: ExportCollection): QuestionRow[] {
  return collection.questions.map((entry, index) => {
    const item = entry.item as Record<string, any>
    return {
      id: String(item.id || entry.relationId || `question-${index + 1}`),
      serial_no: Number(item.serialNo || index + 1),
      question_no: String(item.questionNo || index + 1),
      stage: String(item.stage || '高三'),
      question_type: String(item.questionType || ''),
      difficulty_score: Number(item.difficultyScore || 0),
      difficulty_score_10: Number(item.difficultyScore10 || 0),
      difficulty_label: String(item.difficultyLabel || ''),
      chapter: String(item.chapter || ''),
      knowledge_points_json: JSON.stringify(item.knowledgePoints || []),
      solution_methods_json: JSON.stringify(item.solutionMethods || []),
      source_title: String(item.sourceTitle || ''),
      province: String(item.province || ''),
      city: String(item.city || ''),
      paper_title: String(item.paperTitle || ''),
      batch_name: String(item.batchName || ''),
      subject: String(item.subject || ''),
      paper_kind: item.paperKind || 'unknown',
      exam_year: Number(item.examYear || 0),
      source_org: String(item.sourceOrg || ''),
      import_source_id: String(item.importSourceId || ''),
      bank_status: item.bankStatus || 'ready',
      stem_markdown: String(item.stemMarkdown || ''),
      answer_text: String(item.answerText || ''),
      analysis_markdown: String(item.analysisMarkdown || ''),
      content_revision: Number(item.contentRevision || 1),
      total_score: Number(entry.score || item.totalScore || 0),
      scoring_rubric_json: JSON.stringify(item.scoringRubric || []),
      search_text: String(item.searchText || ''),
      slice_image_path: String(item.sliceImagePath || ''),
      figures_json: JSON.stringify(item.figures || []),
      source_run_id: String(item.sourceRunId || ''),
      source_solution_run_id: String(item.sourceSolutionRunId || ''),
      merge_status: String(item.mergeStatus || ''),
      merge_note: String(item.mergeNote || ''),
      format_review_required: item.needsFormatReview ? 1 : 0,
      format_review_reasons_json: JSON.stringify(item.formatIssue ? [item.formatIssue] : []),
      created_at: String(item.createdAt || collection.createdAt || ''),
      updated_at: String(item.updatedAt || collection.updatedAt || ''),
    } as QuestionRow
  })
}

/** Escape special LaTeX characters for text (non-math) segments. */
export function escapeLatex(value: string) {
  return questionPlainText(value)
    .replace(/([#%&])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\n{2,}/g, '\n\n')
}

export function sectionOrdinal(index: number) {
  const ordinals = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return ordinals[index] || String(index)
}

/** Build section-name hints from question types in the same order as index.ts. */
export function collectionSectionNames(rows: Array<Pick<QuestionRow, 'question_type' | 'stem_markdown' | 'answer_text'>>) {
  const sections = new Map<string, string>()
  let index = 0
  for (const row of rows) {
    const normalized = normalizeQuestionType(row.question_type, row.stem_markdown, row.answer_text)
    if (!sections.has(normalized)) {
      index += 1
      sections.set(normalized, `${sectionOrdinal(index)}、${normalized}`)
    }
  }
  return sections
}

/** Helper: insert inline figure references into a markdown question line. */
export function markdownQuestionLine(index: number, entry: any, figures: Array<Record<string, any>> = []) {
  const score = Number(entry.score || 0)
  const stem = markdownWithInlineFigures(
    stripLeadingQuestionNo(entry.item.stemMarkdown, entry.item.questionNo),
    figures,
  )
  const scoreText = score ? `（${score} 分）` : ''
  return `**${index}.** ${scoreText}${stem || '（题干待补充）'}`
}

export function stripLeadingScore(value: string) {
  return String(value || '').replace(/^\s*[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]\s*/, '').trimStart()
}
