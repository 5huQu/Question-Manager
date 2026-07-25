import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import { dataDir } from '../../../config.js'
import * as candidateRepo from '../../../repositories/question-candidates.repo.js'
import type { CandidateFigure, CandidateFigureUsage, UpdateQuestionCandidateInput } from '../../../types/question-candidate.js'
import { RouteError } from '../../../utils/http-error.js'
import { createId } from '../../../utils/ids.js'
import { imageExtension } from '../../../utils/image-operations.js'
import { revalidateAllCandidatesForSourceDocument } from '../candidate-validation.service.js'
import { withImmediateTransaction } from './helpers.js'

export function updateQuestionCandidate(id: string, body: Record<string, unknown>) {
  const patch = { ...((body.candidate || body) as UpdateQuestionCandidateInput) }
  if (patch.expectedContentRevision === undefined && body.expectedContentRevision !== undefined) {
    patch.expectedContentRevision = Number(body.expectedContentRevision)
  }
  const before = candidateRepo.getQuestionCandidate(id)
  if (!before) throw new RouteError(404, '候选题不存在。')
  const contentFields = ['stemMarkdown', 'answerText', 'analysisMarkdown'] as const
  const hasContentPatch = contentFields.some((field) => patch[field] !== undefined)
  if (before.status === 'committed' && hasContentPatch) {
    throw new RouteError(409, '候选题已入库，请编辑对应的正式题。', undefined, {
      error: 'candidate_committed',
      message: '候选题已入库，请编辑对应的正式题。',
      committedQuestionId: before.committedQuestionId || '',
    })
  }
  if (patch.expectedContentRevision !== undefined && Number(patch.expectedContentRevision) !== Number(before.contentRevision || 1)) {
    throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。', undefined, {
      error: 'content_revision_conflict',
      message: '内容已在其他页面更新，请刷新后重试。',
      expectedContentRevision: Number(patch.expectedContentRevision),
      actualContentRevision: Number(before.contentRevision || 1),
      current: before,
    })
  }
  const finalUpdated = withImmediateTransaction(() => {
    const updated = candidateRepo.updateQuestionCandidate(id, patch)
    if (!updated) {
      const current = candidateRepo.getQuestionCandidate(id)
      if (!current) throw new RouteError(404, '候选题不存在。')
      throw new RouteError(409, '内容已在其他页面更新，请刷新后重试。', undefined, {
        error: 'content_revision_conflict',
        message: '内容已在其他页面更新，请刷新后重试。',
        expectedContentRevision: Number(patch.expectedContentRevision),
        actualContentRevision: current.contentRevision,
        current,
      })
    }
    revalidateAllCandidatesForSourceDocument(updated.sourceDocumentId)
    return candidateRepo.getQuestionCandidate(id)
  })
  if (!finalUpdated) throw new RouteError(404, '候选题不存在。')
  return { candidate: finalUpdated }
}

export function uploadCandidateFigure(id: string, file: Express.Multer.File | undefined, body: Record<string, unknown>) {
  const candidate = candidateRepo.getQuestionCandidate(id)
  if (!candidate) throw new RouteError(404, '候选题不存在。')
  if (candidate.status === 'committed') throw new RouteError(409, '该候选题已入库，不能再上传题图。')
  if (!file) throw new RouteError(400, '请上传一个图片文件。')
  if (!String(file.mimetype || '').startsWith('image/')) throw new RouteError(400, '只能上传图片文件。')

  const requestedUsage = String(body.usage || 'stem')
  const usage: CandidateFigureUsage = ['stem', 'analysis', 'options'].includes(requestedUsage)
    ? requestedUsage as CandidateFigureUsage
    : 'stem'
  const optionLabel = usage === 'options' && /^[A-D]$/i.test(String(body.optionLabel || ''))
    ? String(body.optionLabel).toUpperCase()
    : undefined
  if (usage === 'options' && !optionLabel) throw new RouteError(400, '请选择图片对应的选项。')

  const figureId = createId('fig')
  const extension = imageExtension(file.originalname, file.mimetype)
  const outputRel = path.join('data', 'import-flow-v2', 'candidate-figures', id, `${figureId}${extension}`)
  const outputPath = path.join(dataDir, 'import-flow-v2', 'candidate-figures', id, `${figureId}${extension}`)
  const figure: CandidateFigure = {
    id: figureId,
    origin: 'manual_upload',
    originalName: file.originalname,
    usage,
    path: outputRel,
    ...(optionLabel ? { optionLabel } : {}),
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, file.buffer)
  try {
    const updated = candidateRepo.updateQuestionCandidate(id, { figures: [...candidate.figures, figure] })
    if (!updated) throw new RouteError(409, '题图上传时内容已发生变化，请刷新后重试。')
    revalidateAllCandidatesForSourceDocument(candidate.sourceDocumentId)
    return { figure, candidate: candidateRepo.getQuestionCandidate(id) }
  } catch (error) {
    fs.rmSync(outputPath, { force: true })
    throw error
  }
}
