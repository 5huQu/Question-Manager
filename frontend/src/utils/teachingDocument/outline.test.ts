import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { buildDocumentOutline } from './outline'
import { applyTeachingDocumentCommand } from './editorState'
import { editorDocToTeachingDocument, teachingDocumentToEditorDoc } from '@/components/teaching-document/editor/serialization'
import { parseTeachingDocument } from './validate'

const documentWithSections: TeachingDocumentV1 = {
  version: 1, documentType: 'lecture', title: '章节', metadata: {},
  outline: { numberingEnabled: true, preset: 'decimal' },
  content: [
    { type: 'heading', id: 'h1', level: 1, content: [{ type: 'text', text: '函数' }] },
    { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '正文' }] },
    { type: 'heading', id: 'h2', level: 2, content: [{ type: 'text', text: '定义' }] },
    { type: 'paragraph', id: 'p2', content: [{ type: 'text', text: '子正文' }] },
    { type: 'heading', id: 'h3', level: 1, content: [{ type: 'text', text: '导数' }] },
  ],
}

describe('teaching document outline', () => {
  it('derives hierarchy, ranges, and decimal labels without changing content', () => {
    const outline = buildDocumentOutline(documentWithSections)
    expect(outline.roots.map((entry) => entry.blockId)).toEqual(['h1', 'h3'])
    expect(outline.entryByBlockId.get('h1')?.childBlockIds).toEqual(['h2'])
    expect(outline.sectionRangeByBlockId.get('h1')).toEqual([0, 4])
    expect(outline.entries.map((entry) => entry.displayLabel)).toEqual(['1', '1.1', '2'])
    expect(documentWithSections.content[0]).not.toHaveProperty('displayLabel')
  })

  it('supports textbook and per-heading manual labels', () => {
    const secondHeading = documentWithSections.content[2]
    if (secondHeading.type !== 'heading') throw new Error('fixture heading is missing')
    const document: TeachingDocumentV1 = { ...documentWithSections, outline: { numberingEnabled: true, preset: 'textbook' }, content: [
      documentWithSections.content[0],
      { ...secondHeading, numbering: { mode: 'manual', manualLabel: '附录 A' } },
    ] }
    expect(buildDocumentOutline(document).entries.map((entry) => entry.displayLabel)).toEqual(['第一章', '附录 A'])
  })

  it('supports chapter, decimal, bracket, and western multi-level numbering presets', () => {
    const labels = (preset: NonNullable<TeachingDocumentV1['outline']>['preset']) => buildDocumentOutline({
      ...documentWithSections,
      outline: { numberingEnabled: true, preset },
      content: documentWithSections.content.slice(0, 3),
    }).entries.map((entry) => entry.displayLabel)
    expect(labels('chapter-chinese')).toEqual(['第一章', '一、'])
    expect(labels('chapter-decimal')).toEqual(['第一章', '1.1'])
    expect(labels('paren')).toEqual(['（一）', '1.'])
    expect(labels('roman')).toEqual(['I.', 'A.'])
  })

  it('moves an entire section and leaves its child content attached', () => {
    const moved = applyTeachingDocumentCommand(documentWithSections, { type: 'moveSectionByStep', headingId: 'h3', direction: -1 })
    expect(moved.content.map((block) => block.id)).toEqual(['h3', 'h1', 'p1', 'h2', 'p2'])
    const restored = applyTeachingDocumentCommand(moved, { type: 'moveSectionByStep', headingId: 'h1', direction: -1 })
    expect(restored.content.map((block) => block.id)).toEqual(['h1', 'p1', 'h2', 'p2', 'h3'])
  })

  it('round-trips document and heading numbering configuration through parser and editor serialization', () => {
    const parsed = parseTeachingDocument({
      ...documentWithSections,
      style: { bodyFont: 'songti', bodyLatinFont: 'times', headingFont: 'heiti', headingLatinFont: 'georgia' },
      content: [{ ...documentWithSections.content[0], numbering: { mode: 'manual', manualLabel: '附录 A', restartAt: 2 } }],
    }).document as TeachingDocumentV1
    expect(parsed.outline).toMatchObject({ numberingEnabled: true, preset: 'decimal' })
    expect(parsed.style).toMatchObject({ bodyLatinFont: 'times', headingLatinFont: 'georgia' })
    const editorJson = teachingDocumentToEditorDoc(parsed)
    const restored = editorDocToTeachingDocument(editorJson, {
      documentType: parsed.documentType, title: parsed.title, metadata: parsed.metadata, outline: parsed.outline,
    })
    expect(restored.content[0]).toMatchObject({ numbering: { mode: 'manual', manualLabel: '附录 A', restartAt: 2 } })
  })
})
