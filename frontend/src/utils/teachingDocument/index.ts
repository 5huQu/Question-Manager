export { parseTeachingDocument, validateTeachingDocument, serializeTeachingDocument, generateBlockId, migrateDocumentIds, hasFatalTeachingDocumentIssues } from './validate'
export { getBoxTemplate, getBoxTemplateOrFallback, getAllBoxTemplates, registerBoxTemplate, resetBoxTemplateRegistry, toneStyleVariables, BUILTIN_BOX_TEMPLATES } from './boxTemplates'
export type { BoxTemplateDefinition, BoxToneStyle } from './boxTemplates'
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
