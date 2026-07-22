import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Upload,
  LoaderCircle,
  FileText,
  FileCheck2,
  Trash2,
  Layers,
  AlertTriangle,
  Check,
  ChevronLeft,
  FileArchive,
} from 'lucide-react'
import { importV2Api, type ImportParserPreset, type PaperKind, type SourceMetadataDraft } from '@/api/importV2'
import { settingsApi } from '@/api/settings'
import { SearchableSelect } from '@/components/SearchableSelect'
import { PageTitle, Panel, Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { cityOptionsForProvince, provinceOptions, yearOptionsFromServerYear } from '@/utils/metadataOptions'
import { ensureStageValue, gradeOptionsForTeachingStages } from '@/utils/stages'
import { importJobPath } from './importV2Routes'

type UploadDocumentMode = 'single_document' | 'separated_documents' | 'doc2x_package'
type Doc2xPackageDocumentMode = 'single_document' | 'separated_documents'

const paperKindOptions: Array<{ value: PaperKind; label: string }> = [
  { value: 'gaokao_real', label: '高考真题' },
  { value: 'local_real', label: '地方真题' },
  { value: 'mock', label: '模拟题' },
  { value: 'school_exam', label: '校内考试' },
  { value: 'lecture', label: '讲义' },
  { value: 'daily_practice', label: '日常练习' },
  { value: 'unknown', label: '未分类' },
]

const subjectOptions = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理']

const gaokaoRegionOptions = [
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

function isGaokaoRegion(value: string) {
  return gaokaoRegionOptions.some((item) => item.value === value)
}

function initialMetadata(): SourceMetadataDraft {
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

export default function ImportUploadPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [metadataDraft, setMetadataDraft] = useState<SourceMetadataDraft>(() => initialMetadata())
  const [uploadDocumentMode, setUploadDocumentMode] = useState<UploadDocumentMode>('single_document')

  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null)
  const [doc2xPackageDocumentMode, setDoc2xPackageDocumentMode] = useState<Doc2xPackageDocumentMode>('single_document')
  const [doc2xPackageFile, setDoc2xPackageFile] = useState<File | null>(null)
  const [doc2xSolutionPackageFile, setDoc2xSolutionPackageFile] = useState<File | null>(null)
  const [selectedDoc2xParserPresetId, setSelectedDoc2xParserPresetId] = useState('')
  const [questionUploadFile, setQuestionUploadFile] = useState<File | null>(null)
  const [solutionUploadFile, setSolutionUploadFile] = useState<File | null>(null)

  const [autoOcr, setAutoOcr] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const doc2xPackageInputRef = useRef<HTMLInputElement>(null)
  const doc2xSolutionPackageInputRef = useRef<HTMLInputElement>(null)
  const questionFileInputRef = useRef<HTMLInputElement>(null)
  const solutionFileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const health = useAsync(() => settingsApi.getHealth(), [])
  const ocrSettings = useAsync(() => settingsApi.getOcrSettings(), [])
  const parserPresets = useAsync<{ items: ImportParserPreset[] }>(() => importV2Api.listParserPresets(), [])
  const serverYear = health.data?.serverYear
  const yearOptions = useMemo(() => yearOptionsFromServerYear(serverYear), [serverYear])
  const currentOcrProvider = ocrSettings.data?.ocrProvider === 'glm' ? 'glm' : 'doc2x'
  const currentOcrProviderLabel = currentOcrProvider === 'glm' ? 'GLM-OCR' : 'Doc2X'
  const configuredStageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const stageOptions = metadataDraft.stage && !configuredStageOptions.includes(metadataDraft.stage)
    ? [metadataDraft.stage, ...configuredStageOptions]
    : configuredStageOptions
  const selectedStage = ensureStageValue(metadataDraft.stage, stageOptions)
  const metadataSubject = metadataDraft.subject || '数学'
  const visibleSubjectOptions = subjectOptions.includes(metadataSubject) ? subjectOptions : [metadataSubject, ...subjectOptions]
  const cityOptions = useMemo(() => cityOptionsForProvince(metadataDraft.province), [metadataDraft.province])
  const visibleCityOptions = metadataDraft.city && !cityOptions.includes(metadataDraft.city)
    ? [metadataDraft.city, ...cityOptions]
    : cityOptions

  useEffect(() => {
    if (!serverYear) return
    setMetadataDraft((draft) => {
      const clientInitialYear = String(new Date().getFullYear())
      if (draft.examYear && draft.examYear !== clientInitialYear) return draft
      return { ...draft, examYear: String(serverYear) }
    })
  }, [serverYear])

  function baseNameFromFile(file: File) {
    return file.name.replace(/\.[^.]+$/i, '')
  }

  function handleUploadFileSelection(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    setPendingUploadFile(file)
    setError('')
    setNotice('')
    const titleFromFile = baseNameFromFile(file)
    setMetadataDraft((draft) => ({
      ...draft,
      paperTitle: draft.paperTitle.trim() ? draft.paperTitle : titleFromFile,
    }))
  }

  function handleSeparatedFileSelection(role: 'questions' | 'solutions', files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    if (file.name.endsWith('.json')) {
      setError('双文档导入请上传 PDF 或图片。JSON 模拟导入仍使用单文档模式。')
      return
    }
    if (role === 'questions') setQuestionUploadFile(file)
    else setSolutionUploadFile(file)
    setError('')
    setNotice('')
    const titleFromFile = baseNameFromFile(file)
    setMetadataDraft((draft) => ({
      ...draft,
      paperTitle: draft.paperTitle.trim() ? draft.paperTitle : titleFromFile,
    }))
  }

  function handleDoc2xPackageSelection(role: 'full_or_questions' | 'solutions', files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('请选择 Doc2X 导出的 Markdown ZIP 文件。')
      return
    }
    if (role === 'solutions') setDoc2xSolutionPackageFile(file)
    else setDoc2xPackageFile(file)
    setError('')
    setNotice('')
    const titleFromFile = baseNameFromFile(file)
      .replace(/[-_ ]?\d{14}$/i, '')
      .replace(/[（(【[]+\s*$/u, '')
      .trim()
    if (role !== 'solutions') {
      setMetadataDraft((draft) => ({
        ...draft,
        paperTitle: draft.paperTitle.trim() ? draft.paperTitle : titleFromFile,
      }))
    }
  }

  function metadataPayload(draft: SourceMetadataDraft) {
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
          terms: (draft.watermarkTerms || '').split(/\r?\n/).map((item: string) => item.trim()).filter(Boolean),
        },
      },
    }
  }

  function uploadMetadataForFile(file: File, roleLabel?: string) {
    const titleBase = baseNameFromFile(file)
    return {
      ...metadataPayload(metadataDraft),
      title: roleLabel ? `${titleBase}（${roleLabel}）` : titleBase,
    }
  }

  async function handleSubmit() {
    setError('')
    setNotice('')

    if (uploadDocumentMode === 'doc2x_package') {
      if (!selectedDoc2xParserPresetId) {
        setError('请选择本次 Doc2X 导入使用的解析方式。')
        return
      }
      if (!doc2xPackageFile || (doc2xPackageDocumentMode === 'separated_documents' && !doc2xSolutionPackageFile)) {
        setError(doc2xPackageDocumentMode === 'single_document'
          ? '请选择 Doc2X 导出的 Markdown ZIP 文件。'
          : '请分别选择题目包和答案解析包。')
        return
      }
      setUploading(true)
      try {
        const metadata = metadataPayload(metadataDraft)
        const [questionImported, solutionImported] = await Promise.all([
          importV2Api.importDoc2xPackage(doc2xPackageFile, {
            ...metadata,
            title: doc2xPackageDocumentMode === 'separated_documents' ? `${baseNameFromFile(doc2xPackageFile)}（题目）` : baseNameFromFile(doc2xPackageFile),
          }),
          ...(doc2xPackageDocumentMode === 'separated_documents' && doc2xSolutionPackageFile
            ? [importV2Api.importDoc2xPackage(doc2xSolutionPackageFile, {
                ...metadata,
                title: `${baseNameFromFile(doc2xSolutionPackageFile)}（答案解析）`,
              })]
            : []),
        ])
        const jobRes = await importV2Api.createImportJob({
          title: metadata.paperTitle || questionImported.sourceDocument.title || baseNameFromFile(doc2xPackageFile),
          mode: doc2xPackageDocumentMode,
          ...metadata,
        })
        await Promise.all([
          importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, {
            sourceDocumentId: questionImported.sourceDocument.id,
            role: doc2xPackageDocumentMode === 'single_document' ? 'full' : 'questions',
            sortOrder: 0,
          }),
          ...(solutionImported
            ? [importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, {
                sourceDocumentId: solutionImported.sourceDocument.id,
                role: 'solutions',
                sortOrder: 1,
              })]
            : []),
        ])
        await importV2Api.parseImportJobCandidates(jobRes.importJob.id, { presetId: selectedDoc2xParserPresetId })
        navigate(importJobPath(jobRes.importJob.id))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setUploading(false)
      }
    } else if (uploadDocumentMode === 'single_document') {
      const file = pendingUploadFile
      if (!file) {
        setError('请选择要上传的文件。')
        return
      }
      setUploading(true)
      try {
        const res = await importV2Api.uploadSourceDocument(file, metadataPayload(metadataDraft))
        const metadata = metadataPayload(metadataDraft)
        const jobRes = await importV2Api.createImportJob({
          title: metadata.paperTitle || res.sourceDocument.title || baseNameFromFile(file),
          mode: 'single_document',
          ...metadata,
        })
        await importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, {
          sourceDocumentId: res.sourceDocument.id,
          role: 'full',
          sortOrder: 0,
        })

        if (autoOcr) {
          await importV2Api.startSourceDocumentOcr(res.sourceDocument.id)
          navigate(importJobPath(jobRes.importJob.id))
        } else {
          navigate('/tools/import')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setUploading(false)
      }
    } else {
      if (!questionUploadFile || !solutionUploadFile) {
        setError('请分别选择原卷文件和答案解析文件。')
        return
      }
      setUploading(true)
      try {
        const metadata = metadataPayload(metadataDraft)
        const [questionRes, solutionRes] = await Promise.all([
          importV2Api.uploadSourceDocument(questionUploadFile, uploadMetadataForFile(questionUploadFile, '原卷')),
          importV2Api.uploadSourceDocument(solutionUploadFile, uploadMetadataForFile(solutionUploadFile, '答案解析')),
        ])
        const jobTitle = metadata.paperTitle || `${baseNameFromFile(questionUploadFile)} + ${baseNameFromFile(solutionUploadFile)}`
        const jobRes = await importV2Api.createImportJob({
          title: jobTitle,
          mode: 'separated_documents',
          ...metadata,
        })
        await Promise.all([
          importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, {
            sourceDocumentId: questionRes.sourceDocument.id,
            role: 'questions',
            sortOrder: 0,
          }),
          importV2Api.addSourceDocumentToImportJob(jobRes.importJob.id, {
            sourceDocumentId: solutionRes.sourceDocument.id,
            role: 'solutions',
            sortOrder: 1,
          }),
        ])

        if (autoOcr) {
          await Promise.all([
            importV2Api.startSourceDocumentOcr(questionRes.sourceDocument.id),
            importV2Api.startSourceDocumentOcr(solutionRes.sourceDocument.id)
          ])
          navigate(importJobPath(jobRes.importJob.id))
        } else {
          navigate('/tools/import')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setUploading(false)
      }
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* SF Glass Stepper Header */}
      <div className="sf-glass p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => navigate('/tools/import')} className="sf-pressable rounded-xl">
            返回列表
          </Button>
          <div>
            <h1 className="sf-title text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              新建资料导入
            </h1>
            <p className="sf-subtitle text-xs">配置元数据并上传试卷原件或解析包</p>
          </div>
        </div>

        {/* Dynamic Stepper Pills */}
        <div className="flex items-center gap-2 bg-zinc-100/80 dark:bg-zinc-900/80 p-1.5 rounded-xl border border-zinc-200/50 dark:border-zinc-800/50 text-xs font-medium self-stretch md:self-auto justify-between md:justify-start">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/60 dark:border-zinc-700/60">
            <span className="flex size-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold">1</span>
            <span>上传资料</span>
          </div>
          <span className="text-zinc-300 dark:text-zinc-700">→</span>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-400 dark:text-zinc-500">
            <span className="flex size-4 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-bold">2</span>
            <span>自动识别</span>
          </div>
          <span className="text-zinc-300 dark:text-zinc-700">→</span>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-400 dark:text-zinc-500">
            <span className="flex size-4 items-center justify-center rounded-full bg-zinc-200 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-bold">3</span>
            <span>核对入库</span>
          </div>
        </div>
      </div>

      {notice && (
        <div className="sf-glass px-4 py-3 rounded-xl border-emerald-500/20 bg-emerald-50/50 text-xs text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 flex items-center gap-2.5 shadow-sm">
          <Check className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="sf-glass px-4 py-3 rounded-xl border-red-500/20 bg-red-50/50 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300 flex items-center gap-2.5 shadow-sm">
          <AlertTriangle className="size-4 text-red-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* 左侧元数据配置 */}
        <div className="md:col-span-6">
          <Panel title="试卷信息与元数据" className="overflow-visible" bodyClassName="overflow-visible">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 col-span-2">
                  <span className="text-[13px] font-medium text-zinc-500">试卷名称</span>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                    value={metadataDraft.paperTitle}
                    onChange={(e) => setMetadataDraft((d) => ({ ...d, paperTitle: e.target.value }))}
                    placeholder="请输入试卷或练习的完整标题"
                  />
                </label>
                <label className="space-y-1.5 col-span-2">
                  <span className="text-[13px] font-medium text-zinc-500">批次名称</span>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                    value={metadataDraft.batchName}
                    onChange={(e) => setMetadataDraft((d) => ({ ...d, batchName: e.target.value }))}
                    placeholder="可选，不填默认与试卷名称相同"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[13px] font-medium text-zinc-500">学段/年级</span>
                  <SearchableSelect
                    value={selectedStage}
                    options={stageOptions}
                    onChange={(stage) => setMetadataDraft((d) => ({ ...d, stage }))}
                    placeholder="请选择学段"
                    searchPlaceholder="搜索学段"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[13px] font-medium text-zinc-500">学科</span>
                  <select
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                    value={metadataSubject}
                    onChange={(e) => setMetadataDraft((d) => ({ ...d, subject: e.target.value }))}
                  >
                    {visibleSubjectOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[13px] font-medium text-zinc-500">资料类型</span>
                  <select
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                    value={metadataDraft.paperKind}
                    onChange={(e) => setMetadataDraft((d) => {
                      const paperKind = e.target.value as PaperKind
                      if (paperKind === 'gaokao_real') {
                        return { ...d, paperKind, province: isGaokaoRegion(d.province) ? d.province : '', city: '', sourceOrg: '' }
                      }
                      return { ...d, paperKind }
                    })}
                  >
                    {paperKindOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[13px] font-medium text-zinc-500">年份</span>
                  <SearchableSelect
                    value={String(metadataDraft.examYear)}
                    options={yearOptions}
                    onChange={(examYear) => setMetadataDraft((d) => ({ ...d, examYear }))}
                    placeholder="请选择年份"
                    searchPlaceholder="搜索年份"
                  />
                </label>

                {metadataDraft.paperKind === 'gaokao_real' ? (
                  <label className="col-span-2 space-y-1.5">
                    <span className="text-[13px] font-medium text-zinc-500">试卷适用地区</span>
                    <SearchableSelect
                      value={isGaokaoRegion(metadataDraft.province) ? metadataDraft.province : ''}
                      options={gaokaoRegionOptions.map((item) => item.value)}
                      onChange={(province) => setMetadataDraft((d) => ({ ...d, province, city: '', sourceOrg: '' }))}
                      placeholder="请选择全国卷或直辖市"
                      searchPlaceholder="搜索全国卷或地区"
                      allowClear
                    />
                    {gaokaoRegionOptions.find((item) => item.value === metadataDraft.province)?.provinces && (
                      <p className="text-[11px] leading-4 text-zinc-400">
                        {gaokaoRegionOptions.find((item) => item.value === metadataDraft.province)?.provinces}
                      </p>
                    )}
                  </label>
                ) : (
                  <>
                    <label className="space-y-1.5">
                      <span className="text-[13px] font-medium text-zinc-500">省份</span>
                      <SearchableSelect
                        value={metadataDraft.province}
                        options={provinceOptions}
                        onChange={(province) => setMetadataDraft((d) => ({ ...d, province, city: cityOptionsForProvince(province).includes(d.city) ? d.city : '' }))}
                        placeholder="请选择省份"
                        searchPlaceholder="搜索省份"
                        allowClear
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[13px] font-medium text-zinc-500">城市</span>
                      <SearchableSelect
                        value={metadataDraft.city}
                        options={visibleCityOptions}
                        onChange={(city) => setMetadataDraft((d) => ({ ...d, city }))}
                        placeholder={metadataDraft.province ? '请选择城市' : '可先选择省份'}
                        searchPlaceholder="搜索城市"
                        allowClear
                      />
                    </label>
                    <label className="col-span-2 space-y-1.5">
                      <span className="text-[13px] font-medium text-zinc-500">来源机构</span>
                      <input
                        className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                        value={metadataDraft.sourceOrg}
                        onChange={(e) => setMetadataDraft((d) => ({ ...d, sourceOrg: e.target.value }))}
                        placeholder="例如：金太阳联考"
                      />
                    </label>
                  </>
                )}
              </div>

              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
                    checked={metadataDraft.hasWatermark}
                    onChange={(e) => setMetadataDraft((d) => ({ ...d, hasWatermark: e.target.checked }))}
                  />
                  文档含有去水印背景词
                </label>
                {metadataDraft.hasWatermark && (
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-zinc-500">水印排除词典</span>
                    <textarea
                      className="min-h-20 w-full resize-y rounded-md border border-zinc-200 bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                      value={metadataDraft.watermarkTerms}
                      onChange={(e) => setMetadataDraft((d) => ({ ...d, watermarkTerms: e.target.value }))}
                      placeholder="每行输入一个去水印排除词，例如：鼎尖教育"
                    />
                  </label>
                )}
              </div>
            </div>
          </Panel>
        </div>

        {/* 右侧文件选择与上传提交 */}
        <div className="md:col-span-6 space-y-6">
          <Panel title="导入模式与文件上传">
            <div className="space-y-4">
              <div className="flex bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50 w-full select-none">
                <button
                  type="button"
                  onClick={() => setUploadDocumentMode('single_document')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                    uploadDocumentMode === 'single_document'
                      ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                  }`}
                >
                  <FileText className="size-3.5" />
                  单文档导入
                </button>
                <button
                  type="button"
                  onClick={() => setUploadDocumentMode('separated_documents')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                    uploadDocumentMode === 'separated_documents'
                      ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                  }`}
                >
                  <Layers className="size-3.5" />
                  双文档导入（题解分离）
                </button>
                <button
                  type="button"
                  onClick={() => setUploadDocumentMode('doc2x_package')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                    uploadDocumentMode === 'doc2x_package'
                      ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                  }`}
                >
                  <FileArchive className="size-3.5" />
                  Doc2X 导出包
                </button>
              </div>

              {uploadDocumentMode === 'single_document' ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    if (e.dataTransfer.files) {
                      handleUploadFileSelection(e.dataTransfer.files)
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[220px] ${
                    dragOver
                      ? 'border-zinc-900 bg-zinc-50/30 dark:border-zinc-100 dark:bg-zinc-900/30'
                      : 'border-zinc-200 bg-white hover:bg-zinc-50/10 dark:border-zinc-800 dark:bg-zinc-950'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="application/json,.json,application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                    onChange={(e) => {
                      if (e.target.files) handleUploadFileSelection(e.target.files)
                    }}
                  />
                  {uploading ? (
                    <LoaderCircle className="size-8 animate-spin text-zinc-500 mb-3" />
                  ) : (
                    <Upload className="size-8 text-zinc-400 dark:text-zinc-500 mb-3" />
                  )}
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                    {uploading ? '文件上传并处理中...' : pendingUploadFile ? pendingUploadFile.name : '点击选择或拖拽资料至此处'}
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    {pendingUploadFile ? '已选择文件，提交后直接开始导入' : '支持 PDF、PNG/JPG 或 JSON 格式'}
                  </p>
                  {pendingUploadFile && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingUploadFile(null)
                      }}
                      className="mt-3 text-xs text-red-500 hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="size-3" /> 移除文件
                    </button>
                  )}
                </div>
              ) : uploadDocumentMode === 'doc2x_package' ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">文档路径</div>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
                      {([
                        ['single_document', '单文档（题干答案混排）'],
                        ['separated_documents', '双文档（题目 + 解析）'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDoc2xPackageDocumentMode(value)}
                          className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${doc2xPackageDocumentMode === value
                            ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                            : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">解析方式</span>
                    <select
                      value={selectedDoc2xParserPresetId}
                      onChange={(event) => setSelectedDoc2xParserPresetId(event.target.value)}
                      disabled={parserPresets.loading}
                      className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-xs text-zinc-900 outline-none focus:border-zinc-950 disabled:cursor-wait disabled:text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      <option value="">{parserPresets.loading ? '正在加载解析方式...' : '请选择解析方式'}</option>
                      {(parserPresets.data?.items || []).map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                    {selectedDoc2xParserPresetId && (
                      <span className="block text-[11px] text-zinc-400">
                        {(parserPresets.data?.items || []).find((preset) => preset.id === selectedDoc2xParserPresetId)?.description}
                      </span>
                    )}
                    {parserPresets.error && <span className="block text-[11px] text-red-500">解析方式加载失败：{parserPresets.error}</span>}
                  </label>

                  <input
                    type="file"
                    ref={doc2xPackageInputRef}
                    className="hidden"
                    accept="application/zip,.zip"
                    onChange={(e) => handleDoc2xPackageSelection('full_or_questions', e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => doc2xPackageInputRef.current?.click()}
                    className="flex min-h-[120px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 bg-white p-5 text-center transition-colors hover:bg-zinc-50/30 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/30"
                  >
                    <FileArchive className="mb-2 size-7 text-zinc-400 dark:text-zinc-500" />
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                      {doc2xPackageFile?.name || (doc2xPackageDocumentMode === 'single_document'
                        ? '选择包含题干、答案和解析的 Doc2X ZIP'
                        : '选择题目 Doc2X ZIP')}
                    </span>
                    <span className="mt-1 text-[11px] text-zinc-400">导入现成识别结果，不会调用或消耗 OCR 模型</span>
                  </button>
                  {doc2xPackageDocumentMode === 'separated_documents' && (
                    <>
                      <input
                        type="file"
                        ref={doc2xSolutionPackageInputRef}
                        className="hidden"
                        accept="application/zip,.zip"
                        onChange={(e) => handleDoc2xPackageSelection('solutions', e.target.files)}
                      />
                      <button
                        type="button"
                        onClick={() => doc2xSolutionPackageInputRef.current?.click()}
                        className="flex min-h-[100px] w-full items-center gap-3 rounded-xl border-2 border-dashed border-zinc-200 bg-white p-5 text-left transition-colors hover:bg-zinc-50/30 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/30"
                      >
                        <FileCheck2 className="size-7 shrink-0 text-zinc-400 dark:text-zinc-500" />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-50">{doc2xSolutionPackageFile?.name || '选择答案解析 Doc2X ZIP'}</span>
                          <span className="mt-1 block text-[11px] text-zinc-400">与上方题目包按题号合并</span>
                        </span>
                      </button>
                    </>
                  )}
                  <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-[11px] leading-5 text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/20 dark:text-violet-200">
                    <div className="font-semibold">Doc2X 推荐导出设置</div>
                    <div>导出 Markdown · 公式符 \(…\) / \[…\] · 不退化公式 · 本地图片</div>
                    <div className="text-violet-700/80 dark:text-violet-300/80">ZIP 内应包含 1 个 .md 文件及其 images 图片目录；导入后会自动清理 Meanless 注释、归一化图片并生成候选题。</div>
                  </div>
                  {(doc2xPackageFile || doc2xSolutionPackageFile) && (
                    <div className="flex flex-wrap gap-3">
                      {doc2xPackageFile && (
                        <button
                          type="button"
                          onClick={() => {
                            setDoc2xPackageFile(null)
                            if (doc2xPackageInputRef.current) doc2xPackageInputRef.current.value = ''
                          }}
                          className="flex items-center gap-1 text-xs text-red-500 hover:underline"
                        >
                          <Trash2 className="size-3" /> 移除{doc2xPackageDocumentMode === 'single_document' ? '文档' : '题目包'}
                        </button>
                      )}
                      {doc2xSolutionPackageFile && (
                        <button
                          type="button"
                          onClick={() => {
                            setDoc2xSolutionPackageFile(null)
                            if (doc2xSolutionPackageInputRef.current) doc2xSolutionPackageInputRef.current.value = ''
                          }}
                          className="flex items-center gap-1 text-xs text-red-500 hover:underline"
                        >
                          <Trash2 className="size-3" /> 移除答案解析包
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    type="file"
                    ref={questionFileInputRef}
                    className="hidden"
                    accept="application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                    onChange={(e) => handleSeparatedFileSelection('questions', e.target.files)}
                  />
                  <input
                    type="file"
                    ref={solutionFileInputRef}
                    className="hidden"
                    accept="application/pdf,.pdf,image/png,image/jpeg,image/jpg"
                    onChange={(e) => handleSeparatedFileSelection('solutions', e.target.files)}
                  />

                  <button
                    type="button"
                    onClick={() => questionFileInputRef.current?.click()}
                    className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-left transition-colors hover:bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-955 dark:hover:bg-zinc-900/40"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                      <FileText className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">原卷文件</span>
                      <span className="block truncate text-[11px] text-zinc-400">{questionUploadFile?.name || '选择题干文档、学生版或原卷 PDF/图片'}</span>
                    </span>
                    {questionUploadFile && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          setQuestionUploadFile(null)
                          if (questionFileInputRef.current) questionFileInputRef.current.value = ''
                        }}
                        className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900"
                        title="清除原卷文件"
                      >
                        <Trash2 className="size-4" />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => solutionFileInputRef.current?.click()}
                    className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-left transition-colors hover:bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-955 dark:hover:bg-zinc-900/40"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                      <FileCheck2 className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">答案解析文件</span>
                      <span className="block truncate text-[11px] text-zinc-400">{solutionUploadFile?.name || '选择答案、详解或教师版 PDF/图片'}</span>
                    </span>
                    {solutionUploadFile && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSolutionUploadFile(null)
                          if (solutionFileInputRef.current) solutionFileInputRef.current.value = ''
                        }}
                        className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900"
                        title="清除答案解析文件"
                      >
                        <Trash2 className="size-4" />
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* 自动 OCR 选项 */}
              {uploadDocumentMode !== 'doc2x_package' && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/10 p-3.5 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-50">自动启动 OCR 识别</span>
                    <span className="block text-[11px] text-zinc-400">提交文件后立即通过 {currentOcrProviderLabel} 开始自动排队处理</span>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 cursor-pointer"
                    checked={autoOcr}
                    onChange={(e) => setAutoOcr(e.target.checked)}
                  />
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button
                  size="default"
                  disabled={uploading || (
                    uploadDocumentMode === 'single_document'
                      ? !pendingUploadFile
                      : uploadDocumentMode === 'doc2x_package'
                        ? !selectedDoc2xParserPresetId || !doc2xPackageFile || (doc2xPackageDocumentMode === 'separated_documents' && !doc2xSolutionPackageFile)
                        : !questionUploadFile || !solutionUploadFile
                  )}
                  onClick={handleSubmit}
                  className="w-full sm:w-auto"
                >
                  {uploading ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" />
                      正在提交...
                    </>
                  ) : (
                    '提交导入'
                  )}
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
