import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import type { TeachingBlock } from '@/types/teachingDocument'
import type { TeachingDocumentLayoutChangeSet } from '@/utils/teachingDocument/layout/changeSet'
import { blockToEditorNode } from './serialization'

export const DOCUMENT_LAYOUT_CHANGE_SET_META = 'teaching-document-layout-change-set'

interface TopLevelStructureEntry {
  id: string
  type: string
  node: ProseMirrorNode
}

function topLevelStructure(document: ProseMirrorNode): TopLevelStructureEntry[] {
  const result: TopLevelStructureEntry[] = []
  document.forEach((node) => {
    result.push({ id: String(node.attrs.blockId || ''), type: node.type.name, node })
  })
  return result
}

function nodesEqual(left: ProseMirrorNode | undefined, right: ProseMirrorNode | undefined) {
  return Boolean(left && right && left.eq(right))
}

export function structuralTransactionChangeSet(
  previous: ProseMirrorNode,
  current: ProseMirrorNode,
): TeachingDocumentLayoutChangeSet | null {
  const before = topLevelStructure(previous)
  const after = topLevelStructure(current)
  const firstDirtyTopLevelIndex = Array.from(
    { length: Math.max(before.length, after.length) },
    (_, index) => index,
  ).find((index) => (
    !nodesEqual(before[index]?.node, after[index]?.node)
  ))
  if (firstDirtyTopLevelIndex === undefined) return null

  const structureChanged = before.length !== after.length || before.some((entry, index) => (
    entry.id !== after[index]?.id || entry.type !== after[index]?.type
  ))

  const beforeById = new Map(before.map((entry) => [entry.id, entry]))
  const afterById = new Map(after.map((entry) => [entry.id, entry]))
  const dirtyBlockIds = new Set<string>()
  before.forEach((entry) => {
    const currentEntry = afterById.get(entry.id)
    if ((!currentEntry || currentEntry.type !== entry.type || !nodesEqual(entry.node, currentEntry.node)) && entry.id) {
      dirtyBlockIds.add(entry.id)
    }
  })
  after.forEach((entry) => {
    const previousEntry = beforeById.get(entry.id)
    if ((!previousEntry || previousEntry.type !== entry.type || !nodesEqual(entry.node, previousEntry.node)) && entry.id) {
      dirtyBlockIds.add(entry.id)
    }
  })

  return {
    dirtyBlockIds: [...dirtyBlockIds],
    firstDirtyTopLevelIndex,
    structureChanged,
    paperOrGlobalStyleChanged: false,
    resourceIdsChanged: [],
  }
}

export function mergeStructuralChangeSets(
  current: TeachingDocumentLayoutChangeSet | null,
  next: TeachingDocumentLayoutChangeSet,
): TeachingDocumentLayoutChangeSet {
  if (!current) return next
  return {
    dirtyBlockIds: [...new Set([...current.dirtyBlockIds, ...next.dirtyBlockIds])],
    firstDirtyTopLevelIndex: Math.min(current.firstDirtyTopLevelIndex, next.firstDirtyTopLevelIndex),
    structureChanged: current.structureChanged || next.structureChanged,
    paperOrGlobalStyleChanged: current.paperOrGlobalStyleChanged || next.paperOrGlobalStyleChanged,
    resourceIdsChanged: [...new Set([...current.resourceIdsChanged, ...next.resourceIdsChanged])],
  }
}

function positionAfterBlock(editor: Editor, afterBlockId: string) {
  let position = editor.state.doc.content.size
  let found = !afterBlockId
  editor.state.doc.forEach((node, offset) => {
    if (String(node.attrs.blockId || '') !== afterBlockId) return
    position = offset + node.nodeSize
    found = true
  })
  return found ? position : null
}

export function insertTopLevelTeachingBlock(editor: Editor, block: TeachingBlock, afterBlockId: string) {
  const position = positionAfterBlock(editor, afterBlockId)
  if (position === null) return false
  const node = editor.schema.nodeFromJSON(blockToEditorNode(block))
  const transaction = editor.state.tr.insert(position, node)
  const changeSet = structuralTransactionChangeSet(editor.state.doc, transaction.doc)
  if (changeSet) transaction.setMeta(DOCUMENT_LAYOUT_CHANGE_SET_META, changeSet)
  transaction.setSelection(node.isAtom
    ? NodeSelection.create(transaction.doc, position)
    : TextSelection.near(transaction.doc.resolve(Math.min(transaction.doc.content.size, position + 1))))
  editor.view.dispatch(transaction)
  editor.view.focus()
  return true
}

export function deleteTopLevelTeachingBlock(editor: Editor, blockId: string) {
  if (editor.state.doc.childCount <= 1) return false
  let from = -1
  let to = -1
  editor.state.doc.forEach((node, offset) => {
    if (String(node.attrs.blockId || '') !== blockId) return
    from = offset
    to = offset + node.nodeSize
  })
  if (from < 0 || to < 0) return false
  const transaction = editor.state.tr.delete(from, to)
  const changeSet = structuralTransactionChangeSet(editor.state.doc, transaction.doc)
  if (changeSet) transaction.setMeta(DOCUMENT_LAYOUT_CHANGE_SET_META, changeSet)
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(from, transaction.doc.content.size))))
  editor.view.dispatch(transaction)
  editor.view.focus()
  return true
}

/** Attach a dirty range to every top-level structure-changing transaction. */
export const DocumentStructuralChangeSet = Extension.create({
  name: 'documentStructuralChangeSet',
  priority: 1100,
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction(transaction, state) {
        if (!transaction.docChanged || transaction.getMeta(DOCUMENT_LAYOUT_CHANGE_SET_META)) return true
        const changeSet = structuralTransactionChangeSet(state.doc, transaction.doc)
        if (changeSet) transaction.setMeta(DOCUMENT_LAYOUT_CHANGE_SET_META, changeSet)
        return true
      },
    })]
  },
})
