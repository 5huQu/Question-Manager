import type {
  BoxBlock,
  BoxChildBlock,
  TeachingBlock,
  TeachingDocumentStyle,
  TeachingDocumentOutlineOptions,
  TeachingDocumentV1,
} from '@/types/teachingDocument'
import { buildDocumentOutline } from './outline'

export type TeachingDocumentCommand =
  | { type: 'replaceDocument'; document: TeachingDocumentV1 }
  | { type: 'setTitle'; title: string; mergeKey?: string }
  | { type: 'setStyle'; patch: Partial<TeachingDocumentStyle>; mergeKey?: string }
  | { type: 'setOutline'; patch: Partial<TeachingDocumentOutlineOptions>; mergeKey?: string }
  | { type: 'insertBlock'; block: TeachingBlock; afterBlockId?: string }
  /**
   * 在一个顶层对象之后维护唯一的显式换页标记。
   * 换页是两个对象之间的结构，而不是对象自身的“题前换页”等隐式属性。
   */
  | { type: 'setPageBreakAfter'; blockId: string; enabled: boolean }
  /** 用多个顶层块替换一个块；用于将 Markdown + LaTeX 源码一次性结构化导入。 */
  | { type: 'replaceBlockWithBlocks'; blockId: string; blocks: TeachingBlock[] }
  /** 用多个合法盒子子块替换一个盒子子块。 */
  | { type: 'replaceBoxChildWithBlocks'; boxId: string; childId: string; blocks: BoxChildBlock[] }
  | { type: 'updateBlock'; blockId: string; patch: Partial<TeachingBlock>; mergeKey?: string }
  | { type: 'deleteBlock'; blockId: string }
  | { type: 'deleteBlocks'; blockIds: string[] }
  | { type: 'duplicateBlock'; blockId: string }
  | { type: 'moveBlock'; blockId: string; direction: -1 | 1 }
  | { type: 'moveSection'; headingId: string; targetHeadingId: string; position: 'before' | 'after'; mergeKey?: string }
  | { type: 'moveSectionByStep'; headingId: string; direction: -1 | 1; mergeKey?: string }
  | { type: 'indentSection'; headingId: string; mergeKey?: string }
  | { type: 'outdentSection'; headingId: string; mergeKey?: string }
  | { type: 'reorderBlocks'; order: string[]; mergeKey?: string }
  | { type: 'insertBoxChild'; boxId: string; child: BoxChildBlock; afterChildId?: string }
  | { type: 'updateBoxChild'; boxId: string; childId: string; patch: Partial<BoxChildBlock>; mergeKey?: string }
  | { type: 'deleteBoxChild'; boxId: string; childId: string }
  /** 一次删除同一知识卡片中的多个子块，保留为单个撤销步骤。 */
  | { type: 'deleteBoxChildren'; boxId: string; childIds: string[] }
  /** 用一个合法子块替换同一卡片内连续的一段子块。 */
  | { type: 'replaceBoxChildRange'; boxId: string; childIds: string[]; replacement: BoxChildBlock }
  | { type: 'moveBoxChild'; boxId: string; childId: string; direction: -1 | 1 }

export type TeachingDocumentHistory = {
  document: TeachingDocumentV1
  past: Array<{ document: TeachingDocumentV1; mergeKey?: string }>
  future: TeachingDocumentV1[]
  lastMergeKey?: string
}

/**
 * 自动编号只依赖"题目的出现顺序 + 是否自动编号"：
 * 返回该序列的廉价签名，用于在普通文本回显时短路重编号（避免每次键入都全量克隆题目块）。
 */
export function questionSequenceSignature(document: TeachingDocumentV1): string {
  let signature = ''
  const visit = (block: TeachingBlock) => {
    if (block.type === 'question') {
      const display = block.display || {}
      signature += block.questionId.trim() ? (display.displayNumberAuto ? 'a' : 'c') : 'x'
      return
    }
    if (block.type === 'box') {
      for (const child of block.children) visit(child as TeachingBlock)
    }
  }
  for (const block of document.content) visit(block)
  return signature
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

/**
 * 创建新的顶层内容块。
 *
 * `headingLevel` 只由“插入章节”入口传入；保留旧的三级默认值，避免未迁移的
 * 程序化调用意外改变已有工作流。
 */
export function newTeachingBlock(type: TeachingBlock['type'], options?: { headingLevel?: 1 | 2 | 3 | 4 }): TeachingBlock {
  const id = createEditorId(type)
  switch (type) {
    case 'heading': return { type, id, level: options?.headingLevel ?? 3, content: [{ type: 'text', text: '新章节' }] }
    case 'paragraph': return { type, id, content: [{ type: 'text', text: '' }] }
    case 'blockMath': return { type, id, latex: '' }
    case 'table': return {
      type,
      id,
      hasHeader: true,
      rows: Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => ({ content: [{ type: 'text', text: '' }] }))),
    }
    case 'figure': return { type, id, asset: { type: 'documentAsset', assetId: '' }, alignment: 'center', layoutPreset: 'block-center', widthRatio: 0.8, widthMm: 80, lockAspectRatio: true }
    case 'tikz': return { type, id, source: '\\draw[->] (0,0) -- (4,0);\n\\draw[->] (0,0) -- (0,3);', alignment: 'center', layoutPreset: 'block-center', widthMm: 80, alt: 'TikZ 绘图', caption: '' }
    case 'question': return { type, id, questionId: '', breakBehavior: 'auto', display: { showAnswer: false, showAnalysis: false } }
    case 'box': return { type, id, templateId: 'concept', title: '知识点', breakBehavior: 'auto', children: [] }
    case 'divider': return { type, id }
    case 'spacer': return { type, id, heightEm: 2, heightMm: 10 }
    case 'pageBreak': return { type, id }
    case 'rawMarkdown': return { type, id, markdown: '', reason: 'user-inserted' }
    case 'unknown': return { type, id, originalType: 'unknown', rawData: null }
  }
}

/** 在 Markdown 光标处生成“前文 + 图片 + 后文”，供顶层与盒子内共用。 */
export function blocksForRawMarkdownFigureInsertion(
  markdown: string,
  cursor: number,
  assetId: string,
) {
  const safeCursor = Math.max(0, Math.min(markdown.length, Math.trunc(cursor)))
  const before = markdown.slice(0, safeCursor).trim()
  const after = markdown.slice(safeCursor).trim()
  const figure = {
    ...newTeachingBlock('figure'),
    asset: { type: 'documentAsset' as const, assetId },
  } as Extract<TeachingBlock, { type: 'figure' }>
  const blocks: TeachingBlock[] = []
  if (before) blocks.push({ ...newTeachingBlock('rawMarkdown'), markdown: before } as Extract<TeachingBlock, { type: 'rawMarkdown' }>)
  blocks.push(figure)
  if (after) blocks.push({ ...newTeachingBlock('rawMarkdown'), markdown: after } as Extract<TeachingBlock, { type: 'rawMarkdown' }>)
  return { blocks, figure }
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

function replaceSectionRange(document: TeachingDocumentV1, headingId: string, targetHeadingId: string, position: 'before' | 'after') {
  const outline = buildDocumentOutline(document)
  const source = outline.entryByBlockId.get(headingId)
  const target = outline.entryByBlockId.get(targetHeadingId)
  if (!source || !target || source.blockId === target.blockId) return document
  if (target.sourceIndex >= source.sourceIndex && target.sourceIndex < source.endIndex) return document
  const moving = document.content.slice(source.sourceIndex, source.endIndex)
  const remaining = document.content.filter((_, index) => index < source.sourceIndex || index >= source.endIndex)
  const targetIndex = remaining.findIndex((block) => block.id === target.blockId)
  if (targetIndex < 0) return document
  const insertionIndex = targetIndex + (position === 'after'
    ? (() => {
        const targetInRemaining = remaining[targetIndex]
        const nextHeadingIndex = remaining.findIndex((block, index) => index > targetIndex && block.type === 'heading' && block.level <= (targetInRemaining.type === 'heading' ? targetInRemaining.level : 4))
        return nextHeadingIndex < 0 ? remaining.length - targetIndex : nextHeadingIndex - targetIndex
      })()
    : 0)
  return { ...document, content: [...remaining.slice(0, insertionIndex), ...moving, ...remaining.slice(insertionIndex)] }
}

function shiftSectionLevels(document: TeachingDocumentV1, headingId: string, delta: -1 | 1) {
  const outline = buildDocumentOutline(document)
  const entry = outline.entryByBlockId.get(headingId)
  if (!entry) return document
  const headings = document.content.slice(entry.sourceIndex, entry.endIndex).filter((block): block is Extract<TeachingBlock, { type: 'heading' }> => block.type === 'heading')
  if (headings.some((heading) => heading.level + delta < 1 || heading.level + delta > 4)) return document
  return {
    ...document,
    content: document.content.map((block, index) => index >= entry.sourceIndex && index < entry.endIndex && block.type === 'heading'
      ? { ...block, level: (block.level + delta) as 1 | 2 | 3 | 4 }
      : block),
  }
}

function siblingForStep(document: TeachingDocumentV1, headingId: string, direction: -1 | 1) {
  const outline = buildDocumentOutline(document)
  const entry = outline.entryByBlockId.get(headingId)
  if (!entry) return undefined
  const siblings = outline.entries.filter((candidate) => candidate.parentBlockId === entry.parentBlockId)
  const index = siblings.findIndex((candidate) => candidate.blockId === headingId)
  return siblings[index + direction]
}

function applyTeachingDocumentCommandRaw(document: TeachingDocumentV1, command: TeachingDocumentCommand): TeachingDocumentV1 {
  if (command.type === 'replaceDocument') return command.document
  if (command.type === 'setTitle') return { ...document, title: command.title }
  if (command.type === 'setStyle') return { ...document, style: { ...document.style, ...command.patch } }
  if (command.type === 'setOutline') return { ...document, outline: { ...document.outline, ...command.patch } }
  const content = document.content
  if (command.type === 'insertBlock') {
    const index = command.afterBlockId ? content.findIndex((block) => block.id === command.afterBlockId) + 1 : content.length
    const safeIndex = Math.max(0, Math.min(content.length, index))
    return { ...document, content: [...content.slice(0, safeIndex), command.block, ...content.slice(safeIndex)] }
  }
  if (command.type === 'setPageBreakAfter') {
    const blockIndex = content.findIndex((block) => block.id === command.blockId)
    // 换页符本身没有“其后换页”的意义，也不能嵌套进卡片子内容。
    if (blockIndex < 0 || content[blockIndex]?.type === 'pageBreak') return document
    const next = content[blockIndex + 1]
    if (command.enabled) {
      if (next?.type === 'pageBreak') return document
      const pageBreak = newTeachingBlock('pageBreak')
      return { ...document, content: [...content.slice(0, blockIndex + 1), pageBreak, ...content.slice(blockIndex + 1)] }
    }
    if (next?.type !== 'pageBreak') return document
    return { ...document, content: [...content.slice(0, blockIndex + 1), ...content.slice(blockIndex + 2)] }
  }
  if (command.type === 'reorderBlocks') {
    if (command.order.length !== content.length) return document
    const blockMap = new Map(content.map((block) => [block.id, block]))
    const next = command.order.map((id) => blockMap.get(id))
    if (next.some((block) => !block)) return document
    return { ...document, content: next as TeachingBlock[] }
  }
  if (command.type === 'moveSection') return replaceSectionRange(document, command.headingId, command.targetHeadingId, command.position)
  if (command.type === 'moveSectionByStep') {
    const sibling = siblingForStep(document, command.headingId, command.direction)
    if (!sibling) return document
    return replaceSectionRange(document, command.headingId, sibling.blockId, command.direction === -1 ? 'before' : 'after')
  }
  if (command.type === 'indentSection') {
    const outline = buildDocumentOutline(document)
    const entry = outline.entryByBlockId.get(command.headingId)
    if (!entry || entry.level >= 4) return document
    const previous = outline.entries.filter((candidate) => candidate.sourceIndex < entry.sourceIndex && candidate.level === entry.level).at(-1)
    return previous ? shiftSectionLevels(document, command.headingId, 1) : document
  }
  if (command.type === 'outdentSection') {
    const outline = buildDocumentOutline(document)
    const entry = outline.entryByBlockId.get(command.headingId)
    return entry?.parentBlockId ? shiftSectionLevels(document, command.headingId, -1) : document
  }
  if (command.type === 'replaceBlockWithBlocks') {
    const blockIndex = content.findIndex((block) => block.id === command.blockId)
    if (blockIndex < 0 || !command.blocks.length) return document
    const replacementIds = command.blocks.map((block) => block.id)
    if (new Set(replacementIds).size !== replacementIds.length) return document
    const remainingIds = new Set(content.filter((block) => block.id !== command.blockId).map((block) => block.id))
    if (replacementIds.some((id) => remainingIds.has(id))) return document
    return { ...document, content: [...content.slice(0, blockIndex), ...command.blocks, ...content.slice(blockIndex + 1)] }
  }
  if (command.type === 'deleteBlocks') {
    const ids = new Set(command.blockIds)
    return { ...document, content: content.filter((item) => !ids.has(item.id)) }
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
  if (command.type === 'replaceBoxChildWithBlocks') {
    const childIndex = box.children.findIndex((child) => child.id === command.childId)
    if (childIndex < 0 || !command.blocks.length) return document
    const replacementIds = command.blocks.map((child) => child.id)
    if (new Set(replacementIds).size !== replacementIds.length) return document
    const remainingIds = new Set(box.children.filter((child) => child.id !== command.childId).map((child) => child.id))
    if (replacementIds.some((id) => remainingIds.has(id))) return document
    return {
      ...document,
      content: replaceAt(content, blockIndex, {
        ...box,
        children: [...box.children.slice(0, childIndex), ...command.blocks, ...box.children.slice(childIndex + 1)],
      }),
    }
  }
  if (command.type === 'insertBoxChild') {
    if (['box', 'heading', 'pageBreak'].includes(command.child.type)) return document
    const childIndex = command.afterChildId ? box.children.findIndex((child) => child.id === command.afterChildId) + 1 : box.children.length
    const safeIndex = Math.max(0, Math.min(box.children.length, childIndex))
    const nextBox = { ...box, children: [...box.children.slice(0, safeIndex), command.child, ...box.children.slice(safeIndex)] }
    return { ...document, content: replaceAt(content, blockIndex, nextBox) }
  }
  if (command.type === 'deleteBoxChildren') {
    const ids = new Set(command.childIds)
    if (!ids.size || !box.children.some((child) => ids.has(child.id))) return document
    return { ...document, content: replaceAt(content, blockIndex, { ...box, children: box.children.filter((item) => !ids.has(item.id)) }) }
  }
  if (command.type === 'replaceBoxChildRange') {
    if (['box', 'heading', 'pageBreak'].includes(command.replacement.type)) return document
    const ids = new Set(command.childIds)
    if (!ids.size || ids.size !== command.childIds.length || ids.has(command.replacement.id)) return document
    const indexes = box.children.reduce<number[]>((result, child, index) => ids.has(child.id) ? [...result, index] : result, [])
    if (indexes.length !== ids.size) return document
    const first = indexes[0]
    const contiguous = indexes.every((index, offset) => index === first + offset)
    if (!contiguous || box.children.some((child) => child.id === command.replacement.id)) return document
    return {
      ...document,
      content: replaceAt(content, blockIndex, {
        ...box,
        children: [...box.children.slice(0, first), command.replacement, ...box.children.slice(first + indexes.length)],
      }),
    }
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
