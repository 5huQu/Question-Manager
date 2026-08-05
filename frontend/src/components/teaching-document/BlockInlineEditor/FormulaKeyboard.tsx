/**
 * FormulaKeyboard — 公式键盘（快速插入行内公式）
 *
 * 在正文格式工具栏提供常用 LaTeX 符号与结构模板面板：
 * 点击某项即在光标处插入 inlineMath 节点（与 Sigma 对话框共用同一节点类型，
 * 插入后点击公式仍可弹出编辑器精修）。面板支持连续插入，点击外部或 Esc 关闭。
 */
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Keyboard } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { useFloatingMenuPosition } from '@/hooks/useFloatingMenuPosition'

export interface FormulaKeyboardItem {
  label: string
  latex: string
}

export interface FormulaKeyboardGroup {
  category: string
  items: FormulaKeyboardItem[]
}

export const FORMULA_KEYBOARD_GROUPS: FormulaKeyboardGroup[] = [
  {
    category: '希腊字母',
    items: [
      { label: 'α', latex: '\\alpha' },
      { label: 'β', latex: '\\beta' },
      { label: 'γ', latex: '\\gamma' },
      { label: 'δ', latex: '\\delta' },
      { label: 'θ', latex: '\\theta' },
      { label: 'λ', latex: '\\lambda' },
      { label: 'μ', latex: '\\mu' },
      { label: 'π', latex: '\\pi' },
      { label: 'σ', latex: '\\sigma' },
      { label: 'φ', latex: '\\varphi' },
      { label: 'ω', latex: '\\omega' },
      { label: 'Δ', latex: '\\Delta' },
      { label: 'Σ', latex: '\\Sigma' },
      { label: 'Ω', latex: '\\Omega' },
    ],
  },
  {
    category: '运算符',
    items: [
      { label: '±', latex: '\\pm' },
      { label: '×', latex: '\\times' },
      { label: '÷', latex: '\\div' },
      { label: '·', latex: '\\cdot' },
      { label: '≤', latex: '\\le' },
      { label: '≥', latex: '\\ge' },
      { label: '≠', latex: '\\ne' },
      { label: '≈', latex: '\\approx' },
      { label: '∞', latex: '\\infty' },
      { label: '∈', latex: '\\in' },
      { label: '∉', latex: '\\notin' },
      { label: '⊆', latex: '\\subseteq' },
      { label: '∪', latex: '\\cup' },
      { label: '∩', latex: '\\cap' },
    ],
  },
  {
    category: '结构',
    items: [
      { label: '分数', latex: '\\frac{}{}' },
      { label: '根号', latex: '\\sqrt{}' },
      { label: '上标', latex: 'x^{2}' },
      { label: '下标', latex: 'x_{1}' },
      { label: '向量', latex: '\\vec{}' },
      { label: '上划线', latex: '\\overline{}' },
      { label: '绝对值', latex: '\\left|\\right|' },
      { label: '括号', latex: '\\left(\\right)' },
    ],
  },
  {
    category: '求和与极限',
    items: [
      { label: '求和', latex: '\\sum_{i=1}^{n}' },
      { label: '积分', latex: '\\int_{a}^{b}' },
      { label: '极限', latex: '\\lim_{x \\to \\infty}' },
      { label: '对数', latex: '\\log_{}' },
      { label: '自然对数', latex: '\\ln{}' },
    ],
  },
  {
    category: '三角函数',
    items: [
      { label: 'sin', latex: '\\sin{}' },
      { label: 'cos', latex: '\\cos{}' },
      { label: 'tan', latex: '\\tan{}' },
      { label: 'arcsin', latex: '\\arcsin{}' },
      { label: 'arccos', latex: '\\arccos{}' },
      { label: 'arctan', latex: '\\arctan{}' },
    ],
  },
]

/** 在光标处插入行内公式节点（与 Sigma 对话框同一节点类型）。 */
export function insertInlineFormula(editor: Editor, latex: string) {
  editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex } }).run()
}

export function FormulaKeyboardButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const menuPosition = useFloatingMenuPosition(open, triggerRef, menuRef, { width: 320 })

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        aria-label="公式键盘"
        aria-pressed={open}
        title="公式键盘：点击常用符号与结构，直接插入行内公式"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={`flex size-7 items-center justify-center rounded text-zinc-500 outline-none hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 ${open ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : ''}`}
      >
        <Keyboard className="size-3.5" />
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="公式键盘"
          className="fixed z-[110] max-h-[calc(100vh-1rem)] w-80 overflow-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{
            top: menuPosition?.top ?? 0,
            left: menuPosition?.left ?? 0,
            visibility: menuPosition ? 'visible' : 'hidden',
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {FORMULA_KEYBOARD_GROUPS.map((group) => (
            <div key={group.category} className="mb-2 last:mb-0">
              <p className="px-0.5 pb-1 text-[10px] font-medium tracking-wide text-zinc-400">{group.category}</p>
              <div className="grid grid-cols-5 gap-1">
                {group.items.map((item) => (
                  <button
                    key={item.latex}
                    type="button"
                    title={item.latex}
                    onClick={() => insertInlineFormula(editor, item.latex)}
                    className="h-8 rounded border border-zinc-200 bg-white px-0.5 text-xs text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
