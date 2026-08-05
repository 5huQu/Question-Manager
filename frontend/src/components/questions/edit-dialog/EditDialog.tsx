import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Image, LoaderCircle } from 'lucide-react'
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

  async function handleSave() {
    setSaving(true)
    setSaveStatus('')
    try {
      await persist(draft)
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="编辑题目"
      desc="修改题干、答案、解析和元数据。支持左右分栏实时预览，保存前不会写入数据库。"
      onClose={onClose}
      wide
      locked
      actions={(draft.id || onManageFigures) ? <div className="flex items-center gap-2"><Button size="sm" variant="outline" icon={Image} onClick={() => { setMode('figures'); onManageFigures?.() }}>管理题图</Button></div> : undefined}
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
            {draft.id ? <button
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                mode === 'figures'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
              onClick={() => setMode('figures')}
              type="button"
            >
              题图管理
            </button> : null}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
            {/* Main Split-Pane Body */}
            <div className="min-h-0 flex-1 py-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 h-full min-h-0 overflow-hidden">

            {/* Left Column: Editors */}
            <div className="h-full overflow-y-auto pr-2 space-y-4">
              {mode === 'figures' ? (
                <QuestionFigureManager
                  question={draft as QuestionItem}
                  onFiguresChange={(figures) => { setDraft((current) => ({ ...current, figures })); onFiguresChanged?.(figures) }}
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
                    <MultiTagSelector label="知识点" help="搜索并勾选多个知识点；再次点击可取消选择。" options={tagLibraries.data?.knowledgePoints ?? []} values={draft.knowledgePoints ?? []} onChange={(values) => updateDraft({ knowledgePoints: values })} />
                    <MultiTagSelector label="解题方法" help="搜索并勾选多个解题方法；再次点击可取消选择。" options={tagLibraries.data?.solutionMethods ?? []} values={draft.solutionMethods ?? []} onChange={(values) => updateDraft({ solutionMethods: values })} />
                  </div>
                </div>
              ) : null}
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

        {/* Footer actions */}
        <div className={`flex flex-none items-center justify-between gap-3 border-t pt-3 ${mode === 'form' ? 'hidden' : ''}`}>
          <div className="min-w-0 text-xs text-red-600 dark:text-red-400">{saveStatus}</div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={saving} icon={saving ? LoaderCircle : undefined} onClick={handleSave}>{saving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </div>

    </Modal>
  )
}

export default EditDialog
