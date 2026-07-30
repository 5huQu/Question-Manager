import type {
  HeadingBlock,
  HeadingNumberLevelOptions,
  TeachingDocumentOutlineOptions,
  TeachingDocumentOutlinePreset,
  TeachingDocumentV1,
} from '@/types/teachingDocument'

export type DocumentOutlineDiagnostic = {
  blockId: string
  code: 'heading-level-skip'
  message: string
}

export type DocumentOutlineEntry = {
  blockId: string
  level: 1 | 2 | 3 | 4
  sourceIndex: number
  endIndex: number
  parentBlockId?: string
  childBlockIds: string[]
  displayLabel?: string
}

export type DocumentOutline = {
  roots: DocumentOutlineEntry[]
  entries: DocumentOutlineEntry[]
  entryByBlockId: ReadonlyMap<string, DocumentOutlineEntry>
  sectionRangeByBlockId: ReadonlyMap<string, readonly [number, number]>
  diagnostics: DocumentOutlineDiagnostic[]
}

const DEFAULT_LEVELS: Record<TeachingDocumentOutlinePreset, Record<1 | 2 | 3 | 4, Required<HeadingNumberLevelOptions>>> = {
  textbook: {
    1: { style: 'chinese', template: '第{cn}章', includeParents: false },
    2: { style: 'chinese', template: '第{cn}节', includeParents: false },
    3: { style: 'chinese', template: '{cn}、', includeParents: false },
    4: { style: 'chinese', template: '（{cn}）', includeParents: false },
  },
  decimal: {
    1: { style: 'arabic', template: '{path}', includeParents: true },
    2: { style: 'arabic', template: '{path}', includeParents: true },
    3: { style: 'arabic', template: '{path}', includeParents: true },
    4: { style: 'arabic', template: '{path}', includeParents: true },
  },
  chinese: {
    1: { style: 'chinese', template: '{cn}、', includeParents: false },
    2: { style: 'chinese', template: '（{cn}）', includeParents: false },
    3: { style: 'arabic', template: '{n}.', includeParents: false },
    4: { style: 'arabic', template: '（{n}）', includeParents: false },
  },
  'chapter-chinese': {
    1: { style: 'chinese', template: '第{cn}章', includeParents: false },
    2: { style: 'chinese', template: '{cn}、', includeParents: false },
    3: { style: 'arabic', template: '{n}.', includeParents: false },
    4: { style: 'arabic', template: '（{n}）', includeParents: false },
  },
  'chapter-decimal': {
    1: { style: 'chinese', template: '第{cn}章', includeParents: false },
    2: { style: 'arabic', template: '{path}', includeParents: true },
    3: { style: 'arabic', template: '{path}', includeParents: true },
    4: { style: 'arabic', template: '{path}', includeParents: true },
  },
  'chapter-section': {
    1: { style: 'chinese', template: '第{cn}章', includeParents: false },
    2: { style: 'chinese', template: '第{cn}节', includeParents: false },
    3: { style: 'chinese', template: '第{cn}条', includeParents: false },
    4: { style: 'arabic', template: '（{n}）', includeParents: false },
  },
  roman: {
    1: { style: 'roman-upper', template: '{cn}.', includeParents: false },
    2: { style: 'alpha-upper', template: '{cn}.', includeParents: false },
    3: { style: 'arabic', template: '{n}.', includeParents: false },
    4: { style: 'arabic', template: '（{n}）', includeParents: false },
  },
  paren: {
    1: { style: 'chinese', template: '（{cn}）', includeParents: false },
    2: { style: 'arabic', template: '{n}.', includeParents: false },
    3: { style: 'arabic', template: '（{n}）', includeParents: false },
    4: { style: 'arabic', template: '{n}.', includeParents: false },
  },
  exam: {
    1: { style: 'chinese', template: '{cn}、', includeParents: false },
    2: { style: 'chinese', template: '（{cn}）', includeParents: false },
    3: { style: 'arabic', template: '{n}.', includeParents: false },
    4: { style: 'arabic', template: '', includeParents: false },
  },
  none: {
    1: { style: 'arabic', template: '', includeParents: false },
    2: { style: 'arabic', template: '', includeParents: false },
    3: { style: 'arabic', template: '', includeParents: false },
    4: { style: 'arabic', template: '', includeParents: false },
  },
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
function chineseNumber(value: number) {
  if (value <= 0 || value > 999) return String(value)
  if (value < 10) return CN_DIGITS[value]
  if (value < 20) return value === 10 ? '十' : `十${CN_DIGITS[value % 10]}`
  if (value < 100) return `${CN_DIGITS[Math.floor(value / 10)]}十${value % 10 ? CN_DIGITS[value % 10] : ''}`
  const hundred = `${CN_DIGITS[Math.floor(value / 100)]}百`
  const remainder = value % 100
  return remainder === 0 ? hundred : `${hundred}${remainder < 10 ? '零' : ''}${chineseNumber(remainder)}`
}
function roman(value: number) {
  if (value <= 0 || value > 3999) return String(value)
  const tokens: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let remaining = value
  return tokens.map(([number, token]) => { const count = Math.floor(remaining / number); remaining -= count * number; return token.repeat(count) }).join('')
}
function alpha(value: number) {
  if (value <= 0 || value > 702) return String(value)
  let remaining = value
  let result = ''
  while (remaining > 0) { remaining -= 1; result = String.fromCharCode(65 + (remaining % 26)) + result; remaining = Math.floor(remaining / 26) }
  return result
}
function labelFor(value: number, style: Required<HeadingNumberLevelOptions>['style']) {
  if (style === 'chinese') return chineseNumber(value)
  if (style === 'roman-upper') return roman(value)
  if (style === 'alpha-upper') return alpha(value)
  return String(value)
}
function optionsFor(outline: TeachingDocumentOutlineOptions | undefined, level: 1 | 2 | 3 | 4) {
  const preset = outline?.preset || 'decimal'
  const base = DEFAULT_LEVELS[preset]
  return { ...base[level], ...outline?.levels?.[level] }
}

export function buildDocumentOutline(document: TeachingDocumentV1): DocumentOutline {
  const entries: DocumentOutlineEntry[] = []
  const stack: DocumentOutlineEntry[] = []
  const diagnostics: DocumentOutlineDiagnostic[] = []
  document.content.forEach((block, sourceIndex) => {
    if (block.type !== 'heading') return
    while (stack.length && stack.at(-1)!.level >= block.level) stack.pop()
    const parent = stack.at(-1)
    if (parent && block.level > parent.level + 1) diagnostics.push({ blockId: block.id, code: 'heading-level-skip', message: `标题从 H${parent.level} 跳至 H${block.level}。` })
    const entry: DocumentOutlineEntry = { blockId: block.id, level: block.level, sourceIndex, endIndex: document.content.length, parentBlockId: parent?.blockId, childBlockIds: [] }
    if (parent) parent.childBlockIds.push(block.id)
    entries.push(entry)
    stack.push(entry)
  })
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const next = entries.slice(index + 1).find((candidate) => candidate.level <= entry.level)
    entry.endIndex = next?.sourceIndex ?? document.content.length
  }
  const counters = [0, 0, 0, 0, 0]
  const enabled = document.outline?.numberingEnabled === true && document.outline.preset !== 'none'
  for (const entry of entries) {
    const heading = document.content[entry.sourceIndex] as HeadingBlock
    if (heading.numbering?.restartAt && Number.isInteger(heading.numbering.restartAt) && heading.numbering.restartAt > 0) counters[entry.level] = heading.numbering.restartAt - 1
    counters[entry.level] += 1
    for (let level = entry.level + 1; level <= 4; level += 1) counters[level] = 0
    if (!enabled || heading.numbering?.mode === 'none') continue
    if (heading.numbering?.mode === 'manual') { entry.displayLabel = heading.numbering.manualLabel?.trim() || undefined; continue }
    const options = optionsFor(document.outline, entry.level)
    if (!options.template) continue
    const path = counters.slice(1, entry.level + 1).filter(Boolean).join('.')
    const current = labelFor(counters[entry.level], options.style)
    const parent = entry.level > 1 ? counters.slice(1, entry.level).filter(Boolean).join('.') : ''
    entry.displayLabel = options.template.replaceAll('{n}', String(counters[entry.level])).replaceAll('{cn}', current).replaceAll('{path}', path).replaceAll('{parent}', parent).trim()
  }
  const entryByBlockId = new Map(entries.map((entry) => [entry.blockId, entry]))
  const sectionRangeByBlockId = new Map(entries.map((entry) => [entry.blockId, [entry.sourceIndex, entry.endIndex] as const]))
  return { roots: entries.filter((entry) => !entry.parentBlockId), entries, entryByBlockId, sectionRangeByBlockId, diagnostics }
}

export function headingLabelByBlockId(document: TeachingDocumentV1) {
  return new Map(buildDocumentOutline(document).entries.flatMap((entry) => entry.displayLabel ? [[entry.blockId, entry.displayLabel] as const] : []))
}
