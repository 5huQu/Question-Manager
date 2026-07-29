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
  TeachingDocumentType,
  TeachingInline,
  FigureAssetRef,
  BoxChildBlock,
} from '@/types/teachingDocument'
import {
  teachingInlinesToTiptapDoc,
  tiptapDocToTeachingInlines,
} from '@/utils/teachingDocument/inlineAdapter'

// ─── TeachingBlock → Tiptap JSONContent ─────────────────────────────────────

function blockToEditorNode(block: TeachingBlock): JSONContent {
  switch (block.type) {
    case 'heading':
      return {
        type: 'docHeading',
        attrs: { blockId: block.id, level: block.level },
        content: inlinesToEditorContent(block.content),
      }
    case 'paragraph':
      return {
        type: 'docParagraph',
        attrs: { blockId: block.id },
        content: inlinesToEditorContent(block.content),
      }
    case 'blockMath':
      return {
        type: 'docBlockMath',
        attrs: { blockId: block.id, latex: block.latex, label: block.label || '' },
      }
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
          caption: block.caption || '',
          alt: block.alt || '',
        },
      }
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

function editorNodeToBlock(node: JSONContent): TeachingBlock | null {
  const attrs = node.attrs || {}
  const blockId = String(attrs.blockId || '')
  if (!blockId) return null

  switch (node.type) {
    case 'docHeading': {
      const level = Math.min(4, Math.max(1, Number(attrs.level) || 3)) as 1 | 2 | 3 | 4
      return {
        type: 'heading',
        id: blockId,
        level,
        content: editorContentToInlines(node.content),
      }
    }
    case 'docParagraph':
      return {
        type: 'paragraph',
        id: blockId,
        content: editorContentToInlines(node.content),
      }
    case 'docBlockMath':
      return {
        type: 'blockMath',
        id: blockId,
        latex: String(attrs.latex || ''),
        ...(attrs.label ? { label: String(attrs.label) } : {}),
      }
    case 'docFigure': {
      let asset: FigureAssetRef
      try {
        asset = JSON.parse(String(attrs.asset || '{}'))
      } catch {
        asset = { type: 'documentAsset', assetId: '' }
      }
      return {
        type: 'figure',
        id: blockId,
        asset,
        alignment: (attrs.alignment as 'left' | 'center' | 'right') || 'center',
        ...(attrs.layoutPreset ? { layoutPreset: attrs.layoutPreset } : {}),
        ...(attrs.widthMm != null ? { widthMm: Number(attrs.widthMm) } : {}),
        ...(attrs.widthRatio != null ? { widthRatio: Number(attrs.widthRatio) } : {}),
        ...(attrs.lockAspectRatio === false ? { lockAspectRatio: false } : { lockAspectRatio: true }),
        ...(attrs.caption ? { caption: String(attrs.caption) } : {}),
        ...(attrs.alt ? { alt: String(attrs.alt) } : {}),
      }
    }
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
      try {
        children = JSON.parse(String(attrs.children || '[]'))
      } catch { /* keep empty */ }
      return {
        type: 'box',
        id: blockId,
        templateId: String(attrs.templateId || 'concept'),
        ...(attrs.title ? { title: String(attrs.title) } : {}),
        ...(attrs.icon ? { icon: String(attrs.icon) } : {}),
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

// ─── 公开 API ────────────────────────────────────────────────────────────────

/** 将 TeachingDocumentV1 转为可载入文档级编辑器的 Tiptap doc JSON */
export function teachingDocumentToEditorDoc(doc: TeachingDocumentV1): JSONContent {
  const content = doc.content.map(blockToEditorNode)
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
  }
}
