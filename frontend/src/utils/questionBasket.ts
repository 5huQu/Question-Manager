import { collectionsApi } from '@/api/collections'
import { getActiveCollectionId, notifyBasketUpdated } from '@/components/QuestionBasket'

export async function addQuestionToActiveBasket(questionId: string) {
  const collectionId = getActiveCollectionId()
  await collectionsApi.updateCollection(collectionId, { addQuestionIds: [questionId] })
  notifyBasketUpdated()
}
