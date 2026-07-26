import type { BoxBreakBehavior, TeachingBlock } from '@/types/teachingDocument'
import type { SplitPolicy } from './types'

export const TEACHING_DOM = {
  document: 'data-teaching-document',
  documentHeader: 'data-teaching-document-header',
  block: 'data-teaching-block',
  blockId: 'data-teaching-block-id',
  blockType: 'data-teaching-block-type',
  sourceIndex: 'data-teaching-source-index',
  parentBlockId: 'data-teaching-parent-block-id',
  childIndex: 'data-teaching-child-index',
  splitPolicy: 'data-teaching-split-policy',
  breakBehavior: 'data-teaching-break-behavior',
  boxRoot: 'data-teaching-box-root',
  boxHeader: 'data-teaching-box-header',
  boxBody: 'data-teaching-box-body',
  boxTemplate: 'data-teaching-box-template',
  resource: 'data-teaching-resource',
  resourceId: 'data-teaching-resource-id',
  resourceStatus: 'data-teaching-resource-status',
  inline: 'data-teaching-inline',
  inlineIndex: 'data-teaching-inline-index',
  inlineType: 'data-teaching-inline-type',
  inlineAtomic: 'data-teaching-inline-atomic',
  inlineContent: 'data-teaching-inline-content',
  inlineTextStart: 'data-teaching-inline-text-start',
  fragment: 'data-teaching-fragment',
  fragmentType: 'data-teaching-fragment-type',
  fragmentIndex: 'data-teaching-fragment-index',
  fragmentContinuation: 'data-teaching-fragment-continuation',
  sourceBlockId: 'data-teaching-source-block-id',
} as const

export const TEACHING_DOM_SELECTORS = {
  document: `[${TEACHING_DOM.document}]`,
  documentHeader: `[${TEACHING_DOM.documentHeader}]`,
  block: `[${TEACHING_DOM.block}]`,
  imageResource: `[${TEACHING_DOM.resource}="image"]`,
  questionResource: `[${TEACHING_DOM.resource}="question"]`,
  figureResolverResource: `[${TEACHING_DOM.resource}="figure-resolver"]`,
  mathResource: `[${TEACHING_DOM.resource}="math"]`,
  inline: `[${TEACHING_DOM.inline}]`,
  fragment: `[${TEACHING_DOM.fragment}]`,
} as const

export function splitPolicyForBlock(block: TeachingBlock): SplitPolicy {
  switch (block.type) {
    case 'paragraph':
      return 'paragraph'
    case 'box':
      return block.breakBehavior === 'avoid' ? 'never' : 'children'
    case 'pageBreak':
      return 'forced-break'
    case 'rawMarkdown':
      return 'paragraph'
    case 'unknown':
      return 'unknown'
    default:
      return 'never'
  }
}

export function blockDomAttributes(
  block: TeachingBlock,
  parentBlockId?: string,
  sourceIndex?: number,
  childIndex?: number,
) {
  return {
    [TEACHING_DOM.block]: '',
    [TEACHING_DOM.blockId]: block.id,
    [TEACHING_DOM.blockType]: block.type,
    [TEACHING_DOM.sourceIndex]: sourceIndex,
    [TEACHING_DOM.parentBlockId]: parentBlockId,
    [TEACHING_DOM.childIndex]: childIndex,
    [TEACHING_DOM.splitPolicy]: splitPolicyForBlock(block),
    [TEACHING_DOM.breakBehavior]: block.type === 'box' ? block.breakBehavior : undefined,
  }
}

export function parseBreakBehavior(value: string | null): BoxBreakBehavior | undefined {
  return value === 'auto' || value === 'avoid' || value === 'allow' || value === 'force-before'
    ? value
    : undefined
}
