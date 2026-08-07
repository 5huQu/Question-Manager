import { useCallback, useEffect, useMemo, useState } from 'react'
import { questionBankApi } from '@/api/questionBank'
import { ApiError } from '@/api/client'
import type { FigureAssetRef, TeachingDocumentV1 } from '@/types/teachingDocument'
import type { QuestionResolution } from '@/components/teaching-document/blocks/BlockRenderer'
import { assetUrl } from '@/utils/questionDisplay'

type DocumentAsset = { id: string; url: string }

export function useTeachingDocumentQuestions(props: {
  document: TeachingDocumentV1 | null
  assets?: DocumentAsset[]
}) {
  const [questionMap, setQuestionMap] = useState<Record<string, QuestionResolution>>({})
  const questionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const block of props.document?.content || []) {
      if (block.type === 'question' && block.questionId) ids.add(block.questionId)
      if (block.type === 'box') {
        for (const child of block.children) {
          if (child.type === 'question' && child.questionId) ids.add(child.questionId)
        }
      }
    }
    return [...ids]
  }, [props.document])

  useEffect(() => {
    const missing = questionIds.filter((id) => !questionMap[id])
    if (!missing.length) return
    setQuestionMap((current) => Object.fromEntries([
      ...Object.entries(current),
      ...missing.map((id) => [id, { status: 'loading' as const }]),
    ]))
    for (const id of missing) {
      questionBankApi.getItem(id)
        .then((question) => setQuestionMap((current) => ({ ...current, [id]: question })))
        .catch((error) => setQuestionMap((current) => ({
          ...current,
          [id]: error instanceof ApiError && error.status === 404
            ? { status: 'missing', message: `题目不存在（ID: ${id}）` }
            : { status: 'error', message: error instanceof Error ? error.message : String(error) },
        })))
    }
  }, [questionIds, questionMap])

  const assetMap = useMemo(
    () => new Map((props.assets ?? []).map((asset) => [asset.id, asset.url])),
    [props.assets],
  )
  const resolveQuestion = useCallback(
    (id: string) => questionMap[id] || { status: 'missing' as const, message: `题目不可用（ID: ${id || '未设置'}）` },
    [questionMap],
  )
  const resolveFigure = useCallback((asset: FigureAssetRef) => {
    if (asset.type === 'documentAsset') return assetMap.get(asset.assetId) || { status: 'missing' as const }
    if (asset.type === 'legacyPath') return asset.path ? assetUrl(asset.path) : { status: 'missing' as const }
    const question = questionMap[asset.questionId]
    if (!question || ('status' in question && question.status === 'loading')) return { status: 'loading' as const }
    if ('status' in question) return question.status === 'error'
      ? { status: 'error' as const, message: question.message }
      : { status: 'missing' as const, message: question.message }
    const figure = question.figures?.find((item) => String(item.id || item.blockId || '') === asset.figureId)
    return figure?.path ? assetUrl(figure.path) : { status: 'missing' as const }
  }, [assetMap, questionMap])

  return { questionIds, questionMap, setQuestionMap, resolveQuestion, resolveFigure }
}
