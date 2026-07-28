/**
 * Direction C: "Page Studio" (页面工作室)
 * 核心理念：所见即所得的页面排版体验
 * - 左侧页面缩略图 filmstrip
 * - 中央当前页大预览
 * - 底部浮动状态/操作栏
 * - 以"页"为单位浏览
 * - 块编辑通过双击弹出 bottom sheet
 * - 页面切换使用方向暗示动画
 */

import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import {
  ChevronLeft, ChevronRight, FileText, Layers, Pencil, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import type { MockBlock, MockBlockType } from './shared/types'
import { BLOCK_LABEL } from './shared/types'
import { createMockDocument, paginateMockBlocks, newMockBlock } from './mockData'
import { MockBlockRenderer } from './shared/MockBlockRenderer'
import { PressableButton, springPanel, springDefault } from './shared/MotionPrimitives'

export function DirectionC_PageStudio() {
  const [doc, setDoc] = useState(createMockDocument)
  const [currentPage, setCurrentPage] = useState(0)
  const [direction, setDirection] = useState(0)
  const [zoom, setZoom] = useState(0.85)
  const [editingBlock, setEditingBlock] = useState<MockBlock | null>(null)
  const reduced = useReducedMotion()

  const pages = useMemo(() => paginateMockBlocks(doc.blocks), [doc.blocks])
  const safeCurrentPage = Math.min(currentPage, pages.length - 1)
  const page = pages[safeCurrentPage]

  const goToPage = useCallback((index: number) => {
    setDirection(index > safeCurrentPage ? 1 : -1)
    setCurrentPage(Math.max(0, Math.min(index, pages.length - 1)))
  }, [safeCurrentPage, pages.length])

  const updateBlock = useCallback((id: string, patch: Partial<MockBlock>) => {
    setDoc((d) => ({
      ...d,
      blocks: d.blocks.map((b) => b.id === id ? { ...b, ...patch } : b),
    }))
    setEditingBlock((eb) => eb && eb.id === id ? { ...eb, ...patch } : eb)
  }, [])

  const totalBlocks = doc.blocks.length

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[500px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100/50 dark:border-zinc-800 dark:bg-zinc-900/30">
      <div className="flex min-h-0 flex-1">
        {/* ─── 左侧缩略图 Filmstrip ─── */}
        <aside className="flex w-[100px] shrink-0 flex-col border-r border-zinc-200 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="flex items-center gap-1 px-2 py-2 border-b border-zinc-100 dark:border-zinc-900">
            <Layers className="size-3 text-zinc-400" />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">页面</span>
          </div>
          <div className="flex-1 space-y-2 overflow-auto p-2">
            {pages.map((p, i) => (
              <motion.button
                key={i}
                type="button"
                onClick={() => goToPage(i)}
                layout={!reduced}
                transition={springDefault}
                className={`relative w-full rounded-lg border p-1.5 transition-all ${
                  i === safeCurrentPage
                    ? 'border-zinc-900 bg-white shadow-md dark:border-zinc-100 dark:bg-zinc-900'
                    : 'border-zinc-200 bg-white/60 hover:border-zinc-300 hover:shadow-sm dark:border-zinc-700 dark:bg-zinc-900/40'
                }`}
              >
                {/* 迷你页面预览 */}
                <div className="aspect-[210/297] w-full overflow-hidden rounded border border-zinc-100 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="space-y-0.5">
                    {p.blocks.slice(0, 5).map((b) => (
                      <div key={b.id} className={`rounded-sm ${
                        b.type === 'heading' ? 'h-1.5 w-3/4 bg-zinc-300 dark:bg-zinc-600'
                        : b.type === 'box' ? 'h-3 w-full bg-zinc-200 dark:bg-zinc-700'
                        : b.type === 'figure' ? 'h-2.5 w-full bg-zinc-100 dark:bg-zinc-800'
                        : 'h-1 w-full bg-zinc-100 dark:bg-zinc-800'
                      }`} />
                    ))}
                  </div>
                </div>
                <span className={`mt-1 block text-center text-[9px] font-medium ${i === safeCurrentPage ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}`}>
                  {i + 1}
                </span>
                {/* 当前页指示器 */}
                {i === safeCurrentPage && (
                  <motion.div
                    layoutId="page-indicator"
                    className="absolute -left-0.5 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-zinc-900 dark:bg-zinc-100"
                    transition={springPanel}
                  />
                )}
              </motion.button>
            ))}
          </div>
        </aside>

        {/* ─── 中央页面预览 ─── */}
        <section className="flex flex-1 flex-col overflow-hidden">
          {/* 缩放控制 */}
          <div className="flex items-center justify-center gap-2 py-2">
            <PressableButton onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
              <ZoomOut className="size-3.5" />
            </PressableButton>
            <span className="w-12 text-center text-[11px] font-medium text-zinc-500">{Math.round(zoom * 100)}%</span>
            <PressableButton onClick={() => setZoom((z) => Math.min(1.2, z + 0.1))} className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
              <ZoomIn className="size-3.5" />
            </PressableButton>
          </div>

          {/* 页面画布 */}
          <div className="flex-1 overflow-auto px-6 pb-6">
            <div className="flex justify-center">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={safeCurrentPage}
                  custom={direction}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: direction * -40 }}
                  transition={springDefault}
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
                >
                  {/* A4 页面 */}
                  <div className="w-[520px] rounded-sm border border-zinc-200 bg-white px-10 py-12 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
                    {/* 文档标题（仅第一页） */}
                    {safeCurrentPage === 0 && (
                      <h1 className="mb-8 text-center text-xl font-bold text-zinc-900 dark:text-zinc-100">{doc.title}</h1>
                    )}
                    {/* 页面内容 */}
                    <div className="space-y-2">
                      {page.blocks.map((block) => (
                        <div
                          key={block.id}
                          onDoubleClick={() => setEditingBlock(block)}
                          className="group cursor-default rounded-md px-1 py-0.5 transition-colors hover:bg-zinc-50 hover:ring-1 hover:ring-zinc-200 dark:hover:bg-zinc-900/30 dark:hover:ring-zinc-700"
                          title="双击编辑"
                        >
                          <MockBlockRenderer block={block} />
                          {/* 双击提示 */}
                          <div className="pointer-events-none absolute right-1 top-1 hidden group-hover:block">
                            <Pencil className="size-2.5 text-zinc-300" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>
      </div>

      {/* ─── 底部浮动状态栏 ─── */}
      <div className="flex h-11 shrink-0 items-center justify-between border-t border-zinc-200 bg-white/90 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <FileText className="size-3.5" />
            第 {safeCurrentPage + 1} / {pages.length} 页
          </span>
          <span className="text-[11px] text-zinc-400">{totalBlocks} 个块</span>
        </div>
        <div className="flex items-center gap-1">
          <PressableButton onClick={() => goToPage(safeCurrentPage - 1)} disabled={safeCurrentPage === 0} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900">
            <ChevronLeft className="size-4" />
          </PressableButton>
          <PressableButton onClick={() => goToPage(safeCurrentPage + 1)} disabled={safeCurrentPage >= pages.length - 1} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900">
            <ChevronRight className="size-4" />
          </PressableButton>
          <div className="mx-2 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
            已保存
          </span>
        </div>
      </div>

      {/* ─── Bottom Sheet 编辑 ─── */}
      <AnimatePresence>
        {editingBlock && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 bg-black/20 dark:bg-black/40"
              onClick={() => setEditingBlock(null)}
            />
            <motion.div
              initial={reduced ? { opacity: 0 } : { y: '100%' }}
              animate={reduced ? { opacity: 1 } : { y: 0 }}
              exit={reduced ? { opacity: 0 } : { y: '100%' }}
              transition={springPanel}
              className="absolute inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-zinc-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-zinc-700 dark:bg-zinc-950/95"
            >
              <div className="mx-auto max-w-lg">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-md bg-zinc-900 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                      {BLOCK_LABEL[editingBlock.type].slice(0, 1)}
                    </span>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{BLOCK_LABEL[editingBlock.type]}</span>
                  </div>
                  <PressableButton onClick={() => setEditingBlock(null)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    <X className="size-4" />
                  </PressableButton>
                </div>
                <BottomSheetEditor block={editingBlock} onUpdate={(patch) => updateBlock(editingBlock.id, patch)} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Bottom Sheet 编辑表单 ────────────────────────────────────────────────────

function BottomSheetEditor({ block, onUpdate }: { block: MockBlock; onUpdate: (patch: Partial<MockBlock>) => void }) {
  const fieldClass = 'mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900'
  const areaClass = 'mt-1 min-h-20 w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900'
  const labelClass = 'block text-xs font-medium text-zinc-500'

  return (
    <div className="space-y-3">
      {(block.type === 'heading' || block.type === 'paragraph') && (
        <label className={labelClass}>文字内容<textarea className={areaClass} value={block.text || ''} onChange={(e) => onUpdate({ text: e.target.value })} /></label>
      )}
      {block.type === 'heading' && (
        <label className={labelClass}>级别<select className={fieldClass} value={block.level || 2} onChange={(e) => onUpdate({ level: Number(e.target.value) as 1 | 2 | 3 | 4 })}>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>H{l}</option>)}</select></label>
      )}
      {block.type === 'blockMath' && (
        <label className={labelClass}>LaTeX<textarea className={areaClass} value={block.latex || ''} onChange={(e) => onUpdate({ latex: e.target.value })} /></label>
      )}
      {block.type === 'rawMarkdown' && (
        <label className={labelClass}>Markdown<textarea className={areaClass} value={block.markdown || ''} onChange={(e) => onUpdate({ markdown: e.target.value })} /></label>
      )}
      {block.type === 'box' && (
        <>
          <label className={labelClass}>标题<input className={fieldClass} value={block.boxTitle || ''} onChange={(e) => onUpdate({ boxTitle: e.target.value })} /></label>
          <label className={labelClass}>模板
            <select className={fieldClass} value={block.templateId || 'concept'} onChange={(e) => onUpdate({ templateId: e.target.value })}>
              <option value="concept">定义 / 知识点</option><option value="method">方法 / 技巧</option><option value="example">例题</option><option value="warning">易错提醒</option><option value="practice">课堂练习</option><option value="summary">本节小结</option>
            </select>
          </label>
        </>
      )}
      {block.type === 'question' && (
        <label className={labelClass}>编号<input className={fieldClass} value={block.questionNo || ''} onChange={(e) => onUpdate({ questionNo: e.target.value })} /></label>
      )}
      {block.type === 'figure' && (
        <label className={labelClass}>说明<input className={fieldClass} value={block.figureLabel || ''} onChange={(e) => onUpdate({ figureLabel: e.target.value })} /></label>
      )}
      {block.type === 'spacer' && (
        <label className={labelClass}>高度 (em)<input type="number" className={fieldClass} min={0.5} max={8} step={0.5} value={block.heightEm || 2} onChange={(e) => onUpdate({ heightEm: Number(e.target.value) })} /></label>
      )}
      {['divider', 'pageBreak'].includes(block.type) && (
        <p className="text-xs text-zinc-400">该块没有可编辑属性。</p>
      )}
    </div>
  )
}
