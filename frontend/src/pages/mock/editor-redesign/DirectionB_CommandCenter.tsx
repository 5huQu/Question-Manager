/**
 * Direction B: "Command Center" (命令中心)
 * 核心理念：键盘驱动 + 结构化三栏优化
 * - Cmd+K 命令面板：快速插入块、跳转块、切换视图
 * - 左栏大纲可折叠 + 拖拽排序
 * - 右栏属性面板按 accordion 分组
 * - 顶部工具栏精简
 * - 块 hover 显示行号 gutter + 操作图标
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence, Reorder, useReducedMotion } from 'motion/react'
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Command,
  Copy, FileText, GripVertical, LayoutTemplate, PanelLeftClose,
  PanelLeftOpen, Plus, Search, Trash2, X,
} from 'lucide-react'
import type { MockBlock, MockBlockType } from './shared/types'
import { BLOCK_LABEL, INSERTABLE_TYPES } from './shared/types'
import { createMockDocument, newMockBlock } from './mockData'
import { MockBlockRenderer } from './shared/MockBlockRenderer'
import { PressableButton, springPanel, springDefault } from './shared/MotionPrimitives'

export function DirectionB_CommandCenter() {
  const [doc, setDoc] = useState(createMockDocument)
  const [selectedId, setSelectedId] = useState('')
  const [leftOpen, setLeftOpen] = useState(true)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'continuous' | 'a4'>('continuous')
  const reduced = useReducedMotion()

  const selectedBlock = doc.blocks.find((b) => b.id === selectedId) || null

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen((v) => !v)
      }
      if (e.key === 'Escape') setCmdOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const insertBlock = useCallback((type: MockBlockType) => {
    const block = newMockBlock(type)
    setDoc((d) => {
      const idx = selectedId ? d.blocks.findIndex((b) => b.id === selectedId) : d.blocks.length - 1
      const blocks = [...d.blocks]
      blocks.splice(idx + 1, 0, block)
      return { ...d, blocks }
    })
    setSelectedId(block.id)
    setCmdOpen(false)
  }, [selectedId])

  const deleteBlock = useCallback((id: string) => {
    setDoc((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }))
    if (selectedId === id) setSelectedId('')
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

  const handleReorder = useCallback((newBlocks: MockBlock[]) => {
    setDoc((d) => ({ ...d, blocks: newBlocks }))
  }, [])

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[500px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* ─── 精简顶栏 ─── */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <PressableButton onClick={() => setLeftOpen((v) => !v)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" title="切换侧栏">
          {leftOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </PressableButton>
        <input
          value={doc.title}
          onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))}
          className="h-8 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold outline-none hover:border-zinc-200 focus:border-zinc-300 dark:hover:border-zinc-800"
        />
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-normal tracking-wide text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          <Check className="size-3" /> 已保存 · r3
        </span>
        {/* 视图切换 */}
        <div className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
          <button type="button" onClick={() => setViewMode('continuous')} className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] tracking-wide ${viewMode === 'continuous' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500'}`}>
            <FileText className="size-3" /> 连续
          </button>
          <button type="button" onClick={() => setViewMode('a4')} className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] tracking-wide ${viewMode === 'a4' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-500'}`}>
            <LayoutTemplate className="size-3" /> A4
          </button>
        </div>
        {/* Cmd+K 触发 */}
        <PressableButton onClick={() => setCmdOpen(true)} className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
          <Command className="size-3.5" /> K
        </PressableButton>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ─── 左栏：大纲 ─── */}
        <AnimatePresence initial={false}>
          {leftOpen && (
            <motion.aside
              initial={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { width: 200, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
              transition={springPanel}
              className="overflow-hidden border-r border-zinc-200 dark:border-zinc-800"
            >
              <div className="w-[200px] p-2">
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">大纲</p>
                <Reorder.Group axis="y" values={doc.blocks} onReorder={handleReorder} className="space-y-0.5">
                  {doc.blocks.map((block, i) => (
                    <Reorder.Item key={block.id} value={block} whileDrag={{ scale: 1.03 }} transition={springDefault}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(block.id)}
                        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                          selectedId === block.id
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'
                        }`}
                      >
                        <GripVertical className="size-3 shrink-0 opacity-30 cursor-grab" />
                        <span className="w-4 shrink-0 text-right font-mono text-[9px] opacity-50">{i + 1}</span>
                        <span className="truncate">{BLOCK_LABEL[block.type]}{block.type === 'box' && block.boxTitle ? ` · ${block.boxTitle}` : ''}</span>
                      </button>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ─── 中央画布 ─── */}
        <section className="flex-1 overflow-auto p-5">
          <div className="mx-auto max-w-2xl space-y-0.5">
            {doc.blocks.map((block, i) => (
              <div
                key={block.id}
                onClick={() => setSelectedId(block.id)}
                className={`group relative flex gap-2 rounded-lg px-2 py-1.5 transition-all ${
                  selectedId === block.id
                    ? 'bg-zinc-50 ring-1 ring-zinc-300 dark:bg-zinc-900/50 dark:ring-zinc-700'
                    : 'hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30'
                }`}
              >
                {/* 行号 gutter + 操作 */}
                <div className="flex w-8 shrink-0 flex-col items-center gap-1 pt-1">
                  <span className="font-mono text-[9px] text-zinc-300 group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-400">{i + 1}</span>
                  <div className="hidden flex-col gap-0.5 group-hover:flex">
                    <button type="button" onClick={(e) => { e.stopPropagation(); moveBlock(block.id, -1) }} className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"><ArrowUp className="size-2.5" /></button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 1) }} className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"><ArrowDown className="size-2.5" /></button>
                  </div>
                </div>
                {/* 块内容 */}
                <div className="min-w-0 flex-1">
                  <MockBlockRenderer block={block} />
                </div>
                {/* 右侧快捷操作 */}
                <div className="hidden shrink-0 items-center gap-0.5 pt-1 group-hover:flex">
                  <button type="button" onClick={(e) => { e.stopPropagation(); duplicateBlock(block.id) }} className="rounded p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700" title="复制"><Copy className="size-3" /></button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); deleteBlock(block.id) }} className="rounded p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30" title="删除"><Trash2 className="size-3" /></button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── 右栏：属性 Accordion ─── */}
        <aside className="w-[260px] shrink-0 overflow-auto border-l border-zinc-200 dark:border-zinc-800">
          {selectedBlock ? (
            <PropertiesAccordion
              block={selectedBlock}
              onUpdate={(patch) => setDoc((d) => ({ ...d, blocks: d.blocks.map((b) => b.id === selectedBlock.id ? { ...b, ...patch } : b) }))}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-zinc-400">选择一个块以编辑属性</div>
          )}
        </aside>
      </div>

      {/* ─── Cmd+K 命令面板 ─── */}
      <AnimatePresence>
        {cmdOpen && (
          <CommandPalette
            blocks={doc.blocks}
            onClose={() => setCmdOpen(false)}
            onInsert={insertBlock}
            onJump={(id) => { setSelectedId(id); setCmdOpen(false) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── 命令面板 ─────────────────────────────────────────────────────────────────

function CommandPalette({ blocks, onClose, onInsert, onJump }: {
  blocks: MockBlock[]
  onClose: () => void
  onInsert: (type: MockBlockType) => void
  onJump: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => { inputRef.current?.focus() }, [])

  const commands = useMemo(() => {
    const insertCmds = INSERTABLE_TYPES
      .filter((t) => BLOCK_LABEL[t].includes(query) || t.includes(query.toLowerCase()))
      .map((type) => ({ kind: 'insert' as const, type, label: `插入${BLOCK_LABEL[type]}` }))
    const jumpCmds = blocks
      .filter((b) => {
        const text = `${BLOCK_LABEL[b.type]} ${b.text || ''} ${b.boxTitle || ''}`
        return text.includes(query)
      })
      .slice(0, 6)
      .map((b) => ({ kind: 'jump' as const, id: b.id, label: `跳转 → ${BLOCK_LABEL[b.type]}${b.text ? ` · ${b.text.slice(0, 12)}` : ''}${b.boxTitle ? ` · ${b.boxTitle}` : ''}` }))
    return [...insertCmds, ...jumpCmds]
  }, [query, blocks])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -10 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -6 }}
        transition={springPanel}
        className="w-[480px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <Search className="size-4 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入命令或搜索块…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
          />
          <kbd className="rounded border border-zinc-200 px-1.5 py-0.5 text-[9px] text-zinc-400 dark:border-zinc-700">ESC</kbd>
        </div>
        <div className="max-h-[300px] overflow-auto p-2">
          {commands.map((cmd, i) => (
            <button
              key={`${cmd.kind}-${i}`}
              type="button"
              onClick={() => cmd.kind === 'insert' ? onInsert(cmd.type) : onJump(cmd.id)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {cmd.kind === 'insert' ? <Plus className="size-3.5 text-zinc-400" /> : <ChevronRight className="size-3.5 text-zinc-400" />}
              {cmd.label}
            </button>
          ))}
          {!commands.length && <p className="px-3 py-4 text-center text-xs text-zinc-400">无匹配命令</p>}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── Accordion 属性面板 ───────────────────────────────────────────────────────

function PropertiesAccordion({ block, onUpdate }: { block: MockBlock; onUpdate: (patch: Partial<MockBlock>) => void }) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['content']))
  const toggle = (key: string) => setOpenSections((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  const fieldClass = 'mt-1 h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950'
  const areaClass = 'mt-1 min-h-16 w-full rounded-md border border-zinc-200 bg-white p-2 text-xs outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950'

  return (
    <div className="p-3 space-y-1">
      {/* 块信息头 */}
      <div className="mb-3 rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-900/50">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{BLOCK_LABEL[block.type]}</p>
        <p className="mt-0.5 font-mono text-[9px] text-zinc-400">{block.id}</p>
      </div>

      {/* 内容区 */}
      <AccordionSection title="内容" open={openSections.has('content')} onToggle={() => toggle('content')}>
        {(block.type === 'heading' || block.type === 'paragraph') && (
          <label className="block text-[10px] font-medium text-zinc-500">文字<textarea className={areaClass} value={block.text || ''} onChange={(e) => onUpdate({ text: e.target.value })} /></label>
        )}
        {block.type === 'heading' && (
          <label className="block text-[10px] font-medium text-zinc-500">级别<select className={fieldClass} value={block.level || 2} onChange={(e) => onUpdate({ level: Number(e.target.value) as 1 | 2 | 3 | 4 })}>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>H{l}</option>)}</select></label>
        )}
        {block.type === 'blockMath' && (
          <label className="block text-[10px] font-medium text-zinc-500">LaTeX<textarea className={areaClass} value={block.latex || ''} onChange={(e) => onUpdate({ latex: e.target.value })} /></label>
        )}
        {block.type === 'rawMarkdown' && (
          <label className="block text-[10px] font-medium text-zinc-500">Markdown<textarea className={areaClass} value={block.markdown || ''} onChange={(e) => onUpdate({ markdown: e.target.value })} /></label>
        )}
        {block.type === 'box' && (
          <label className="block text-[10px] font-medium text-zinc-500">标题<input className={fieldClass} value={block.boxTitle || ''} onChange={(e) => onUpdate({ boxTitle: e.target.value })} /></label>
        )}
        {block.type === 'question' && (
          <label className="block text-[10px] font-medium text-zinc-500">编号<input className={fieldClass} value={block.questionNo || ''} onChange={(e) => onUpdate({ questionNo: e.target.value })} /></label>
        )}
        {block.type === 'figure' && (
          <label className="block text-[10px] font-medium text-zinc-500">说明<input className={fieldClass} value={block.figureLabel || ''} onChange={(e) => onUpdate({ figureLabel: e.target.value })} /></label>
        )}
        {['divider', 'pageBreak'].includes(block.type) && <p className="text-[10px] text-zinc-400">无内容属性</p>}
      </AccordionSection>

      {/* 布局区 */}
      <AccordionSection title="布局" open={openSections.has('layout')} onToggle={() => toggle('layout')}>
        {block.type === 'box' && (
          <label className="block text-[10px] font-medium text-zinc-500">模板
            <select className={fieldClass} value={block.templateId || 'concept'} onChange={(e) => onUpdate({ templateId: e.target.value })}>
              <option value="concept">定义 / 知识点</option><option value="method">方法 / 技巧</option><option value="example">例题</option><option value="warning">易错提醒</option><option value="practice">课堂练习</option><option value="summary">本节小结</option>
            </select>
          </label>
        )}
        {block.type === 'spacer' && (
          <label className="block text-[10px] font-medium text-zinc-500">高度 (em)<input type="number" className={fieldClass} min={0.5} max={8} step={0.5} value={block.heightEm || 2} onChange={(e) => onUpdate({ heightEm: Number(e.target.value) })} /></label>
        )}
        {!['box', 'spacer'].includes(block.type) && <p className="text-[10px] text-zinc-400">默认布局</p>}
      </AccordionSection>

      {/* 高级区 */}
      <AccordionSection title="高级" open={openSections.has('advanced')} onToggle={() => toggle('advanced')}>
        <p className="text-[10px] text-zinc-400">ID: {block.id}</p>
        <p className="text-[10px] text-zinc-400">类型: {block.type}</p>
      </AccordionSection>
    </div>
  )
}

function AccordionSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <div className="rounded-lg border border-zinc-100 dark:border-zinc-800/60">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={reduced ? { duration: 0.1 } : { type: 'spring', bounce: 0, duration: 0.2 }}>
          <ChevronRight className="size-3" />
        </motion.span>
        {title}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={springDefault}
            className="overflow-hidden"
          >
            <div className="space-y-2.5 px-2.5 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
