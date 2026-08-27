/**
 * 单块行内编辑器的 Tiptap 扩展集
 *
 * 复用仓库现有 Tiptap v3 基础设施（@tiptap/react + @tiptap/starter-kit），
 * 不引入新大型依赖：
 * - underline：starter-kit v3 内置选项
 * - UnknownMark：透传保留 unknownMarks 原始 JSON
 * - UnknownInlineNode：原子节点保留 UnknownInline 原始数据
 * - InlineMathNode：原子公式节点，复用 FormulaEditorDialog 编辑，
 *   KaTeX 通过 ref + renderToString 挂载（不使用 dangerouslySetInnerHTML）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Node, Mark, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Paragraph from '@tiptap/extension-paragraph'
import 'katex/dist/katex.min.css'
import { FormulaEditorDialog } from '@/components/questions/editor/FormulaEditorDialog'
import { fontStackById } from '@/utils/teachingDocument/lectureFonts'
import { renderKatexWithStatus } from '@/utils/katexValidation'

// ─── UnknownMark：保留无法识别的 mark 原始数据 ───────────────────────────────

export const UnknownMark = Mark.create({
  name: 'unknownMark',
  excludes: '',
  addAttributes() {
    return {
      data: { default: 'null' },
      index: { default: 0 },
    }
  },
  parseHTML() {
    // 不从 HTML 解析产生；仅存在于程序化 JSON 载入
    return []
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-unknown-mark': '' }), 0]
  },
})

// ─── FontFamilyMark：行内字体覆盖（Word 式局部改字体）──────────────────

/** 为自定义命令补充 Tiptap 类型，使 editor.chain().setFontFamily(...) 可被类型检查 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (family: string) => ReturnType
      unsetFontFamily: () => ReturnType
    }
  }
}

export const FontFamilyMark = Mark.create({
  name: 'fontFamily',
  addAttributes() {
    return {
      family: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-font-id') || null,
        renderHTML: (attributes) => {
          const stack = fontStackById(attributes.family ? String(attributes.family) : undefined)
          if (!stack) return {}
          return { 'data-font-id': String(attributes.family), style: `font-family: ${stack}` }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-font-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      setFontFamily: (family) => ({ commands }) => commands.setMark('fontFamily', { family }),
      unsetFontFamily: () => ({ commands }) => commands.unsetMark('fontFamily'),
    }
  },
})

// ─── TextColorMark：受控行内文字颜色 ───────────────────────────────────

/** 仅接受不含透明度/表达式的标准 RGB 色值，兼顾自定义取色与持久化安全。 */
const TEXT_COLOR_HEX = /^#[0-9a-f]{6}$/i

function normalizeTextColor(value: unknown) {
  const color = String(value || '').trim().toLowerCase()
  return TEXT_COLOR_HEX.test(color) ? color : null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType
      unsetTextColor: () => ReturnType
    }
  }
}

export const TextColorMark = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-text-color') || null,
        renderHTML: (attributes) => {
          const color = normalizeTextColor(attributes.color)
          return color
            ? { 'data-text-color': color, style: `color: ${color}` }
            : {}
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-text-color]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      setTextColor: (color) => ({ commands }) => {
        const normalized = normalizeTextColor(color)
        return normalized ? commands.setMark('textColor', { color: normalized }) : false
      },
      unsetTextColor: () => ({ commands }) => commands.unsetMark('textColor'),
    }
  },
})

// ─── FontSizeMark：受控行内字号 ────────────────────────────────────────

const INLINE_FONT_SIZES = new Set([12, 14, 16, 18, 20, 24])

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: number) => ReturnType
      unsetFontSize: () => ReturnType
    }
  }
}

export const FontSizeMark = Mark.create({
  name: 'fontSize',
  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-font-size')) || null,
        renderHTML: (attributes) => {
          const size = Number(attributes.size)
          return INLINE_FONT_SIZES.has(size) ? { 'data-font-size': String(size), style: `font-size: ${size}px` } : {}
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-font-size]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ commands }) => INLINE_FONT_SIZES.has(size) ? commands.setMark('fontSize', { size }) : false,
      unsetFontSize: () => ({ commands }) => commands.unsetMark('fontSize'),
    }
  },
})

// ─── UnknownInlineNode：原子保留未识别行内节点 ───────────────────────────────

function UnknownInlineView({ node, selected }: NodeViewProps) {
  const originalType = String(node.attrs.originalType || 'unknown')
  return (
    <NodeViewWrapper
      as="span"
      className={`inline-block rounded border px-1 py-0.5 align-middle font-mono text-[10px] leading-4 ${
        selected
          ? 'border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-400'
      }`}
      data-unknown-inline=""
      title={`未识别的行内节点「${originalType}」已受保护保留，不可编辑`}
    >
      [{originalType}]
    </NodeViewWrapper>
  )
}

export const UnknownInlineNode = Node.create({
  name: 'unknownInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      originalType: { default: 'unknown' },
      data: { default: 'null' },
    }
  },
  parseHTML() {
    return []
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-unknown-inline': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(UnknownInlineView)
  },
})

// ─── InlineMathNode：行内公式原子节点 ────────────────────────────────────────

function InlineMathNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const [open, setOpen] = useState(false)
  const mathRef = useRef<HTMLSpanElement>(null)
  const latex = String(node.attrs.latex || '')
  const rendered = useMemo(() => renderKatexWithStatus(latex, false), [latex])

  useEffect(() => {
    if (!mathRef.current) return
    mathRef.current.textContent = ''
    const template = document.createElement('template')
    template.innerHTML = rendered.html
    mathRef.current.appendChild(template.content)
  }, [rendered.html])

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle" data-inline-math="">
      <button
        type="button"
        aria-label={`行内公式${rendered.validation.valid ? '' : '，公式格式有误'}，点击编辑`}
        aria-invalid={rendered.validation.valid ? undefined : true}
        title={rendered.validation.valid ? undefined : '公式格式有误'}
        data-inline-math-button=""
        className={`rounded border px-1 py-0.5 align-middle transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800 ${
          selected ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900' : 'border-zinc-200 dark:border-zinc-700'
        }`}
        onClick={() => setOpen(true)}
      >
        <span ref={mathRef} className="text-[0.95em]" />
        {rendered.validation.valid ? null : <span className="ml-1 text-[10px] text-amber-700">公式格式有误</span>}
      </button>
      {open ? (
        <FormulaEditorDialog
          title="编辑行内公式"
          initialLatex={latex}
          displayMode={false}
          onClose={() => setOpen(false)}
          onApply={(nextLatex) => { updateAttributes({ latex: nextLatex }); setOpen(false) }}
        />
      ) : null}
    </NodeViewWrapper>
  )
}

export const InlineMathNode = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { latex: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-inline-math]', getAttrs: (element) => ({ latex: (element as HTMLElement).dataset.latex || '' }) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-inline-math': '', 'data-latex': HTMLAttributes.latex })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineMathNodeView)
  },
})

/**
 * 连续卡片正文仍由多个 paragraph 组成。将业务 id 写入 ProseMirror 节点属性，
 * 而非在 DOM 上事后打标，避免被 ProseMirror DOMObserver 当成外部改动。
 */
export const ParagraphWithBlockId = Paragraph.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      blockId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-block-id') || '',
        renderHTML: (attributes) => attributes.blockId ? { 'data-block-id': String(attributes.blockId) } : {},
      },
    }
  },
})

// ─── 扩展集工厂 ─────────────────────────────────────────────────────────────

/**
 * 创建单块行内编辑器扩展集。
 * 文档结构约束为单个 paragraph + 行内内容：
 * - 禁用所有块级节点（heading/list/blockquote/codeBlock/hr）
 * - 禁用 Tiptap 内置 history（撤销重做由文档级命令历史承担）
 * - 仅保留 bold/italic/strike/code 内置 marks + 自定义 underline/unknownMark
 */
export function createBlockEditorExtensions() {
  return [
    StarterKit.configure({
      // 块级节点全部禁用：单块编辑器只含一个 paragraph
      paragraph: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      horizontalRule: false,
      // 禁用内置 undo/redo：撤销重做走文档级 TeachingDocumentHistory
      undoRedo: false,
      // 仅保留所需内置 marks（bold/italic/strike/code/underline）
      bold: {},
      italic: {},
      strike: {},
      code: {},
      underline: {},
      // 禁用不需要的内置能力
      link: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
    }),
    ParagraphWithBlockId,
    UnknownMark,
    FontFamilyMark,
    TextColorMark,
    FontSizeMark,
    UnknownInlineNode,
    InlineMathNode,
  ]
}
