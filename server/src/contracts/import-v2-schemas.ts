import { schema, type RuntimeSchema } from './runtime-schema.js'

const string = schema.string()
const nonEmptyString = schema.string({ minLength: 1 })
const integer = schema.number({ integer: true })
const nonNegativeInteger = schema.number({ integer: true, min: 0 })
const stringList = schema.array(string)
const bbox = schema.tuple(schema.number(), schema.number(), schema.number(), schema.number())

const solutionBindingStrategies = ['heading_then_question', 'question_then_heading', 'auto'] as const
const metadataBlockPolicies = ['ignore', 'append_to_analysis', 'store_as_note'] as const
const answerTablePolicies = ['disabled', 'fill_empty_only', 'override_metadata_like_answer', 'prefer_table_for_choice_questions'] as const
const candidateStatuses = ['ready', 'needs_review', 'needs_manual_fix', 'blocked', 'committed'] as const
const figureUsages = ['stem', 'analysis', 'options', 'unknown'] as const
const sourceRefKinds = ['stem', 'answer', 'analysis', 'figure', 'unknown'] as const
const paperKinds = ['gaokao_real', 'local_real', 'mock', 'school_exam', 'lecture', 'daily_practice', 'unknown'] as const
const candidateIssueCodes = [
  'missing_question_no', 'duplicate_question_no', 'missing_stem', 'missing_answer', 'missing_analysis',
  'missing_solution', 'solution_conflict', 'unmatched_solution', 'unplaced_figure', 'possible_cross_page',
  'formula_parse_error', 'markdown_render_error', 'possible_presentation_noise', 'manual_review_required',
  'image_download_failed',
] as const

export const parserConfigSchema = schema.object({
  version: schema.number({ integer: true, min: 1 }),
  sectionHeadings: stringList,
  documentNoteKeywords: stringList,
  lectureNonQuestionSectionKeywords: stringList,
  solutionSectionKeywords: stringList,
  primaryQuestionPatterns: stringList,
  subQuestionPatterns: stringList,
  allowParenthesizedNumberAsPrimary: schema.boolean(),
  figureKeywords: stringList,
  solutionBindingStrategy: schema.string({ enum: solutionBindingStrategies }),
  metadataBlockKeywords: stringList,
  metadataBlockPolicy: schema.string({ enum: metadataBlockPolicies }),
  answerTablePolicy: schema.string({ enum: answerTablePolicies }),
})

export const partialParserConfigSchema = { ...parserConfigSchema, partial: true } as RuntimeSchema

export const parserPresetInputSchema = schema.object({
  id: schema.optional(string),
  name: nonEmptyString,
  description: schema.optional(string),
  config: parserConfigSchema,
})

export const parserPresetPatchSchema = schema.object({
  name: schema.optional(nonEmptyString),
  description: schema.optional(string),
  config: schema.optional(parserConfigSchema),
}, { partial: true })

const parserPresetSchema = schema.object({
  id: nonEmptyString,
  name: nonEmptyString,
  description: string,
  config: parserConfigSchema,
  createdAt: string,
  updatedAt: string,
  builtIn: schema.optional(schema.boolean()),
})

export const parserConfigEnvelopeSchema = schema.object({ config: parserConfigSchema })
export const parserPresetListSchema = schema.object({ items: schema.array(parserPresetSchema) })
export const parserPresetMutationSchema = schema.object({
  preset: parserPresetSchema,
  items: schema.array(parserPresetSchema),
})
export const parserPresetDeleteSchema = schema.object({
  success: schema.boolean(),
  items: schema.array(parserPresetSchema),
})

export const parseCandidatesRequestSchema = schema.object({
  configOverride: schema.optional(partialParserConfigSchema),
  presetId: schema.optional(string),
})

export const parserPreviewRequestSchema = schema.object({
  config: schema.optional(partialParserConfigSchema),
  focusQuestionNo: schema.optional(string),
  candidateId: schema.optional(string),
  candidateIds: schema.optional(schema.array(nonEmptyString)),
})

const figureSchema = schema.object({
  id: nonEmptyString,
  usage: schema.string({ enum: figureUsages }),
  path: string,
  origin: schema.optional(string),
  originalName: schema.optional(string),
  sourceDocumentId: schema.optional(string),
  blockId: schema.optional(string),
  sourceBlockId: schema.optional(string),
  pageNo: schema.optional(integer),
  bbox: schema.optional(bbox),
  inlineMarker: schema.optional(string),
  optionLabel: schema.optional(string),
})

const sourceRefSchema = schema.object({
  sourceDocumentId: schema.optional(string),
  pageNo: integer,
  blockIds: schema.array(string),
  bbox: schema.optional(bbox),
  kind: schema.string({ enum: sourceRefKinds }),
})

const candidateIssueSchema = schema.object({
  code: schema.string({ enum: candidateIssueCodes }),
  severity: schema.string({ enum: ['warning', 'error'] }),
  message: string,
  relatedBlockIds: schema.optional(schema.array(string)),
  relatedFigures: schema.optional(schema.array(figureSchema)),
})

const candidateDiagnosticSchema = schema.object({
  code: nonEmptyString,
  severity: schema.string({ enum: ['info', 'warning', 'error'] }),
  questionNo: schema.optional(string),
  message: string,
  start: schema.optional(nonNegativeInteger),
  end: schema.optional(nonNegativeInteger),
})

const candidatePatchProperties = {
  ocrDocumentId: schema.optional(string),
  questionNo: schema.optional(string),
  stemMarkdown: schema.optional(string),
  answerText: schema.optional(string),
  analysisMarkdown: schema.optional(string),
  questionType: schema.optional(string),
  difficultyScore10: schema.optional(schema.number({ min: 0, max: 10 })),
  difficultyLabel: schema.optional(string),
  knowledgePoints: schema.optional(stringList),
  solutionMethods: schema.optional(stringList),
  figures: schema.optional(schema.array(figureSchema)),
  sourceRefs: schema.optional(schema.array(sourceRefSchema)),
  status: schema.optional(schema.string({ enum: candidateStatuses })),
  province: schema.optional(string), city: schema.optional(string), paperTitle: schema.optional(string),
  batchName: schema.optional(string), stage: schema.optional(string), subject: schema.optional(string),
  paperKind: schema.optional(schema.string({ enum: paperKinds })),
  examYear: schema.optional(integer), sourceOrg: schema.optional(string),
  committedQuestionId: schema.optional(string), committedAt: schema.optional(string),
  issues: schema.optional(schema.array(candidateIssueSchema)),
  parseDiagnostics: schema.optional(schema.array(candidateDiagnosticSchema)),
  parserConfigSnapshot: schema.optional(schema.union(parserConfigSchema, schema.object({}))),
  expectedContentRevision: schema.optional(nonNegativeInteger),
}

export const candidatePatchSchema = schema.object(candidatePatchProperties, { partial: true })
export const candidateUpdateRequestSchema = schema.object({
  candidate: schema.optional(candidatePatchSchema),
  expectedContentRevision: schema.optional(nonNegativeInteger),
})

export const candidateSchema = schema.object({
  id: nonEmptyString,
  sourceDocumentId: nonEmptyString,
  ocrDocumentId: schema.optional(string),
  questionNo: string,
  stemMarkdown: string,
  answerText: string,
  analysisMarkdown: string,
  contentRevision: schema.optional(nonNegativeInteger),
  questionType: schema.optional(string),
  difficultyScore10: schema.optional(schema.number({ min: 0, max: 10 })),
  difficultyLabel: schema.optional(string),
  knowledgePoints: stringList,
  solutionMethods: stringList,
  figures: schema.array(figureSchema),
  sourceRefs: schema.array(sourceRefSchema),
  status: schema.string({ enum: candidateStatuses }),
  province: string, city: string, paperTitle: string, batchName: string, stage: string, subject: string,
  paperKind: schema.string({ enum: paperKinds }), examYear: integer, sourceOrg: string,
  committedQuestionId: schema.optional(string), committedAt: schema.optional(string),
  issues: schema.array(candidateIssueSchema),
  parseDiagnostics: schema.array(candidateDiagnosticSchema),
  parserConfigSnapshot: schema.union(parserConfigSchema, schema.object({})),
  createdAt: string, updatedAt: string,
})

const diagnosticsSchema = schema.object({
  placeholderCount: nonNegativeInteger,
  assetsCount: nonNegativeInteger,
  unmatchedPlaceholderCount: nonNegativeInteger,
  unusedAssetsCount: nonNegativeInteger,
  failedDownloadCount: nonNegativeInteger,
})

export const candidateListResponseSchema = schema.object({
  items: schema.array(candidateSchema),
  diagnostics: schema.optional(diagnosticsSchema),
})

export const parseCandidatesResponseSchema = schema.object({
  candidateCount: nonNegativeInteger, readyCount: nonNegativeInteger, needsReviewCount: nonNegativeInteger,
  needsManualFixCount: schema.optional(nonNegativeInteger), blockedCount: nonNegativeInteger,
  items: schema.array(candidateSchema), diagnostics: schema.optional(diagnosticsSchema),
  importJob: schema.optional(schema.object({}, { allowUnknown: true })),
  mode: schema.optional(schema.string({ enum: ['single_document', 'separated_documents'] })),
  status: schema.optional(schema.string({ enum: ['draft', 'parsing', 'parsed', 'partially_parsed', 'failed'] })),
})

export const candidateIdsSchema = schema.object({ candidateIds: schema.array(nonEmptyString, { minLength: 1 }) })
export const candidateResolveFigureSchema = schema.object({
  action: schema.string({ enum: ['assign', 'ignore'] }),
  targetCandidateId: schema.optional(string),
  usage: schema.optional(schema.string({ enum: ['stem', 'analysis'] })),
})
export const candidateMoveFigureSchema = schema.object({
  targetCandidateId: nonEmptyString,
  usage: schema.string({ enum: ['stem', 'analysis', 'options'] }),
  optionLabel: schema.optional(schema.string({ enum: ['A', 'B', 'C', 'D'] })),
  sourceExpectedContentRevision: schema.optional(nonNegativeInteger),
  targetExpectedContentRevision: schema.optional(nonNegativeInteger),
})

export const candidateEnvelopeSchema = schema.object({ candidate: candidateSchema })
export const candidatePairEnvelopeSchema = schema.object({
  sourceCandidate: schema.nullable(candidateSchema),
  targetCandidate: schema.nullable(candidateSchema),
})

const markdownRangeSchema = schema.object({ start: nonNegativeInteger, end: nonNegativeInteger })
const parserDiagnosticSchema = schema.object({
  code: schema.string({ enum: ['solution_heading_without_following_question', 'question_before_solution_heading', 'metadata_used_as_answer', 'table_answer_blocked_by_existing_answer', 'missing_analysis', 'unmatched_solution'] }),
  severity: schema.string({ enum: ['info', 'warning', 'error'] }),
  questionNo: schema.optional(string), message: string,
  start: schema.optional(nonNegativeInteger), end: schema.optional(nonNegativeInteger),
  suggestedConfigPatch: schema.optional(partialParserConfigSchema),
})
export const parserPreviewResponseSchema = schema.object({
  config: parserConfigSchema,
  strategyRecommendation: schema.optional(schema.object({
    strategy: schema.string({ enum: solutionBindingStrategies }), reason: string, confidence: schema.number({ min: 0, max: 1 }),
  })),
  structures: schema.array(schema.object({
    id: nonEmptyString,
    kind: schema.string({ enum: ['page_marker', 'question_no', 'sub_question_no', 'answer_table', 'solution_heading', 'metadata_heading', 'stem_range', 'answer_range', 'analysis_range'] }),
    questionNo: schema.optional(string), start: nonNegativeInteger, end: nonNegativeInteger,
    lineStart: schema.number({ integer: true, min: 1 }), lineEnd: schema.number({ integer: true, min: 1 }),
    label: string, severity: schema.optional(schema.string({ enum: ['info', 'warning', 'error'] })),
  })),
  candidatePreviews: schema.array(schema.object({
    questionNo: string, stemPreview: string, answerPreview: string, analysisPreview: string,
    sourceRanges: schema.object({
      stem: schema.optional(markdownRangeSchema), answer: schema.optional(markdownRangeSchema), analysis: schema.optional(markdownRangeSchema),
    }),
    issues: schema.array(parserDiagnosticSchema),
  })),
  diagnostics: schema.array(parserDiagnosticSchema),
})

export const markdownPreviewResponseSchema = schema.object({
  ocrDocumentId: nonEmptyString,
  sourceDocumentId: nonEmptyString,
  provider: string,
  markdown: string,
  lineOffsets: schema.array(schema.object({
    lineNo: schema.number({ integer: true, min: 1 }),
    start: nonNegativeInteger,
    end: nonNegativeInteger,
  })),
  pageMarkers: schema.array(schema.object({
    pageNo: nonNegativeInteger,
    offset: nonNegativeInteger,
    lineNo: schema.number({ integer: true, min: 1 }),
  })),
})

export const exportRecordSchema = schema.object({
  id: nonEmptyString,
  sourceType: schema.string({ enum: ['collection', 'run', 'import_job'] }),
  collectionId: string, runId: string, importJobId: string, title: string, format: string, variant: string,
  filename: string, path: string, url: string,
  items: schema.array(schema.object({ questionId: nonEmptyString, exportOrder: schema.number({ integer: true, min: 1 }) })),
  snapshot: schema.record(),
  contentLength: nonNegativeInteger, questionCount: nonNegativeInteger,
  status: schema.string({ enum: ['succeeded', 'failed'] }), error: string, createdAt: string,
})
export const exportRequestSchema = schema.object({
  title: schema.optional(string),
  template: schema.optional(schema.string({ enum: ['exam', 'worksheet'] })),
  variant: schema.optional(schema.string({ enum: ['student', 'teacher', 'error_notebook'] })),
  format: schema.optional(schema.string({ enum: ['pdf'] })),
})
export const exportResponseSchema = schema.object({
  filename: nonEmptyString,
  format: schema.string({ enum: ['pdf'] }),
  url: nonEmptyString,
  path: schema.optional(string),
  exportRecord: schema.optional(exportRecordSchema),
})
export const exportRecordListResponseSchema = schema.object({ items: schema.array(exportRecordSchema) })

export const candidateUploadResponseSchema = schema.object({
  figure: figureSchema,
  candidate: candidateSchema,
})
export const candidateCommitResponseSchema = schema.object({
  candidate: candidateSchema,
  item: schema.object({}, { allowUnknown: true }),
  classificationReports: schema.nullable(schema.unknown()),
})
export const candidateBatchCommitResponseSchema = schema.object({
  success: nonNegativeInteger,
  failed: nonNegativeInteger,
  items: schema.array(schema.object({}, { allowUnknown: true })),
  errors: schema.array(schema.object({ id: nonEmptyString, error: string })),
  classificationReports: schema.nullable(schema.unknown()),
})
export const candidateSkipResponseSchema = schema.object({
  success: nonNegativeInteger,
  skippedIds: schema.array(nonEmptyString),
})
