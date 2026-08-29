import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, EyeOff, FileDown, FileText, GripVertical, HelpCircle, NotebookPen, PencilLine, Save, Settings2, ShoppingBag, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '../ui'
import { EditDialog } from '../questions/EditDialog'
import { Modal } from '../dialogs/Modal'
import { basketCardOutlineButtonClass, basketCardDangerButtonClass, getDefaultScore, stripLeadingQuestionNo } from './constants'
import type { BasketState } from './useBasketState'
import {
  QuestionCardContextLabel,
  QuestionCardFooter,
  QuestionCardFrame,
  QuestionCardHeader,
  QuestionCardKnowledge,
  QuestionCardSolution,
  QuestionCardStem,
  resolveQuestionCardContent,
} from '../questions/workbench/QuestionCard'

export function BasketPageView({
  state,
  onSnapshotsOpenChange,
}: {
  state: BasketState
  onSnapshotsOpenChange: (open: boolean) => void
}) {
  const {
    navigate,
    editingPaperId, activeId,
    exporting,
    draggedIndex, setDraggedIndex,
    localTitle, setLocalTitle,
    localSubtitle, setLocalSubtitle,
    localTimeLimit, setLocalTimeLimit,
    pageVariant, setPageVariant,
    expandedQuestionIds, setExpandedQuestionIds,
    editingItem, setEditingItem,
    editDraft, setEditDraft,
    paperSaveAction,
    paperTitleInput, setPaperTitleInput,
    savingPaper,
    saveNotice,
    showMoreSettings, setShowMoreSettings,
    active, layoutDrafts,
    totalScore, activeQuestions, allExpanded,
    savedPapers,
    toggleExpandAll,
    backToBasket,
    openSaveDialog, closeSaveDialog, confirmSavePaper, overwriteSavePaper,
    patchCollection, patchItem, removeItem, clearCollection, moveItem,
    openEditor, saveEditedQuestion,
    exportCollection, createLayoutDraft,
    importingDocument, importToTeachingDocument,
    handleDragDrop,
  } = state

  return (
    <div className="mock-page-root relative flex min-h-[calc(100vh-6rem)] flex-col overflow-auto bg-zinc-50/20 select-none xl:h-[calc(100vh-6rem)] xl:flex-row xl:overflow-hidden dark:bg-zinc-950">
      <main className="flex min-h-[560px] min-w-0 flex-1 flex-col overflow-hidden border-b border-zinc-200 bg-zinc-50/10 xl:min-h-0 xl:border-b-0 xl:border-r dark:border-zinc-800">
        <div className="h-12 shrink-0 border-b border-zinc-200 bg-white flex items-center justify-between px-4 dark:bg-zinc-900 dark:border-zinc-800">
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            试题大纲与分值分配 ({active.data?.questions.length ?? 0} 道试题)
          </span>
          <div className="flex items-center gap-2">
            {activeQuestions.length ? (
              <button onClick={toggleExpandAll} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 transition-colors">
                {allExpanded ? <><ChevronUp className="size-3.5" />收起全部解析</> : <><ChevronDown className="size-3.5" />展开所有解析</>}
              </button>
            ) : null}
            <button onClick={() => navigate('/questions')} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 transition-colors">
              <ChevronLeft className="size-3.5" />
              返回题库
            </button>
            {active.data?.questions.length ? (
              <button onClick={clearCollection} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-200 bg-white text-zinc-500 hover:text-red-650 hover:bg-red-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-red-400 transition-colors">
                <Trash2 className="size-3.5" />
                清空列表
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!active.data?.questions.length ? (
            <div className="flex flex-col items-center justify-center h-64 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-400 text-xs bg-white dark:bg-zinc-900/20">
              <HelpCircle className="size-8 text-zinc-300 dark:text-zinc-700 mb-2" />
              <span>你的试题篮是空的</span>
              <button onClick={() => navigate('/questions')} className="mt-3 text-xs text-zinc-900 dark:text-zinc-100 font-semibold hover:underline">
                前去题库管理添加题目
              </button>
            </div>
          ) : (
            <div className="space-y-3 pb-16">
              {active.data.questions.map((entry, index) => {
                const itemKey = entry.relationId || entry.item.id
                const showAnalysis = expandedQuestionIds.has(itemKey)
                const { stem } = resolveQuestionCardContent(entry.item)

                return (
                  <QuestionCardFrame
                    key={itemKey}
                    draggable
                    animateLayout
                    dragging={draggedIndex === index}
                    className="cursor-grab active:cursor-grabbing"
                    onDragStartCapture={(event) => {
                      if ((event.target as HTMLElement).closest('button, input')) {
                        event.preventDefault()
                        return
                      }
                      setDraggedIndex(index)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragEnd={() => setDraggedIndex(null)}
                    onDrop={async (event) => {
                      event.preventDefault()
                      if (draggedIndex === null) return
                      await handleDragDrop(draggedIndex, index)
                    }}
                  >
                    <QuestionCardHeader
                      item={entry.item}
                      leading={
                        <>
                          <GripVertical className="size-4 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-500" />
                          <QuestionCardContextLabel>第 {index + 1} 题</QuestionCardContextLabel>
                        </>
                      }
                    />
                    <QuestionCardStem item={entry.item} content={stripLeadingQuestionNo(stem || '题干为空', entry.item.questionNo)} />
                    <QuestionCardKnowledge item={entry.item} />
                    <QuestionCardSolution item={entry.item} open={showAnalysis} />
                    <QuestionCardFooter
                      item={entry.item}
                      open={showAnalysis}
                      actions={
                        <>
                        <label className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[10px] font-medium text-zinc-500 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                          分值
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={entry.score || ''}
                            placeholder={String(getDefaultScore(entry.item.questionType))}
                            onChange={(event) => entry.relationId && patchItem(entry.relationId, { score: Number(event.target.value || 0) })}
                            className="w-8 border-0 bg-transparent p-0 text-center font-mono text-xs font-semibold text-zinc-800 outline-none focus:ring-0 dark:text-zinc-200"
                          />
                          分
                        </label>
                        <button type="button" onClick={() => openEditor(entry.item)} className={basketCardOutlineButtonClass}>
                          <PencilLine className="size-3.5" />编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedQuestionIds((current) => {
                            const next = new Set(current)
                            if (next.has(itemKey)) next.delete(itemKey)
                            else next.add(itemKey)
                            return next
                          })}
                          className={basketCardOutlineButtonClass}
                        >
                          {showAnalysis ? <><ChevronUp className="size-3.5" />收起解析</> : <><ChevronDown className="size-3.5" />查看解析</>}
                        </button>
                        <button type="button" onClick={() => entry.relationId && moveItem(entry.relationId, -1)} disabled={index === 0} className={basketCardOutlineButtonClass} title="上移">
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button type="button" onClick={() => entry.relationId && moveItem(entry.relationId, 1)} disabled={index === activeQuestions.length - 1} className={basketCardOutlineButtonClass} title="下移">
                          <ArrowDown className="size-3.5" />
                        </button>
                        <button type="button" onClick={() => entry.relationId && removeItem(entry.relationId)} className={basketCardDangerButtonClass}>
                          <Trash2 className="size-3.5" />移出试题篮
                        </button>
                        </>
                      }
                    />
                  </QuestionCardFrame>
                )
              })}
            </div>
          )}
        </div>
      </main>

      <aside className="flex w-full shrink-0 flex-col justify-between overflow-y-auto bg-white p-5 text-left xl:w-[360px] xl:border-l xl:border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-5">
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/70 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {editingPaperId ? <FileText className="size-3.5" /> : <ShoppingBag className="size-3.5" />}
                {editingPaperId ? '正在编辑组卷快照' : '试题篮 · 唯一暂存区'}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {editingPaperId ? (
                  <button type="button" onClick={backToBasket} title="返回试题篮" className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                    <ChevronLeft className="size-3" />
                    返回试题篮
                  </button>
                ) : null}
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{active.data?.questionCount ?? 0}题</span>
              </div>
            </div>
            <div className="space-y-3 px-4 py-3.5">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">组卷标题</span>
                <input value={localTitle} onChange={(event) => setLocalTitle(event.target.value)} onBlur={() => localTitle !== active.data?.title && patchCollection({ title: localTitle })} className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200" placeholder="组卷" />
              </label>
              <div>
                <button type="button" onClick={() => setShowMoreSettings((value) => !value)} className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                  <ChevronDown className={`size-3.5 transition-transform duration-200 ${showMoreSettings ? '' : '-rotate-90'}`} />
                  更多设置（副标题 · 考试时长）
                </button>
                {showMoreSettings ? (
                  <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">副标题与考试说明</span>
                      <textarea value={localSubtitle} onChange={(event) => setLocalSubtitle(event.target.value)} onBlur={() => localSubtitle !== (active.data?.subtitle || '') && patchCollection({ subtitle: localSubtitle })} rows={2} className="w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 font-sans text-xs text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200" placeholder="考试时间、分数、班级、姓名等信息栏说明" />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">考试时长（分钟）</span>
                      <input type="number" value={localTimeLimit} onChange={(event) => setLocalTimeLimit(event.target.value)} onBlur={() => Number(localTimeLimit) !== (active.data?.timeLimit || 0) && patchCollection({ timeLimit: Number(localTimeLimit || 0) })} className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200" />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/50 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              {editingPaperId ? (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void overwriteSavePaper()} disabled={savingPaper} className="flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-50 shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200">
                  <Save className="size-3.5" />
                  {savingPaper ? '保存中…' : '覆盖保存'}
                </button>
                <button type="button" onClick={() => openSaveDialog('save_as')} disabled={savingPaper || !activeQuestions.length} className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-xs transition-all hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  <Copy className="size-3.5" />
                  另存为新卷
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => openSaveDialog('save_clear')} disabled={savingPaper || !activeQuestions.length} className="flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-50 shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200">
                  <Save className="size-3.5" />
                  保存并清空
                </button>
                <button type="button" onClick={() => openSaveDialog('save_copy')} disabled={savingPaper || !activeQuestions.length} className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-xs transition-all hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  <Copy className="size-3.5" />
                  保存副本
                </button>
              </div>
            )}
              <p className="text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                {editingPaperId ? '题目修改已实时写入当前快照；“覆盖保存”用于提交标题与考试设置。' : '保存时会创建一份独立组卷快照，试题篮是唯一暂存区。'}
              </p>
              {saveNotice ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{saveNotice}</span> : null}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/25">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">组卷快照</span>
                  <span className="font-mono text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">{savedPapers.length}</span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">保存后的题目组合，可随时恢复继续组卷。</p>
              </div>
              <button type="button" onClick={() => onSnapshotsOpenChange(true)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
                查看快照
                <ChevronRight className="size-3" />
              </button>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/25">
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">文档类型</span>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'exam', icon: FileText, label: '试卷' },
                  { value: 'error_notebook', icon: NotebookPen, label: '错题本' },
                ] as const).map((option) => {
                  const selected = option.value === 'error_notebook' ? pageVariant === 'error_notebook' : pageVariant !== 'error_notebook'
                  const Icon = option.icon
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPageVariant(option.value === 'error_notebook' ? 'error_notebook' : 'teacher')}
                      className={`flex flex-col items-center gap-1.5 p-2.5 border rounded-lg transition-all duration-150 active:scale-[0.98] ${selected ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900/60' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800'}`}
                    >
                      <Icon className={`size-5 ${selected ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500'}`} />
                      <span className={`text-[11px] leading-tight ${selected ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>{option.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 divide-x divide-zinc-200/80 border-t border-zinc-200/80 pt-3 dark:divide-zinc-800 dark:border-zinc-800">
              <div className="px-1 text-center">
                <span className="block text-sm font-bold text-zinc-800 dark:text-zinc-200">{active.data?.questionCount ?? 0}</span>
                <span className="block text-[9px] text-zinc-400 dark:text-zinc-500">试题数</span>
              </div>
              <div className="px-1 text-center">
                <span className="block font-mono text-sm font-bold text-zinc-800 dark:text-zinc-200">{totalScore}</span>
                <span className="block text-[9px] text-zinc-400 dark:text-zinc-500">估算总分</span>
              </div>
              <div className="px-1 text-center">
                <span className="block text-sm font-bold text-zinc-800 dark:text-zinc-200">{localTimeLimit || '-'}</span>
                <span className="block text-[9px] text-zinc-400 dark:text-zinc-500">时长（分）</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <button
            onClick={() => void importToTeachingDocument()}
            disabled={importingDocument || !active.data?.questionCount}
            title={pageVariant === 'error_notebook'
              ? '生成错题集文档：仅保留题目，隐藏标题与章节，随后可在文档编辑器中继续编辑'
              : '将当前题目一键生成试卷文档，题目按题型自动分组，随后可在文档编辑器中继续编辑'}
            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 py-2.5 text-xs font-semibold text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <NotebookPen className="size-3.5" />
            {importingDocument
              ? (pageVariant === 'error_notebook' ? '正在生成错题集文档…' : '正在生成试卷文档…')
              : (pageVariant === 'error_notebook' ? '生成错题集文档' : '生成试卷文档')}
          </button>
        </div>
      </aside>
      {editingItem ? <EditDialog draft={editDraft} setDraft={setEditDraft} onClose={() => setEditingItem(null)} onSave={saveEditedQuestion} /> : null}
      {paperSaveAction ? (
        <Modal
          title={paperSaveAction === 'save_as' ? '另存为组卷快照' : '保存组卷快照'}
          desc={'将当前题目保存为一份独立组卷快照，可随时恢复、修改或生成试卷文档。'}
          onClose={closeSaveDialog}
        >
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">快照标题</span>
              <input
                autoFocus
                value={paperTitleInput}
                onChange={(event) => setPaperTitleInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void confirmSavePaper() }}
                placeholder="请输入快照标题"
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200"
              />
            </label>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {paperSaveAction === 'save_clear'
                ? '保存后试题篮将被清空，题目保留在这份组卷快照中，可随时恢复。'
                : paperSaveAction === 'save_copy'
                  ? '保存后试题篮中的题目保持不变，相当于为当前题目创建一份快照。'
                  : '将以当前组卷的题目创建一份新快照，原快照保持不变。'}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={closeSaveDialog} disabled={savingPaper}>取消</Button>
              <Button size="sm" onClick={() => void confirmSavePaper()} disabled={savingPaper || !paperTitleInput.trim()}>
                {savingPaper ? '保存中…' : '保存快照'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
