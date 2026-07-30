/**
 * TeachingInline[] ↔ Tiptap JSONContent 双向适配器
 *
 * 数据契约：
 * - TeachingDocumentV1.content 中的 TeachingInline[] 是唯一事实来源
 * - 序列化/反序列化确定且无损：text + marks、inlineMath、hardBreak 完整往返
 * - UnknownInline / unknownMarks 进入保护模式：以 unknownInline 节点 / unknownMark mark
 *   形式携带原始 JSON，编辑器只读展示，绝不删除或扁平化
 */
import type { JSONContent } from '@tiptap/react'
import type { InlineMark, TeachingInline } from '@/types/teachingDocument'

/** 已知 marks 的规范化输出顺序，保证序列化确定性 */
const MARK_ORDER: InlineMark[] = ['bold', 'italic', 'underline', 'strikethrough', 'code']

const MARK_TO_TIPTAP: Record<InlineMark, string> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikethrough: 'strike',
  code: 'code',
}

const TIPTAP_TO_MARK: Record<string, InlineMark> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  code: 'code',
}

/** 粘贴时允许保留的 HTML 标签 → mark 映射；其余标签仅提取文本 */
const PASTE_TAG_MARKS: Record<string, InlineMark[]> = {
  B: ['bold'],
  STRONG: ['bold'],
  I: ['italic'],
  EM: ['italic'],
  U: ['underline'],
  S: ['strikethrough'],
  STRIKE: ['strikethrough'],
  DEL: ['strikethrough'],
  CODE: ['code'],
}

/** 粘贴时完全丢弃（含内容）的危险标签 */
const PASTE_REMOVED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'TEMPLATE',
  'NOSCRIPT', 'AUDIO', 'VIDEO', 'CANVAS', 'SVG', 'MATH',
])

// ─── TeachingInline[] → Tiptap JSON ─────────────────────────────────────────

function marksToTiptap(inline: Extract<TeachingInline, { type: 'text' }>): Array<{ type: string; attrs?: Record<string, unknown> }> | undefined {
  const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = []
  for (const mark of inline.marks || []) {
    const tiptapType = MARK_TO_TIPTAP[mark]
    if (tiptapType) marks.push({ type: tiptapType })
  }
  // 行内字体覆盖：以 fontFamily mark 携带字体 id（不属于字符串 marks）
  if (inline.font) marks.push({ type: 'fontFamily', attrs: { family: inline.font } })
  if (inline.color) marks.push({ type: 'textColor', attrs: { color: inline.color } })
  for (const [index, raw] of (inline.unknownMarks || []).entries()) {
    marks.push({ type: 'unknownMark', attrs: { data: JSON.stringify(raw ?? null), index } })
  }
  return marks.length ? marks : undefined
}

function inlineToTiptapNode(inline: TeachingInline): JSONContent {
  switch (inline.type) {
    case 'text':
      return { type: 'text', text: inline.text, marks: marksToTiptap(inline) }
    case 'inlineMath':
      return { type: 'inlineMath', attrs: { latex: inline.latex } }
    case 'hardBreak':
      return { type: 'hardBreak' }
    case 'unknown':
      return {
        type: 'unknownInline',
        attrs: { originalType: inline.originalType, data: JSON.stringify(inline.rawData ?? null) },
      }
  }
}

/** 将 TeachingInline[] 转换为可载入单块编辑器的 Tiptap doc JSON */
export function teachingInlinesToTiptapDoc(inlines: TeachingInline[]): JSONContent {
  // ProseMirror 不允许空文本节点；空 text 无可见内容，过滤不影响显示。
  // 注意：这只影响编辑器 UI 状态，文档中的原始数据不受影响；
  // 带 unknownMarks 的空 text 仍会触发保护模式（只读，数据不经过编辑器回写）。
  const content = inlines
    .filter((inline) => !(inline.type === 'text' && !inline.text))
    .map(inlineToTiptapNode)
  return { type: 'doc', content: [{ type: 'paragraph', content: content.length ? content : undefined }] }
}

// ─── Tiptap JSON → TeachingInline[] ─────────────────────────────────────────

/** 从 Tiptap doc JSON 还原 TeachingInline[]；输出确定且无损 */
export function tiptapDocToTeachingInlines(doc: JSONContent): TeachingInline[] {
  const inlines: TeachingInline[] = []
  const blocks = doc.content || []
  for (const block of blocks) {
    if (inlines.length && block.type !== 'paragraph') continue
    for (const node of block.content || []) {
      collectInline(node, inlines)
    }
  }
  return inlines
}

function collectInline(node: JSONContent, out: TeachingInline[]): void {
  if (node.type === 'text') {
    const text = node.text ?? ''
    const marks: InlineMark[] = []
    let font: string | undefined
    let color: string | undefined
    const unknownEntries: Array<{ index: number; raw: unknown }> = []
    for (const mark of node.marks || []) {
      const known = TIPTAP_TO_MARK[mark.type || '']
      if (known) {
        marks.push(known)
      } else if (mark.type === 'fontFamily') {
        const family = mark.attrs?.family
        if (typeof family === 'string' && family) font = family
      } else if (mark.type === 'textColor') {
        const value = mark.attrs?.color
        if (typeof value === 'string' && value) color = value
      } else if (mark.type === 'unknownMark') {
        let raw: unknown = null
        try { raw = JSON.parse(String(mark.attrs?.data ?? 'null')) } catch { raw = null }
        unknownEntries.push({ index: Number(mark.attrs?.index ?? unknownEntries.length), raw })
      }
      // 其余未识别 mark（理论上不会出现，schema 已约束）静默忽略
    }
    marks.sort((a, b) => MARK_ORDER.indexOf(a) - MARK_ORDER.indexOf(b))
    const deduped = [...new Set(marks)]
    const unknownMarks = unknownEntries
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.raw)
    const inline: TeachingInline = {
      type: 'text',
      text,
      ...(deduped.length ? { marks: deduped } : {}),
      ...(font ? { font } : {}),
      ...(color ? { color } : {}),
      ...(unknownMarks.length ? { unknownMarks } : {}),
    }
    if (text || deduped.length || font || color || unknownMarks.length) out.push(inline)
    return
  }
  if (node.type === 'inlineMath') {
    out.push({ type: 'inlineMath', latex: String(node.attrs?.latex ?? '') })
    return
  }
  if (node.type === 'hardBreak') {
    out.push({ type: 'hardBreak' })
    return
  }
  if (node.type === 'unknownInline') {
    let raw: unknown = null
    try { raw = JSON.parse(String(node.attrs?.data ?? 'null')) } catch { raw = null }
    out.push({ type: 'unknown', originalType: String(node.attrs?.originalType ?? 'unknown'), rawData: raw })
    return
  }
  // 非预期节点：递归提取行内内容，避免静默丢失文本
  for (const child of node.content || []) collectInline(child, out)
}

// ─── 保护模式检测 ────────────────────────────────────────────────────────────

/** 内容是否包含无法安全往返的数据（UnknownInline 或 unknownMarks） */
export function hasProtectedInlineContent(inlines: TeachingInline[]): boolean {
  return inlines.some((inline) =>
    inline.type === 'unknown' || (inline.type === 'text' && (inline.unknownMarks?.length ?? 0) > 0))
}

/** 生成保护模式的原因说明 */
export function protectedInlineReason(inlines: TeachingInline[]): string {
  const reasons: string[] = []
  const unknownTypes = new Set(
    inlines.filter((inline): inline is Extract<TeachingInline, { type: 'unknown' }> => inline.type === 'unknown')
      .map((inline) => inline.originalType),
  )
  if (unknownTypes.size) reasons.push(`未识别的行内节点（${[...unknownTypes].join('、')}）`)
  if (inlines.some((inline) => inline.type === 'text' && (inline.unknownMarks?.length ?? 0) > 0)) {
    reasons.push('未识别的文字标记（unknownMarks）')
  }
  return reasons.length
    ? `该块包含${reasons.join('与')}，为防止数据丢失已进入只读保护模式，原始数据完整保留。`
    : ''
}

// ─── 粘贴 HTML → 安全行内内容 ────────────────────────────────────────────────

/**
 * 将粘贴的 HTML 降级为安全行内内容：
 * - 只映射允许的 marks（bold/italic/underline/strikethrough/code）、纯文本与换行
 * - 拒绝事件属性、style、任意标签语义与 javascript: URL
 * - <script> 等危险标签连同内容整体丢弃；文本中的标签字符保持普通文本
 */
export function pastedHtmlToSafeInlines(html: string): TeachingInline[] {
  const parser = new DOMParser()
  const parsed = parser.parseFromString(html, 'text/html')
  const inlines: TeachingInline[] = []
  walkPasteNodes(parsed.body.childNodes, [], inlines)
  return inlines
}

function walkPasteNodes(nodes: NodeListOf<ChildNode>, activeMarks: InlineMark[], out: TeachingInline[]): void {
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) out.push({ type: 'text', text, ...(activeMarks.length ? { marks: [...activeMarks] } : {}) })
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const element = node as Element
    const tag = element.tagName.toUpperCase()
    if (PASTE_REMOVED_TAGS.has(tag)) continue
    if (tag === 'BR') {
      out.push({ type: 'hardBreak' })
      continue
    }
    const tagMarks = PASTE_TAG_MARKS[tag] || []
    const nextMarks = [...new Set([...activeMarks, ...tagMarks])]
    // 块级语义标签（p/div/li/h* 等）不保留结构，仅递归提取文本；
    // 在块边界插入换行以保持可读性
    const isBlockLike = ['P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TABLE', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER'].includes(tag)
    if (isBlockLike && out.length && out[out.length - 1].type !== 'hardBreak') {
      out.push({ type: 'hardBreak' })
    }
    walkPasteNodes(element.childNodes, nextMarks, out)
  }
}
