/**
 * Backward-compatible barrel – all implementation lives in ./export/.
 * Existing imports of './export.js' continue to work unchanged.
 */
export type { ExportCollection, ExportVariant, StandardExportVariant, ExportContentField } from './export/types.js'
export { normalizeExportVariant, exportFieldsForVariant } from './export/types.js'
export { collectionQuestionRows, escapeLatex, sectionOrdinal, collectionSectionNames, markdownQuestionLine, stripLeadingScore } from './export/collection-helpers.js'
export { questionForExport, assertQuestionExportable, assertCollectionExportable, buildQuestionSetWorksheetCollection } from './export/question-validation.js'
export { buildCollectionErrorNotebookMarkdown, buildCollectionErrorNotebookLatex, exportCollectionErrorNotebookPdf } from './export/error-notebook.js'
export { buildCollectionMarkdown } from './export/collection-markdown.js'
export { buildCollectionLatex } from './export/collection-latex.js'
export { buildCollectionWorksheetLatex } from './export/worksheet-latex.js'
export { exportCollectionWorksheetPdf, exportCollectionWorksheetPdfWithDiagnostics, exportQuestionSetPdf } from './export/worksheet-pdf.js'
export { splitChoiceStemForExport } from '../../utils/exam-zh.js'
