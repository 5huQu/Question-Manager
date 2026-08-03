import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { importV2Api, type ImportParserPreset, type PaperKind, type SourceMetadataDraft } from '@/api/importV2'
import { settingsApi } from '@/api/settings'
import { useAsync } from '@/hooks/useAsync'
import { cityOptionsForProvince, provinceForCity, yearOptionsFromServerYear } from '@/utils/metadataOptions'
import { ensureStageValue, gradeOptionsForTeachingStages } from '@/utils/stages'
import { unsupportedImportReason } from '@/utils/importFiles'
import { importJobDocumentPath } from '../importV2Routes'
import { type UploadDocumentMode, type Doc2xPackageDocumentMode, isGaokaoRegion, initialMetadata, subjectOptions } from './constants'

function baseNameFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/i, '')
}

export function useImportUpload() {
  const navigate = useNavigate()

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

  function handleUploadFileSelection(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    const unsupportedReason = unsupportedImportReason(file.name, { allowJson: true })
    if (unsupportedReason) {
      setPendingUploadFile(null)
      setError(unsupportedReason)
      setNotice('')
      return
    }
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
    const unsupportedReason = unsupportedImportReason(file.name)
    if (unsupportedReason) {
      if (role === 'questions') setQuestionUploadFile(null)
      else setSolutionUploadFile(null)
      setError(unsupportedReason)
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
        navigate(importJobDocumentPath(jobRes.importJob.id, questionImported.sourceDocument.id))
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
          navigate(importJobDocumentPath(jobRes.importJob.id, res.sourceDocument.id))
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
          navigate(importJobDocumentPath(jobRes.importJob.id, questionRes.sourceDocument.id))
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

  return {
    navigate,
    // metadata state
    metadataDraft,
    setMetadataDraft,
    // mode state
    uploadDocumentMode,
    setUploadDocumentMode,
    // single document
    pendingUploadFile,
    setPendingUploadFile,
    fileInputRef,
    dragOver,
    setDragOver,
    handleUploadFileSelection,
    // doc2x package
    doc2xPackageDocumentMode,
    setDoc2xPackageDocumentMode,
    doc2xPackageFile,
    setDoc2xPackageFile,
    doc2xSolutionPackageFile,
    setDoc2xSolutionPackageFile,
    selectedDoc2xParserPresetId,
    setSelectedDoc2xParserPresetId,
    doc2xPackageInputRef,
    doc2xSolutionPackageInputRef,
    handleDoc2xPackageSelection,
    parserPresets,
    // separated documents
    questionUploadFile,
    setQuestionUploadFile,
    solutionUploadFile,
    setSolutionUploadFile,
    questionFileInputRef,
    solutionFileInputRef,
    handleSeparatedFileSelection,
    // ocr & submit
    autoOcr,
    setAutoOcr,
    uploading,
    handleSubmit,
    currentOcrProviderLabel,
    // feedback
    error,
    notice,
    // derived metadata options
    yearOptions,
    stageOptions,
    selectedStage,
    metadataSubject,
    visibleSubjectOptions,
    visibleCityOptions,
  }
}

export type ImportUploadState = ReturnType<typeof useImportUpload>
