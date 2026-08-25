/**
 * TeachingDocumentV1 ↔ Tiptap editor JSON 双向序列化
 *
 * 数据契约：
 * - round-trip 无损：teachingDocumentToEditorDoc → editorDocToTeachingDocument 还原一致
 * - 未知节点和旧字段完整保留
 * - 行内内容通过 inlineAdapter 的 teachingInlinesToTiptapDoc / tiptapDocToTeachingInlines 处理
 */
import type { JSONContent } from '@tiptap/react'
import type {
  TeachingBlock,
  TeachingDocumentV1,
  TeachingDocumentStyle,
  TeachingDocumentOutlineOptions,
  TeachingDocumentDesign,
  TeachingDocumentType,
  TeachingInline,
  FigureAssetRef,
  BoxChildBlock,
} from '@/types/teachingDocument'
import {
  teachingInlinesToTiptapDoc,
  tiptapDocToTeachingInlines,
} from '@/utils/teachingDocument/inlineAdapter'
import { headingLabelByBlockId } from '@/utils/teachingDocument/outline'
import { isFigureLayoutPreset } from '@/utils/teachingDocument/figureLayoutPresets'
import { parseBoxAppearance } from '@/utils/teachingDocument/boxAppearance'
import { parseTeachingSkinRef } from '@/utils/teachingDocument/skins'

// ─── TeachingBlock → Tiptap JSONContent ─────────────────────────────────────

/** 供文档编辑器与卡片连续编辑流共用：块 → Tiptap 节点。 */
export function blockToEditorNode(block: TeachingBlock, labels: ReadonlyMap<string, string> = new Map()): JSONContent {
  switch (block.type) {
    case 'heading':
      return {
        type: 'docHeading',
        attrs: {
          blockId: block.id,
          level: block.level,
          numberLabel: labels.get(block.id) || '',
          numbering: JSON.stringify(block.numbering || {}),
          alignment: block.alignment || 'left',
          indentLevel: block.indentLevel || 0,
          skin: block.skin ? JSON.stringify(block.skin) : '',
        },
        content: inlinesToEditorContent(block.content),
      }
    case 'paragraph':
      return {
        type: 'docParagraph',
        attrs: {
          blockId: block.id,
          alignment: block.alignment || 'left',
          listStyle: block.listStyle || '',
          indentLevel: block.indentLevel || 0,
        },
        content: inlinesToEditorContent(block.content),
      }
    case 'blockMath':
      return {
        type: 'docBlockMath',
        attrs: { blockId: block.id, latex: block.latex, label: block.label || '' },
      }
    case 'table':
      return { type: 'docTable', attrs: { blockId: block.id, rows: JSON.stringify(block.rows), hasHeader: block.hasHeader ?? true } }
    case 'figure':
      return {
        type: 'docFigure',
        attrs: {
          blockId: block.id,
          asset: JSON.stringify(block.asset),
          alignment: block.alignment,
          layoutPreset: block.layoutPreset ?? null,
          widthMm: block.widthMm ?? null,
          widthRatio: block.widthRatio ?? null,
          lockAspectRatio: block.lockAspectRatio ?? true,
          textWrap: block.textWrap ?? 'top-bottom',
          wrapGapMm: block.wrapGapMm ?? 4,
          caption: block.caption || '',
          alt: block.alt || '',
          groupItems: JSON.stringify(block.groupItems || []),
          groupColumns: block.groupColumns || 2,
          groupGapMm: block.groupGapMm ?? 4,
        },
      }
    case 'tikz':
      return { type: 'docTikz', attrs: { blockId: block.id, source: block.source, sourceHash: block.sourceHash || '', svgAssetId: block.svgAssetId || '', alignment: block.alignment, layoutPreset: block.layoutPreset ?? null, widthMm: block.widthMm ?? null, alt: block.alt || '', caption: block.caption || '' } }
    case 'question':
      return {
        type: 'docQuestion',
        attrs: {
          blockId: block.id,
          questionId: block.questionId,
          breakBehavior: block.breakBehavior || 'auto',
          display: JSON.stringify(block.display ?? {}),
          localContent: block.localContent ? JSON.stringify(block.localContent) : '',
        },
      }
    case 'box':
      return {
        type: 'docBox',
        attrs: {
          blockId: block.id,
          templateId: block.templateId,
          title: block.title || '',
          icon: block.icon || '',
          appearance: JSON.stringify(block.appearance || {}),
          skin: block.skin ? JSON.stringify(block.skin) : '',
          breakBehavior: block.breakBehavior,
          children: JSON.stringify(block.children),
        },
      }
    case 'divider':
      return {
        type: 'docDivider',
        attrs: { blockId: block.id },
      }
    case 'spacer':
      return {
        type: 'docSpacer',
        attrs: {
          blockId: block.id,
          heightMm: block.heightMm ?? null,
          heightEm: block.heightEm,
        },
      }
    case 'pageBreak':
      return {
        type: 'docPageBreak',
        attrs: { blockId: block.id },
      }
    case 'rawMarkdown':
      return {
        type: 'docRawMarkdown',
        attrs: {
          blockId: block.id,
          markdown: block.markdown,
          reason: block.reason || '',
        },
      }
    case 'unknown':
      return {
        type: 'docUnknown',
        attrs: {
          blockId: block.id,
          originalType: block.originalType,
          rawData: JSON.stringify(block.rawData ?? null),
        },
      }
  }
}

/** 将 TeachingInline[] 转为 Tiptap 行内 content 数组（去掉外层 doc/paragraph 包装） */
function inlinesToEditorContent(inlines: TeachingInline[]): JSONContent[] | undefined {
  const doc = teachingInlinesToTiptapDoc(inlines)
  const paragraph = doc.content?.[0]
  const content = paragraph?.content
  return content?.length ? content : undefined
}

// ─── Tiptap JSONContent → TeachingBlock ─────────────────────────────────────

/** 供文档编辑器与卡片连续编辑流共用：Tiptap 节点 → 块（无 blockId 返回 null）。 */
export function editorNodeToBlock(node: JSONContent): TeachingBlock | null {
  const attrs = node.attrs || {}
  const blockId = String(attrs.blockId || '')
  if (!blockId) return null

  switch (node.type) {
    case 'docHeading': {
      const level = Math.min(4, Math.max(1, Number(attrs.level) || 3)) as 1 | 2 | 3 | 4
      let numbering: unknown
      try { numbering = attrs.numbering ? JSON.parse(String(attrs.numbering)) : undefined } catch { numbering = undefined }
      const alignment = ['left', 'center', 'right', 'justify'].includes(String(attrs.alignment))
        ? String(attrs.alignment) as 'left' | 'center' | 'right' | 'justify'
        : 'left'
      const indentLevel = [0, 1, 2, 3, 4].includes(Number(attrs.indentLevel))
        ? Number(attrs.indentLevel) as 0 | 1 | 2 | 3 | 4
        : 0
      const skin = parseTeachingSkinRef(safeJsonParse(attrs.skin))
      return {
        type: 'heading',
        id: blockId,
        level,
        content: editorContentToInlines(node.content),
        ...(numbering && typeof numbering === 'object' && Object.keys(numbering).length ? { numbering } : {}),
        ...(alignment !== 'left' ? { alignment } : {}),
        ...(indentLevel ? { indentLevel } : {}),
        ...(skin ? { skin } : {}),
      }
    }
    case 'docParagraph': {
      const alignment = ['left', 'center', 'right', 'justify'].includes(String(attrs.alignment))
        ? String(attrs.alignment) as 'left' | 'center' | 'right' | 'justify'
        : 'left'
      const listStyle = ['bullet', 'ordered'].includes(String(attrs.listStyle))
        ? String(attrs.listStyle) as 'bullet' | 'ordered'
        : undefined
      const indentLevel = [0, 1, 2, 3, 4].includes(Number(attrs.indentLevel))
        ? Number(attrs.indentLevel) as 0 | 1 | 2 | 3 | 4
        : 0
      return {
        type: 'paragraph',
        id: blockId,
        content: editorContentToInlines(node.content),
        ...(alignment !== 'left' ? { alignment } : {}),
        ...(listStyle ? { listStyle } : {}),
        ...(indentLevel ? { indentLevel } : {}),
      }
    }
    case 'docBlockMath':
      return {
        type: 'blockMath',
        id: blockId,
        latex: String(attrs.latex || ''),
        ...(attrs.label ? { label: String(attrs.label) } : {}),
      }
    case 'docTable': {
      let rows: unknown = []
      try { rows = JSON.parse(String(attrs.rows || '[]')) } catch { /* normalized below */ }
      return { type: 'table', id: blockId, rows: Array.isArray(rows) ? rows : [], hasHeader: attrs.hasHeader !== false } as TeachingBlock
    }
    case 'docFigure': {
      let asset: FigureAssetRef
      let groupItems: Extract<TeachingBlock, { type: 'figure' }>['groupItems'] = []
      try {
        asset = JSON.parse(String(attrs.asset || '{}'))
      } catch {
        asset = { type: 'documentAsset', assetId: '' }
      }
      try {
        const parsed = JSON.parse(String(attrs.groupItems || '[]'))
        groupItems = Array.isArray(parsed) ? parsed : []
      } catch { /* keep empty */ }
      return {
        type: 'figure',
        id: blockId,
        asset,
        alignment: (attrs.alignment as 'left' | 'center' | 'right') || 'center',
        ...(attrs.layoutPreset ? { layoutPreset: attrs.layoutPreset } : {}),
        ...(attrs.widthMm != null ? { widthMm: Number(attrs.widthMm) } : {}),
        ...(attrs.widthRatio != null ? { widthRatio: Number(attrs.widthRatio) } : {}),
        ...(attrs.lockAspectRatio === false ? { lockAspectRatio: false } : { lockAspectRatio: true }),
        ...(['top-bottom', 'square-left', 'square-right'].includes(String(attrs.textWrap)) && attrs.textWrap !== 'top-bottom' ? { textWrap: attrs.textWrap as 'square-left' | 'square-right' } : {}),
        ...((attrs.textWrap === 'square-left' || attrs.textWrap === 'square-right') && Number.isFinite(Number(attrs.wrapGapMm)) ? { wrapGapMm: Math.max(0, Number(attrs.wrapGapMm)) } : {}),
        ...(attrs.caption ? { caption: String(attrs.caption) } : {}),
        ...(attrs.alt ? { alt: String(attrs.alt) } : {}),
        ...(groupItems.length ? { groupItems } : {}),
        ...(groupItems.length ? { groupColumns: ([1, 2, 3].includes(Number(attrs.groupColumns)) ? Number(attrs.groupColumns) : 2) as 1 | 2 | 3 } : {}),
        ...(groupItems.length ? { groupGapMm: Math.max(0, Number(attrs.groupGapMm) || 0) } : {}),
      }
    }
    case 'docTikz':
      return { type: 'tikz', id: blockId, source: String(attrs.source || ''), ...(attrs.sourceHash ? { sourceHash: String(attrs.sourceHash) } : {}), ...(attrs.svgAssetId ? { svgAssetId: String(attrs.svgAssetId) } : {}), alignment: (['left', 'center', 'right'].includes(String(attrs.alignment)) ? attrs.alignment : 'center') as 'left' | 'center' | 'right', ...(isFigureLayoutPreset(attrs.layoutPreset) ? { layoutPreset: attrs.layoutPreset } : {}), ...(attrs.widthMm != null ? { widthMm: Number(attrs.widthMm) } : {}), ...(attrs.alt ? { alt: String(attrs.alt) } : {}), ...(attrs.caption ? { caption: String(attrs.caption) } : {}) }
    case 'docQuestion': {
      let display: Record<string, unknown> = {}
      try {
        display = JSON.parse(String(attrs.display || '{}'))
      } catch { /* keep empty */ }
      let localContent: unknown = undefined
      if (attrs.localContent) {
        try {
          localContent = JSON.parse(String(attrs.localContent))
        } catch { /* ignore */ }
      }
      return {
        type: 'question',
        id: blockId,
        questionId: String(attrs.questionId || ''),
        breakBehavior: (['auto', 'avoid', 'force-before'].includes(String(attrs.breakBehavior))
          ? String(attrs.breakBehavior)
          : 'auto') as 'auto' | 'avoid' | 'force-before',
        ...(Object.keys(display).length ? { display } : {}),
        ...(localContent ? { localContent } : {}),
      } as TeachingBlock
    }
    case 'docBox': {
      let children: BoxChildBlock[] = []
      let appearance: unknown
      const skin = parseTeachingSkinRef(safeJsonParse(attrs.skin))
      try {
        children = JSON.parse(String(attrs.children || '[]'))
      } catch { /* keep empty */ }
      try {
        appearance = JSON.parse(String(attrs.appearance || '{}'))
      } catch { /* keep default */ }
      const parsedAppearance = parseBoxAppearance(appearance)
      return {
        type: 'box',
        id: blockId,
        templateId: String(attrs.templateId || 'concept'),
        ...(attrs.title ? { title: String(attrs.title) } : {}),
        ...(attrs.icon ? { icon: String(attrs.icon) } : {}),
        ...(parsedAppearance ? { appearance: parsedAppearance } : {}),
        ...(skin ? { skin } : {}),
        breakBehavior: (attrs.breakBehavior as 'auto' | 'avoid' | 'allow' | 'force-before') || 'auto',
        children,
      }
    }
    case 'docDivider':
      return { type: 'divider', id: blockId }
    case 'docSpacer':
      return {
        type: 'spacer',
        id: blockId,
        heightEm: Number(attrs.heightEm) || 2,
        ...(attrs.heightMm != null ? { heightMm: Number(attrs.heightMm) } : {}),
      }
    case 'docPageBreak':
      return { type: 'pageBreak', id: blockId }
    case 'docRawMarkdown':
      return {
        type: 'rawMarkdown',
        id: blockId,
        markdown: String(attrs.markdown || ''),
        ...(attrs.reason ? { reason: attrs.reason as 'fallback' | 'user-inserted' | 'unsupported-structure' } : {}),
      }
    case 'docUnknown': {
      let rawData: unknown = null
      try {
        rawData = JSON.parse(String(attrs.rawData || 'null'))
      } catch { /* keep null */ }
      return {
        type: 'unknown',
        id: blockId,
        originalType: String(attrs.originalType || 'unknown'),
        rawData,
      }
    }
    default:
      return null
  }
}

/** 从 Tiptap 行内 content 数组还原 TeachingInline[]（包装为 doc/paragraph 后调用 tiptapDocToTeachingInlines） */
function editorContentToInlines(content: JSONContent[] | undefined) {
  const doc: JSONContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: content || undefined }],
  }
  return tiptapDocToTeachingInlines(doc)
}

function safeJsonParse(value: unknown): unknown {
  if (!value) return undefined
  try { return JSON.parse(String(value)) } catch { return undefined }
}

// ─── 公开 API ────────────────────────────────────────────────────────────────

const jsonSignatureCache = new WeakMap<readonly unknown[], string>()

/**
 * JSON.stringify 的 WeakMap 缓存：同一数组引用被反复序列化时只计算一次。
 * 文档回显路径里 document.content / children 数组引用在两次渲染间通常不变，
 * 用它替代每次 `JSON.stringify(document.content)` 的全量序列化。
 */
export function cachedJsonSignature(value: readonly unknown[]): string {
  let signature = jsonSignatureCache.get(value)
  if (signature === undefined) {
    signature = JSON.stringify(value)
    jsonSignatureCache.set(value, signature)
  }
  return signature
}

/** 将 TeachingDocumentV1 转为可载入文档级编辑器的 Tiptap doc JSON */
export function teachingDocumentToEditorDoc(doc: TeachingDocumentV1): JSONContent {
  const labels = headingLabelByBlockId(doc)
  const content = doc.content.map((block) => blockToEditorNode(block, labels))
  // ProseMirror 要求 doc 至少有一个块；空文档插入一个空段落
  if (!content.length) {
    content.push({ type: 'docParagraph', attrs: { blockId: '__empty__' } })
  }
  return { type: 'doc', content }
}

export interface EditorDocMeta {
  documentType: TeachingDocumentType
  title: string
  metadata: Record<string, unknown>
  style?: TeachingDocumentStyle
  outline?: TeachingDocumentOutlineOptions
  design?: TeachingDocumentDesign
}

/** 从编辑器 JSON 还原 TeachingDocumentV1；保留未知节点和旧字段 */
export function editorDocToTeachingDocument(json: JSONContent, meta: EditorDocMeta): TeachingDocumentV1 {
  const blocks: TeachingBlock[] = []
  for (const node of json.content || []) {
    const block = editorNodeToBlock(node)
    if (block) {
      // 跳过空文档占位符
      if (block.id === '__empty__' && block.type === 'paragraph' && block.content.length === 0) continue
      blocks.push(block)
    }
  }
  return {
    version: 1,
    documentType: meta.documentType,
    title: meta.title,
    metadata: meta.metadata,
    content: blocks,
    ...(meta.style ? { style: meta.style } : {}),
    ...(meta.outline ? { outline: meta.outline } : {}),
    ...(meta.design ? { design: meta.design } : {}),
  }
}
