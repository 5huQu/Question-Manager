export { parseTeachingDocument, validateTeachingDocument, serializeTeachingDocument, generateBlockId, migrateDocumentIds, hasFatalTeachingDocumentIssues } from './validate'
export { getBoxTemplate, getBoxTemplateOrFallback, getAllBoxTemplates, registerBoxTemplate, resetBoxTemplateRegistry, toneStyleVariables, BUILTIN_BOX_TEMPLATES } from './boxTemplates'
export type { BoxTemplateDefinition, BoxToneStyle } from './boxTemplates'
export { boxBodyPaddingStyle, boxBodyStyle, boxFrameStyle, hasValidBoxAppearance, parseBoxAppearance, skinBoxBodyStyle, skinBoxFrameStyle } from './boxAppearance'
export {
  defineBoxSkin,
  defineHeadingSkin,
  hasValidTeachingSkinRef,
  parseTeachingSkinRef,
  resolveBoxSkin,
  resolveHeadingSkin,
  skinClassName,
  teachingSkinRegistry,
} from './skins'
export type { BoxSkinDefinition, HeadingSkinDefinition, TeachingSkinDefinition, TeachingSkinResolution } from './skins'
export { FIGURE_LAYOUT_PRESETS, FIGURE_LAYOUT_PRESET_IDS, isFigureLayoutPreset, resolveFigureLayout } from './figureLayoutPresets'
export type { FigureLayoutPreset, FigureLayoutPresetDefinition } from './figureLayoutPresets'
export { markdownToTeachingBlocks, teachingBlocksToMarkdown, parseInlineMarkdown } from './markdownCompat'
export type { MarkdownConversionResult } from './markdownCompat'
export { buildDocumentOutline, headingLabelByBlockId } from './outline'
export type { DocumentOutline, DocumentOutlineEntry, DocumentOutlineDiagnostic } from './outline'
export {
  teachingInlinesToTiptapDoc,
  tiptapDocToTeachingInlines,
  hasProtectedInlineContent,
  protectedInlineReason,
  pastedHtmlToSafeInlines,
} from './inlineAdapter'
export {
  applyTeachingDocumentCommand,
  questionSequenceSignature,
  renumberAutomaticQuestionNumbers,
  createTeachingDocumentHistory,
  executeTeachingDocumentCommand,
  newTeachingBlock,
  blocksForRawMarkdownFigureInsertion,
  redoTeachingDocument,
  undoTeachingDocument,
} from './editorState'
export type { TeachingDocumentCommand, TeachingDocumentHistory } from './editorState'
export { TeachingDocumentAutosave } from './autosave'
export type { AutosaveState } from './autosave'
export { questionOnlyDocument } from './wrongQuestionCollection'
export {
  TYPOGRAPHY_PRESETS,
  typographyPresetForDocumentType,
  typographyStyleForPreset,
  resolveHeadingStyle,
  resolveQuestionStyle,
  teachingDocumentLayoutCssVars,
  teachingTypographyCssVars,
} from './lectureFonts'
export * from './layout'
