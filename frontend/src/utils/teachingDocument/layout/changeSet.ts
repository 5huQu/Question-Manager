import type { TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import { teachingBlockContentSignature } from './signatures'

export interface TeachingDocumentLayoutChangeSet {
  dirtyBlockIds: string[]
  firstDirtyTopLevelIndex: number
  structureChanged: boolean
  paperOrGlobalStyleChanged: boolean
  resourceIdsChanged: string[]
}

function structureToken(block: TeachingBlock) {
  if (block.type !== 'box') return `${block.type}:${block.id}`
  return `box:${block.id}:${block.children.map((child) => `${child.type}:${child.id}`).join(',')}`
}

export function createTeachingDocumentLayoutChangeSet(input: {
  previous: TeachingDocumentV1 | null
  current: TeachingDocumentV1
  previousLayoutStyleSignature?: string
  currentLayoutStyleSignature: string
  previousResourceRevision?: string
  currentResourceRevision: string
}): TeachingDocumentLayoutChangeSet {
  const {
    previous,
    current,
    previousLayoutStyleSignature,
    currentLayoutStyleSignature,
    previousResourceRevision,
    currentResourceRevision,
  } = input
  if (!previous) {
    return {
      dirtyBlockIds: current.content.map((block) => block.id),
      firstDirtyTopLevelIndex: 0,
      structureChanged: true,
      paperOrGlobalStyleChanged: true,
      resourceIdsChanged: previousResourceRevision === currentResourceRevision ? [] : ['*'],
    }
  }

  const previousStructure = previous.content.map(structureToken)
  const currentStructure = current.content.map(structureToken)
  const structureChanged = previousStructure.length !== currentStructure.length
    || previousStructure.some((token, index) => token !== currentStructure[index])
  const paperOrGlobalStyleChanged = previousLayoutStyleSignature !== currentLayoutStyleSignature
    || previous.title !== current.title
  const resourceChanged = previousResourceRevision !== currentResourceRevision
  const previousById = new Map(previous.content.map((block, index) => [block.id, { block, index }]))
  const currentById = new Map(current.content.map((block, index) => [block.id, { block, index }]))
  const dirtyIds = new Set<string>()
  let firstDirty = current.content.length

  current.content.forEach((block, index) => {
    const before = previousById.get(block.id)
    if (!before || teachingBlockContentSignature(before.block) !== teachingBlockContentSignature(block)) {
      dirtyIds.add(block.id)
      firstDirty = Math.min(firstDirty, index)
    }
  })
  previous.content.forEach((block, index) => {
    if (currentById.has(block.id)) return
    dirtyIds.add(block.id)
    firstDirty = Math.min(firstDirty, Math.min(index, current.content.length))
  })

  if (structureChanged) {
    const firstStructureDifference = Array.from(
      { length: Math.max(previousStructure.length, currentStructure.length) },
      (_, index) => index,
    ).find((index) => previousStructure[index] !== currentStructure[index])
    firstDirty = Math.min(firstDirty, firstStructureDifference ?? 0)
  }
  if (paperOrGlobalStyleChanged || resourceChanged) firstDirty = 0

  return {
    dirtyBlockIds: [...dirtyIds],
    firstDirtyTopLevelIndex: Math.max(0, Math.min(firstDirty, current.content.length)),
    structureChanged,
    paperOrGlobalStyleChanged,
    resourceIdsChanged: resourceChanged ? ['*'] : [],
  }
}
