/**
 * 文档级 Tiptap 扩展集
 *
 * 设计约束：
 * - 顶层 doc 包含 block+ 内容
 * - 文本块（heading/paragraph）为可编辑 ProseMirror 节点（inline 内容）
 * - 非文本块为 atom 节点（通过 ReactNodeViewRenderer 渲染）
 * - 每个块节点必须携带 blockId attr（稳定 id）
 * - 行内 marks/nodes 复用 BlockInlineEditor 的扩展
 * - 启用 Tiptap 内置 history（undo/redo 由编辑器管理）
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  InlineMathNode,
  UnknownInlineNode,
  FontFamilyMark,
  TextColorMark,
  UnknownMark,
} from '../BlockInlineEditor/extensions'
import {
  BlockMathNodeView,
  FigureNodeView,
  QuestionNodeView,
  BoxNodeView,
  DividerNodeView,
  SpacerNodeView,
  PageBreakNodeView,
  RawMarkdownNodeView,
  UnknownNodeView,
} from './NodeViews'
import { ResizeCommands } from './resizeCommands'
import { PaginationDecorations } from './paginationDecorations'
import { ActiveTextBlockDecoration, DocumentSelectionSafety } from './selection'

function createPageBreakId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid
    ? `pageBreak_${uuid}`
    : `pageBreak_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

// ─── 文本块节点 ──────────────────────────────────────────────────────────────

/** 文档级段落节点：行内内容 + blockId */
export const DocParagraph = Node.create({
  name: 'docParagraph',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      blockId: { default: '', renderHTML: (attrs) => ({ 'data-block-id': attrs.blockId }) },
    }
  },
  parseHTML() {
    return [{ tag: 'p[data-block-type="paragraph"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { class: 'td-paragraph', 'data-block-type': 'paragraph' }), 0]
  },
})

/** 文档级标题节点：level 1-4 + blockId + 行内内容 */
export const DocHeading = Node.create({
  name: 'docHeading',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      blockId: { default: '', renderHTML: (attrs) => ({ 'data-block-id': attrs.blockId }) },
      level: {
        default: 3,
        renderHTML: (attrs) => ({ 'data-level': String(attrs.level) }),
      },
      numberLabel: {
        default: '',
        renderHTML: (attrs) => attrs.numberLabel ? { 'data-number-label': attrs.numberLabel } : {},
      },
      numbering: { default: '{}' },
    }
  },
  parseHTML() {
    return [
      { tag: 'h1[data-block-type="heading"]', attrs: { level: 1 } },
      { tag: 'h2[data-block-type="heading"]', attrs: { level: 2 } },
      { tag: 'h3[data-block-type="heading"]', attrs: { level: 3 } },
      { tag: 'h4[data-block-type="heading"]', attrs: { level: 4 } },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = Math.min(4, Math.max(1, Number(node.attrs.level) || 3))
    return [`h${level}`, mergeAttributes(HTMLAttributes, { class: 'td-heading', 'data-block-type': 'heading' }), 0]
  },
})

// ─── 原子块节点 ──────────────────────────────────────────────────────────────

/** 块级公式：atom，attrs: blockId, latex, label */
export const DocBlockMath = Node.create({
  name: 'docBlockMath',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      latex: { default: '' },
      label: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="blockMath"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'blockMath' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(BlockMathNodeView)
  },
})

/** 图片块：atom，attrs: blockId, asset(JSON), layoutPreset, alignment, widthMm, widthRatio, lockAspectRatio, caption, alt */
export const DocFigure = Node.create({
  name: 'docFigure',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      asset: { default: '{}' },
      alignment: { default: 'center' },
      layoutPreset: { default: null },
      widthMm: { default: null },
      widthRatio: { default: null },
      lockAspectRatio: { default: true },
      caption: { default: '' },
      alt: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="figure"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'figure' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureNodeView)
  },
})

/** 题目块：atom，attrs: blockId, questionId, display(JSON), localContent(JSON) */
export const DocQuestion = Node.create({
  name: 'docQuestion',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      questionId: { default: '' },
      breakBehavior: { default: 'auto' },
      display: { default: '{}' },
      localContent: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="question"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'question' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(QuestionNodeView)
  },
})

/** 盒子块：atom（children 以 JSON 存储），attrs: blockId, templateId, title, icon, breakBehavior, children(JSON) */
export const DocBox = Node.create({
  name: 'docBox',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      templateId: { default: 'concept' },
      title: { default: '' },
      icon: { default: '' },
      breakBehavior: { default: 'auto' },
      children: { default: '[]' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="box"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'box' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(BoxNodeView)
  },
})

/** 分割线：atom */
export const DocDivider = Node.create({
  name: 'docDivider',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="divider"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'divider' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DividerNodeView)
  },
})

/** 留白：atom，attrs: blockId, heightMm, heightEm */
export const DocSpacer = Node.create({
  name: 'docSpacer',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      heightMm: { default: null },
      heightEm: { default: 2 },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="spacer"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'spacer' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(SpacerNodeView)
  },
})

/** 手动分页：atom */
export const DocPageBreak = Node.create({
  name: 'docPageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="pageBreak"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'pageBreak' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageBreakNodeView)
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.insertContent({
        type: this.name,
        attrs: { blockId: createPageBreakId() },
      }),
    }
  },
})

/** 原始 Markdown：atom，attrs: blockId, markdown, reason */
export const DocRawMarkdown = Node.create({
  name: 'docRawMarkdown',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      markdown: { default: '' },
      reason: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="rawMarkdown"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'rawMarkdown' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(RawMarkdownNodeView)
  },
})

/** 未知块：atom，attrs: blockId, originalType, rawData(JSON) */
export const DocUnknown = Node.create({
  name: 'docUnknown',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: '' },
      originalType: { default: 'unknown' },
      rawData: { default: 'null' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-block-type="unknown"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-type': 'unknown' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(UnknownNodeView)
  },
})

// ─── 扩展集工厂 ─────────────────────────────────────────────────────────────

/**
 * 创建文档级编辑器扩展集。
 * - StarterKit 提供 document/text/marks/history/hardBreak
 * - 禁用所有 StarterKit 块级节点（paragraph/heading/list/blockquote/codeBlock/hr）
 * - 自定义块节点覆盖所有 TeachingBlock 类型
 * - 行内扩展复用 BlockInlineEditor 的 InlineMathNode/UnknownInlineNode/FontFamilyMark/UnknownMark
 */
export function createDocumentEditorExtensions() {
  return [
    StarterKit.configure({
      // 保留 document + text（StarterKit 内置）
      // 禁用默认块级节点：由自定义节点替代
      paragraph: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      horizontalRule: false,
      // 保留内置 marks
      bold: {},
      italic: {},
      strike: {},
      code: {},
      underline: {},
      // 保留 hardBreak
      hardBreak: {},
      // 启用 undo/redo（由编辑器管理，不再走外部 TeachingDocumentHistory）
      undoRedo: {},
      // 禁用不需要的辅助能力
      link: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
    }),
    // 自定义文本块
    DocParagraph,
    DocHeading,
    // 原子块节点
    DocBlockMath,
    DocFigure,
    DocQuestion,
    DocBox,
    DocDivider,
    DocSpacer,
    DocPageBreak,
    DocRawMarkdown,
    DocUnknown,
    // 行内扩展（复用现有）
    InlineMathNode,
    UnknownInlineNode,
    FontFamilyMark,
    TextColorMark,
    UnknownMark,
    // 尺寸调整 commands（setFigureWidth / setSpacerHeight + undo 合并）
    ResizeCommands,
    PaginationDecorations,
    ActiveTextBlockDecoration,
    DocumentSelectionSafety,
  ]
}
