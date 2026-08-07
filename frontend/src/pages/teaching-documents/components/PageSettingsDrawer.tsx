import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { springPanel } from '@/components/teaching-document/motion'

export function PageSettingsDrawer(props: {
  open: boolean
  onClose: () => void
  printSettings: ReactNode
  fontSettings: ReactNode
  answerSettings: ReactNode
}) {
  const [tab, setTab] = useState<'print' | 'typography' | 'answers'>('print')
  const reduced = useReducedMotion()
  const tabs: Array<{ id: typeof tab; label: string }> = [
    { id: 'print', label: '页眉页脚' },
    { id: 'typography', label: '字体与题距' },
    { id: 'answers', label: '解答题' },
  ]
  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-label="页面设置">
      <motion.button
        type="button"
        aria-label="关闭页面设置"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 cursor-default bg-black/35 backdrop-blur-md dark:bg-black/55"
        onClick={props.onClose}
      />
      <motion.aside
        initial={reduced ? { opacity: 0 } : { x: '100%', opacity: 0.8 }}
        animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0 } : { x: '100%', opacity: 0 }}
        transition={reduced ? { duration: 0.15 } : springPanel}
        style={{ borderRadius: 0 }}
        className="question-edit-glass-dialog fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col !rounded-none border-l border-black/10 bg-white/95 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 dark:border-white/12 dark:bg-zinc-950/95"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-black/6 px-5 dark:border-white/8">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">页面设置</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">整份文档同步更新，不按页保存。</p>
          </div>
          <button type="button" onClick={props.onClose} className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-zinc-800 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">完成</button>
        </div>
        <div className="border-b border-black/6 bg-zinc-50/40 px-5 py-2.5 dark:border-white/8 dark:bg-zinc-900/40">
          <div role="tablist" aria-label="页面设置分类" className="question-edit-glass-tabs inline-flex items-center gap-1">
            {tabs.map((item) => (
              <button key={item.id} role="tab" aria-selected={tab === item.id} type="button" onClick={() => setTab(item.id)} className="inline-flex h-7.5 items-center justify-center whitespace-nowrap rounded-lg px-3.5 text-xs font-medium cursor-pointer transition-all active:scale-95">{item.label}</button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
              {tab === 'print' ? props.printSettings : null}
              {tab === 'typography' ? props.fontSettings : null}
              {tab === 'answers' ? props.answerSettings : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.aside>
    </div>
  )
}
