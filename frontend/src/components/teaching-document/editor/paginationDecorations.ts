import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { TeachingDocumentV1, TeachingInline } from '@/types/teachingDocument'
import type { InlineCursor, PaginationResult } from '@/utils/teachingDocument'

export interface EditorPageGapAnchor {
  blockId: string
  pageNumber: number
  contentOffset?: number
  leadingBlankPx: number
}

export interface EditorPaginationLayout {
  anchors: EditorPageGapAnchor[]
  pageWidthPx: number
  contentWidthPx: number
  marginLeftPx: number
  marginRightPx: number
  marginTopPx: number
  marginBottomPx: number
  headerHeightPx: number
  footerHeightPx: number
  pageGapPx: number
  totalPages: number
  documentTitle: string
}

export const PAGINATION_LAYOUT_META = new PluginKey<DecorationSet>('teaching-document-pagination-layout')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    teachingPagination: {
      setPaginationLayout: (layout: EditorPaginationLayout | null) => ReturnType
    }
  }
}

function inlineSize(inline: TeachingInline): number {
  return inline.type === 'text' ? inline.text.length : 1
}

export function inlineCursorToEditorOffset(inlines: TeachingInline[], cursor: InlineCursor): number {
  let offset = 0
  const end = Math.min(cursor.inlineIndex, inlines.length)
  for (let index = 0; index < end; index += 1) offset += inlineSize(inlines[index])
  if (cursor.inlineIndex < inlines.length && cursor.textOffset !== undefined) {
    const inline = inlines[cursor.inlineIndex]
    offset += Math.max(0, Math.min(inline.type === 'text' ? inline.text.length : 0, cursor.textOffset))
  }
  return offset
}

export function paginationGapAnchors(
  document: TeachingDocumentV1,
  pagination: PaginationResult | null,
  contentHeightPx: number,
): EditorPageGapAnchor[] {
  if (!pagination || pagination.pages.length < 2) return []
  const byId = new Map(document.content.map((block) => [block.id, block]))
  const anchors: EditorPageGapAnchor[] = []
  for (let pageIndex = 1; pageIndex < pagination.pages.length; pageIndex += 1) {
    const first = pagination.pages[pageIndex].items[0]
    if (!first) continue
    const previousPage = pagination.pages[pageIndex - 1]
    const leadingBlankPx = Math.max(0, contentHeightPx - previousPage.usedHeight)
    if (first.kind === 'whole') {
      anchors.push({ blockId: first.blockId, pageNumber: pageIndex + 1, leadingBlankPx })
    } else if (first.fragmentType === 'paragraph') {
      const block = byId.get(first.blockId)
      if (block?.type === 'paragraph') {
        anchors.push({
          blockId: first.blockId,
          pageNumber: pageIndex + 1,
          contentOffset: inlineCursorToEditorOffset(block.content, first.range.start),
          leadingBlankPx,
        })
      }
    } else if (first.fragmentIndex === 0) {
      // 后续 question/box fragment 的页隙由 atom NodeView 内部渲染。
      anchors.push({ blockId: first.blockId, pageNumber: pageIndex + 1, leadingBlankPx })
    }
  }
  return anchors
}

function gapDom(layout: EditorPaginationLayout, anchor: EditorPageGapAnchor): HTMLElement {
  const root = document.createElement('span')
  root.className = 'td-page-transition-widget'
  root.contentEditable = 'false'
  root.dataset.pageNumber = String(anchor.pageNumber)
  root.setAttribute('aria-hidden', 'true')
  root.style.setProperty('--td-page-leading-blank', `${anchor.leadingBlankPx}px`)
  root.style.setProperty('--td-page-width', `${layout.pageWidthPx}px`)
  root.style.setProperty('--td-page-content-width', `${layout.contentWidthPx}px`)
  root.style.setProperty('--td-page-margin-left', `${layout.marginLeftPx}px`)
  root.style.setProperty('--td-page-margin-right', `${layout.marginRightPx}px`)
  root.style.setProperty('--td-page-margin-top', `${layout.marginTopPx}px`)
  root.style.setProperty('--td-page-margin-bottom', `${layout.marginBottomPx}px`)
  root.style.setProperty('--td-page-header-height', `${layout.headerHeightPx}px`)
  root.style.setProperty('--td-page-footer-height', `${layout.footerHeightPx}px`)
  root.style.setProperty('--td-page-gap', `${layout.pageGapPx}px`)

  const filler = document.createElement('span')
  filler.className = 'td-page-transition-filler'
  const footer = document.createElement('span')
  footer.className = 'td-page-transition-footer'
  footer.textContent = `${anchor.pageNumber - 1} / ${layout.totalPages}`
  const band = document.createElement('span')
  band.className = 'td-page-transition-band'
  const bottomMargin = document.createElement('span')
  bottomMargin.className = 'td-page-transition-bottom-margin'
  const physicalGap = document.createElement('span')
  physicalGap.className = 'td-page-transition-physical-gap'
  const topMargin = document.createElement('span')
  topMargin.className = 'td-page-transition-top-margin'
  const header = document.createElement('span')
  header.className = 'td-page-transition-header'
  header.textContent = layout.documentTitle
  const label = document.createElement('span')
  label.className = 'td-page-transition-label'
  label.textContent = `第 ${anchor.pageNumber} 页`
  physicalGap.append(label)
  band.append(bottomMargin, physicalGap, topMargin)
  root.append(filler, footer, band, header)
  return root
}

function decorationSet(doc: ProseMirrorNode, layout: EditorPaginationLayout | null): DecorationSet {
  if (!layout) return DecorationSet.empty
  // 单次 doc 遍历解析全部锚点位置；原来每个锚点各做一次全量 descendants，
  // 多页文档会退化为 P 次全树遍历。
  const remaining = new Map<string, EditorPageGapAnchor>()
  for (const anchor of layout.anchors) remaining.set(anchor.blockId, anchor)
  const widgets: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!remaining.size) return false
    const anchor = remaining.get(String(node.attrs.blockId || ''))
    if (!anchor) return true
    const position = anchor.contentOffset === undefined
      ? pos
      : Math.min(pos + node.nodeSize - 1, pos + 1 + anchor.contentOffset)
    widgets.push(Decoration.widget(position, () => gapDom(layout, anchor), { side: -1, key: `page-${anchor.pageNumber}` }))
    remaining.delete(anchor.blockId)
    return true
  })
  return DecorationSet.create(doc, widgets)
}

export const PaginationDecorations = Extension.create({
  name: 'teachingPagination',
  addCommands() {
    return {
      setPaginationLayout: (layout) => ({ tr, dispatch }) => {
        tr.setMeta(PAGINATION_LAYOUT_META, layout)
        tr.setMeta('addToHistory', false)
        dispatch?.(tr)
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: PAGINATION_LAYOUT_META,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr: Transaction, current: DecorationSet) => {
          const layout = tr.getMeta(PAGINATION_LAYOUT_META) as EditorPaginationLayout | null | undefined
          if (layout !== undefined) return decorationSet(tr.doc, layout)
          return current.map(tr.mapping, tr.doc)
        },
      },
      props: {
        decorations(state: EditorState) {
          return PAGINATION_LAYOUT_META.getState(state) || DecorationSet.empty
        },
      },
    })]
  },
})
