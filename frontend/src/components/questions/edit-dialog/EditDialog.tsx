import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Check, Image, LoaderCircle, Pencil, RotateCcw, Save, Tag, X } from 'lucide-react'
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
import { QuestionFigureManager } from '@/components/questions/QuestionFigureManager'
import { difficultyBadgeVariant, difficultyLabel10, difficultyLabelFromScore10, figuresByUsage } from '@/utils/questionDisplay'
import { draftAnalysisText, draftAnswerText, draftProblemText, paragraphBlocksFromText } from '@/utils/jsonCleanup'
import { gradeOptionsForTeachingStages } from '@/utils/stages'
import { LabeledInput, LabeledSelect, MultiTagSelector } from './form-fields'

export function EditDialog({ draft, setDraft, onClose, onSave, onManageFigures, onFiguresChanged, entityType = 'question' }: { draft: Partial<QuestionItem>; setDraft: Dispatch<SetStateAction<Partial<QuestionItem>>>; onClose: () => void; onSave: (nextDraft?: Partial<QuestionItem>) => Promise<void>; onManageFigures?: () => void; onFiguresChanged?: (figures: QuestionItem['figures']) => void; entityType?: string }) {
  const [mode, setMode] = useState<'form' | 'metadata' | 'figures'>('form')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [editorConflict, setEditorConflict] = useState<QuestionEditorConflict | null>(null)

  const initialDraft = useMemo(() => ({ ...draft }), [draft.id])
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

  const isDirty = contentDraft.dirty || JSON.stringify(draft) !== JSON.stringify(initialDraft)

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

  const tagLibraries = useAsync<TagLibraries>(() => learningTagsApi.getQuestionBankTagLibraries(), [])
  const ocrSettings = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const configuredStageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const metadataStageOptions = draft.stage && !configuredStageOptions.includes(draft.stage)
    ? [...configuredStageOptions, draft.stage]
    : configuredStageOptions

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

  async function handleSaveAll() {
    if (saving) return
    setSaving(true)
    setSaveStatus('')
    const nextDraft = { ...draft, ...contentPatch(contentDraft.value) }
    setDraft(nextDraft)
    try {
      await persist(nextDraft)
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function handleResetAll() {
    setDraft(initialDraft)
    contentDraft.setValue(initialContent)
    setEditorConflict(null)
    setSaveStatus('')
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void handleSaveAll()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [draft, contentDraft.value])

  return (
    <Modal
      title="编辑题目"
      desc="修改题干、答案、解析和元数据。支持左右分栏实时预览，保存前不会写入数据库。"
      onClose={onClose}
      wide
      locked
      surface="glass"
      actions={
        <div role="tablist" aria-label="编辑模式" className="question-edit-glass-tabs inline-flex items-center gap-0.5 p-1">
          <button
            role="tab"
            aria-selected={mode === 'form'}
            className="inline-flex h-7.5 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium cursor-pointer transition-all"
            onClick={() => setMode('form')}
            type="button"
          >
            <Pencil className="size-3.5" />直观修改
          </button>
          <button
            role="tab"
            aria-selected={mode === 'metadata'}
            className="inline-flex h-7.5 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium cursor-pointer transition-all"
            onClick={() => setMode('metadata')}
            type="button"
          >
            <Tag className="size-3.5" />题目元数据
          </button>
          {draft.id ? (
            <button
              role="tab"
              aria-selected={mode === 'figures'}
              className="inline-flex h-7.5 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium cursor-pointer transition-all"
              onClick={() => { setMode('figures'); onManageFigures?.() }}
              type="button"
            >
              <Image className="size-3.5" />题图管理
            </button>
          ) : null}
        </div>
      }
      footer={
        <footer className="question-edit-glass-footer flex items-center justify-between gap-4 px-5 py-3 rounded-b-2xl">
          <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {isDirty ? (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-400">
                <span className="size-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />有未保存修改
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400">
                <Check className="size-3.5 shrink-0" />内容已保存
              </span>
            )}
            <span className="hidden truncate text-zinc-400 sm:inline dark:text-zinc-500">快捷键 ⌘/Ctrl + S</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="h-8.5 rounded-lg px-3 text-xs font-medium text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-50"
              onClick={onClose}
            >
              <span className="flex items-center gap-1.5"><X className="size-3.5" />关闭</span>
            </button>
            <button
              type="button"
              disabled={!isDirty || saving}
              className="question-edit-glass-button-secondary h-8.5 rounded-lg border px-3 text-xs font-medium text-zinc-700 transition-all hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900"
              onClick={handleResetAll}
            >
              <span className="flex items-center gap-1.5"><RotateCcw className="size-3.5" />重置</span>
            </button>
            <button
              type="button"
              disabled={!isDirty || saving}
              className="h-8.5 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-zinc-50 shadow-xs transition-all hover:bg-zinc-800 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              onClick={() => { void handleSaveAll() }}
            >
              <span className="flex items-center gap-1.5"><Save className="size-3.5" />{saving ? '保存中…' : '保存内容'}</span>
            </button>
          </div>
        </footer>
      }
    >
      <div className="h-full min-h-0 flex-1 py-1">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 h-full min-h-0 overflow-hidden">

            {/* Left Column: Editors */}
            <div className="h-full overflow-y-auto pr-2 space-y-4">
              {mode === 'figures' ? (
                <QuestionFigureManager
                  question={draft as QuestionItem}
                  onFiguresChange={(figures) => { setDraft((current) => ({ ...current, figures })); onFiguresChanged?.(figures) }}
                  surface="glass"
                />
              ) : mode === 'form' ? (
                <QuestionContentEditor
                  entityKey={`${entityType}:${String(draft.id || 'new')}`}
                  value={contentDraft.value}
                  savedValue={initialContent}
                  onChange={(value) => {
                    contentDraft.setValue(value)
                    setDraft((current) => ({ ...current, ...contentPatch(value) }))
                    setEditorConflict(null)
                  }}
                  onSave={handleSaveAll}
                  onCancel={onClose}
                  saving={saving}
                  dirty={contentDraft.dirty}
                  contentRevision={draft.contentRevision}
                  conflict={editorConflict}
                  className="min-h-[520px]"
                  surface="glass"
                  hideFooter
                />
              ) : mode === 'metadata' ? (
                <div className="space-y-4">
                  {/* Metadata fields */}
                  <div className="question-edit-glass-choice rounded-xl p-4 space-y-3">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 block border-b pb-1.5 border-black/6 dark:border-white/8">题目元数据</span>
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
                    <MultiTagSelector label="知识点" help="搜索并勾选多个知识点；再次点击可取消选择。" options={tagLibraries.data?.knowledgePoints ?? []} values={draft.knowledgePoints ?? []} onChange={(values) => updateDraft({ knowledgePoints: values })} />
                    <MultiTagSelector label="解题方法" help="搜索并勾选多个解题方法；再次点击可取消选择。" options={tagLibraries.data?.solutionMethods ?? []} values={draft.solutionMethods ?? []} onChange={(values) => updateDraft({ solutionMethods: values })} />
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right Column: Live Preview */}
            <div className="h-full overflow-y-auto pl-2 border-t pt-4 lg:border-t-0 lg:pt-0 lg:border-l border-black/6 dark:border-white/8 space-y-4 lg:pl-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-300">实时预览效果</span>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>

              {/* Mock Question Preview Card */}
              <div className="question-edit-glass-preview rounded-2xl p-5 space-y-4">
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
    </Modal>
  )
}

export default EditDialog
