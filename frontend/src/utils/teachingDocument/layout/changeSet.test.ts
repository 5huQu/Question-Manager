import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import { createTeachingDocumentLayoutChangeSet } from './changeSet'

function documentWith(ids: string[]): TeachingDocumentV1 {
  return {
    version: 1,
    documentType: 'lecture',
    title: 'doc',
    metadata: {},
    content: ids.map((id) => ({ type: 'paragraph', id, content: [{ type: 'text', text: id }] })),
  }
}

function change(previous: TeachingDocumentV1, current: TeachingDocumentV1, style = 'style') {
  return createTeachingDocumentLayoutChangeSet({
    previous,
    current,
    previousLayoutStyleSignature: style,
    currentLayoutStyleSignature: style,
    previousResourceRevision: 'resources',
    currentResourceRevision: 'resources',
  })
}

describe('createTeachingDocumentLayoutChangeSet', () => {
  it('marks only a changed immutable block dirty', () => {
    const previous = documentWith(['a', 'b', 'c'])
    const current = {
      ...previous,
      content: previous.content.map((block) => block.id === 'b'
        ? { ...block, content: [{ type: 'text' as const, text: 'changed' }] }
        : block),
    }
    expect(change(previous, current)).toMatchObject({
      dirtyBlockIds: ['b'],
      firstDirtyTopLevelIndex: 1,
      structureChanged: false,
      paperOrGlobalStyleChanged: false,
    })
  })

  it('starts propagation at an inserted page break without dirtying following blocks', () => {
    const previous = documentWith(['a', 'b'])
    const current: TeachingDocumentV1 = {
      ...previous,
      content: [previous.content[0], { type: 'pageBreak', id: 'break' }, previous.content[1]],
    }
    expect(change(previous, current)).toMatchObject({
      dirtyBlockIds: ['break'],
      firstDirtyTopLevelIndex: 1,
      structureChanged: true,
    })
  })

  it('globally invalidates paper style and resource changes', () => {
    const source = documentWith(['a'])
    const result = createTeachingDocumentLayoutChangeSet({
      previous: source,
      current: source,
      previousLayoutStyleSignature: 'old',
      currentLayoutStyleSignature: 'new',
      previousResourceRevision: 'r1',
      currentResourceRevision: 'r2',
    })
    expect(result.firstDirtyTopLevelIndex).toBe(0)
    expect(result.paperOrGlobalStyleChanged).toBe(true)
    expect(result.resourceIdsChanged).toEqual(['*'])
  })
})
