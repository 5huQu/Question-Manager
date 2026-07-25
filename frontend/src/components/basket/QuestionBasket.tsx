import { useSearchParams } from 'react-router-dom'
import { useBasketState } from './useBasketState'
import { BasketPageView } from './BasketPageView'
import { BasketDrawerView } from './BasketDrawerView'

export function QuestionBasket({ mode = 'drawer' }: { mode?: 'drawer' | 'page' }) {
  const [searchParams] = useSearchParams()
  const state = useBasketState(mode === 'page' ? { initialPaperId: searchParams.get('paper') } : undefined)

  // Hide the floating drawer globally if we are on the dedicated basket page
  if (mode === 'drawer' && state.isBasketPage) {
    return null
  }

  if (mode === 'page') {
    return <BasketPageView state={state} />
  }

  return <BasketDrawerView state={state} />
}
