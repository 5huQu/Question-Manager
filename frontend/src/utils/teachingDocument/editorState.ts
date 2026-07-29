import type {
  BoxBlock,
  BoxChildBlock,
  TeachingBlock,
  TeachingDocumentStyle,
  TeachingDocumentV1,
} from '@/types/teachingDocument'

export type TeachingDocumentCommand =
  | { type: 'replaceDocument'; document: TeachingDocumentV1 }
  | { type: 'setTitle'; title: string; mergeKey?: string }
  | { type: 'setStyle'; patch: Partial<TeachingDocumentStyle>; mergeKey?: string }
  | { type: 'insertBlock'; block: TeachingBlock; afterBlockId?: string }
  | { type: 'updateBlock'; blockId: string; patch: Partial<TeachingBlock>; mergeKey?: string }
  | { type: 'deleteBlock'; blockId: string }
  | { type: 'duplicateBlock'; blockId: string }
  | { type: 'moveBlock'; blockId: string; direction: -1 | 1 }
  | { type: 'reorderBlocks'; order: string[]; mergeKey?: string }
  | { type: 'insertBoxChild'; boxId: string; child: BoxChildBlock; afterChildId?: string }
  | { type: 'updateBoxChild'; boxId: string; childId: string; patch: Partial<BoxChildBlock>; mergeKey?: string }
  | { type: 'deleteBoxChild'; boxId: string; childId: string }
  | { type: 'moveBoxChild'; boxId: string; childId: string; direction: -1 | 1 }

export type TeachingDocumentHistory = {
  document: TeachingDocumentV1
  past: Array<{ document: TeachingDocumentV1; mergeKey?: string }>
  future: TeachingDocumentV1[]
  lastMergeKey?: string
}

/** 按文档中的题目出现顺序更新自动编号；用户自定义编号保持不变。 */
export function renumberAutomaticQuestionNumbers(document: TeachingDocumentV1): TeachingDocumentV1 {
  let nextNumber = 0
  let changed = false
  const visit = (block: TeachingBlock): TeachingBlock => {
    if (block.type === 'question') {
      if (!block.questionId.trim()) return block
      nextNumber += 1
      const display = block.display || {}
      if (display.displayNumberAuto || !display.displayNumber?.trim()) {
        if (display.displayNumber !== String(nextNumber) || display.displayNumberAuto !== true) changed = true
        return { ...block, display: { ...display, displayNumber: String(nextNumber), displayNumberAuto: true } }
      }
      return block
    }
    if (block.type === 'box') {
      const children = block.children.map((child) => visit(child as TeachingBlock) as BoxChildBlock)
      if (children.some((child, index) => child !== block.children[index])) changed = true
      return changed ? { ...block, children } : block
    }
    return block
  }
  const content = document.content.map(visit)
  if (!changed) return document
  return { ...document, content }
}

function createEditorId(prefix = 'block') {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}_${uuid}`
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function newTeachingBlock(type: TeachingBlock['type']): TeachingBlock {
  const id = createEditorId(type)
  switch (type) {
    case 'heading': return { type, id, level: 3, content: [{ type: 'text', text: '新标题' }] }
    case 'paragraph': return { type, id, content: [{ type: 'text', text: '' }] }
    case 'blockMath': return { type, id, latex: '' }
    case 'figure': return { type, id, asset: { type: 'documentAsset', assetId: '' }, alignment: 'center', layoutPreset: 'block-center', widthRatio: 0.8, widthMm: 80, lockAspectRatio: true }
    case 'question': return { type, id, questionId: '', breakBehavior: 'auto', display: { showAnswer: false, showAnalysis: false } }
    case 'box': return { type, id, templateId: 'concept', title: '知识点', breakBehavior: 'auto', children: [] }
    case 'divider': return { type, id }
    case 'spacer': return { type, id, heightEm: 2, heightMm: 10 }
    case 'pageBreak': return { type, id }
    case 'rawMarkdown': return { type, id, markdown: '', reason: 'user-inserted' }
    case 'unknown': return { type, id, originalType: 'unknown', rawData: null }
  }
}

function cloneBlock(block: TeachingBlock): TeachingBlock {
  const cloned = { ...block, id: createEditorId(block.type) } as TeachingBlock
  if (cloned.type === 'box' && block.type === 'box') {
    cloned.children = block.children.map((child) => cloneBlock(child as TeachingBlock) as BoxChildBlock)
  }
  return cloned
}

function replaceAt<T>(items: T[], index: number, value: T) {
  return items.map((item, itemIndex) => itemIndex === index ? value : item)
}

function moveAt<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function applyTeachingDocumentCommandRaw(document: TeachingDocumentV1, command: TeachingDocumentCommand): TeachingDocumentV1 {
  if (command.type === 'replaceDocument') return command.document
  if (command.type === 'setTitle') return { ...document, title: command.title }
  if (command.type === 'setStyle') return { ...document, style: { ...document.style, ...command.patch } }
  const content = document.content
  if (command.type === 'insertBlock') {
    const index = command.afterBlockId ? content.findIndex((block) => block.id === command.afterBlockId) + 1 : content.length
    const safeIndex = Math.max(0, Math.min(content.length, index))
    return { ...document, content: [...content.slice(0, safeIndex), command.block, ...content.slice(safeIndex)] }
  }
  if (command.type === 'reorderBlocks') {
    if (command.order.length !== content.length) return document
    const blockMap = new Map(content.map((block) => [block.id, block]))
    const next = command.order.map((id) => blockMap.get(id))
    if (next.some((block) => !block)) return document
    return { ...document, content: next as TeachingBlock[] }
  }
  const targetId = 'blockId' in command ? command.blockId : command.boxId
  const blockIndex = content.findIndex((block) => block.id === targetId)
  if (blockIndex < 0) return document
  const block = content[blockIndex]
  if (command.type === 'updateBlock') {
    if (block.type === 'unknown') return document
    return { ...document, content: replaceAt(content, blockIndex, { ...block, ...command.patch, id: block.id, type: block.type } as TeachingBlock) }
  }
  if (command.type === 'deleteBlock') return { ...document, content: content.filter((item) => item.id !== command.blockId) }
  if (command.type === 'duplicateBlock') {
    const copy = cloneBlock(block)
    return { ...document, content: [...content.slice(0, blockIndex + 1), copy, ...content.slice(blockIndex + 1)] }
  }
  if (command.type === 'moveBlock') return { ...document, content: moveAt(content, blockIndex, command.direction) }
  if (block.type !== 'box') return document
  const box = block as BoxBlock
  if (command.type === 'insertBoxChild') {
    if (['box', 'heading', 'pageBreak', 'rawMarkdown'].includes(command.child.type)) return document
    const childIndex = command.afterChildId ? box.children.findIndex((child) => child.id === command.afterChildId) + 1 : box.children.length
    const safeIndex = Math.max(0, Math.min(box.children.length, childIndex))
    const nextBox = { ...box, children: [...box.children.slice(0, safeIndex), command.child, ...box.children.slice(safeIndex)] }
    return { ...document, content: replaceAt(content, blockIndex, nextBox) }
  }
  const childIndex = box.children.findIndex((child) => child.id === command.childId)
  if (childIndex < 0) return document
  const child = box.children[childIndex]
  if (command.type === 'updateBoxChild') {
    if (child.type === 'unknown') return document
    const nextChild = { ...child, ...command.patch, id: child.id, type: child.type } as BoxChildBlock
    return { ...document, content: replaceAt(content, blockIndex, { ...box, children: replaceAt(box.children, childIndex, nextChild) }) }
  }
  if (command.type === 'deleteBoxChild') {
    return { ...document, content: replaceAt(content, blockIndex, { ...box, children: box.children.filter((item) => item.id !== command.childId) }) }
  }
  return { ...document, content: replaceAt(content, blockIndex, { ...box, children: moveAt(box.children, childIndex, command.direction) }) }
}

export function applyTeachingDocumentCommand(document: TeachingDocumentV1, command: TeachingDocumentCommand): TeachingDocumentV1 {
  return renumberAutomaticQuestionNumbers(applyTeachingDocumentCommandRaw(document, command))
}

export function createTeachingDocumentHistory(document: TeachingDocumentV1): TeachingDocumentHistory {
  return { document: renumberAutomaticQuestionNumbers(document), past: [], future: [] }
}

export function executeTeachingDocumentCommand(state: TeachingDocumentHistory, command: TeachingDocumentCommand): TeachingDocumentHistory {
  if (command.type === 'replaceDocument') return createTeachingDocumentHistory(command.document)
  const next = applyTeachingDocumentCommand(state.document, command)
  if (next === state.document) return state
  const mergeKey = 'mergeKey' in command ? command.mergeKey : undefined
  const shouldMerge = Boolean(mergeKey && state.lastMergeKey === mergeKey && state.past.length)
  return {
    document: next,
    past: shouldMerge ? state.past : [...state.past, { document: state.document, mergeKey }],
    future: [],
    lastMergeKey: mergeKey,
  }
}

export function undoTeachingDocument(state: TeachingDocumentHistory): TeachingDocumentHistory {
  const previous = state.past.at(-1)
  if (!previous) return state
  return { document: previous.document, past: state.past.slice(0, -1), future: [state.document, ...state.future] }
}

export function redoTeachingDocument(state: TeachingDocumentHistory): TeachingDocumentHistory {
  const next = state.future[0]
  if (!next) return state
  return { document: next, past: [...state.past, { document: state.document }], future: state.future.slice(1) }
}
