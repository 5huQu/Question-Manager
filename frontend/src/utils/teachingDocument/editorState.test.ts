import { describe, expect, it } from 'vitest'
import type { BoxChildBlock, TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import {
  applyTeachingDocumentCommand,
  createTeachingDocumentHistory,
  executeTeachingDocumentCommand,
  blocksForRawMarkdownFigureInsertion,
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
  it('splits mixed Markdown at the cursor and inserts one independent figure', () => {
    const markdown = '第一段\n\n第二段'
    const { blocks, figure } = blocksForRawMarkdownFigureInsertion(markdown, markdown.indexOf('第二段'), 'asset-1')
    expect(blocks.map((block) => block.type)).toEqual(['rawMarkdown', 'figure', 'rawMarkdown'])
    expect(blocks[0]).toMatchObject({ type: 'rawMarkdown', markdown: '第一段' })
    expect(figure.asset).toEqual({ type: 'documentAsset', assetId: 'asset-1' })
    expect(blocks[2]).toMatchObject({ type: 'rawMarkdown', markdown: '第二段' })
  })

  it('assigns document-order numbers to uncustomized questions', () => {
    const first = { ...newTeachingBlock('question'), questionId: 'bank-19' } as TeachingBlock
    const second = { ...newTeachingBlock('question'), questionId: 'bank-3' } as TeachingBlock
    const custom = { ...newTeachingBlock('question'), questionId: 'bank-8', display: { displayNumber: '例 2' } } as TeachingBlock
    const history = createTeachingDocumentHistory({ ...baseDocument, content: [first, custom, second] })
    expect(history.document.content.filter((block) => block.type === 'question').map((block) => block.display?.displayNumber)).toEqual(['1', '例 2', '3'])
    expect(history.document.content[0].type === 'question' && history.document.content[0].display?.displayNumberAuto).toBe(true)
  })

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

  it('creates a section at the level explicitly chosen by the insert menu', () => {
    const firstLevel = newTeachingBlock('heading', { headingLevel: 1 })
    const childLevel = newTeachingBlock('heading', { headingLevel: 2 })
    expect(firstLevel).toMatchObject({ type: 'heading', level: 1, content: [{ type: 'text', text: '新章节' }] })
    expect(childLevel).toMatchObject({ type: 'heading', level: 2, content: [{ type: 'text', text: '新章节' }] })
  })

  it('replaces one top-level block with imported Markdown conversion blocks as one history action', () => {
    const replacement: TeachingBlock[] = [
      { type: 'paragraph', id: 'math-source', content: [{ type: 'text', text: '斜率为' }] },
      { type: 'blockMath', id: 'math-1', latex: 'k=\\tan\\alpha' },
    ]
    const document = applyTeachingDocumentCommand(baseDocument, {
      type: 'replaceBlockWithBlocks',
      blockId: 'p1',
      blocks: replacement,
    })
    expect(document.content.map((block) => block.id)).toEqual(['math-source', 'math-1', 'p2'])

    const history = executeTeachingDocumentCommand(createTeachingDocumentHistory(baseDocument), {
      type: 'replaceBlockWithBlocks',
      blockId: 'p1',
      blocks: replacement,
    })
    expect(undoTeachingDocument(history).document.content.map((block) => block.id)).toEqual(['p1', 'p2'])
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

  it('deletes multiple card children atomically and merges a contiguous paragraph range', () => {
    const document: TeachingDocumentV1 = {
      ...baseDocument,
      content: [{
        type: 'box', id: 'box1', templateId: 'concept', breakBehavior: 'auto', children: [
          { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '第一段' }] },
          { type: 'paragraph', id: 'p2', content: [{ type: 'text', text: '第二段' }] },
          { type: 'blockMath', id: 'm1', latex: 'x=1' },
        ],
      }],
    }
    const deleted = applyTeachingDocumentCommand(document, {
      type: 'deleteBoxChildren', boxId: 'box1', childIds: ['p1', 'p2'],
    })
    expect(deleted.content[0]).toMatchObject({ type: 'box', children: [{ id: 'm1' }] })
    const history = executeTeachingDocumentCommand(createTeachingDocumentHistory(document), {
      type: 'deleteBoxChildren', boxId: 'box1', childIds: ['p1', 'p2'],
    })
    expect(undoTeachingDocument(history).document).toEqual(document)

    const replacement: BoxChildBlock = { type: 'rawMarkdown', id: 'merged', markdown: '第一段\n\n第二段', reason: 'user-inserted' }
    const merged = applyTeachingDocumentCommand(document, {
      type: 'replaceBoxChildRange', boxId: 'box1', childIds: ['p1', 'p2'], replacement,
    })
    expect(merged.content[0]).toMatchObject({ type: 'box', children: [{ id: 'merged' }, { id: 'm1' }] })
    expect(applyTeachingDocumentCommand(document, {
      type: 'replaceBoxChildRange', boxId: 'box1', childIds: ['p1', 'm1'], replacement,
    })).toBe(document)
  })

  it('allows Markdown content as a box child and replaces a formula child with converted content', () => {
    const document: TeachingDocumentV1 = {
      ...baseDocument,
      content: [{
        type: 'box', id: 'box1', templateId: 'concept', breakBehavior: 'auto', children: [
          { type: 'blockMath', id: 'formula1', latex: 'x' },
        ],
      }],
    }
    const markdownChild: BoxChildBlock = { type: 'rawMarkdown', id: 'formula1', markdown: '**斜率** $k=\\tan\\alpha$', reason: 'user-inserted' }
    const updated = applyTeachingDocumentCommand(document, {
      type: 'replaceBoxChildWithBlocks',
      boxId: 'box1',
      childId: 'formula1',
      blocks: [markdownChild],
    })
    expect(updated.content[0]).toMatchObject({ type: 'box', children: [markdownChild] })
  })

  it('writes a picked question id into a box child instead of the top-level box', () => {
    const document: TeachingDocumentV1 = {
      ...baseDocument,
      content: [{
        type: 'box',
        id: 'box1',
        templateId: 'concept',
        breakBehavior: 'auto',
        children: [{ type: 'question', id: 'child-question', questionId: '', breakBehavior: 'auto' }],
      }],
    }

    const updated = applyTeachingDocumentCommand(document, {
      type: 'updateBoxChild',
      boxId: 'box1',
      childId: 'child-question',
      patch: { questionId: 'bank-question-1' },
    })

    expect(updated.content[0]).toMatchObject({
      type: 'box',
      children: [{ id: 'child-question', questionId: 'bank-question-1' }],
    })
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
