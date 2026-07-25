import { ChevronDown, Code2, GripVertical, ListTree, Plus, Save, Trash2 } from 'lucide-react'
import { Badge, Button, Empty } from '@/components/ui'
import type { LearningLibraryType } from '@/types'
import type { LearningTagsController } from './useLearningTags'
import { STAGE_OPTIONS, SUBJECT_OPTIONS, inputClass, makeId, stageLabel, stringifyLibrary, textareaClass } from './utils'

export function LibraryEditor({ controller }: { controller: LearningTagsController }) {
  const {
    editor,
    mode,
    setMode,
    jsonText,
    setJsonText,
    expandedIds,
    setExpandedIds,
    dirty,
    setDirty,
    saveState,
    setSaveState,
    activeLibrary,
    activeStats,
    activeMeta,
    validationError,
    statusLabel,
    knowledgeLibraries,
    saveLibrary,
    markEditor,
    updateChapter,
    reorderChapter,
    draggedChapterId,
    setDraggedChapterId,
    dragOverChapterId,
    setDragOverChapterId,
  } = controller

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{activeLibrary?.name ?? '标签库编辑器'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">可切换 JSON 与直观视图编辑；内容有效时会自动实时保存。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${mode === 'visual' ? 'border-zinc-900 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900'}`} onClick={() => setMode('visual')} type="button"><ListTree className="size-4" />直观视图</button>
          <button className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${mode === 'json' ? 'border-zinc-900 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900'}`} onClick={() => { if (editor) setJsonText(stringifyLibrary(editor)); setMode('json') }} type="button"><Code2 className="size-4" />JSON</button>
          <Button icon={Save} disabled={!activeLibrary || Boolean(validationError) || saveState === 'saving'} onClick={() => activeLibrary && void saveLibrary(activeLibrary, false)}>保存</Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant={validationError ? 'danger' : saveState === 'saving' ? 'warning' : 'success'}>{statusLabel}</Badge>
        {activeLibrary ? <Badge>{activeLibrary.subject}</Badge> : null}
        {activeLibrary ? <Badge>{activeStats.sections} {activeMeta.sectionLabel} / {activeStats.points} {activeMeta.pointLabel}</Badge> : null}
      </div>

      {mode === 'json' ? (
        <textarea
          className={textareaClass('mt-4 min-h-[620px] font-mono text-xs leading-5')}
          value={jsonText}
          onChange={(event) => {
            setJsonText(event.target.value)
            setDirty(true)
            setSaveState('idle')
          }}
        />
      ) : editor ? (
        <div className="mt-4 space-y-5">
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-zinc-500">标签库类型</span>
              <select className={inputClass()} value={editor.libraryType} onChange={(event) => {
                const libraryType = event.target.value as LearningLibraryType
                const baseLibrary = libraryType === 'method_tag' ? knowledgeLibraries[0] : undefined
                markEditor({
                  ...editor,
                  libraryType,
                  isDefault: libraryType === 'knowledge_point' ? editor.isDefault : false,
                  subject: baseLibrary?.subject ?? editor.subject,
                  stage: baseLibrary?.stage ?? editor.stage,
                  baseKnowledgeLibraryId: baseLibrary?.id,
                  baseKnowledgeLibraryCode: baseLibrary?.code,
                  baseKnowledgeLibraryName: baseLibrary?.name,
                })
              }}>
                <option value="knowledge_point">知识点标签库</option>
                <option value="method_tag">方法题型标签库</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-zinc-500">模板名称</span>
              <input className={inputClass()} value={editor.name} onChange={(event) => markEditor({ ...editor, name: event.target.value })} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-zinc-500">语言</span>
              <input className={inputClass()} value={editor.locale} onChange={(event) => markEditor({ ...editor, locale: event.target.value })} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-zinc-500">科目</span>
              <select className={inputClass()} value={SUBJECT_OPTIONS.includes(editor.subject) ? editor.subject : '__custom__'} onChange={(event) => markEditor({ ...editor, subject: event.target.value === '__custom__' ? '' : event.target.value })}>
                {SUBJECT_OPTIONS.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                <option value="__custom__">其他</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-zinc-500">阶段</span>
              <select className={inputClass()} value={STAGE_OPTIONS.some((option) => option.value === editor.stage) ? editor.stage : '__custom__'} onChange={(event) => markEditor({ ...editor, stage: event.target.value === '__custom__' ? '' : event.target.value })}>
                {STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                <option value="__custom__">其他</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-zinc-500">默认标签库</span>
              <div className="grid grid-cols-2 rounded-lg border bg-zinc-50 p-0.5 dark:bg-zinc-950">
                <button className={`h-9 rounded-md text-sm ${!editor.isDefault ? 'bg-white shadow-sm dark:bg-zinc-800' : 'text-zinc-500'}`} disabled={editor.libraryType === 'method_tag'} onClick={() => markEditor({ ...editor, isDefault: false })} type="button">普通</button>
                <button className={`h-9 rounded-md text-sm ${editor.isDefault ? 'bg-zinc-950 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950' : 'text-zinc-500'}`} disabled={editor.libraryType === 'method_tag'} onClick={() => markEditor({ ...editor, isDefault: true })} type="button">默认</button>
              </div>
            </label>
            {editor.libraryType === 'method_tag' ? (
              <label className="grid gap-1.5 md:col-span-2 2xl:col-span-3">
                <span className="text-xs font-medium text-zinc-500">对照知识点库</span>
                <select className={inputClass()} value={editor.baseKnowledgeLibraryId ?? ''} onChange={(event) => {
                  const baseLibrary = knowledgeLibraries.find((library) => library.id === event.target.value)
                  markEditor({
                    ...editor,
                    baseKnowledgeLibraryId: baseLibrary?.id,
                    baseKnowledgeLibraryCode: baseLibrary?.code,
                    baseKnowledgeLibraryName: baseLibrary?.name,
                    subject: baseLibrary?.subject ?? editor.subject,
                    stage: baseLibrary?.stage ?? editor.stage,
                    isDefault: false,
                  })
                }}>
                  <option value="">请选择</option>
                  {knowledgeLibraries.map((library) => <option key={library.id} value={library.id}>{library.name} · {library.subject} · {stageLabel(library.stage)}</option>)}
                </select>
              </label>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">{activeMeta.sectionLabel}与{activeMeta.pointLabel}</h3>
            <Button size="sm" variant="outline" icon={Plus} onClick={() => markEditor({
              ...editor,
              chapters: [...editor.chapters, {
                id: makeId('chapter'),
                code: `${editor.libraryType === 'method_tag' ? 'MG' : 'CH'}_${editor.chapters.length + 1}`,
                name: editor.libraryType === 'method_tag' ? '新分组' : '新章节',
                sortOrder: editor.chapters.length + 1,
                knowledgePoints: [{
                  id: makeId('point'),
                  code: editor.libraryType === 'method_tag' ? 'MT_NEW' : 'KP_NEW',
                  name: editor.libraryType === 'method_tag' ? '新方法题型标签' : '新知识点',
                  tagType: editor.libraryType === 'method_tag' ? 'method' : 'knowledge',
                  sortOrder: 1,
                }],
              }],
            })}>添加{activeMeta.sectionLabel}</Button>
          </div>

          <div className="space-y-3">
            {editor.chapters.map((chapter, chapterIndex) => {
              const expanded = expandedIds.has(chapter.id)
              const isDragging = draggedChapterId === chapter.id
              const isDragTarget = dragOverChapterId === chapter.id && draggedChapterId !== chapter.id
              return (
                <article
                  key={chapter.id}
                  draggable
                  onDragStart={(event) => {
                    const target = event.target as HTMLElement
                    const fromHandle = Boolean(target.closest('[data-chapter-drag-handle]'))
                    const blockedControl = Boolean(target.closest('input, textarea, select, button, a'))
                    if (!fromHandle && blockedControl) {
                      event.preventDefault()
                      return
                    }
                    setDraggedChapterId(chapter.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', chapter.id)
                  }}
                  onDragEnd={() => {
                    setDraggedChapterId(null)
                    setDragOverChapterId(null)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDragOverChapterId(chapter.id)
                  }}
                  onDragLeave={() => setDragOverChapterId((current) => current === chapter.id ? null : current)}
                  onDrop={(event) => {
                    event.preventDefault()
                    const sourceChapterId = draggedChapterId ?? event.dataTransfer.getData('text/plain')
                    reorderChapter(sourceChapterId, chapter.id)
                    setDraggedChapterId(null)
                    setDragOverChapterId(null)
                  }}
                  className={`overflow-hidden rounded-xl border bg-zinc-50 p-3 transition-all duration-150 dark:bg-zinc-950/50 ${
                    isDragTarget ? 'border-zinc-900 shadow-lg ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100' : ''
                  } ${isDragging ? 'scale-[0.985] opacity-50' : 'scale-100 opacity-100'}`}
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="grid min-w-0 grid-cols-[36px_52px_minmax(0,1fr)] items-center gap-3">
                      <button
                        aria-label="拖动章节排序"
                        className="flex size-9 cursor-grab items-center justify-center rounded-lg border bg-white text-zinc-500 active:cursor-grabbing dark:bg-zinc-900"
                        data-chapter-drag-handle
                        title="拖动排序"
                        type="button"
                      >
                        <GripVertical className="size-4" />
                      </button>
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-white text-xs font-semibold text-zinc-500 dark:bg-zinc-900">{String(chapterIndex + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <div className="break-words font-semibold">{chapter.name || `未命名${activeMeta.sectionLabel}`}</div>
                        <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-zinc-500">
                          <span>{activeMeta.sectionLabel} {chapterIndex + 1}</span>
                          <span>{chapter.knowledgePoints.length} 个{activeMeta.pointLabel}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setExpandedIds((current) => {
                        const next = new Set(current)
                        if (next.has(chapter.id)) next.delete(chapter.id)
                        else next.add(chapter.id)
                        return next
                      })}
                    >
                      <ChevronDown className={`size-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
                      {expanded ? '收起' : '展开'}
                    </Button>
                  </div>

                  <div className={`grid transition-all duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                      <div className="mt-3 space-y-3 border-t pt-3">
                        <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_90px_36px] md:items-end">
                          <label className="grid gap-1.5">
                            <span className="text-xs text-zinc-500">{activeMeta.sectionLabel} code</span>
                            <input className={inputClass('h-9')} value={chapter.code} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, code: event.target.value }))} />
                          </label>
                          <label className="grid gap-1.5">
                            <span className="text-xs text-zinc-500">{activeMeta.sectionLabel}名称</span>
                            <input className={inputClass('h-9')} value={chapter.name} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, name: event.target.value }))} />
                          </label>
                          <label className="grid gap-1.5">
                            <span className="text-xs text-zinc-500">排序</span>
                            <input className={inputClass('h-9')} type="number" value={chapter.sortOrder} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, sortOrder: Number(event.target.value) || chapterIndex + 1 }))} />
                          </label>
                          <button className="flex size-9 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white dark:border-red-950 dark:bg-red-950/30 dark:text-red-300" onClick={() => markEditor({ ...editor, chapters: editor.chapters.filter((_, index) => index !== chapterIndex) })} type="button"><Trash2 className="size-4" /></button>
                        </div>

                        <div className="space-y-2">
                          {chapter.knowledgePoints.map((point, pointIndex) => (
                            <div key={point.id} className={`grid gap-2 rounded-lg border bg-white p-2 dark:bg-zinc-900 ${editor.libraryType === 'method_tag' ? 'md:grid-cols-[130px_minmax(0,1fr)_120px_minmax(0,1fr)_36px]' : 'md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)_36px]'}`}>
                              <input className={inputClass('h-9 font-mono text-xs')} value={point.code} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.map((kp, index) => index === pointIndex ? { ...kp, code: event.target.value } : kp) }))} />
                              <input className={inputClass('h-9')} value={point.name} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.map((kp, index) => index === pointIndex ? { ...kp, name: event.target.value } : kp) }))} />
                              {editor.libraryType === 'method_tag' ? (
                                <select className={inputClass('h-9')} value={point.tagType ?? 'method'} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.map((kp, index) => index === pointIndex ? { ...kp, tagType: event.target.value } : kp) }))}>
                                  <option value="method">方法</option>
                                  <option value="problem_type">题型</option>
                                  <option value="strategy">策略</option>
                                  <option value="other">其他</option>
                                </select>
                              ) : null}
                              <input className={inputClass('h-9')} placeholder={editor.libraryType === 'method_tag' ? '适用知识点，用顿号分隔' : '说明（可选）'} value={editor.libraryType === 'method_tag' ? (point.appliesTo ?? []).join('、') : point.description ?? ''} onChange={(event) => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.map((kp, index) => index === pointIndex ? editor.libraryType === 'method_tag' ? { ...kp, appliesTo: event.target.value.split(/[、,，;；/]+/).map((value) => value.trim()).filter(Boolean) } : { ...kp, description: event.target.value || undefined } : kp) }))} />
                              <button className="flex size-9 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white dark:border-red-950 dark:bg-red-950/30 dark:text-red-300" onClick={() => updateChapter(chapterIndex, (item) => ({ ...item, knowledgePoints: item.knowledgePoints.filter((_, index) => index !== pointIndex) }))} type="button"><Trash2 className="size-4" /></button>
                            </div>
                          ))}
                          <Button size="sm" variant="outline" icon={Plus} onClick={() => updateChapter(chapterIndex, (item) => ({
                            ...item,
                            knowledgePoints: [...item.knowledgePoints, {
                              id: makeId('point'),
                              code: `${editor.libraryType === 'method_tag' ? 'MT' : 'KP'}_${item.knowledgePoints.length + 1}`,
                              name: editor.libraryType === 'method_tag' ? '新方法题型标签' : '新知识点',
                              tagType: editor.libraryType === 'method_tag' ? 'method' : 'knowledge',
                              sortOrder: item.knowledgePoints.length + 1,
                            }],
                          }))}>添加{activeMeta.pointLabel}</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      ) : (
        <Empty text="请选择或新建标签库。" />
      )}
    </section>
  )
}
