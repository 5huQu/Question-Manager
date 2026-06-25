export const PAPER_KINDS = [
  'gaokao_real',
  'local_real',
  'mock',
  'school_exam',
  'lecture',
  'daily_practice',
  'unknown',
] as const

export type PaperKind = typeof PAPER_KINDS[number]

export type ImportMetadata = {
  province: string
  city: string
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  paperKind: PaperKind
  examYear: number
  sourceOrg: string
}

export const DEFAULT_IMPORT_METADATA: ImportMetadata = {
  province: '',
  city: '',
  paperTitle: '',
  batchName: '',
  stage: '高三',
  subject: '数学',
  paperKind: 'unknown',
  examYear: 0,
  sourceOrg: '',
}

export function normalizePaperKind(value: unknown): PaperKind {
  const text = String(value || '').trim()
  return (PAPER_KINDS as readonly string[]).includes(text) ? text as PaperKind : 'unknown'
}

function metadataSource(input: Record<string, unknown> = {}) {
  const nested = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {}
  return { ...input, ...nested }
}

export function normalizeExamYear(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  const year = Math.floor(numeric)
  return year > 0 ? year : 0
}

export function normalizeImportMetadata(input: Record<string, unknown> = {}): ImportMetadata {
  const source = metadataSource(input)
  return {
    province: String(source.province ?? DEFAULT_IMPORT_METADATA.province),
    city: String(source.city ?? DEFAULT_IMPORT_METADATA.city),
    paperTitle: String(source.paperTitle ?? source.paper_title ?? DEFAULT_IMPORT_METADATA.paperTitle),
    batchName: String(source.batchName ?? source.batch_name ?? DEFAULT_IMPORT_METADATA.batchName),
    stage: String(source.stage ?? DEFAULT_IMPORT_METADATA.stage) || DEFAULT_IMPORT_METADATA.stage,
    subject: String(source.subject ?? DEFAULT_IMPORT_METADATA.subject) || DEFAULT_IMPORT_METADATA.subject,
    paperKind: normalizePaperKind(source.paperKind ?? source.paper_kind),
    examYear: normalizeExamYear(source.examYear ?? source.exam_year),
    sourceOrg: String(source.sourceOrg ?? source.source_org ?? DEFAULT_IMPORT_METADATA.sourceOrg),
  }
}

export function importMetadataPatch(input: Record<string, unknown>) {
  const source = metadataSource(input)
  const patch: Partial<ImportMetadata> = {}
  if ('province' in source) patch.province = String(source.province ?? '')
  if ('city' in source) patch.city = String(source.city ?? '')
  if ('paperTitle' in source || 'paper_title' in source) patch.paperTitle = String(source.paperTitle ?? source.paper_title ?? '')
  if ('batchName' in source || 'batch_name' in source) patch.batchName = String(source.batchName ?? source.batch_name ?? '')
  if ('stage' in source) patch.stage = String(source.stage || DEFAULT_IMPORT_METADATA.stage)
  if ('subject' in source) patch.subject = String(source.subject || DEFAULT_IMPORT_METADATA.subject)
  if ('paperKind' in source || 'paper_kind' in source) patch.paperKind = normalizePaperKind(source.paperKind ?? source.paper_kind)
  if ('examYear' in source || 'exam_year' in source) patch.examYear = normalizeExamYear(source.examYear ?? source.exam_year)
  if ('sourceOrg' in source || 'source_org' in source) patch.sourceOrg = String(source.sourceOrg ?? source.source_org ?? '')
  return patch
}
