import { describe, expect, it } from 'vitest'
import type { TeachingDocumentV1 } from '@/types/teachingDocument'
import {
  applyTeachingDocumentCommand,
  createTeachingDocumentHistory,
  executeTeachingDocumentCommand,
  newTeachingBlock,
  redoTeachingDocument,
  undoTeachingDocument,
} from './editorState'

const baseDocument: TeachingDocumentV1 = {
  version: 1,
  documentType: 'lecture',
  title: '测试讲义',
  metadata: {},
  content: [
    { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '第一段' }] },
    { type: 'paragraph', id: 'p2', content: [{ type: 'text', text: '第二段' }] },
  ],
}

describe('TeachingDocument editor state', () => {
  it('inserts, moves, duplicates, and deletes blocks by stable id', () => {
    const heading = newTeachingBlock('heading')
    let document = applyTeachingDocumentCommand(baseDocument, { type: 'insertBlock', block: heading, afterBlockId: 'p1' })
    expect(document.content.map((block) => block.id)).toEqual(['p1', heading.id, 'p2'])
    document = applyTeachingDocumentCommand(document, { type: 'moveBlock', blockId: heading.id, direction: 1 })
    expect(document.content.map((block) => block.id)).toEqual(['p1', 'p2', heading.id])
    document = applyTeachingDocumentCommand(document, { type: 'duplicateBlock', blockId: 'p1' })
    expect(document.content[1].id).not.toBe('p1')
    expect(document.content[1]).toMatchObject({ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] })
    document = applyTeachingDocumentCommand(document, { type: 'deleteBlock', blockId: 'p2' })
    expect(document.content.some((block) => block.id === 'p2')).toBe(false)
  })

  it('rejects nested boxes while supporting legal box child operations', () => {
    const box: TeachingDocumentV1['content'][number] = { type: 'box', id: 'box1', templateId: 'concept', breakBehavior: 'auto', children: [] }
    const document: TeachingDocumentV1 = { ...baseDocument, content: [box] }
    const nested = newTeachingBlock('box')
    expect(applyTeachingDocumentCommand(document, { type: 'insertBoxChild', boxId: 'box1', child: nested as never })).toBe(document)
    const paragraph = newTeachingBlock('paragraph')
    expect(paragraph.type).toBe('paragraph')
    const inserted = applyTeachingDocumentCommand(document, { type: 'insertBoxChild', boxId: 'box1', child: paragraph as Extract<typeof paragraph, { type: 'paragraph' }> })
    expect(inserted.content[0]).toMatchObject({ type: 'box', children: [{ id: paragraph.id }] })
    const divider = newTeachingBlock('divider')
    const withDivider = applyTeachingDocumentCommand(inserted, { type: 'insertBoxChild', boxId: 'box1', child: divider as Extract<typeof divider, { type: 'divider' }> })
    const moved = applyTeachingDocumentCommand(withDivider, { type: 'moveBoxChild', boxId: 'box1', childId: divider.id, direction: -1 })
    expect(moved.content[0]).toMatchObject({ type: 'box', children: [{ id: divider.id }, { id: paragraph.id }] })
    const removed = applyTeachingDocumentCommand(moved, { type: 'deleteBoxChild', boxId: 'box1', childId: paragraph.id })
    expect(removed.content[0]).toMatchObject({ type: 'box', children: [{ id: divider.id }] })
  })

  it('keeps UnknownBlock and complex inline data unchanged', () => {
    const unknown = { type: 'unknown', id: 'u1', originalType: 'future', rawData: { nested: ['kept'] } } as const
    const complex = {
      type: 'paragraph',
      id: 'complex',
      content: [
        { type: 'text', text: '保留', marks: ['bold'], unknownMarks: [{ future: true }] },
        { type: 'unknown', originalType: 'futureInline', rawData: { value: 1 } },
      ],
    } as const
    const document = { ...baseDocument, content: [unknown, complex] } as unknown as TeachingDocumentV1
    const unchanged = applyTeachingDocumentCommand(document, { type: 'updateBlock', blockId: 'u1', patch: { rawData: null } as never })
    expect(unchanged).toBe(document)
    const moved = applyTeachingDocumentCommand(document, { type: 'moveBlock', blockId: 'complex', direction: -1 })
    expect(moved.content[0]).toEqual(complex)
  })

  it('supports session-only undo and redo and resets future after a new command', () => {
    let history = createTeachingDocumentHistory(baseDocument)
    history = executeTeachingDocumentCommand(history, { type: 'setTitle', title: '新标题' })
    expect(history.document.title).toBe('新标题')
    history = undoTeachingDocument(history)
    expect(history.document.title).toBe('测试讲义')
    history = redoTeachingDocument(history)
    expect(history.document.title).toBe('新标题')
    history = undoTeachingDocument(history)
    history = executeTeachingDocumentCommand(history, { type: 'setTitle', title: '另一标题' })
    expect(history.future).toEqual([])
  })

  it('merges continuous text commands with the same merge key', () => {
    let history = createTeachingDocumentHistory(baseDocument)
    history = executeTeachingDocumentCommand(history, { type: 'setTitle', title: '测', mergeKey: 'title' })
    history = executeTeachingDocumentCommand(history, { type: 'setTitle', title: '测试', mergeKey: 'title' })
    history = executeTeachingDocumentCommand(history, { type: 'setTitle', title: '测试完成', mergeKey: 'title' })
    expect(history.past).toHaveLength(1)
    expect(undoTeachingDocument(history).document.title).toBe('测试讲义')
  })

  it('reorders blocks by id sequence and rejects invalid orders', () => {
    const reordered = applyTeachingDocumentCommand(baseDocument, { type: 'reorderBlocks', order: ['p2', 'p1'] })
    expect(reordered.content.map((block) => block.id)).toEqual(['p2', 'p1'])
    // 保持块对象引用不变，避免拖拽过程中视觉跳变
    expect(reordered.content[0]).toBe(baseDocument.content[1])
    // 长度不符或含未知 id 的 order 返回原文档
    expect(applyTeachingDocumentCommand(baseDocument, { type: 'reorderBlocks', order: ['p1'] })).toBe(baseDocument)
    expect(applyTeachingDocumentCommand(baseDocument, { type: 'reorderBlocks', order: ['p1', 'missing'] })).toBe(baseDocument)
  })

  it('merges reorder commands within one drag session into a single undo step', () => {
    let history = createTeachingDocumentHistory(baseDocument)
    // 同一次拖拽手势内的多次交换共享 mergeKey，合并为一个撤销步骤
    history = executeTeachingDocumentCommand(history, { type: 'reorderBlocks', order: ['p2', 'p1'], mergeKey: 'drag-1' })
    history = executeTeachingDocumentCommand(history, { type: 'reorderBlocks', order: ['p1', 'p2'], mergeKey: 'drag-1' })
    expect(history.past).toHaveLength(1)
    // 不同手势使用不同 mergeKey，不互相合并
    history = executeTeachingDocumentCommand(history, { type: 'reorderBlocks', order: ['p2', 'p1'], mergeKey: 'drag-2' })
    expect(history.past).toHaveLength(2)
    // 撤销一次回到拖拽前的顺序
    expect(undoTeachingDocument(history).document.content.map((block) => block.id)).toEqual(['p1', 'p2'])
  })

  it('clears undo and redo history when a server document is reloaded', () => {
    let history = createTeachingDocumentHistory(baseDocument)
    history = executeTeachingDocumentCommand(history, { type: 'setTitle', title: '本地修改' })
    history = undoTeachingDocument(history)
    history = executeTeachingDocumentCommand(history, {
      type: 'replaceDocument',
      document: { ...baseDocument, title: '服务端版本' },
    })
    expect(history.document.title).toBe('服务端版本')
    expect(history.past).toEqual([])
    expect(history.future).toEqual([])
  })
})
