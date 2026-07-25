import type { PaperKind, SourceMetadataDraft } from '@/api/importV2'

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
