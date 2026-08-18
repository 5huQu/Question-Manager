import type { PaperKind, SourceMetadataDraft } from '@/api/importV2'
import { gaokaoRegionOptions, isGaokaoRegion } from '@/utils/metadataOptions'

export { gaokaoRegionOptions, isGaokaoRegion } from '@/utils/metadataOptions'

export type UploadDocumentMode = 'single_document' | 'separated_documents' | 'doc2x_package'
export type Doc2xPackageDocumentMode = 'single_document' | 'separated_documents'

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

export function initialMetadata(): SourceMetadataDraft {
  return {
    paperTitle: '',
    batchName: '',
    stage: '高三',
    subject: '数学',
    province: '',
    city: '',
    paperKind: 'unknown',
    examYear: String(new Date().getFullYear()),
    sourceOrg: '',
    hasWatermark: false,
    watermarkTerms: '',
  }
}
