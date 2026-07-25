import type { CandidateParseDiagnostic } from '../../../types/question-candidate.js'
import type { ImportFlowV2ParserConfig, SolutionBindingStrategy } from '../default-parser-config.js'
import type { MarkdownRange, SolutionMatch } from '../solution-matcher.js'

export type MarkdownPreviewResponse = {
  ocrDocumentId: string
  sourceDocumentId: string
  provider: string
  markdown: string
  lineOffsets: Array<{ lineNo: number; start: number; end: number }>
  pageMarkers: Array<{ pageNo: number; offset: number; lineNo: number }>
}

export type MarkdownStructureTokenKind =
  | 'page_marker'
  | 'question_no'
  | 'sub_question_no'
  | 'answer_table'
  | 'solution_heading'
  | 'metadata_heading'
  | 'stem_range'
  | 'answer_range'
  | 'analysis_range'

export type MarkdownStructureToken = {
  id: string
  kind: MarkdownStructureTokenKind
  questionNo?: string
  start: number
  end: number
  lineStart: number
  lineEnd: number
  label: string
  severity?: 'info' | 'warning' | 'error'
}

export type ParserDiagnostic = {
  code: CandidateParseDiagnostic['code']
  severity: 'info' | 'warning' | 'error'
  questionNo?: string
  message: string
  start?: number
  end?: number
  suggestedConfigPatch?: Partial<ImportFlowV2ParserConfig>
}

export type CandidateParsePreview = {
  questionNo: string
  stemPreview: string
  answerPreview: string
  analysisPreview: string
  sourceRanges: {
    stem?: MarkdownRange
    answer?: MarkdownRange
    analysis?: MarkdownRange
  }
  issues: ParserDiagnostic[]
}

export type ParserPreviewRequest = {
  config?: Partial<ImportFlowV2ParserConfig>
  focusQuestionNo?: string
  candidateId?: string
  candidateIds?: string[]
}

export type ParserPreviewResponse = {
  config: ImportFlowV2ParserConfig
  strategyRecommendation?: {
    strategy: SolutionBindingStrategy
    reason: string
    confidence: number
  }
  structures: MarkdownStructureToken[]
  candidatePreviews: CandidateParsePreview[]
  diagnostics: ParserDiagnostic[]
}

export type LineOffset = MarkdownPreviewResponse['lineOffsets'][number]
export type TableAnswerEntry = { questionNo: string; answerText: string; range: MarkdownRange }
export type PreviewSolutionMatch = SolutionMatch & {
  stemMarkdown?: string
  stemRange?: MarkdownRange
}
