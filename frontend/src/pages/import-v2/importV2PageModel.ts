import type { ImportV2Candidate, ImportV2ImportJobDocument, ImportV2SourceDocument } from '@/api/importV2'
import { importIssueLabel } from '@/utils/importDiagnostics'

export type UnifiedQuestion = {
  id: string
  questionNo: string
  questionType: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  status: 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked' | 'committed' | 'banked' | 'skipped'
  issues: Array<{
    severity: 'warning' | 'error'
    message: string
    code?: string
    relatedBlockIds?: string[]
    relatedFigures?: ImportV2Candidate['figures']
  }>
  figures: Array<{ id: string; usage: string; path: string; pageNo?: number; blockId?: string; sourceBlockId?: string; bbox?: any; inlineMarker?: string; optionLabel?: string }>
  hasFigures: boolean
  similarQuestions?: any[]
  parseDiagnostics: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string; questionNo?: string }>
  rawItem: ImportV2Candidate
}

export type PaperKind = ImportV2SourceDocument['paperKind']
export type UploadDocumentMode = 'single_document' | 'separated_documents'
export type SourceOcrProvider = 'doc2x' | 'glm'

export type SourceMetadataDraft = {
  paperTitle: string
  batchName: string
  stage: string
  subject: string
  province: string
  city: string
  paperKind: PaperKind
  examYear: string
  sourceOrg: string
  hasWatermark: boolean
  watermarkTerms: string
}

export const paperKindOptions: Array<{ value: PaperKind; label: string }> = [
  { value: 'gaokao_real', label: '高考真题' },
  { value: 'local_real', label: '地方真题' },
  { value: 'mock', label: '模拟题' },
  { value: 'school_exam', label: '校内考试' },
  { value: 'lecture', label: '讲义' },
  { value: 'daily_practice', label: '日常练习' },
  { value: 'unknown', label: '未分类' },
]

export const subjectOptions = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理']

export const gaokaoRegionOptions = [
  {
    value: '全国一卷 / 新课标全国 I 卷',
    label: '全国一卷 / 新课标全国 I 卷',
    provinces: '浙江、山东、江苏、河北、福建、湖北、湖南、广东、江西、安徽、河南',
  },
  {
    value: '全国二卷 / 新课标全国 II 卷',
    label: '全国二卷 / 新课标全国 II 卷',
    provinces: '海南、重庆、贵州、广西、甘肃、四川、云南、辽宁、吉林、黑龙江、内蒙古、陕西、青海、宁夏、山西、新疆、西藏',
  },
  { value: '北京', label: '北京', provinces: '' },
  { value: '上海', label: '上海', provinces: '' },
  { value: '天津', label: '天津', provinces: '' },
]

export function isGaokaoRegion(value: string) {
  return gaokaoRegionOptions.some((item) => item.value === value)
}

export function metadataDraftFromDoc(doc?: Partial<ImportV2SourceDocument> | null): SourceMetadataDraft {
  const watermark = doc?.metadata && typeof doc.metadata.watermark === 'object' && !Array.isArray(doc.metadata.watermark)
    ? doc.metadata.watermark as { enabled?: unknown; terms?: unknown }
    : {}
  const watermarkTerms = Array.isArray(watermark.terms)
    ? watermark.terms.map((item) => String(item || '')).filter(Boolean).join('\n')
    : ''
  return {
    paperTitle: doc?.paperTitle || '',
    batchName: doc?.batchName || '',
    stage: doc?.stage || '高三',
    subject: doc?.subject || '数学',
    province: doc?.province || '',
    city: doc?.city || '',
    paperKind: doc?.paperKind || 'unknown',
    examYear: doc?.examYear ? String(doc.examYear) : '',
    sourceOrg: doc?.sourceOrg || '',
    hasWatermark: Boolean(watermark.enabled),
    watermarkTerms,
  }
}

export function metadataPayload(draft: SourceMetadataDraft) {
  const isGaokaoReal = draft.paperKind === 'gaokao_real'
  const gaokaoProvince = isGaokaoReal && isGaokaoRegion(draft.province) ? draft.province.trim() : ''
  const paperTitle = draft.paperTitle.trim()
  return {
    paperTitle,
    batchName: draft.batchName.trim() || paperTitle,
    stage: draft.stage.trim() || '高三',
    subject: draft.subject.trim() || '数学',
    province: isGaokaoReal ? gaokaoProvince : draft.province.trim(),
    city: isGaokaoReal ? '' : draft.city.trim(),
    paperKind: draft.paperKind || 'unknown',
    examYear: Number(draft.examYear || 0) || 0,
    sourceOrg: isGaokaoReal ? '' : draft.sourceOrg.trim(),
    metadata: {
      watermark: {
        enabled: draft.hasWatermark,
        terms: draft.watermarkTerms.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      },
    },
  }
}

function hasVisibleFigureMarkup(...contents: string[]) {
  return contents.some((content) =>
    /!\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))\s*\)/.test(String(content || '')) ||
    /<!--\s*DOC2X_FIGURE:([^\s>]+)\s*-->/.test(String(content || ''))
  )
}

export function fromCandidate(candidate: ImportV2Candidate): UnifiedQuestion {
  return {
    id: candidate.id,
    questionNo: candidate.questionNo || '',
    questionType: candidate.questionType || '',
    stemMarkdown: candidate.stemMarkdown || '',
    answerText: candidate.answerText || '',
    analysisMarkdown: candidate.analysisMarkdown || '',
    status: candidate.status === 'committed' ? 'committed' : candidate.status === 'ready' ? 'ready' : candidate.status === 'blocked' ? 'blocked' : 'needs_review',
    issues: (candidate.issues || []).map((issue) => ({
      severity: issue.severity,
      message: issue.message,
      code: issue.code,
      relatedBlockIds: issue.relatedBlockIds,
      relatedFigures: issue.relatedFigures,
    })),
    figures: (candidate.figures || []).map((figure) => ({
      id: figure.id,
      usage: figure.usage,
      path: figure.path,
      pageNo: figure.pageNo,
      blockId: figure.blockId,
      sourceBlockId: figure.sourceBlockId,
      bbox: figure.bbox,
      inlineMarker: figure.inlineMarker,
      optionLabel: figure.optionLabel,
    })),
    hasFigures: hasVisibleFigureMarkup(candidate.stemMarkdown, candidate.answerText, candidate.analysisMarkdown),
    parseDiagnostics: (candidate.parseDiagnostics || []).map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      questionNo: diagnostic.questionNo,
    })),
    rawItem: candidate,
  }
}

export function issueLabel(code?: string) {
  return importIssueLabel(code)
}

export function importJobDocumentRoleLabel(role?: ImportV2ImportJobDocument['role']) {
  return ({ full: '完整文档', questions: '原卷', solutions: '答案解析' } as Record<string, string>)[role || ''] || ''
}

export function normalizeSourceOcrProvider(value: unknown): SourceOcrProvider {
  return String(value || '').toLowerCase() === 'glm' ? 'glm' : 'doc2x'
}

export function sourceOcrProviderLabel(provider: SourceOcrProvider) {
  return provider === 'glm' ? 'GLM-OCR' : 'Doc2X'
}

export function reviewTabFromQuery(value: string | null): 'all' | 'ready' | 'warning' | 'error' {
  return value === 'ready' || value === 'warning' || value === 'error' ? value : 'all'
}

export function questionReviewState(question: UnifiedQuestion, isCommitted: boolean) {
  if (isCommitted) return { label: '已入库', dotClass: 'bg-emerald-500', textClass: 'text-emerald-700 dark:text-emerald-400' }
  if (question.status === 'blocked' || question.status === 'needs_manual_fix' || question.issues.some((issue) => issue.severity === 'error')) {
    return { label: '需要修正', dotClass: 'bg-red-500', textClass: 'text-red-700 dark:text-red-400' }
  }
  if (question.issues.some((issue) => issue.severity === 'warning') || question.similarQuestions?.length) {
    return { label: '建议核对', dotClass: 'bg-amber-500', textClass: 'text-amber-700 dark:text-amber-400' }
  }
  return { label: '可以入库', dotClass: 'bg-emerald-500', textClass: 'text-muted-foreground' }
}
