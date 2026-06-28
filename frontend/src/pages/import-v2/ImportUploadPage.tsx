import { useState, useRef, useEffect } from 'react'
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
} from 'lucide-react'
import { importV2Api, type PaperKind, type SourceMetadataDraft } from '@/api/importV2'
import { settingsApi } from '@/api/settings'
import { PageTitle, Panel, Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { ensureStageValue, gradeOptionsForTeachingStages } from '@/utils/stages'

type UploadDocumentMode = 'single_document' | 'separated_documents'

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
  const [questionUploadFile, setQuestionUploadFile] = useState<File | null>(null)
  const [solutionUploadFile, setSolutionUploadFile] = useState<File | null>(null)

  const [autoOcr, setAutoOcr] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const questionFileInputRef = useRef<HTMLInputElement>(null)
  const solutionFileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const ocrSettings = useAsync(() => settingsApi.getOcrSettings(), [])
  const currentOcrProvider = ocrSettings.data?.ocrProvider === 'glm' ? 'glm' : 'doc2x'
  const currentOcrProviderLabel = currentOcrProvider === 'glm' ? 'GLM-OCR' : 'Doc2X'
  const configuredStageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const stageOptions = metadataDraft.stage && !configuredStageOptions.includes(metadataDraft.stage)
    ? [metadataDraft.stage, ...configuredStageOptions]
    : configuredStageOptions
  const selectedStage = ensureStageValue(metadataDraft.stage, stageOptions)
  const metadataSubject = metadataDraft.subject || '数学'
  const visibleSubjectOptions = subjectOptions.includes(metadataSubject) ? subjectOptions : [metadataSubject, ...subjectOptions]

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

    if (uploadDocumentMode === 'single_document') {
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
          navigate(`/tools/import/jobs/${jobRes.importJob.id}`)
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
          navigate(`/tools/import/jobs/${jobRes.importJob.id}`)
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
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" icon={ChevronLeft} onClick={() => navigate('/tools/import')}>
          返回列表
        </Button>
        <PageTitle
          title="资料导入"
          desc="上传单文档或题解分离的双文档进行识别入库。"
          path="/tools/import/upload"
        />
      </div>

      {notice && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-4 py-2.5 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center gap-2 shadow-sm">
          <Check className="size-3.5 text-zinc-900 dark:text-zinc-50" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/20 px-4 py-2.5 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-950/10 dark:text-red-400 flex items-center gap-2 shadow-sm">
          <AlertTriangle className="size-3.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* 左侧元数据配置 */}
        <div className="md:col-span-6">
          <Panel title="试卷信息与元数据">
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
                  <select
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                    value={selectedStage}
                    onChange={(e) => setMetadataDraft((d) => ({ ...d, stage: e.target.value }))}
                  >
                    {stageOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
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
                  <input
                    type="number"
                    className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                    value={metadataDraft.examYear}
                    onChange={(e) => setMetadataDraft((d) => ({ ...d, examYear: e.target.value }))}
                  />
                </label>

                {metadataDraft.paperKind === 'gaokao_real' ? (
                  <label className="col-span-2 space-y-1.5">
                    <span className="text-[13px] font-medium text-zinc-500">试卷适用地区</span>
                    <select
                      className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                      value={isGaokaoRegion(metadataDraft.province) ? metadataDraft.province : ''}
                      onChange={(e) => setMetadataDraft((d) => ({ ...d, province: e.target.value, city: '', sourceOrg: '' }))}
                    >
                      <option value="">请选择全国卷或直辖市</option>
                      {gaokaoRegionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
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
                      <input
                        className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                        value={metadataDraft.province}
                        onChange={(e) => setMetadataDraft((d) => ({ ...d, province: e.target.value }))}
                        placeholder="例如：安徽"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[13px] font-medium text-zinc-500">城市</span>
                      <input
                        className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-800"
                        value={metadataDraft.city}
                        onChange={(e) => setMetadataDraft((d) => ({ ...d, city: e.target.value }))}
                        placeholder="例如：合肥"
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

              <div className="pt-2 flex justify-end">
                <Button
                  size="default"
                  disabled={uploading || (uploadDocumentMode === 'single_document' ? !pendingUploadFile : !questionUploadFile || !solutionUploadFile)}
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
