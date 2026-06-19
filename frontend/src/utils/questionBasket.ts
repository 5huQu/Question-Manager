import { api, jsonHeaders } from '@/api/client'
import { getActiveCollectionId, notifyBasketUpdated } from '@/components/QuestionBasket'

export async function addQuestionToActiveBasket(questionId: string) {
  const collectionId = getActiveCollectionId()
  await api(`/api/question-bank/collections/${encodeURIComponent(collectionId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ addQuestionIds: [questionId] }),
  })
  notifyBasketUpdated()
}
