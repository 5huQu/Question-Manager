import { collectionsApi } from '@/api/collections'
import { notifyBasketUpdated } from '@/components/QuestionBasket'

/** 全应用唯一的试题篮（默认集合 'basket'）是"加入试题篮"的固定目标。 */
export const BASKET_COLLECTION_ID = 'basket'

export async function addQuestionToBasket(questionId: string) {
  await collectionsApi.updateCollection(BASKET_COLLECTION_ID, { addQuestionIds: [questionId] })
  notifyBasketUpdated()
}
