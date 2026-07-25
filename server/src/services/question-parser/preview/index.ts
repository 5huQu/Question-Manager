export type {
  CandidateParsePreview,
  LineOffset,
  MarkdownPreviewResponse,
  MarkdownStructureToken,
  MarkdownStructureTokenKind,
  ParserDiagnostic,
  ParserPreviewRequest,
  ParserPreviewResponse,
  PreviewSolutionMatch,
  TableAnswerEntry,
} from './types.js'
export { buildMarkdownPreview, cleanPreviewText, lineNoForOffset, lineOffsetsFor, PAGE_MARKER_RE, textForRange, tokenFor } from './markdown-utils.js'
export {
  containsAnswerTable,
  containsQuestionSectionHeading,
  isMetadataLike,
  metadataKeywordForLine,
  normalizeHeadingLine,
  simpleChoiceAnswer,
  titleMatchesConfiguredSection,
} from './section-detection.js'
export { applyAnswerTablePolicy, cloneMatches, extractQuestionThenHeadingMatches, mergePreviewMatch } from './match-extraction.js'
export { candidatePreviewsFromMatches, diagnosticsForCandidate, recognizedCandidateDiagnostics, strategyDiagnostics } from './diagnostics.js'
export { buildParserPreview } from './preview-builder.js'
