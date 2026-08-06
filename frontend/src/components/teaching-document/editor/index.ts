/**
 * 文档级编辑器模块导出
 */
export { DocumentEditor, type DocumentEditorProps, type DocumentEditorInstance } from './DocumentEditor'
export { createDocumentEditorExtensions } from './schema'
export { teachingDocumentToEditorDoc, editorDocToTeachingDocument, type EditorDocMeta } from './serialization'
export {
  DOCUMENT_LAYOUT_CHANGE_SET_META,
  DocumentStructuralChangeSet,
  deleteTopLevelTeachingBlock,
  insertTopLevelTeachingBlock,
  mergeStructuralChangeSets,
  structuralTransactionChangeSet,
} from './structuralActions'
export { ResolverProvider, PaperProvider, paperContentWidthMm, type DocumentEditorResolvers } from './NodeViews'
export { ResizeCommands, RESIZE_MERGE_META } from './resizeCommands'
export {
  ImageResizeOverlay,
  SpacerResizeHandle,
  useFigureResizeKeyboard,
  useSpacerResizeKeyboard,
} from './ResizeHandles'
export {
  MIN_FIGURE_WIDTH_MM,
  MIN_SPACER_HEIGHT_MM,
  MAX_SPACER_HEIGHT_MM,
  SPACER_SNAP_MM,
  KEYBOARD_STEP_MM,
  KEYBOARD_SHIFT_STEP_MM,
  RESIZE_MERGE_WINDOW_MS,
  clampFigureWidthMm,
  clampSpacerHeightMm,
  snapSpacerHeightMm,
  shouldMergeResize,
  nextResizeMergeState,
  mmToPx,
  pxToMm,
  roundMm,
  type ResizeMergeState,
} from './resizeLogic'
export { TeachingDocumentCanvas, type TeachingDocumentCanvasProps, type TeachingCanvasMode } from './TeachingDocumentCanvas'
export { usePagination, type UsePaginationOptions, type UsePaginationResult } from './usePagination'
export {
  createLayoutCoordinatorKey,
  TeachingDocumentLayoutCoordinator,
  type LayoutCoordinatorEvent,
  type LayoutCoordinatorRequest,
  type LayoutCoordinatorRequestHandle,
  type LayoutCoordinatorSnapshot,
  type LayoutCoordinatorStatus,
  type LayoutCoordinatorVariant,
  type LayoutCoordinatorWorkResult,
} from './layoutCoordinator'
