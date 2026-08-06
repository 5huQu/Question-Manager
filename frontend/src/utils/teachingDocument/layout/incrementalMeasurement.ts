import type { TeachingBlock, TeachingDocumentV1 } from '@/types/teachingDocument'
import type { ChoiceLayoutOverrides } from '@/utils/choiceLayout'
import { blockSourcePathKey, type BlockSourcePath } from './fragment'
import {
  measureTeachingDocumentAll,
  type MeasurementAdapters,
  type TeachingDocumentMeasurementBundle,
} from './measureAll'
import { teachingDocumentMeasurementVersion } from './measure'
import type { BlockMeasurement, RenderDiagnostic } from './types'
import type { ParagraphMeasurement } from './paragraphMeasurement'
import type { BoxMeasurement } from './boxMeasurement'
import type { QuestionMeasurement, QuestionResolutionLike } from './questionMeasurement'
import type { RawMarkdownMeasurement } from './rawMarkdownMeasurement'
import { teachingBlockContentSignature } from './signatures'

interface CachedBlockMeasurement {
  blockId: string
  blockMeasurement?: BlockMeasurement
  paragraphs: ParagraphMeasurement[]
  box?: BoxMeasurement
  question?: QuestionMeasurement
  boxChildQuestions: Array<{ childIndex: number; measurement: QuestionMeasurement }>
  rawMarkdowns: RawMarkdownMeasurement[]
  diagnostics: RenderDiagnostic[]
}

export class TeachingDocumentIncrementalMeasurementCache {
  private entries = new Map<string, CachedBlockMeasurement>()

  constructor(private readonly maxEntries = 512) {}

  get(key: string) {
    const value = this.entries.get(key)
    if (!value) return null
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: CachedBlockMeasurement) {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (!oldest) break
      this.entries.delete(oldest)
    }
  }

  clear() {
    this.entries.clear()
  }
}

function topLevelIds(block: TeachingBlock) {
  return new Set([block.id, ...(block.type === 'box' ? block.children.map((child) => child.id) : [])])
}

function rebasePath(path: BlockSourcePath, sourceIndex: number): BlockSourcePath {
  return { ...path, sourceIndex }
}

function rebaseBlockMeasurement(measurement: BlockMeasurement, sourceIndex: number): BlockMeasurement {
  return {
    ...measurement,
    sourceIndex,
    childMeasurements: measurement.childMeasurements.map((child) => rebaseBlockMeasurement(child, sourceIndex)),
  }
}

function rebaseParagraph(measurement: ParagraphMeasurement, sourceIndex: number): ParagraphMeasurement {
  return { ...measurement, sourceIndex, sourcePath: rebasePath(measurement.sourcePath, sourceIndex) }
}

function rebaseQuestion(measurement: QuestionMeasurement, sourceIndex: number): QuestionMeasurement {
  return {
    ...measurement,
    sourceIndex,
    regions: measurement.regions.map((region) => ({
      ...region,
      paragraphMeasurement: region.paragraphMeasurement
        ? rebaseParagraph(region.paragraphMeasurement, sourceIndex)
        : undefined,
    })),
  }
}

function rebaseEntry(entry: CachedBlockMeasurement, block: TeachingBlock, sourceIndex: number) {
  const blockMeasurement = entry.blockMeasurement
    ? rebaseBlockMeasurement(entry.blockMeasurement, sourceIndex)
    : undefined
  const paragraphs = entry.paragraphs.map((measurement) => rebaseParagraph(measurement, sourceIndex))
  const box = entry.box ? {
    ...entry.box,
    sourceIndex,
    children: entry.box.children.map((child) => ({
      ...child,
      sourcePath: rebasePath(child.sourcePath, sourceIndex),
    })),
  } : undefined
  const question = entry.question ? rebaseQuestion(entry.question, sourceIndex) : undefined
  const boxChildQuestions = new Map<string, QuestionMeasurement>()
  entry.boxChildQuestions.forEach(({ childIndex, measurement }) => {
    if (block.type !== 'box') return
    const child = block.children[childIndex]
    if (!child) return
    boxChildQuestions.set(blockSourcePathKey({
      sourceIndex,
      topLevelBlockId: block.id,
      childPath: [{ childIndex, blockId: child.id }],
    }), rebaseQuestion(measurement, sourceIndex))
  })
  const rawMarkdowns = entry.rawMarkdowns.map((measurement) => ({
    ...measurement,
    sourcePath: rebasePath(measurement.sourcePath, sourceIndex),
  }))
  return { blockMeasurement, paragraphs, box, question, boxChildQuestions, rawMarkdowns }
}

function entryFromPartial(
  partial: TeachingDocumentMeasurementBundle,
  block: TeachingBlock,
  sourceIndex: number,
): CachedBlockMeasurement {
  const ids = topLevelIds(block)
  const boxChildQuestions: CachedBlockMeasurement['boxChildQuestions'] = []
  if (block.type === 'box') {
    block.children.forEach((child, childIndex) => {
      if (child.type !== 'question') return
      const measurement = partial.boxChildQuestions.get(blockSourcePathKey({
        sourceIndex,
        topLevelBlockId: block.id,
        childPath: [{ childIndex, blockId: child.id }],
      }))
      if (measurement) boxChildQuestions.push({ childIndex, measurement })
    })
  }
  return {
    blockId: block.id,
    blockMeasurement: partial.measurement.blocks.find((measurement) => measurement.sourceIndex === sourceIndex),
    paragraphs: partial.paragraphs.filter((measurement) => measurement.sourceIndex === sourceIndex),
    box: partial.boxes.find((measurement) => measurement.sourceIndex === sourceIndex),
    question: partial.questions.find((measurement) => measurement.sourceIndex === sourceIndex),
    boxChildQuestions,
    rawMarkdowns: partial.boxChildRawMarkdowns.filter((measurement) => measurement.sourcePath.sourceIndex === sourceIndex),
    diagnostics: partial.measurement.diagnostics.filter((diagnostic) => diagnostic.blockId && ids.has(diagnostic.blockId)),
  }
}

function choiceSignature(overrides: ChoiceLayoutOverrides | undefined) {
  return Object.entries(overrides ?? {}).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`).join(',')
}

export interface IncrementalMeasurementResult {
  bundle: TeachingDocumentMeasurementBundle
  cacheHitBlockCount: number
  measuredBlockCount: number
  measuredSourceIndexes: number[]
}

export function measureTeachingDocumentIncrementally(input: {
  root: HTMLElement
  document: TeachingDocumentV1
  cache: TeachingDocumentIncrementalMeasurementCache
  layoutStyleSignature: string
  variant: string
  resourceRevision: string
  adapters?: MeasurementAdapters
  resolveQuestion?: (questionId: string) => QuestionResolutionLike
  choiceLayoutOverrides?: ChoiceLayoutOverrides
  cacheable?: boolean
}): IncrementalMeasurementResult {
  const occurrences = new Map<string, number>()
  const keys = input.document.content.map((block) => {
    const occurrence = occurrences.get(block.id) ?? 0
    occurrences.set(block.id, occurrence + 1)
    return [
      block.id,
      occurrence,
      teachingBlockContentSignature(block),
      input.layoutStyleSignature,
      input.variant,
      input.resourceRevision,
      choiceSignature(input.choiceLayoutOverrides),
    ].join('|')
  })
  const cachedEntries = keys.map((key) => input.cache.get(key))
  const measuredSourceIndexes = input.document.content.flatMap((block, sourceIndex) => (
    cachedEntries[sourceIndex] || block.type === 'pageBreak' ? [] : [sourceIndex]
  ))
  const sourceIndexes = new Set(measuredSourceIndexes)
  const partial = measureTeachingDocumentAll(
    input.root,
    input.document,
    input.adapters,
    input.resolveQuestion,
    input.choiceLayoutOverrides,
    { sourceIndexes },
  )
  const entries = input.document.content.map((block, sourceIndex) => {
    const cached = cachedEntries[sourceIndex]
    if (cached) return cached
    const entry = entryFromPartial(partial, block, sourceIndex)
    if (input.cacheable !== false) input.cache.set(keys[sourceIndex], entry)
    return entry
  })

  const blocks: BlockMeasurement[] = []
  const paragraphs: ParagraphMeasurement[] = []
  const boxes: BoxMeasurement[] = []
  const questions: QuestionMeasurement[] = []
  const boxChildQuestions = new Map<string, QuestionMeasurement>()
  const boxChildRawMarkdowns: RawMarkdownMeasurement[] = []
  const diagnostics: RenderDiagnostic[] = partial.measurement.diagnostics.filter((diagnostic) => !diagnostic.blockId)
  entries.forEach((entry, sourceIndex) => {
    const block = input.document.content[sourceIndex]
    const rebased = rebaseEntry(entry, block, sourceIndex)
    if (rebased.blockMeasurement) blocks.push(rebased.blockMeasurement)
    paragraphs.push(...rebased.paragraphs)
    if (rebased.box) boxes.push(rebased.box)
    if (rebased.question) questions.push(rebased.question)
    rebased.boxChildQuestions.forEach((measurement, key) => boxChildQuestions.set(key, measurement))
    boxChildRawMarkdowns.push(...rebased.rawMarkdowns)
    diagnostics.push(...entry.diagnostics)
  })
  return {
    bundle: {
      measurement: {
        blocks,
        headerHeight: partial.measurement.headerHeight,
        diagnostics,
        measurementVersion: teachingDocumentMeasurementVersion(blocks, partial.measurement.headerHeight),
      },
      paragraphs,
      boxes,
      questions,
      boxChildQuestions,
      boxChildRawMarkdowns,
    },
    cacheHitBlockCount: cachedEntries.filter(Boolean).length,
    measuredBlockCount: measuredSourceIndexes.length,
    measuredSourceIndexes,
  }
}
