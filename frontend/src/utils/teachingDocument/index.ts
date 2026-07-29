export { parseTeachingDocument, validateTeachingDocument, serializeTeachingDocument, generateBlockId, migrateDocumentIds, hasFatalTeachingDocumentIssues } from './validate'
export { getBoxTemplate, getBoxTemplateOrFallback, getAllBoxTemplates, registerBoxTemplate, resetBoxTemplateRegistry, toneStyleVariables, BUILTIN_BOX_TEMPLATES } from './boxTemplates'
export type { BoxTemplateDefinition, BoxToneStyle } from './boxTemplates'
export { FIGURE_LAYOUT_PRESETS, FIGURE_LAYOUT_PRESET_IDS, isFigureLayoutPreset, resolveFigureLayout } from './figureLayoutPresets'
export type { FigureLayoutPreset, FigureLayoutPresetDefinition } from './figureLayoutPresets'
export { markdownToTeachingBlocks, teachingBlocksToMarkdown, parseInlineMarkdown } from './markdownCompat'
export type { MarkdownConversionResult } from './markdownCompat'
export {
  teachingInlinesToTiptapDoc,
  tiptapDocToTeachingInlines,
  hasProtectedInlineContent,
  protectedInlineReason,
  pastedHtmlToSafeInlines,
} from './inlineAdapter'
export {
  applyTeachingDocumentCommand,
  renumberAutomaticQuestionNumbers,
  createTeachingDocumentHistory,
  executeTeachingDocumentCommand,
  newTeachingBlock,
  redoTeachingDocument,
  undoTeachingDocument,
} from './editorState'
export type { TeachingDocumentCommand, TeachingDocumentHistory } from './editorState'
export { TeachingDocumentAutosave } from './autosave'
export type { AutosaveState } from './autosave'
export * from './layout'
