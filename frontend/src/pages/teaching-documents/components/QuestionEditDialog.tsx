/**
 * 题目内容及元数据编辑弹窗（全屏 portal）
 * 复用 QuestionContentEditor 及题库元数据编辑组件；保存时进入"保存方式确认"步：
 * 回填到题库（PATCH updateItem，带 contentRevision 冲突处理及元数据更新）或仅保存在本文档（localContent 覆盖）
 */

import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Database, FileText, HelpCircle, Image, LoaderCircle, RotateCcw, Save, Tag, X } from 'lucide-react'
import type { OcrSettings, QuestionItem, TagLibraries } from '@/types'
import type { QuestionContentDraft } from '@/types/questionContent'
import type { QuestionBlock } from '@/types/teachingDocument'
import { questionBankApi } from '@/api/questionBank'
import { ApiError } from '@/api/client'
import { learningTagsApi } from '@/api/learningTags'
import { settingsApi } from '@/api/settings'
import { useAsync } from '@/hooks/useAsync'
import { QuestionContentEditor, type QuestionEditorConflict } from '@/components/questions/editor/QuestionContentEditor'
import { QuestionFigureManager } from '@/components/questions/QuestionFigureManager'
import { contentEquals } from '@/components/questions/editor/model'
import { LabeledInput, LabeledSelect, MultiTagSelector, type MultiTagGroup } from '@/components/questions/edit-dialog/form-fields'
import { difficultyLabelFromScore10 } from '@/utils/questionDisplay'
import { gradeOptionsForTeachingStages } from '@/utils/stages'

export function QuestionEditDialog(props: {
  block: QuestionBlock
  question: QuestionItem
  onClose: () => void
  /** 回填题库成功：页面刷新 questionMap 并清除该块 localContent */
  onWrittenBack: (item: QuestionItem) => void
  /** 仅保存在本文档：页面写入 localContent */
  onKeepLocal: (draft: QuestionContentDraft) => void
  /** 题图资源保存后同步当前文档的题目缓存 */
  onFiguresChanged?: (figures: QuestionItem['figures']) => void
}) {
  const { block, question } = props
  const initialValue = useMemo<Partial<QuestionItem>>(() => ({
    stemMarkdown: block.localContent?.stemMarkdown ?? question.stemMarkdown ?? '',
    answerText: block.localContent?.answerText ?? question.answerText ?? '',
    analysisMarkdown: block.localContent?.analysisMarkdown ?? question.analysisMarkdown ?? '',
    sourceTitle: question.sourceTitle ?? '',
    chapter: question.chapter ?? '',
    stage: question.stage ?? '',
    questionType: question.questionType ?? '',
    difficultyScore10: question.difficultyScore10 ?? 0,
    difficultyLabel: question.difficultyLabel ?? '',
    knowledgePoints: question.knowledgePoints ?? [],
    solutionMethods: question.solutionMethods ?? [],
  }), []) // eslint-disable-line react-hooks/exhaustive-deps -- 仅取打开弹窗时的快照

  const [draft, setDraft] = useState<Partial<QuestionItem>>(initialValue)
  const [step, setStep] = useState<'edit' | 'confirm' | 'discard'>('edit')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<QuestionEditorConflict | null>(null)
  const [writeError, setWriteError] = useState('')
  const [editPanel, setEditPanel] = useState<'content' | 'metadata' | 'figures'>('content')

  const tagLibraries = useAsync<TagLibraries>(() => learningTagsApi.getQuestionBankTagLibraries(), [])
  const ocrSettings = useAsync<OcrSettings>(() => settingsApi.getOcrSettings(), [])
  const configuredStageOptions = gradeOptionsForTeachingStages(ocrSettings.data?.teachingStages)
  const metadataStageOptions = draft.stage && !configuredStageOptions.includes(draft.stage)
    ? [...configuredStageOptions, draft.stage]
    : configuredStageOptions

  const knowledgePointGroups = useMemo<MultiTagGroup[]>(() => {
    const libraries = tagLibraries.data?.libraries?.filter((library) => library.libraryType === 'knowledge_point') ?? []
    return libraries.flatMap((library) => library.chapters.map((chapter) => ({
      id: `${library.code}:${chapter.code}`,
      name: chapter.name,
      options: chapter.knowledgePoints.map((point) => ({ name: point.name })),
    })))
  }, [tagLibraries.data])

  const solutionMethodGroups = useMemo<MultiTagGroup[]>(() => {
    const libraries = tagLibraries.data?.libraries?.filter((library) => library.libraryType === 'method_tag') ?? []
    return libraries.flatMap((library) => library.chapters.map((chapter) => ({
      id: `${library.code}:${chapter.code}`,
      name: chapter.name,
      options: chapter.knowledgePoints.map((point) => ({ name: point.name, appliesTo: point.appliesTo })),
    })))
  }, [tagLibraries.data])

  const methodFilter = useMemo(() => {
    const selectedKnowledgePoints = (draft.knowledgePoints ?? []).map((value) => String(value).trim()).filter(Boolean)
    if (!selectedKnowledgePoints.length) return undefined
    return (option: { name: string; appliesTo?: string[] }) => (
      option.appliesTo?.some((knowledgePoint) => selectedKnowledgePoints.includes(knowledgePoint)) ?? false
    )
  }, [draft.knowledgePoints?.join('|')])

  function updateDraft(patch: Partial<QuestionItem>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const dirty = useMemo(() => {
    const contentChanged = !contentEquals(
      {
        stemMarkdown: draft.stemMarkdown ?? '',
        answerText: draft.answerText ?? '',
        analysisMarkdown: draft.analysisMarkdown ?? '',
      },
      {
        stemMarkdown: initialValue.stemMarkdown ?? '',
        answerText: initialValue.answerText ?? '',
        analysisMarkdown: initialValue.analysisMarkdown ?? '',
      },
    )
    const metadataChanged =
      (draft.sourceTitle ?? '') !== (initialValue.sourceTitle ?? '') ||
      (draft.chapter ?? '') !== (initialValue.chapter ?? '') ||
      (draft.stage ?? '') !== (initialValue.stage ?? '') ||
      (draft.questionType ?? '') !== (initialValue.questionType ?? '') ||
      (draft.difficultyScore10 ?? 0) !== (initialValue.difficultyScore10 ?? 0) ||
      JSON.stringify(draft.knowledgePoints ?? []) !== JSON.stringify(initialValue.knowledgePoints ?? []) ||
      JSON.stringify(draft.solutionMethods ?? []) !== JSON.stringify(initialValue.solutionMethods ?? [])
    return contentChanged || metadataChanged
  }, [draft, initialValue])

  const dialogTitle = `编辑题目内容 · ${question.questionNo || block.questionId}`

  function requestClose() {
    if (dirty && step === 'edit') {
      setStep('discard')
      return
    }
    props.onClose()
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
    }
  }

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty && step === 'edit') {
          setConflict(null)
          setStep('confirm')
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [dirty, step])

  async function writeBack() {
    setSaving(true)
    setWriteError('')
    try {
      const updated = await questionBankApi.updateItem(question.id, draft, question.contentRevision)
      props.onWrittenBack(updated)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const actual = error.payload?.actualContentRevision
        setConflict({
          message: '题库中的题目已被其他页面更新，可重试回填，或改存为本文档本地内容。',
          actualContentRevision: typeof actual === 'number' ? actual : undefined,
        })
        setStep('edit')
      } else {
        setWriteError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }

  function keepLocal() {
    props.onKeepLocal({
      stemMarkdown: draft.stemMarkdown ?? '',
      answerText: draft.answerText ?? '',
      analysisMarkdown: draft.analysisMarkdown ?? '',
    })
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dialogTitle}
      className="question-edit-glass-backdrop fixed inset-0 z-[90] flex items-center justify-center p-4 md:p-8"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}
    >
      <div className="question-edit-glass-dialog flex h-full max-h-[56rem] w-full max-w-4xl flex-col overflow-hidden">
        {step === 'edit' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
            <div role="tablist" aria-label="题目编辑面板" className="question-edit-glass-tabs inline-flex w-fit shrink-0 items-center gap-0.5">
              <button
                type="button"
                role="tab"
                aria-selected={editPanel === 'content'}
                onClick={() => setEditPanel('content')}
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-xs font-medium"
              >
                <FileText className="size-3.5" />内容编辑
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editPanel === 'metadata'}
                onClick={() => setEditPanel('metadata')}
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-xs font-medium"
              >
                <Tag className="size-3.5" />题目元数据
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editPanel === 'figures'}
                onClick={() => setEditPanel('figures')}
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-xs font-medium"
              >
                <Image className="size-3.5" />题图管理
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {editPanel === 'figures' ? (
                <QuestionFigureManager
                  question={question}
                  onFiguresChange={props.onFiguresChanged}
                  onClose={requestClose}
                  surface="glass"
                />
              ) : editPanel === 'metadata' ? (
                <div className="h-full overflow-y-auto space-y-4 pr-1">
                  <div className="question-edit-glass-preview rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-black/6 pb-2 dark:border-white/8">
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">题目元数据</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <LabeledInput
                        label="来源"
                        help="用于题目来源展示和筛选。"
                        value={draft.sourceTitle ?? ''}
                        onChange={(value) => updateDraft({ sourceTitle: value })}
                      />
                      <LabeledInput
                        label="章节/知识点概览"
                        help="旧字段；可作为主知识点简写。"
                        value={draft.chapter ?? ''}
                        onChange={(value) => updateDraft({ chapter: value })}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    </div>
                    <LabeledInput
                      label="难度分 1-10"
                      help="保存时同步显示难度标签。"
                      value={String(draft.difficultyScore10 ?? '')}
                      onChange={(value) => updateDraft({ difficultyScore10: Number(value), difficultyLabel: difficultyLabelFromScore10(Number(value)) })}
                    />
                    <MultiTagSelector
                      label="知识点"
                      help="先展开章节，再勾选具体知识点；支持多选。"
                      options={tagLibraries.data?.knowledgePoints ?? []}
                      groups={knowledgePointGroups}
                      values={draft.knowledgePoints ?? []}
                      onChange={(values) => updateDraft({ knowledgePoints: values })}
                    />
                    <MultiTagSelector
                      label="解题方法"
                      help={draft.knowledgePoints?.length ? '已按所选知识点筛选适用方法；支持多选。' : '先选择知识点，可仅显示对应的解题方法。'}
                      options={tagLibraries.data?.solutionMethods ?? []}
                      groups={solutionMethodGroups}
                      filterOption={methodFilter}
                      values={draft.solutionMethods ?? []}
                      onChange={(values) => updateDraft({ solutionMethods: values })}
                    />
                  </div>
                </div>
              ) : (
                <QuestionContentEditor
                  entityKey={`teaching-question-${block.id}`}
                  questionType={draft.questionType}
                  className="h-full min-h-0"
                  surface="glass"
                  hideFooter
                  title={dialogTitle}
                  description="内容以 Markdown 保存，公式与表格可视化编辑。保存时可选择回填题库或仅保留在本文档。"
                  value={{
                    stemMarkdown: draft.stemMarkdown ?? '',
                    answerText: draft.answerText ?? '',
                    analysisMarkdown: draft.analysisMarkdown ?? '',
                  }}
                  savedValue={{
                    stemMarkdown: initialValue.stemMarkdown ?? '',
                    answerText: initialValue.answerText ?? '',
                    analysisMarkdown: initialValue.analysisMarkdown ?? '',
                  }}
                  dirty={dirty}
                  onChange={(val) => updateDraft(val)}
                  onSave={() => { setConflict(null); setStep('confirm') }}
                  onCancel={requestClose}
                  contentRevision={question.contentRevision}
                  conflict={conflict}
                  saving={saving}
                />
              )}
            </div>
            <footer className="question-edit-glass-footer flex shrink-0 items-center justify-between gap-4 px-4 py-2.5 rounded-xl border border-black/6 dark:border-white/8">
              <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
                {dirty ? (
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
                  onClick={requestClose}
                >
                  <span className="flex items-center gap-1.5"><X className="size-3.5" />关闭</span>
                </button>
                <button
                  type="button"
                  disabled={!dirty || saving}
                  className="question-edit-glass-button-secondary h-8.5 rounded-lg border px-3 text-xs font-medium text-zinc-700 transition-all hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  onClick={() => setDraft(initialValue)}
                >
                  <span className="flex items-center gap-1.5"><RotateCcw className="size-3.5" />重置</span>
                </button>
                <button
                  type="button"
                  disabled={!dirty || saving}
                  className="h-8.5 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-zinc-50 shadow-xs transition-all hover:bg-zinc-800 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  onClick={() => { setConflict(null); setStep('confirm') }}
                >
                  <span className="flex items-center gap-1.5"><Save className="size-3.5" />{saving ? '保存中…' : '保存内容'}</span>
                </button>
              </div>
            </footer>
          </div>
        ) : step === 'confirm' ? (
          <div className="question-edit-glass-panel flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-md space-y-5">
              <div className="flex items-center gap-2">
                <HelpCircle className="size-5 text-zinc-500" />
                <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">选择保存方式</h3>
              </div>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                题目内容已修改。回填题库后，所有引用此题的文档同步更新；仅保存在本文档则只影响当前文档。
              </p>
              {writeError ? (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50/40 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400">{writeError}</p>
              ) : null}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { void writeBack() }}
                  className="flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Database className="size-4" />}
                  {saving ? '回填中…' : '回填到题库'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={keepLocal}
                  className="flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <FileText className="size-4" />仅保存在本文档
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setStep('edit')}
                  className="h-9 rounded-md px-4 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  继续编辑
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="question-edit-glass-panel flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-sm space-y-5 text-center">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">放弃未保存的修改？</h3>
              <p className="text-sm leading-6 text-zinc-500">关闭后，本次对题目内容的修改将不会保留。</p>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={props.onClose}
                  className="h-9 rounded-md border border-red-200 bg-white px-4 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:bg-zinc-950 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  放弃修改
                </button>
                <button
                  type="button"
                  onClick={() => setStep('edit')}
                  className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  继续编辑
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
