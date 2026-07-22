import { useState, useEffect, Fragment, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Play,
  LoaderCircle,
  Trash2,
  ChevronDown,
  ChevronRight,
  Edit2,
  FileText,
  FileCheck2,
  ArrowRight,
  RefreshCcw,
  Eye,
} from 'lucide-react'
import { importV2Api, type ImportV2ImportJob, type ImportV2ImportJobDetail, type PaperKind, type SourceMetadataDraft } from '@/api/importV2'
import { settingsApi } from '@/api/settings'
import { SearchableSelect } from '@/components/SearchableSelect'
import { PageTitle, Panel, Badge, Button } from '@/components/ui'
import { Modal } from '@/components/dialogs/Modal'
import { useAsync } from '@/hooks/useAsync'
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling'
import { cityOptionsForProvince, provinceOptions, yearOptionsFromServerYear } from '@/utils/metadataOptions'
import { candidateReviewPath, importJobDocumentPath, importJobPath, importJobQuestionsPath } from './importV2Routes'

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
const stageOptions = ['小学', '初中', '高中', '高一', '高二', '高三']

const gaokaoRegionOptions = [
  { value: '全国甲卷', label: '全国甲卷' },
  { value: '全国乙卷', label: '全国乙卷' },
  { value: '新课标I卷', label: '新课标I卷' },
  { value: '新课标II卷', label: '新课标II卷' },
  { value: '北京', label: '北京' },
  { value: '上海', label: '上海' },
  { value: '天津', label: '天津' },
]

function isGaokaoRegion(val?: string) {
  return gaokaoRegionOptions.some(item => item.value === val)
}

export default function ImportJobsListPage() {
  const navigate = useNavigate()
  const health = useAsync(() => settingsApi.getHealth(), [])
  const [jobs, setJobs] = useState<ImportV2ImportJobDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [paperKindFilter, setPaperKindFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')

  // 折叠状态，记录展开的 jobId
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set())

  // 编辑模态框状态
  const [editingJob, setEditingJob] = useState<ImportV2ImportJobDetail | null>(null)
  const [editForm, setEditForm] = useState<SourceMetadataDraft | null>(null)

  // 轮询状态：记录处于 ocr_running 状态的 jobId，用于页面轮询
  const [hasRunningOcr, setHasRunningOcr] = useState(false)
  const yearOptions = useMemo(() => yearOptionsFromServerYear(health.data?.serverYear), [health.data?.serverYear])
  const editCityOptions = useMemo(() => editForm ? cityOptionsForProvince(editForm.province) : [], [editForm?.province])
  const visibleEditCityOptions = editForm?.city && !editCityOptions.includes(editForm.city)
    ? [editForm.city, ...editCityOptions]
    : editCityOptions

  async function fetchJobs(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await importV2Api.listImportJobs()
      setJobs(res.items || [])

      // 检查是否有文档仍在进行 OCR 识别
      const running = (res.items || []).some(job =>
        job.documents.some(doc => ['uploaded', 'ocr_running'].includes(doc.sourceDocument.status))
      )
      setHasRunningOcr(running)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  useVisibilityAwarePolling(async (signal) => {
    const res = await importV2Api.listImportJobs()
    if (signal.aborted) return
    const items = res.items || []
    setJobs(items)
    setHasRunningOcr(items.some((job) =>
      job.documents.some((doc) => ['uploaded', 'ocr_running'].includes(doc.sourceDocument.status))
    ))
    setError('')
  }, {
    enabled: hasRunningOcr,
    intervalMs: 4_000,
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  })

  const stageFilterOptions = useMemo(() => {
    return Array.from(new Set([...stageOptions, ...jobs.map(job => job.importJob.stage).filter(Boolean)]))
  }, [jobs])

  const subjectFilterOptions = useMemo(() => {
    return Array.from(new Set([...subjectOptions, ...jobs.map(job => job.importJob.subject).filter(Boolean)]))
  }, [jobs])

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      if (stageFilter && job.importJob.stage !== stageFilter) return false
      if (subjectFilter && job.importJob.subject !== subjectFilter) return false
      if (paperKindFilter && job.importJob.paperKind !== paperKindFilter) return false
      if (regionFilter && getJobRegionText(job) !== regionFilter) return false
      if (yearFilter && String(job.importJob.examYear || '') !== yearFilter) return false
      return true
    })
  }, [jobs, paperKindFilter, regionFilter, stageFilter, subjectFilter, yearFilter])

  const regionFilterOptions = useMemo(() => {
    return Array.from(new Set(jobs.map(getJobRegionText).filter(Boolean)))
  }, [jobs])

  const yearFilterOptions = useMemo(() => {
    return Array.from(new Set(jobs.map(job => job.importJob.examYear).filter(Boolean).map(String))).sort((a, b) => Number(a) - Number(b))
  }, [jobs])

  const hasActiveFilters = Boolean(stageFilter || subjectFilter || paperKindFilter || regionFilter || yearFilter)

  function resetFilters() {
    setStageFilter('')
    setSubjectFilter('')
    setPaperKindFilter('')
    setRegionFilter('')
    setYearFilter('')
  }

  function toggleExpand(jobId: string) {
    setExpandedJobIds(prev => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  // 触发单文档/双文档 OCR 识别
  async function triggerOcr(job: ImportV2ImportJobDetail) {
    setError('')
    setNotice('')
    try {
      if (job.importJob.mode === 'single_document') {
        const doc = job.documents[0]
        if (doc) {
          await importV2Api.startSourceDocumentOcr(doc.sourceDocumentId)
          setNotice(`已成功启动单文档 OCR 任务。`)
        }
      } else {
        const questionDoc = job.documents.find(d => d.role === 'questions')
        const solutionDoc = job.documents.find(d => d.role === 'solutions')

        const promises = []
        if (questionDoc) promises.push(importV2Api.startSourceDocumentOcr(questionDoc.sourceDocumentId))
        if (solutionDoc) promises.push(importV2Api.startSourceDocumentOcr(solutionDoc.sourceDocumentId))

        await Promise.all(promises)
        setNotice(`已成功并行启动原卷与解析双文档 OCR 任务。`)
      }
      fetchJobs(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // 打开编辑批次模态框
  function openEditModal(job: ImportV2ImportJobDetail) {
    setEditingJob(job)
    setEditForm({
      paperTitle: job.importJob.paperTitle || job.importJob.title || '',
      batchName: job.importJob.batchName || '',
      stage: job.importJob.stage || '高中',
      subject: job.importJob.subject || '数学',
      province: job.importJob.province || '',
      city: job.importJob.city || '',
      paperKind: job.importJob.paperKind || 'unknown',
      examYear: job.importJob.examYear ? String(job.importJob.examYear) : '',
      sourceOrg: job.importJob.sourceOrg || '',
      hasWatermark: false,
      watermarkTerms: '',
    })
  }

  // 保存编辑批次信息
  async function handleSaveEdit() {
    if (!editingJob || !editForm) return
    setError('')
    try {
      await importV2Api.updateImportJob(editingJob.importJob.id, {
        title: editForm.paperTitle,
        paperTitle: editForm.paperTitle,
        batchName: editForm.batchName,
        stage: editForm.stage,
        subject: editForm.subject,
        province: editForm.province,
        city: editForm.city,
        paperKind: editForm.paperKind,
        examYear: Number(editForm.examYear) || 0,
        sourceOrg: editForm.sourceOrg,
      } as any)
      setNotice('更新试卷批次信息成功，数据已同步至各个文档及候选题目。')
      setEditingJob(null)
      setEditForm(null)
      fetchJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // 删除批次
  async function handleDeleteJob(jobId: string) {
    const ok = window.confirm('删除此导入批次将永久清理该批次下的所有关联文档、OCR Markdown/分析结果、未确认入库的候选题目以及相关的磁盘缓存文件，该操作不可恢复！\n\n确定要删除吗？')
    if (!ok) return
    setError('')
    setNotice('')
    try {
      await importV2Api.deleteImportJob(jobId)
      setNotice('成功删除试卷批次及关联的所有数据文件。')
      fetchJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function getJobRegionText(job: ImportV2ImportJobDetail) {
    return [job.importJob.province, job.importJob.city].filter(Boolean).join(' · ')
  }

  function getJobProgressText(job: ImportV2ImportJobDetail) {
    const candidateCount = job.stats.candidateCount || 0
    if (candidateCount <= 0) return ''
    return `${job.stats.committedCandidateCount || 0} / ${candidateCount} 题`
  }

  function getJobStatusCapsule(job: ImportV2ImportJobDetail) {
    const totalDocs = job.documents.length
    const runningDocs = job.documents.filter(d => d.sourceDocument.status === 'ocr_running').length
    const failedDocs = job.documents.filter(d => d.sourceDocument.status === 'ocr_failed').length
    const uploadedDocs = job.documents.filter(d => d.sourceDocument.status === 'uploaded').length
    const progressText = getJobProgressText(job)

    // 如果有在运行的
    if (runningDocs > 0) {
      return <Badge variant="warning">识别中 ({runningDocs}/{totalDocs})</Badge>
    }
    // 等待启动的
    if (uploadedDocs > 0) {
      return <Badge variant="outline">等待识别</Badge>
    }
    // 如果失败的
    if (failedDocs > 0 && failedDocs === totalDocs) {
      return <Badge variant="danger">识别失败</Badge>
    } else if (failedDocs > 0) {
      return <Badge variant="danger">部分识别失败</Badge>
    }

    const { stats } = job
    const candidateCount = stats.candidateCount || 0
    const committedCount = stats.committedCandidateCount || 0

    if (candidateCount > 0) {
      if (committedCount === candidateCount) {
        return <Badge variant="success">已全部入库 · {candidateCount} 题</Badge>
      }
      if (committedCount > 0) {
        return <Badge variant="warning">部分入库 · {progressText}</Badge>
      }
      return <Badge variant="outline">待核对 · {progressText}</Badge>
    }

    // 判断第一个文档的状态
    const firstStatus = job.documents[0]?.sourceDocument.status
    if (firstStatus === 'ocr_succeeded') {
      return <Badge variant="outline">已识别，待解析</Badge>
    }

    return <Badge variant="outline">等待识别</Badge>
  }

  function getReviewSourceDocumentId(job: ImportV2ImportJobDetail) {
    const reviewDocument = job.documents.find(d => d.role === 'questions')
      || job.documents.find(d => d.role === 'full')
      || job.documents[0]
    return reviewDocument?.sourceDocumentId || ''
  }

  function getReviewUrl(job: ImportV2ImportJobDetail) {
    const sourceDocumentId = getReviewSourceDocumentId(job)
    if (!sourceDocumentId) return importJobPath(job.importJob.id)
    return candidateReviewPath(importJobDocumentPath(job.importJob.id, sourceDocumentId))
  }

  function getDocStatusBadge(status: string) {
    switch (status) {
      case 'uploaded':
        return <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">等待识别</span>
      case 'ocr_running':
        return (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900/30 dark:bg-amber-955/20 dark:text-amber-400">
            <LoaderCircle className="size-3 animate-spin" />
            识别中
          </span>
        )
      case 'ocr_succeeded':
      case 'parsed':
      case 'partially_parsed':
        return <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">识别完成</span>
      case 'ocr_failed':
        return <span className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">识别失败</span>
      default:
        return <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">{status}</span>
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageTitle
          title="资料导入中心"
          desc="管理所有已导入的试卷批次，配置元数据、运行识别并核对题目入库。"
          path="/tools/import"
        />
        <div className="flex gap-2">
          <Button icon={Plus} onClick={() => navigate('/tools/import/upload')}>
            新建导入
          </Button>
          <Button variant="outline" icon={RefreshCcw} onClick={() => fetchJobs()}>
            刷新
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-4 py-2.5 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 flex items-center gap-2 shadow-sm animate-in fade-in duration-200">
          <Badge variant="success" className="h-4 px-1 rounded">成功</Badge>
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/20 px-4 py-2.5 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-955/10 dark:text-red-400 flex items-center gap-2 shadow-sm animate-in fade-in duration-200">
          <Badge variant="danger" className="h-4 px-1 rounded">错误</Badge>
          <span>{error}</span>
        </div>
      )}

      <Panel title="导入批次列表">
        {loading && jobs.length === 0 ? (
          <div className="flex h-36 items-center justify-center">
            <LoaderCircle className="size-6 animate-spin text-zinc-400" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/10">
            <FileText className="size-8 text-zinc-300 dark:text-zinc-700 mb-3" />
            <p className="text-xs text-zinc-400 dark:text-zinc-500">暂无导入批次，请点击右上方“新建导入”上传文件</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-800 dark:bg-zinc-900/20 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[760px] lg:grid-cols-5">
                <select
                  className="h-9 min-w-0 rounded-md border border-zinc-200 bg-background px-3 text-xs outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={stageFilter}
                  onChange={(event) => setStageFilter(event.target.value)}
                >
                  <option value="">全部学段</option>
                  {stageFilterOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                <select
                  className="h-9 min-w-0 rounded-md border border-zinc-200 bg-background px-3 text-xs outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={subjectFilter}
                  onChange={(event) => setSubjectFilter(event.target.value)}
                >
                  <option value="">全部科目</option>
                  {subjectFilterOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                <select
                  className="h-9 min-w-0 rounded-md border border-zinc-200 bg-background px-3 text-xs outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={paperKindFilter}
                  onChange={(event) => setPaperKindFilter(event.target.value)}
                >
                  <option value="">全部类型</option>
                  {paperKindOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select
                  className="h-9 min-w-0 rounded-md border border-zinc-200 bg-background px-3 text-xs outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={regionFilter}
                  onChange={(event) => setRegionFilter(event.target.value)}
                >
                  <option value="">全部地区</option>
                  {regionFilterOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                <select
                  className="h-9 min-w-0 rounded-md border border-zinc-200 bg-background px-3 text-xs outline-none transition-all focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800"
                  value={yearFilter}
                  onChange={(event) => setYearFilter(event.target.value)}
                >
                  <option value="">全部年份</option>
                  {yearFilterOptions.map(option => <option key={option} value={option}>{option}年</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>显示 {filteredJobs.length} / {jobs.length} 个批次</span>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                  >
                    重置筛选
                  </button>
                ) : null}
              </div>
            </div>
            {filteredJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/10 p-10 dark:border-zinc-800">
                <FileText className="mb-3 size-8 text-zinc-300 dark:text-zinc-700" />
                <p className="text-xs text-zinc-400 dark:text-zinc-500">没有匹配当前筛选条件的导入批次</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/70 dark:bg-zinc-900/40 text-[11px] font-semibold text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 select-none">
                      <th className="py-2.5 px-3 w-8"></th>
                      <th className="py-2.5 px-3">试卷批次名称</th>
                      <th className="py-2.5 px-3 w-40">创建时间</th>
                      <th className="py-2.5 px-3 w-28">模式</th>
                      <th className="py-2.5 px-3 w-40">学段/科目/类型</th>
                      <th className="py-2.5 px-3 w-40">地区/年份</th>
                      <th className="py-2.5 px-3 w-40">状态</th>
                      <th className="py-2.5 px-3 text-right pr-4">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((job) => {
                  const isExpanded = expandedJobIds.has(job.importJob.id)
                  const isSeparated = job.importJob.mode === 'separated_documents'
                  const ocrPending = job.documents.some(d => ['uploaded', 'ocr_failed'].includes(d.sourceDocument.status))
                  const ocrRunning = job.documents.some(d => d.sourceDocument.status === 'ocr_running')

                  return (
                    <Fragment key={job.importJob.id}>
                      <tr className="border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors text-xs">
                        <td className="py-3 px-3">
                          {isSeparated ? (
                            <button
                              onClick={() => toggleExpand(job.importJob.id)}
                              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors text-zinc-500 dark:text-zinc-400 cursor-pointer"
                              title={isExpanded ? '折叠文档' : '展开文档'}
                            >
                              {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                            </button>
                          ) : null}
                        </td>
                        <td className="py-3 px-3 font-medium text-zinc-900 dark:text-zinc-50">
                          <div>{job.importJob.paperTitle || job.importJob.title}</div>
                        </td>
                        <td className="py-3 px-3 text-zinc-500 dark:text-zinc-400">
                          {new Date(job.importJob.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-3">
                          {isSeparated ? (
                            <span className="text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-955/20 dark:text-amber-400 px-1.5 py-0.5 rounded text-[10px] font-semibold">双文档题解分离</span>
                          ) : (
                            <span className="text-zinc-600 bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 px-1.5 py-0.5 rounded text-[10px]">单文档</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-zinc-500 dark:text-zinc-400">
                          {job.importJob.stage} / {job.importJob.subject} / {paperKindOptions.find(o => o.value === job.importJob.paperKind)?.label || '未定义'}
                        </td>
                        <td className="py-3 px-3 text-zinc-500 dark:text-zinc-400">
                          {[getJobRegionText(job), job.importJob.examYear ? `${job.importJob.examYear}年` : ''].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="py-3 px-3">
                          {getJobStatusCapsule(job)}
                        </td>
                        <td className="py-3 px-3 text-right pr-4 space-x-1 whitespace-nowrap">
                          {ocrPending && !ocrRunning && (
                            <Button
                              size="xs"
                              variant="outline"
                              icon={Play}
                              onClick={() => triggerOcr(job)}
                              title="触发此批次下的所有文档进行 OCR 识别"
                            >
                              OCR识别
                            </Button>
                          )}
                          <button
                            onClick={() => openEditModal(job)}
                            className="inline-flex items-center justify-center p-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-md text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 cursor-pointer"
                            title="修改批次属性信息"
                          >
                            <Edit2 className="size-3.5" />
                          </button>
                          {job.stats.candidateCount > 0 && job.stats.committedCandidateCount === job.stats.candidateCount ? (
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => navigate(importJobQuestionsPath(job.importJob.id))}
                              icon={Eye}
                              className="text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                            >
                              查看入库
                            </Button>
                          ) : (
                            <Button
                              size="xs"
                              onClick={() => navigate(getReviewUrl(job))}
                              icon={ArrowRight}
                            >
                              核对入库
                            </Button>
                          )}
                          <button
                            onClick={() => handleDeleteJob(job.importJob.id)}
                            className="inline-flex items-center justify-center p-1.5 border border-red-200 bg-red-55/20 text-red-750 hover:bg-red-50 rounded-md dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/30 cursor-pointer"
                            title="删除批次及其关联的所有底层文档和候选试题"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>

                      {/* 展开双文档面板 */}
                      {isSeparated && (
                        <tr className="bg-zinc-50/20 dark:bg-zinc-900/10">
                          <td colSpan={8} className={`p-0 transition-all duration-300 ${isExpanded ? 'border-b border-zinc-100 dark:border-zinc-900' : 'border-transparent'}`}>
                            <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                              <div className="overflow-hidden">
                                <div className="pl-10 pr-6 py-2.5 space-y-3">
                                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-955 p-3 space-y-3">
                                    <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider select-none border-b border-zinc-100 dark:border-zinc-900 pb-1.5 flex items-center justify-between">
                                      <span>关联的物理文档清单</span>
                                      {ocrRunning && (
                                        <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                          <LoaderCircle className="size-3 animate-spin" />
                                          后台识别引擎运行中，请静候...
                                        </span>
                                      )}
                                    </div>
                                    <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                                      {job.documents.map((doc) => {
                                        const isQuestionRole = doc.role === 'questions'

                                        return (
                                          <div key={doc.id} className="py-2.5 flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                              <span className={`flex size-6 shrink-0 items-center justify-center rounded ${isQuestionRole ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-955/20 dark:text-amber-400'}`}>
                                                {isQuestionRole ? <FileText className="size-3.5" /> : <FileCheck2 className="size-3.5" />}
                                              </span>
                                              <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                                                    {isQuestionRole ? '原卷题干' : '答案解析'}
                                                  </span>
                                                  <span className="text-[10px] text-zinc-400 truncate">
                                                    ({doc.sourceDocument.originalFileName})
                                                  </span>
                                                </div>
                                                <div className="text-[10px] text-zinc-400 mt-0.5">
                                                  页数: {doc.sourceDocument.pageCount || '—'} 页 · 大小: {(doc.sourceDocument.metadata?.fileSize as number ? `${((doc.sourceDocument.metadata.fileSize as number) / 1024 / 1024).toFixed(2)} MB` : '未知')}
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                              {getDocStatusBadge(doc.sourceDocument.status)}
                                              {doc.sourceDocument.status === 'ocr_failed' && (
                                                <Button
                                                  size="xs"
                                                  variant="outline"
                                                  onClick={() => importV2Api.startSourceDocumentOcr(doc.sourceDocumentId).then(() => fetchJobs(true))}
                                                  icon={Play}
                                                >
                                                  单文档重试
                                                </Button>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* 修改属性模态框 */}
      {editingJob && editForm && (() => {
        const updateEditForm = (fields: Partial<SourceMetadataDraft>) => setEditForm(prev => prev ? { ...prev, ...fields } : null)

        return (
          <Modal
            title="修改试卷批次属性"
            desc={`修改此批次会将属性同步写入底下的所有关联文档以及所有的待确认题目记录中。`}
            onClose={() => { setEditingJob(null); setEditForm(null) }}
          >
            <div className="space-y-4 py-2">
              <div className="space-y-4">
                {/* 第一部分：基本档案 */}
                <div className="space-y-3">
                  <label className="space-y-1.5 block">
                    <span className="text-[13px] font-medium text-zinc-500">试卷标题</span>
                    <input
                      className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                      value={editForm.paperTitle}
                      onChange={(e) => updateEditForm({ paperTitle: e.target.value })}
                    />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[13px] font-medium text-zinc-500">批次名称</span>
                    <input
                      className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                      value={editForm.batchName}
                      onChange={(e) => updateEditForm({ batchName: e.target.value })}
                    />
                  </label>
                </div>

                {/* 第二部分：分类属性 */}
                <div className="p-3.5 bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-150 dark:border-zinc-800 rounded-xl">
                  <div className="mb-2.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                    分类与年份信息
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1.5 block">
                      <span className="text-[13px] font-medium text-zinc-500">学段/年级</span>
                      <SearchableSelect
                        value={editForm.stage}
                        options={stageOptions.includes(editForm.stage) ? stageOptions : [editForm.stage, ...stageOptions]}
                        onChange={(stage) => updateEditForm({ stage })}
                        placeholder="请选择学段"
                        searchPlaceholder="搜索学段"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-[13px] font-medium text-zinc-500">学科</span>
                      <select
                        className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                        value={editForm.subject}
                        onChange={(e) => updateEditForm({ subject: e.target.value })}
                      >
                        {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-[13px] font-medium text-zinc-500">资料类型</span>
                      <select
                        className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                        value={editForm.paperKind}
                        onChange={(e) => {
                          const paperKind = e.target.value as PaperKind
                          if (paperKind === 'gaokao_real') {
                            updateEditForm({ paperKind, province: isGaokaoRegion(editForm.province) ? editForm.province : '', city: '', sourceOrg: '' })
                          } else {
                            updateEditForm({ paperKind })
                          }
                        }}
                      >
                        {paperKindOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-[13px] font-medium text-zinc-500">年份</span>
                      <SearchableSelect
                        value={String(editForm.examYear)}
                        options={yearOptions.includes(String(editForm.examYear)) ? yearOptions : [String(editForm.examYear), ...yearOptions].filter(Boolean)}
                        onChange={(examYear) => updateEditForm({ examYear })}
                        placeholder="请选择年份"
                        searchPlaceholder="搜索年份"
                      />
                    </label>
                  </div>
                </div>

                {/* 第三部分：归属来源 */}
                <div className="p-3.5 bg-zinc-50/50 dark:bg-zinc-900/20 border border-zinc-150 dark:border-zinc-800 rounded-xl">
                  <div className="mb-2.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                    归属与来源机构
                  </div>
                  {editForm.paperKind === 'gaokao_real' ? (
                    <label className="space-y-1.5 block">
                      <span className="text-[13px] font-medium text-zinc-500">试卷适用地区</span>
                      <SearchableSelect
                        value={isGaokaoRegion(editForm.province) ? editForm.province : ''}
                        options={gaokaoRegionOptions.map((item) => item.value)}
                        onChange={(province) => updateEditForm({ province, city: '', sourceOrg: '' })}
                        placeholder="请选择全国卷或直辖市"
                        searchPlaceholder="搜索全国卷或地区"
                        allowClear
                      />
                    </label>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1.5 block">
                          <span className="text-[13px] font-medium text-zinc-500">省份</span>
                          <SearchableSelect
                            value={editForm.province}
                            options={provinceOptions}
                            onChange={(province) => updateEditForm({ province, city: cityOptionsForProvince(province).includes(editForm.city) ? editForm.city : '' })}
                            placeholder="请选择省份"
                            searchPlaceholder="搜索省份"
                            allowClear
                          />
                        </label>
                        <label className="space-y-1.5 block">
                          <span className="text-[13px] font-medium text-zinc-500">城市</span>
                          <SearchableSelect
                            value={editForm.city}
                            options={visibleEditCityOptions}
                            onChange={(city) => updateEditForm({ city })}
                            placeholder={editForm.province ? '请选择城市' : '可先选择省份'}
                            searchPlaceholder="搜索城市"
                            allowClear
                          />
                        </label>
                      </div>
                      <label className="space-y-1.5 block">
                        <span className="text-[13px] font-medium text-zinc-500">来源机构</span>
                        <input
                          className="h-9 w-full rounded-md border border-zinc-200 bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-zinc-955 dark:border-zinc-800 transition-all"
                          value={editForm.sourceOrg}
                          onChange={(e) => updateEditForm({ sourceOrg: e.target.value })}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-zinc-100 dark:border-zinc-900 mt-4">
                <Button variant="outline" onClick={() => { setEditingJob(null); setEditForm(null) }}>
                  取消
                </Button>
                <Button onClick={handleSaveEdit}>
                  保存修改
                </Button>
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
