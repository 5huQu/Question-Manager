import * as candidateRepo from '../../../repositories/question-candidates.repo.js'
import type { OCRDocument } from '../../../types/ocr-document.js'
import type { CandidateFigure, CandidateFigureUsage, QuestionCandidate } from '../../../types/question-candidate.js'
import { RouteError } from '../../../utils/http-error.js'
import {
  refreshCandidateParseDiagnostics,
} from '../../question-parser/candidate-validator.js'
import { figureForBlock } from '../../question-parser/figure-linker.js'
import { revalidateAllCandidatesForSourceDocument } from '../candidate-validation.service.js'
import { loadOcrDocument } from '../ocr-document.service.js'
import {
  assertContentRevision,
  figureIdentifiers,
  insertFigureMarker,
  removeFigureMarkup,
  sameFigure,
  sourceRefsWithoutFigure,
  sourceRefsWithFigure,
} from './figure-operations.js'
import { withImmediateTransaction } from './helpers.js'

export function moveCandidateFigure(id: string, figureId: string, body: Record<string, unknown>) {
  const sourceCandidate = candidateRepo.getQuestionCandidate(id)
  if (!sourceCandidate) throw new RouteError(404, '候选题不存在。')
  if (sourceCandidate.status === 'committed') throw new RouteError(409, '该候选题已入库，不能再移动图片。')
  assertContentRevision(sourceCandidate, body.sourceExpectedContentRevision)

  const sourceFigure = sourceCandidate.figures.find((figure) =>
    [figure.id, figure.blockId, figure.sourceBlockId].filter(Boolean).some((value) => String(value) === figureId),
  )
  if (!sourceFigure) throw new RouteError(404, '未找到需要移动的图片，请刷新后重试。')

  const targetCandidateId = String(body.targetCandidateId || '').trim()
  if (!targetCandidateId) throw new RouteError(400, '请选择目标题目。')
  const targetCandidate = candidateRepo.getQuestionCandidate(targetCandidateId)
  if (!targetCandidate) throw new RouteError(404, '目标候选题不存在。')
  if (targetCandidate.sourceDocumentId !== sourceCandidate.sourceDocumentId) {
    throw new RouteError(400, '图片只能移动到同一份资料中的题目。')
  }
  if (targetCandidate.status === 'committed') throw new RouteError(409, '目标题目已入库，不能再添加图片。')
  if (targetCandidate.id !== sourceCandidate.id) assertContentRevision(targetCandidate, body.targetExpectedContentRevision)

  const requestedUsage = String(body.usage || sourceFigure.usage || 'stem')
  const usage: CandidateFigureUsage = ['stem', 'analysis', 'options'].includes(requestedUsage)
    ? requestedUsage as CandidateFigureUsage
    : 'stem'
  const optionLabel = usage === 'options' && /^[A-D]$/i.test(String(body.optionLabel || ''))
    ? String(body.optionLabel).toUpperCase()
    : undefined
  if (usage === 'options' && !optionLabel) throw new RouteError(400, '请选择图片对应的选项。')

  let document: OCRDocument | undefined
  if (sourceCandidate.ocrDocumentId) {
    try {
      document = loadOcrDocument(sourceCandidate.ocrDocumentId)
    } catch {
      // Manually uploaded figures can outlive their original OCR document.
    }
  }
  const block = document?.pages.flatMap((page) => page.blocks).find((item) =>
    (Boolean(sourceFigure.sourceBlockId) && item.id === sourceFigure.sourceBlockId)
    || (Boolean(sourceFigure.blockId) && item.id === sourceFigure.blockId)
    || (Boolean(sourceFigure.id) && item.assetId === sourceFigure.id)
    || (Boolean(sourceFigure.blockId) && item.assetId === sourceFigure.blockId),
  )
  const identifiers = figureIdentifiers(sourceFigure, block)
  const markerId = sourceFigure.blockId || sourceFigure.id
  const referenceBlockId = sourceFigure.sourceBlockId || block?.id || sourceFigure.blockId || sourceFigure.id
  const movedFigure: CandidateFigure = { ...sourceFigure, usage, optionLabel }
  if (usage !== 'options') delete movedFigure.optionLabel

  const removeFromContent = (candidate: QuestionCandidate) => ({
    stemMarkdown: removeFigureMarkup(candidate.stemMarkdown, identifiers, sourceFigure.path),
    answerText: removeFigureMarkup(candidate.answerText, identifiers, sourceFigure.path),
    analysisMarkdown: removeFigureMarkup(candidate.analysisMarkdown, identifiers, sourceFigure.path),
  })

  const result = withImmediateTransaction(() => {
    const sourceContent = removeFromContent(sourceCandidate)
    const sourceFigures = sourceCandidate.figures.filter((figure) => !sameFigure(figure, identifiers))
    const sourceRefs = sourceRefsWithoutFigure(sourceCandidate.sourceRefs, identifiers, document)

    if (targetCandidate.id === sourceCandidate.id) {
      const content = { ...sourceContent }
      if (usage === 'analysis') content.analysisMarkdown = insertFigureMarker(content.analysisMarkdown, markerId, usage)
      else content.stemMarkdown = insertFigureMarker(content.stemMarkdown, markerId, usage, optionLabel)
      const updated = candidateRepo.updateQuestionCandidate(sourceCandidate.id, {
        ...content,
        figures: [...sourceFigures, movedFigure],
        sourceRefs: sourceRefsWithFigure(sourceRefs, movedFigure, referenceBlockId),
        expectedContentRevision: sourceCandidate.contentRevision,
      })
      if (!updated) throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。')
    } else {
      const targetContent = removeFromContent(targetCandidate)
      if (usage === 'analysis') targetContent.analysisMarkdown = insertFigureMarker(targetContent.analysisMarkdown, markerId, usage)
      else targetContent.stemMarkdown = insertFigureMarker(targetContent.stemMarkdown, markerId, usage, optionLabel)
      const updatedSource = candidateRepo.updateQuestionCandidate(sourceCandidate.id, {
        ...sourceContent,
        figures: sourceFigures,
        sourceRefs,
        expectedContentRevision: sourceCandidate.contentRevision,
      })
      const targetIdentifiers = figureIdentifiers(movedFigure, block)
      const updatedTarget = candidateRepo.updateQuestionCandidate(targetCandidate.id, {
        ...targetContent,
        figures: [...targetCandidate.figures.filter((figure) => !sameFigure(figure, targetIdentifiers)), movedFigure],
        sourceRefs: sourceRefsWithFigure(
          sourceRefsWithoutFigure(targetCandidate.sourceRefs, targetIdentifiers, document),
          movedFigure,
          referenceBlockId,
        ),
        expectedContentRevision: targetCandidate.contentRevision,
      })
      if (!updatedSource || !updatedTarget) throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。')
    }
    revalidateAllCandidatesForSourceDocument(sourceCandidate.sourceDocumentId)
    return {
      sourceCandidate: candidateRepo.getQuestionCandidate(sourceCandidate.id),
      targetCandidate: candidateRepo.getQuestionCandidate(targetCandidate.id),
    }
  })
  return result
}

export function resolveCandidateUnplacedFigure(id: string, blockId: string, body: Record<string, unknown>) {
  const sourceCandidate = candidateRepo.getQuestionCandidate(id)
  if (!sourceCandidate) throw new RouteError(404, '候选题不存在。')
  if (sourceCandidate.status === 'committed') throw new RouteError(409, '该候选题已入库，不能再处理待归属图片。')

  const issueExists = sourceCandidate.issues.some((issue) =>
    issue.code === 'unplaced_figure' && issue.relatedBlockIds?.includes(blockId),
  )
  if (!issueExists) throw new RouteError(404, '未找到该待归属图片提示，请刷新后重试。')

  const action = String(body.action || 'assign')
  if (!['assign', 'ignore'].includes(action)) throw new RouteError(400, '图片处理方式不正确。')
  const nextIssues = sourceCandidate.issues.flatMap((issue) => {
    if (issue.code !== 'unplaced_figure' || !issue.relatedBlockIds?.includes(blockId)) return [issue]
    const relatedBlockIds = issue.relatedBlockIds.filter((item) => item !== blockId)
    if (!relatedBlockIds.length) return []
    return [{
      ...issue,
      relatedBlockIds,
      relatedFigures: (issue.relatedFigures || []).filter((figure) => figure.sourceBlockId !== blockId && figure.blockId !== blockId),
    }]
  })
  const nextParseDiagnostics = refreshCandidateParseDiagnostics({ ...sourceCandidate, issues: nextIssues }, nextIssues)

  let targetCandidate = sourceCandidate
  withImmediateTransaction(() => {
    if (action === 'ignore') {
      candidateRepo.updateQuestionCandidate(id, { issues: nextIssues, parseDiagnostics: nextParseDiagnostics })
      return
    }

    const targetCandidateId = String(body.targetCandidateId || id)
    targetCandidate = candidateRepo.getQuestionCandidate(targetCandidateId) as QuestionCandidate
    if (!targetCandidate) throw new RouteError(404, '目标候选题不存在。')
    if (targetCandidate.sourceDocumentId !== sourceCandidate.sourceDocumentId) {
      throw new RouteError(400, '图片只能归属到同一份资料中的题目。')
    }
    if (targetCandidate.status === 'committed') throw new RouteError(409, '目标题目已入库，不能再添加图片。')
    if (!sourceCandidate.ocrDocumentId) throw new RouteError(400, '候选题缺少 OCR 文档关联。')

    const document = loadOcrDocument(sourceCandidate.ocrDocumentId)
    const block = document.pages.flatMap((page) => page.blocks).find((item) => item.id === blockId)
    if (!block) throw new RouteError(404, '未找到图片对应的 OCR 块。')
    const usage = String(body.usage || 'stem') === 'analysis' ? 'analysis' : 'stem'
    const figure = figureForBlock(document, block, usage)
    if (!figure?.path) throw new RouteError(404, '未找到图片文件。')

    const figures = [
      ...targetCandidate.figures.filter((item) => item.id !== figure.id && item.sourceBlockId !== blockId),
      figure,
    ]
    const matchingRef = targetCandidate.sourceRefs.find((ref) =>
      ref.kind === 'figure' && ref.sourceDocumentId === document.sourceDocumentId && ref.pageNo === block.pageNo,
    )
    const sourceRefs = matchingRef
      ? targetCandidate.sourceRefs.map((ref) => ref === matchingRef ? {
        ...ref,
        blockIds: Array.from(new Set([...ref.blockIds, blockId])),
        bbox: ref.bbox || block.bbox,
      } : ref)
      : [...targetCandidate.sourceRefs, {
        sourceDocumentId: document.sourceDocumentId,
        pageNo: block.pageNo,
        blockIds: [blockId],
        bbox: block.bbox,
        kind: 'figure' as const,
      }]

    if (targetCandidate.id === sourceCandidate.id) {
      candidateRepo.updateQuestionCandidate(id, { figures, sourceRefs, issues: nextIssues, parseDiagnostics: nextParseDiagnostics })
    } else {
      candidateRepo.updateQuestionCandidate(targetCandidate.id, { figures, sourceRefs })
      candidateRepo.updateQuestionCandidate(id, { issues: nextIssues, parseDiagnostics: nextParseDiagnostics })
    }
  })
  revalidateAllCandidatesForSourceDocument(sourceCandidate.sourceDocumentId)
  return {
    sourceCandidate: candidateRepo.getQuestionCandidate(id),
    targetCandidate: candidateRepo.getQuestionCandidate(targetCandidate.id),
  }
}
