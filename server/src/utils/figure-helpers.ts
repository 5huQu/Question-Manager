/**
 * Backward-compatible barrel – all implementation lives in ./figures/.
 * Existing imports of 'utils/figure-helpers' continue to work unchanged.
 */
export {
  imageMimeType,
  imageExtension,
  figureAbsolutePath,
  imageDimensions,
} from './figures/image-basics.js'

export {
  cropFigureImage,
  cropFigureImageAsync,
  splitReviewImage,
  mergeReviewImages,
} from './figures/pil-operations.js'

export {
  loadCutResultRecord,
  loadSolutionCutResultRecord,
} from './figures/cut-results.js'

export {
  normalizedFigureId,
  expandedReviewBBox,
  rawReviewBBox,
  reviewSegmentBBox,
  figurePixelBBoxForSegments,
  reviewFigurePixelBBox,
  reviewFigureDefaultUsage,
  answerOrAnalysisBoundary,
  reviewFigureReadingKey,
  reviewSegmentReadingKey,
  type ReviewRow,
} from './figures/review-bbox.js'

export {
  normalizedRectangle,
  rectanglesOverlap,
  isFormulaSuspectFigure,
  isManualFigure,
  glmFigureMatchesConfirmedReviewFigure,
  glmFigureIsBoundToReviewFigure,
  figureBelongsToReview,
  sliceImagePathForOcrResult,
  sourceImagePathForOcrResult,
} from './figures/figure-belonging.js'

export {
  providerFigureWithExistingAsset,
  sourceFiguresForImportedOcrResult,
  figuresForImportedOcrResult,
  figuresForImportedOcrResultAsync,
  figuresForSolutionItem,
} from './figures/imported-ocr-figures.js'

export { bindInlineImageReferences } from './figures/inline-binding.js'

export { bindExplicitAttachments } from './figures/explicit-attachments.js'
