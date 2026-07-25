import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { BookOpen, Check, Copy, Crop, FileText, Image, Info as InfoIcon, LoaderCircle, RefreshCcw, Sparkles, X } from 'lucide-react'
import { questionBankApi, type AiCleanMode, type AiCleanPreview } from '@/api/questionBank'
import { ApiError } from '@/api/client'
import { learningTagsApi } from '@/api/learningTags'
import { settingsApi } from '@/api/settings'
import { MarkdownContent } from '@/components/MarkdownContent'
import { Modal } from '@/components/dialogs/Modal'
import { Badge, Button } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { useQuestionEditorDraft } from '@/hooks/useQuestionEditorDraft'
import type { OcrSettings, QuestionItem, TagLibraries } from '@/types'
import type { QuestionContentDraft } from '@/types/questionContent'
import { QuestionContentEditor, type QuestionEditorConflict } from '@/components/questions/editor'
import { FigureGallery, QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { assetUrl, difficultyBadgeVariant, difficultyLabel10, difficultyLabelFromScore10, figuresByUsage } from '@/utils/questionDisplay'
import { draftAnalysisText, draftAnswerText, draftProblemText, paragraphBlocksFromText } from '@/utils/jsonCleanup'
import { gradeOptionsForTeachingStages } from '@/utils/stages'
import {
  analysisCopyGroupCount,
  splitIntoBalancedGroups,
  editableJsonFromDraft,
  draftPatchFromJsonText,
  copyImageToClipboard,
  copySegmentGroupToClipboard,
  aiPrompt,
} from './utils'
import { LabeledInput, LabeledSelect, LabeledTextarea, MultiTagSelector } from './form-fields'
import { AiCleanPreviewPanel } from './ai-clean-panel'

export { analysisCopyGroupCount } from './utils'

export function EditDialog({ draft, setDraft, onClose, onSave, onManageFigures, entityType = 'question' }: { draft: Partial<QuestionItem>; setDraft: Dispatch<SetStateAction<Partial<QuestionItem>>>; onClose: () => void; onSave: (nextDraft?: Partial<QuestionItem>) => Promise<void>; onManageFigures?: () => void; entityType?: string }) {
  const [mode, setMode] = useState<'form' | 'metadata' | 'json'>('form')
  const [aiOpen, setAiOpen] = useState(false)
	  const [jsonInput, setJsonInput] = useState(() => {
	    return JSON.stringify({
	      problem_text: draftProblemText(draft),
	      answer: draftAnswerText(draft),
	      analysis: draftAnalysisText(draft),
	      stage: draft.stage || '',
	      question_type: draft.questionType || '',
	      knowledge_points: draft.knowledgePoints || [],
	      solution_methods: draft.solutionMethods || [],
	      difficulty_score_10: draft.difficultyScore10 || '',
      difficulty_label: draft.difficultyLabel || '',
    }, null, 2)
  })
  const [jsonStatus, setJsonStatus] = useState('')
  const [jsonSaveReady, setJsonSaveReady] = useState(false)
  const jsonSaveReadyRef = useRef(false)
  const cleanedJsonDraftRef = useRef<Partial<QuestionItem> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [aiCleanMode, setAiCleanMode] = useState<AiCleanMode>('full')
  const [aiCleanLoading, setAiCleanLoading] = useState(false)
  const [aiCleanPreview, setAiCleanPreview] = useState<AiCleanPreview | null>(null)
  const [aiCleanStatus, setAiCleanStatus] = useState('')
  const [editorConflict, setEditorConflict] = useState<QuestionEditorConflict | null>(null)
  const initialContent = useMemo<QuestionContentDraft>(() => ({
    stemMarkdown: draftProblemText(draft),
    answerText: draftAnswerText(draft),
    analysisMarkdown: draftAnalysisText(draft),
  }), [draft.id, draft.contentRevision])
  const contentDraft = useQuestionEditorDraft({
    entityType,
    entityId: String(draft.id || 'new'),
    initialValue: initialContent,
    contentRevision: draft.contentRevision,
  })

  useEffect(() => {
    if (!contentDraft.hasRecoveredDraft) return
    setDraft((current) => ({
      ...current,
      ...contentDraft.value,
      problemBlocks: paragraphBlocksFromText(contentDraft.value.stemMarkdown),
      answerBlocks: paragraphBlocksFromText(contentDraft.value.answerText),
      analysisBlocks: paragraphBlocksFromText(contentDraft.value.analysisMarkdown),
    }))
  }, [contentDraft.hasRecoveredDraft])

	  useEffect(() => {
	    if (mode === 'form' || mode === 'metadata') {
	      setJsonInput(JSON.stringify({
	        problem_text: draftProblemText(draft),
	        answer: draftAnswerText(draft),
	        analysis: draftAnalysisText(draft),
	        stage: draft.stage || '',
	        question_type: draft.questionType || '',
	        knowledge_points: draft.knowledgePoints || [],
	        solution_methods: draft.solutionMethods || [],
	        difficulty_score_10: draft.difficultyScore10 || '',
        difficulty_label: draft.difficultyLabel || '',
      }, null, 2))
    }
  }, [draft, mode])

  const tagLibraries = useAsync<TagLibraries>(() => learningTagsApi.getQuestionBankTagLibraries(), [])
  const ocrSettings = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const configuredStageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const metadataStageOptions = draft.stage && !configuredStageOptions.includes(draft.stage)
    ? [...configuredStageOptions, draft.stage]
    : configuredStageOptions
  const imageUrl = draft.sliceImagePath ? assetUrl(String(draft.sliceImagePath)) : ''
  const segmentImages = draft.ocrSegmentImages ?? []
  const groupedSegmentImages = useMemo(() => {
    const byKind = {
      problem: segmentImages.filter((segment) => segment.kind === 'problem'),
      answer: segmentImages.filter((segment) => segment.kind === 'answer'),
      analysis: segmentImages.filter((segment) => segment.kind === 'analysis'),
    }
    const groups: Array<{ label: string; segments: typeof segmentImages }> = []
    if (byKind.problem.length) groups.push({ label: '题干图', segments: byKind.problem })
    if (byKind.answer.length) groups.push({ label: '答案图', segments: byKind.answer })
    const analysisGroups = splitIntoBalancedGroups(byKind.analysis, analysisCopyGroupCount(byKind.analysis.length))
    analysisGroups.forEach((segments, index) => {
      groups.push({ label: analysisGroups.length > 1 ? `解析图 ${index + 1}` : '解析图', segments })
    })
    return groups
  }, [segmentImages])

  function updateDraft(patch: Partial<QuestionItem>) {
    setDraft((current) => ({ ...current, ...patch }))
    if (patch.stemMarkdown !== undefined || patch.answerText !== undefined || patch.analysisMarkdown !== undefined) {
      contentDraft.setValue((current) => ({
        stemMarkdown: patch.stemMarkdown ?? current.stemMarkdown,
        answerText: patch.answerText ?? current.answerText,
        analysisMarkdown: patch.analysisMarkdown ?? current.analysisMarkdown,
      }))
    }
  }

  function contentPatch(value: QuestionContentDraft): Partial<QuestionItem> {
    return {
      ...value,
      problemBlocks: paragraphBlocksFromText(value.stemMarkdown),
      answerBlocks: paragraphBlocksFromText(value.answerText),
      analysisBlocks: paragraphBlocksFromText(value.analysisMarkdown),
    }
  }

  async function persist(nextDraft: Partial<QuestionItem>) {
    setEditorConflict(null)
    try {
      await onSave(nextDraft)
      contentDraft.markSaved({
        stemMarkdown: draftProblemText(nextDraft),
        answerText: draftAnswerText(nextDraft),
        analysisMarkdown: draftAnalysisText(nextDraft),
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setEditorConflict({
          message: String(error.payload.message || '题目已被其他操作修改，请核对服务器上的最新内容后再保存。'),
          actualContentRevision: typeof error.payload.actualContentRevision === 'number' ? error.payload.actualContentRevision : undefined,
        })
      }
      throw error
    }
  }

  async function saveContent(value: QuestionContentDraft) {
    setSaving(true)
    setSaveStatus('')
    const nextDraft = { ...draft, ...contentPatch(value) }
    setDraft(nextDraft)
    try {
      await persist(nextDraft)
    } finally {
      setSaving(false)
    }
  }

  function setJsonCleanState(ready: boolean, nextDraft: Partial<QuestionItem> | null = null) {
    jsonSaveReadyRef.current = ready
    cleanedJsonDraftRef.current = nextDraft
    setJsonSaveReady(ready)
  }

  function applyJsonText(value: string) {
    setJsonInput(value)
    setSaveStatus('')
    setJsonCleanState(false)
    if (!value.trim()) {
      setJsonStatus('')
      return
    }
    try {
      const { next, status } = draftPatchFromJsonText(value)
      if (!Object.keys(next).length) {
        setJsonStatus(status)
        return
      }
      updateDraft(next)
      setJsonStatus(status)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setJsonStatus(`JSON 仍需修正：${message}`)
    }
  }

  function handleParseAndSyncJson() {
    if (!jsonInput.trim()) return
    try {
      const { next, status } = draftPatchFromJsonText(jsonInput, { clean: true })
      if (!Object.keys(next).length) {
        setJsonStatus('JSON 有效，但没有识别到可替换字段。')
        return
      }
      const updated = { ...draft, ...next }
      updateDraft(updated)
      setJsonCleanState(true, updated)
      setJsonStatus(`JSON 清洗完成：${status.replace(/[。.]$/, '')}。已自动合并字段，并同步右侧预览。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setJsonStatus(`解析失败，请检查 JSON 格式：${message}`)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveStatus('')
    try {
      let nextDraft = draft
      if (mode === 'json' && jsonInput.trim()) {
        if ((jsonSaveReadyRef.current || jsonSaveReady) && cleanedJsonDraftRef.current) {
          nextDraft = cleanedJsonDraftRef.current
        } else {
          const { next, status } = draftPatchFromJsonText(jsonInput)
          if (!Object.keys(next).length) {
            setJsonStatus(status)
            setSaveStatus('没有识别到可保存字段，请检查 JSON 字段名。')
            return
          }
          nextDraft = { ...draft, ...next }
          updateDraft(nextDraft)
          setJsonCleanState(false)
          setJsonStatus(status)
        }
      }
      await persist(nextDraft)
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function copyText(value: string, doneText: string) {
    await navigator.clipboard.writeText(value)
    setJsonStatus(doneText)
  }

  async function runAiCleanPreview() {
    if (!draft.id) {
      setAiCleanStatus('当前题目缺少 ID，无法调用 AI 清洗。')
      return
    }
    setAiCleanLoading(true)
    setAiCleanStatus('')
    try {
      const preview = await questionBankApi.previewAiCleanItem(String(draft.id), { mode: aiCleanMode })
      setAiCleanPreview(preview)
      setAiCleanStatus(preview.formatIssues.length ? 'AI 已返回预览，但仍有渲染风险。' : 'AI 清洗预览已生成，确认后可应用到当前草稿。')
    } catch (error) {
      setAiCleanStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setAiCleanLoading(false)
    }
  }

  function applyAiCleanPreview() {
    if (!aiCleanPreview) return
    const patch = aiCleanPreview.patch
    const nextDraft = {
      ...draft,
      stemMarkdown: patch.stemMarkdown,
      problemBlocks: paragraphBlocksFromText(patch.stemMarkdown),
      answerText: patch.answerText,
      answerBlocks: paragraphBlocksFromText(patch.answerText),
      analysisMarkdown: patch.analysisMarkdown,
      analysisBlocks: paragraphBlocksFromText(patch.analysisMarkdown),
    }
    updateDraft(nextDraft)
    setJsonInput(editableJsonFromDraft(nextDraft))
    setJsonCleanState(false)
    setAiCleanStatus('已应用到当前编辑草稿，保存后才会写入题库。')
    setAiCleanPreview(null)
  }

	  const currentJson = JSON.stringify({
	    problem_text: draftProblemText(draft),
	    answer: draftAnswerText(draft),
	    analysis: draftAnalysisText(draft),
	    stage: draft.stage || '',
	    knowledge_points: draft.knowledgePoints || [],
	    solution_methods: draft.solutionMethods || [],
	    difficulty_score_10: draft.difficultyScore10 || '',
    difficulty_label: draft.difficultyLabel || '',
  }, null, 2)

  return (
    <Modal
      title="编辑题目"
      desc="修改题干、答案、解析和元数据。支持左右分栏实时预览，保存前不会写入数据库。"
      onClose={onClose}
      wide
      locked
      actions={<div className="flex items-center gap-2">{onManageFigures ? <Button size="sm" variant="outline" icon={Image} onClick={onManageFigures}>管理题图</Button> : null}<Button size="sm" variant="outline" icon={BookOpen} onClick={() => { setMode('json'); setAiOpen(true) }}>AI 辅助</Button></div>}
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* Toggle Mode Bar */}
        <div className="flex flex-none items-center justify-between gap-3 border-b pb-3 border-zinc-200 dark:border-zinc-800">
          <div className="inline-flex rounded-lg border bg-zinc-50 dark:bg-zinc-800/40 p-1 border-zinc-200 dark:border-zinc-700/30">
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                mode === 'form'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
              onClick={() => setMode('form')}
              type="button"
            >
              直观修改
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                mode === 'metadata'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
              onClick={() => setMode('metadata')}
              type="button"
            >
              题目元数据
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                mode === 'json'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
              onClick={() => setMode('json')}
              type="button"
            >
              JSON 修改
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
              value={aiCleanMode}
              onChange={(event) => setAiCleanMode(event.target.value as AiCleanMode)}
            >
              <option value="full">完整清洗</option>
              <option value="format_only">只修格式</option>
            </select>
            <Button size="sm" variant="outline" icon={aiCleanLoading ? LoaderCircle : Sparkles} disabled={aiCleanLoading || !draft.id} onClick={runAiCleanPreview}>
              {aiCleanLoading ? '清洗中...' : 'AI 清洗'}
            </Button>
          </div>
        </div>

        {aiCleanPreview ? (
          <AiCleanPreviewPanel
            current={draft}
            preview={aiCleanPreview}
            status={aiCleanStatus}
            loading={aiCleanLoading}
            onApply={applyAiCleanPreview}
            onClose={() => {
              setAiCleanPreview(null)
              setAiCleanStatus('')
            }}
          />
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {aiCleanStatus ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/50 flex-none">
                <span className={`text-xs ${aiCleanStatus.includes('失败') || aiCleanStatus.includes('缺少') || aiCleanStatus.includes('风险') ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-600 dark:text-zinc-400'}`}>
                  {aiCleanStatus}
                </span>
                <button
                  className="rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 p-1 text-zinc-400 hover:text-zinc-600"
                  onClick={() => setAiCleanStatus('')}
                  type="button"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : null}

            {/* Main Split-Pane Body */}
            <div className="min-h-0 flex-1 py-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 h-full min-h-0 overflow-hidden">

            {/* Left Column: Editors */}
            <div className="h-full overflow-y-auto pr-2 space-y-4">
              {mode === 'form' ? (
                <QuestionContentEditor
                  entityKey={`${entityType}:${String(draft.id || 'new')}`}
                  value={contentDraft.value}
                  savedValue={initialContent}
                  onChange={(value) => {
                    contentDraft.setValue(value)
                    setDraft((current) => ({ ...current, ...contentPatch(value) }))
                    setEditorConflict(null)
                  }}
                  onSave={saveContent}
                  onCancel={onClose}
                  saving={saving}
                  dirty={contentDraft.dirty}
                  contentRevision={draft.contentRevision}
                  conflict={editorConflict}
                  className="min-h-[520px]"
                />
              ) : mode === 'metadata' ? (
                <div className="space-y-4">
                  {/* Metadata fields */}
                  <div className="rounded-xl border bg-zinc-50/50 dark:bg-zinc-900/50 p-4 border-zinc-200 dark:border-zinc-800/80 space-y-3">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 block border-b pb-1.5 border-zinc-200 dark:border-zinc-800">题目元数据</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <LabeledInput label="来源" help="用于题目来源展示和筛选。" value={draft.sourceTitle ?? ''} onChange={(value) => updateDraft({ sourceTitle: value })} />
                      <LabeledInput label="章节/知识点概览" help="旧字段；可作为主知识点简写。" value={draft.chapter ?? ''} onChange={(value) => updateDraft({ chapter: value })} />
                    </div>
                    <LabeledSelect
                      label="学段"
                      help="用于题目展示、筛选和后续导入记录。"
                      value={draft.stage ?? ''}
                      options={metadataStageOptions}
                      placeholder="未设学段"
                      onChange={(value) => updateDraft({ stage: value })}
                    />
                    <LabeledSelect
                      label="题型"
                      help="影响题目展示、筛选和试卷导出时的版式判断。"
                      value={draft.questionType ?? ''}
                      options={['单选题', '多选题', '填空题', '解答题']}
                      placeholder="未设题型"
                      onChange={(value) => updateDraft({ questionType: value })}
                    />
                    <LabeledInput label="难度分 1-10" help="保存时同步显示难度标签。" value={String(draft.difficultyScore10 ?? '')} onChange={(value) => updateDraft({ difficultyScore10: Number(value), difficultyLabel: difficultyLabelFromScore10(Number(value)) })} />
                    <MultiTagSelector label="知识点" help="从知识点库中选择；可添加多个，点标签右侧可移除。" options={tagLibraries.data?.knowledgePoints ?? []} values={draft.knowledgePoints ?? []} onChange={(values) => updateDraft({ knowledgePoints: values })} />
                    <MultiTagSelector label="解题方法" help="从解题方法库中选择；可添加多个，点标签右侧可移除。" options={tagLibraries.data?.solutionMethods ?? []} values={draft.solutionMethods ?? []} onChange={(values) => updateDraft({ solutionMethods: values })} />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2.5">
	                    <LabeledTextarea
	                      label="粘贴整题 JSON"
	                      help={'支持只粘贴部分字段。点击右侧“JSON 清洗”可合并字段，并同步右侧预览。'}
	                      minHeight="min-h-[480px]"
	                      value={jsonInput}
	                      onChange={applyJsonText}
	                      headerAction={
                        <Button
                          size="sm"
                          variant="outline"
	                          icon={RefreshCcw}
	                          onClick={handleParseAndSyncJson}
	                          disabled={!jsonInput.trim()}
	                          title="清洗输入框中的 JSON 字段并同步到当前草稿"
	                        >
	                          JSON 清洗
	                        </Button>
                      }
                    />
                    {jsonStatus && (
                      <div className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
                        jsonStatus.includes('仍需修正')
                          ? 'text-red-700 dark:text-red-400 bg-red-50/50 dark:bg-red-950/20 border-red-200/20'
                          : jsonStatus.includes('有效')
                            ? 'text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/20'
                            : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/20'
                      }`}>
                        {jsonStatus.includes('仍需修正') ? <X className="size-3.5 shrink-0 mt-0.5" /> : jsonStatus.includes('有效') ? <InfoIcon className="size-3.5 shrink-0 mt-0.5" /> : <Check className="size-3.5 shrink-0 mt-0.5" />}
                        <span className="leading-relaxed">{jsonStatus}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 rounded-xl border bg-zinc-50 dark:bg-zinc-900/40 p-4 text-xs leading-5 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">可识别字段</p>
	                    <p>problem_text / stemMarkdown</p>
	                    <p>answer / answerText</p>
                    <p>analysis / analysisMarkdown</p>
                    <p>stage</p>
                    <p>knowledge_points / knowledgePoints</p>
                    <p>solution_methods / solutionMethods</p>
                    <p>difficulty_score_10 / difficultyScore10</p>
                    <Button className="mt-2 w-full justify-start" size="sm" variant="outline" icon={Copy} onClick={() => copyText(currentJson, '已复制当前题目 JSON。')}>复制当前 JSON</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Live Preview */}
            <div className="h-full overflow-y-auto pl-2 border-t pt-4 lg:border-t-0 lg:pt-0 lg:border-l border-zinc-200 dark:border-zinc-800 space-y-4 lg:pl-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-300">实时预览效果</span>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>

              {/* Mock Question Preview Card */}
              <div className="rounded-2xl border bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm border-zinc-200 dark:border-zinc-800">
                {/* Badges / Header */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  {draft.stage && draft.stage !== 'OCRT' && (
                    <Badge variant="default">{draft.stage}</Badge>
                  )}
                  {draft.questionType && (
                    <Badge variant="default">{draft.questionType}</Badge>
                  )}
                  <Badge variant={difficultyBadgeVariant(draft as QuestionItem)}>
                    {difficultyLabel10(draft as QuestionItem)}
                  </Badge>
                  {draft.sourceTitle && (
                    <Badge variant="outline" className="max-w-xs truncate" title={draft.sourceTitle}>
                      {draft.sourceTitle}
                    </Badge>
                  )}
                </div>

                {/* Question Stem Content */}
                <div className="space-y-3">
	                  <QuestionMarkdownContent
	                    className="text-sm leading-7"
	                    content={draftProblemText(draft)}
	                    figures={draft.figures ?? []}
	                    prefix={draft.serialNo ? `#${draft.serialNo}` : draft.questionNo ? `#${draft.questionNo}` : undefined}
	                  />
                </div>

                {/* Answers and Analysis Sections (always visible in preview for easy editing) */}
                <div className="border-t border-zinc-100 dark:border-zinc-800/80 pt-4 space-y-4">
                  <div className="bg-zinc-50/50 dark:bg-zinc-800/30 rounded-xl p-3.5 border border-zinc-200/60 dark:border-zinc-700/30">
                    <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block mb-1">答案</span>
	                    {draftAnswerText(draft).trim() ? (
	                      <MarkdownContent className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed font-medium" content={draftAnswerText(draft)} />
	                    ) : (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">未设置答案</span>
                    )}
                  </div>

                  <div className="bg-zinc-50/50 dark:bg-zinc-800/30 rounded-xl p-3.5 border border-zinc-200/60 dark:border-zinc-700/30">
                    <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block mb-1.5">解析</span>
	                    {draftAnalysisText(draft).trim() ? (
	                      <>
	                        <MarkdownContent className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed" content={draftAnalysisText(draft)} />
                        <FigureGallery figures={figuresByUsage(draft.figures ?? [], 'analysis')} className="mt-3" />
                      </>
                    ) : (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">未设置解析</span>
                    )}
                  </div>
                </div>

                {/* Tag Displays */}
                {(draft.knowledgePoints?.length || draft.chapter || draft.solutionMethods?.length) ? (
                  <div className="border-t border-zinc-100 dark:border-zinc-800/80 pt-3 space-y-2.5">
                    {((draft.knowledgePoints?.length ? draft.knowledgePoints : [draft.chapter]).filter(Boolean).length > 0) && (
                      <div className="space-y-1">
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold block">知识点</span>
                        <div className="flex flex-wrap gap-1">
                          {(draft.knowledgePoints?.length ? draft.knowledgePoints : [draft.chapter]).filter(Boolean).map((kp, i) => (
                            <span key={i} className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
                              {kp}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {draft.solutionMethods && draft.solutionMethods.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold block">解题方法</span>
                        <div className="flex flex-wrap gap-1">
                          {draft.solutionMethods.map((sm, i) => (
                            <span key={i} className="solution-method-tag text-[11px] font-medium px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50">
                              {sm}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

          </div>
        </div>
      </div>
    )}

        {/* Footer actions */}
        <div className={`flex flex-none items-center justify-between gap-3 border-t pt-3 ${mode === 'form' ? 'hidden' : ''}`}>
          <div className="min-w-0 text-xs text-red-600 dark:text-red-400">{saveStatus}</div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={saving} icon={saving ? LoaderCircle : undefined} onClick={handleSave}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </div>

      {aiOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4"
          onClick={() => setAiOpen(false)}
        >
          <div
            className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-none items-start justify-between gap-3 border-b px-4 py-3">
              <div>
                <h3 className="font-semibold">AI 辅助</h3>
                <p className="mt-1 text-xs text-zinc-500">复制当前内容、题图/分块图，或复制提示词后到外部模型识别。</p>
              </div>
              <button className="rounded-md border p-2 hover:bg-zinc-50" onClick={() => setAiOpen(false)} type="button"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Button className="justify-start" variant="outline" icon={Copy} onClick={() => copyText(currentJson, '已复制当前题目 JSON。')}>复制</Button>
                <Button className="justify-start" variant="outline" icon={Crop} disabled={!imageUrl} onClick={() => imageUrl && copyImageToClipboard(imageUrl, setJsonStatus)}>复制题图</Button>
                <Button className="justify-start" variant="outline" icon={FileText} onClick={() => copyText(aiPrompt, '已复制提示词。')}>提示词</Button>
              </div>
              {groupedSegmentImages.length ? (
                <div className="mt-3 rounded-xl border bg-zinc-50 p-3">
                  <p className="text-xs font-semibold text-zinc-900">OCR 分块图</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">题干和答案会分别合成一张图；解析按顺序合并为 3-4 张，避免整张长图被压缩后看不清公式。</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {groupedSegmentImages.map((group, index) => (
                      <Button
                        key={`${group.label}-${index}`}
                        size="sm"
                        variant="outline"
                        icon={Copy}
                        onClick={() => copySegmentGroupToClipboard(group, setJsonStatus)}
                      >
                        {index + 1}. 复制{group.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
	              <LabeledTextarea className="mt-4" label="提示词预览" help="要求模型返回 problem_text / answer / analysis；模型返回后可直接粘贴到 JSON 修改。" minHeight="min-h-72" value={aiPrompt} onChange={() => undefined} readOnly />
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

export default EditDialog
