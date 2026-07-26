/**
 * Direction A: "Focus Canvas" (聚焦画布)
 * 核心理念：内容优先，chrome 退后
 * - 全宽画布 + 左侧大纲收缩为图标栏 + 右侧属性 overlay sheet
 * - 块选中时 floating contextual toolbar
 * - 拖拽排序 (spring physics)
 * - 插入 "+" 按钮在块间出现
 * - Translucent material 面板
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence, Reorder, useReducedMotion } from 'motion/react'
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, GripVertical,
  List, PanelRightOpen, Plus, Trash2, X,
} from 'lucide-react'
import type { MockBlock, MockBlockType } from './shared/types'
import { BLOCK_LABEL, INSERTABLE_TYPES } from './shared/types'
import { createMockDocument, newMockBlock } from './mockData'
import { MockBlockRenderer } from './shared/MockBlockRenderer'
import { PressableButton, springPanel, springDefault } from './shared/MotionPrimitives'

export function DirectionA_FocusCanvas() {
  const [doc, setDoc] = useState(createMockDocument)
  const [selectedId, setSelectedId] = useState('')
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)
  const [insertAfterId, setInsertAfterId] = useState<string | null>(null)
  const reduced = useReducedMotion()

  const selectedBlock = doc.blocks.find((b) => b.id === selectedId) || null

  const handleReorder = useCallback((newBlocks: MockBlock[]) => {
    setDoc((d) => ({ ...d, blocks: newBlocks }))
  }, [])

  const insertBlock = useCallback((type: MockBlockType, afterId: string | null) => {
    const block = newMockBlock(type)
    setDoc((d) => {
      const idx = afterId ? d.blocks.findIndex((b) => b.id === afterId) : d.blocks.length - 1
      const blocks = [...d.blocks]
      blocks.splice(idx + 1, 0, block)
      return { ...d, blocks }
    })
    setSelectedId(block.id)
    setInsertAfterId(null)
    setPropsOpen(true)
  }, [])

  const deleteBlock = useCallback((id: string) => {
    setDoc((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }))
    if (selectedId === id) { setSelectedId(''); setPropsOpen(false) }
  }, [selectedId])

  const duplicateBlock = useCallback((id: string) => {
    setDoc((d) => {
      const idx = d.blocks.findIndex((b) => b.id === id)
      if (idx < 0) return d
      const clone = { ...d.blocks[idx], id: `${id}_copy_${Date.now()}` }
      const blocks = [...d.blocks]
      blocks.splice(idx + 1, 0, clone)
      return { ...d, blocks }
    })
  }, [])

  const moveBlock = useCallback((id: string, dir: -1 | 1) => {
    setDoc((d) => {
      const idx = d.blocks.findIndex((b) => b.id === id)
      const target = idx + dir
      if (target < 0 || target >= d.blocks.length) return d
      const blocks = [...d.blocks]
      ;[blocks[idx], blocks[target]] = [blocks[target], blocks[idx]]
      return { ...d, blocks }
    })
  }, [])

  return (
    <div className="relative flex h-[calc(100vh-12rem)] min-h-[500px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/30 dark:border-zinc-800 dark:bg-zinc-950">
      {/* ─── 左侧图标栏 / 展开大纲 ─── */}
      <AnimatePresence>
        {outlineOpen && (
          <motion.aside
            initial={reduced ? { opacity: 0 } : { x: -260, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { x: -260, opacity: 0 }}
            transition={springPanel}
            className="absolute inset-y-0 left-0 z-30 flex w-[240px] flex-col border-r border-zinc-200/80 bg-white/80 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/80"
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-900">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">文档大纲</span>
              <PressableButton onClick={() => setOutlineOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <ChevronLeft className="size-3.5" />
              </PressableButton>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-0.5">
              {doc.blocks.map((block, i) => (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => { setSelectedId(block.id); setPropsOpen(true) }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    selectedId === block.id
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="w-4 shrink-0 text-right font-mono text-[9px] opacity-50">{i + 1}</span>
                  <span className="truncate">{BLOCK_LABEL[block.type]}{block.type === 'box' && block.boxTitle ? ` · ${block.boxTitle}` : ''}{block.type === 'heading' && block.text ? ` · ${block.text}` : ''}</span>
                </button>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* 收缩态图标栏 */}
      {!outlineOpen && (
        <div className="flex w-10 shrink-0 flex-col items-center border-r border-zinc-200/60 bg-white/60 py-3 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/60">
          <PressableButton onClick={() => setOutlineOpen(true)} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="展开大纲">
            <List className="size-4" />
          </PressableButton>
        </div>
      )}

      {/* ─── 中央画布 ─── */}
      <section className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-2xl">
          {/* 文档标题 */}
          <input
            value={doc.title}
            onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))}
            className="mb-6 w-full bg-transparent text-center text-2xl font-bold text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100"
            placeholder="文档标题"
          />

          {/* 块列表 - 可拖拽排序 */}
          <Reorder.Group axis="y" values={doc.blocks} onReorder={handleReorder} className="space-y-1">
            {doc.blocks.map((block) => (
              <Reorder.Item
                key={block.id}
                value={block}
                className="relative"
                whileDrag={{ scale: 1.02, boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}
                transition={springDefault}
              >
                {/* 块间插入按钮 */}
                <div
                  className="group/insert relative flex h-4 items-center justify-center"
                  onMouseEnter={() => setInsertAfterId(block.id)}
                  onMouseLeave={() => setInsertAfterId(null)}
                >
                  <AnimatePresence>
                    {insertAfterId === block.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-10"
                      >
                        <InsertPopover onInsert={(type) => insertBlock(type, block.id)} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="h-px w-full bg-transparent group-hover/insert:bg-zinc-200 dark:group-hover/insert:bg-zinc-700 transition-colors" />
                </div>

                {/* 块内容 */}
                <div
                  onClick={() => { setSelectedId(block.id); setPropsOpen(true) }}
                  className={`group/block relative cursor-pointer rounded-lg px-3 py-1.5 transition-all ${
                    selectedId === block.id
                      ? 'bg-white shadow-sm ring-2 ring-zinc-900 dark:bg-zinc-900 dark:ring-zinc-100'
                      : 'hover:bg-white/60 hover:shadow-sm dark:hover:bg-zinc-900/40'
                  }`}
                >
                  {/* 拖拽手柄 */}
                  <div className="absolute -left-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/block:opacity-100">
                    <GripVertical className="size-3.5 text-zinc-300 dark:text-zinc-600 cursor-grab" />
                  </div>

                  <MockBlockRenderer block={block} />

                  {/* Floating Contextual Toolbar */}
                  <AnimatePresence>
                    {selectedId === block.id && (
                      <motion.div
                        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.95 }}
                        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.97 }}
                        transition={springPanel}
                        className="absolute -top-9 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-zinc-200/80 bg-white/90 px-1.5 py-1 shadow-lg backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-900/90"
                      >
                        <ToolbarBtn onClick={() => moveBlock(block.id, -1)} title="上移"><ArrowUp className="size-3.5" /></ToolbarBtn>
                        <ToolbarBtn onClick={() => moveBlock(block.id, 1)} title="下移"><ArrowDown className="size-3.5" /></ToolbarBtn>
                        <div className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
                        <ToolbarBtn onClick={() => duplicateBlock(block.id)} title="复制"><Copy className="size-3.5" /></ToolbarBtn>
                        <ToolbarBtn onClick={() => deleteBlock(block.id)} title="删除" danger><Trash2 className="size-3.5" /></ToolbarBtn>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>
      </section>

      {/* ─── 右侧属性 Overlay Sheet ─── */}
      <AnimatePresence>
        {propsOpen && selectedBlock && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/10 dark:bg-black/30"
              onClick={() => setPropsOpen(false)}
            />
            <motion.aside
              initial={reduced ? { opacity: 0 } : { x: 320 }}
              animate={reduced ? { opacity: 1 } : { x: 0 }}
              exit={reduced ? { opacity: 0 } : { x: 320 }}
              transition={springPanel}
              className="absolute inset-y-0 right-0 z-40 flex w-[300px] flex-col border-l border-zinc-200/80 bg-white/90 shadow-2xl backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/90"
            >
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{BLOCK_LABEL[selectedBlock.type]}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-400">{selectedBlock.id}</p>
                </div>
                <PressableButton onClick={() => setPropsOpen(false)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  <X className="size-4" />
                </PressableButton>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-4">
                <PropertiesContent block={selectedBlock} onUpdate={(patch) => {
                  setDoc((d) => ({ ...d, blocks: d.blocks.map((b) => b.id === selectedBlock.id ? { ...b, ...patch } : b) }))
                }} />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* 右下角打开属性面板按钮 */}
      {!propsOpen && selectedBlock && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute bottom-4 right-4 z-20"
        >
          <PressableButton onClick={() => setPropsOpen(true)} className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white/90 px-4 py-2.5 text-xs font-medium text-zinc-700 shadow-lg backdrop-blur-md hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-200">
            <PanelRightOpen className="size-4" />
            编辑属性
          </PressableButton>
        </motion.div>
      )}
    </div>
  )
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function ToolbarBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <PressableButton
      onClick={onClick}
      title={title}
      className={`rounded-md p-1.5 ${danger ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}
    >
      {children}
    </PressableButton>
  )
}

function InsertPopover({ onInsert }: { onInsert: (type: MockBlockType) => void }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <PressableButton onClick={() => setOpen(true)} className="flex size-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        <Plus className="size-3" />
      </PressableButton>
    )
  }
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      {INSERTABLE_TYPES.map((type) => (
        <PressableButton
          key={type}
          onClick={() => onInsert(type)}
          className="rounded-md px-2 py-1 text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {BLOCK_LABEL[type]}
        </PressableButton>
      ))}
      <PressableButton onClick={() => setOpen(false)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <X className="size-3" />
      </PressableButton>
    </motion.div>
  )
}

function PropertiesContent({ block, onUpdate }: { block: MockBlock; onUpdate: (patch: Partial<MockBlock>) => void }) {
  const fieldClass = 'mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950'
  const areaClass = 'mt-1 min-h-20 w-full rounded-md border border-zinc-200 bg-white p-2.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950'
  const labelClass = 'block text-xs font-medium text-zinc-500 dark:text-zinc-400'

  return (
    <>
      {(block.type === 'heading' || block.type === 'paragraph') && (
        <label className={labelClass}>文字内容
          <textarea className={areaClass} value={block.text || ''} onChange={(e) => onUpdate({ text: e.target.value })} />
        </label>
      )}
      {block.type === 'heading' && (
        <label className={labelClass}>标题级别
          <select className={fieldClass} value={block.level || 2} onChange={(e) => onUpdate({ level: Number(e.target.value) as 1 | 2 | 3 | 4 })}>
            {[1, 2, 3, 4].map((l) => <option key={l} value={l}>H{l}</option>)}
          </select>
        </label>
      )}
      {block.type === 'blockMath' && (
        <label className={labelClass}>LaTeX
          <textarea className={areaClass} value={block.latex || ''} onChange={(e) => onUpdate({ latex: e.target.value })} />
        </label>
      )}
      {block.type === 'rawMarkdown' && (
        <label className={labelClass}>Markdown
          <textarea className={areaClass} value={block.markdown || ''} onChange={(e) => onUpdate({ markdown: e.target.value })} />
        </label>
      )}
      {block.type === 'box' && (
        <>
          <label className={labelClass}>盒子标题
            <input className={fieldClass} value={block.boxTitle || ''} onChange={(e) => onUpdate({ boxTitle: e.target.value })} />
          </label>
          <label className={labelClass}>模板
            <select className={fieldClass} value={block.templateId || 'concept'} onChange={(e) => onUpdate({ templateId: e.target.value })}>
              <option value="concept">定义 / 知识点</option>
              <option value="method">方法 / 技巧</option>
              <option value="example">例题</option>
              <option value="warning">易错提醒</option>
              <option value="practice">课堂练习</option>
              <option value="summary">本节小结</option>
            </select>
          </label>
        </>
      )}
      {block.type === 'question' && (
        <label className={labelClass}>显示编号
          <input className={fieldClass} value={block.questionNo || ''} onChange={(e) => onUpdate({ questionNo: e.target.value })} />
        </label>
      )}
      {block.type === 'figure' && (
        <label className={labelClass}>图片说明
          <input className={fieldClass} value={block.figureLabel || ''} onChange={(e) => onUpdate({ figureLabel: e.target.value })} />
        </label>
      )}
      {block.type === 'spacer' && (
        <label className={labelClass}>高度 (em)
          <input type="number" className={fieldClass} min={0.5} max={8} step={0.5} value={block.heightEm || 2} onChange={(e) => onUpdate({ heightEm: Number(e.target.value) })} />
        </label>
      )}
      {['divider', 'pageBreak'].includes(block.type) && (
        <p className="text-xs text-zinc-400">该块没有额外属性。</p>
      )}
    </>
  )
}
