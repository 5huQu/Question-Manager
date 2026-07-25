import { Copy, Plus, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui'
import type { LearningLibraryType } from '@/types'
import type { LearningTagsController } from './useLearningTags'
import { STAGE_OPTIONS, SUBJECT_OPTIONS, inputClass, stageLabel, textareaClass, typeMeta } from './utils'

export function AddLibraryDialog({ controller }: { controller: LearningTagsController }) {
  const {
    addDialogMode,
    setAddDialogMode,
    addLibraryType,
    setAddLibraryType,
    addBaseKnowledgeLibraryId,
    setAddBaseKnowledgeLibraryId,
    aiGuideStep,
    setAiGuideStep,
    aiSubject,
    setAiSubject,
    aiStage,
    setAiStage,
    aiScopeNote,
    setAiScopeNote,
    aiJsonText,
    setAiJsonText,
    aiImporting,
    knowledgeLibraries,
    selectedBaseKnowledgeLibrary,
    addTypeMeta,
    aiStartPrompt,
    aiJsonPrompt,
    setAddDialogOpen,
    setError,
    handleDirectAdd,
    copyPrompt,
    handleAiJsonImport,
  } = controller

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-sm">
      <div className={`flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl dark:bg-zinc-900 ${addDialogMode === 'ai' ? 'max-w-3xl' : 'max-w-2xl'}`}>
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{addDialogMode === 'choice' ? '新增标签库' : 'AI 辅助生成标签库'}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {addDialogMode === 'choice'
                ? '先选择标签库类型，再决定从空白模板开始或使用 AI 辅助生成。'
                : `第 ${aiGuideStep} 步 / 2：${aiGuideStep === 1 ? '先让模型和你确认目录结构' : '再让模型输出可导入的 JSON 数组'}`}
            </p>
          </div>
          <button className="flex size-9 items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setAddDialogOpen(false)} type="button" aria-label="关闭">
            <X className="size-4" />
          </button>
        </div>

        {addDialogMode === 'choice' ? (
          <div className="space-y-4 overflow-y-auto p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {(['knowledge_point', 'method_tag'] as LearningLibraryType[]).map((option) => {
                const selected = addLibraryType === option
                const meta = typeMeta(option)
                return (
                  <button
                    key={option}
                    className={`rounded-xl border p-4 text-left transition ${selected ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950' : 'bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800'}`}
                    onClick={() => setAddLibraryType(option)}
                    type="button"
                  >
                    <div className="font-semibold">{meta.label}</div>
                    <p className={`mt-1 text-sm leading-6 ${selected ? 'opacity-80' : 'text-zinc-500'}`}>
                      {option === 'knowledge_point' ? '记录题目对应哪些知识点。' : '记录题目卡在哪类方法、题型或策略。'}
                    </p>
                  </button>
                )
              })}
            </div>

            {addLibraryType === 'method_tag' ? (
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-zinc-500">对照知识点标签库</span>
                <select className={inputClass()} value={addBaseKnowledgeLibraryId} onChange={(event) => setAddBaseKnowledgeLibraryId(event.target.value)}>
                  {knowledgeLibraries.map((library) => (
                    <option key={library.id} value={library.id}>{library.name} · {library.subject} · {stageLabel(library.stage)}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className="flex min-h-36 flex-col items-start rounded-xl border bg-white p-5 text-left transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                disabled={addLibraryType === 'method_tag' && !selectedBaseKnowledgeLibrary}
                onClick={handleDirectAdd}
                type="button"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"><Plus className="size-4" /></span>
                <span className="mt-4 font-semibold">直接添加</span>
                <span className="mt-1 text-sm leading-6 text-zinc-500">创建一个新{addTypeMeta.label}，并直接在直观视图里修改。</span>
              </button>
              <button
                className="flex min-h-36 flex-col items-start rounded-xl border bg-white p-5 text-left transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                disabled={addLibraryType === 'method_tag' && !selectedBaseKnowledgeLibrary}
                onClick={() => {
                  if (addLibraryType === 'method_tag' && !selectedBaseKnowledgeLibrary) {
                    setError('请先选择对照知识点标签库。')
                    return
                  }
                  setAddDialogMode('ai')
                  setAiGuideStep(1)
                }}
                type="button"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"><Sparkles className="size-4" /></span>
                <span className="mt-4 font-semibold">AI 辅助</span>
                <span className="mt-1 text-sm leading-6 text-zinc-500">先复制提示词到大模型对话，确认终版后再导入 JSON。</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {aiGuideStep === 1 ? (
                <div className="grid gap-4">
                  <div className="rounded-xl border bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-950">
                    当前生成：<span className="font-semibold text-zinc-900 dark:text-zinc-100">{addTypeMeta.label}</span>
                    {addLibraryType === 'method_tag' && selectedBaseKnowledgeLibrary ? <span className="ml-2">对照：{selectedBaseKnowledgeLibrary.name}</span> : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium text-zinc-500">学科</span>
                      <select className={inputClass()} value={aiSubject} onChange={(event) => setAiSubject(event.target.value)}>
                        {SUBJECT_OPTIONS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium text-zinc-500">学段</span>
                      <select className={inputClass()} value={aiStage} onChange={(event) => setAiStage(event.target.value)}>
                        {STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-zinc-500">补充范围</span>
                    <input className={inputClass()} value={aiScopeNote} onChange={(event) => setAiScopeNote(event.target.value)} placeholder="例如：人教版 A 版必修、上海中考、AP Calculus AB" />
                  </label>
                  <div className="rounded-xl border bg-zinc-50 p-3 dark:bg-zinc-950">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="font-semibold">开始提问提示词</div>
                      <Button size="sm" variant="outline" icon={Copy} onClick={() => void copyPrompt(aiStartPrompt)}>复制</Button>
                    </div>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{aiStartPrompt}</pre>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="rounded-xl border bg-zinc-50 p-3 dark:bg-zinc-950">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="font-semibold">生成 JSON 数组提示词</div>
                      <Button size="sm" variant="outline" icon={Copy} onClick={() => void copyPrompt(aiJsonPrompt)}>复制</Button>
                    </div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{aiJsonPrompt}</pre>
                  </div>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-zinc-500">粘贴模型输出的 JSON 数组</span>
                    <textarea
                      className={textareaClass('min-h-52 font-mono text-xs leading-5')}
                      value={aiJsonText}
                      onChange={(event) => setAiJsonText(event.target.value)}
                      placeholder='[{"code":"...","name":"...","chapters":[...]}]'
                    />
                  </label>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <Button variant="outline" onClick={() => aiGuideStep === 1 ? setAddDialogMode('choice') : setAiGuideStep(1)}>返回</Button>
              {aiGuideStep === 1 ? (
                <Button onClick={() => setAiGuideStep(2)}>下一步</Button>
              ) : (
                <Button onClick={() => void handleAiJsonImport()} disabled={aiImporting || !aiJsonText.trim()}>{aiImporting ? '导入中' : '导入'}</Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
