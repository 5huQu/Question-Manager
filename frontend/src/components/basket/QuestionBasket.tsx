import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useBasketState } from './useBasketState'
import { BasketPageView } from './BasketPageView'
import { BasketDrawerView } from './BasketDrawerView'
import { BasketSnapshotSheet } from './BasketSnapshotSheet'

export function QuestionBasket({ mode = 'drawer' }: { mode?: 'drawer' | 'page' }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useBasketState(mode === 'page' ? { initialPaperId: searchParams.get('paper') } : undefined)
  const [snapshotsOpen, setSnapshotsOpen] = useState(() => (
    mode === 'page' && searchParams.get('snapshots') === '1'
  ))

  // 兼容已分享或历史保留的 ?snapshots=1 链接：首次进入直接打开抽屉，
  // 随后清除参数，避免关闭抽屉后被 URL 状态重新打开。
  useEffect(() => {
    if (mode !== 'page' || searchParams.get('snapshots') !== '1') return
    setSnapshotsOpen(true)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('snapshots')
      return next
    }, { replace: true })
  }, [mode, searchParams, setSearchParams])

  // Hide the floating drawer globally if we are on the dedicated basket page
  if (mode === 'drawer' && state.isBasketPage) {
    return null
  }

  if (mode === 'page') {
    return (
      <>
        <BasketPageView state={state} onSnapshotsOpenChange={setSnapshotsOpen} />
        <BasketSnapshotSheet open={snapshotsOpen} onOpenChange={setSnapshotsOpen} state={state} />
      </>
    )
  }

  return (
    <>
      <BasketDrawerView state={state} onSnapshotsOpenChange={setSnapshotsOpen} />
      <BasketSnapshotSheet open={snapshotsOpen} onOpenChange={setSnapshotsOpen} state={state} />
    </>
  )
}
