import {
  AlertTriangle,
  ArrowRightLeft,
  BadgeAlert,
  Check,
  CheckCircle2,
  Compass,
  FileText,
  HelpCircle,
  ImageIcon,
  Layers,
  LoaderCircle,
  PencilLine,
  SkipForward,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { ReviewActionMenu } from '@/components/import-v2/ReviewActionMenu'
import { FigureGallery, MarkdownWithInlineFigures, QuestionMarkdownContent } from '@/components/questions/QuestionContent'
import { parserDiagnosticLabel } from '@/utils/importDiagnostics'
import { assetUrl } from '@/utils/questionDisplay'
import { issueLabel, questionReviewState } from '../importV2PageModel'
import type { ImportV2WorkspaceState } from '../useImportV2Workspace'

export function CandidateReviewWorkspace({ ws }: { ws: ImportV2WorkspaceState }) {
  return (
    <div
      ref={ws.checkAreaRef}
      className="flex h-auto min-h-0 flex-col overflow-hidden rounded-2xl border border-black/6 bg-white/70 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-900/70 shadow-2xs lg:h-full lg:min-h-[30rem] lg:flex-row"
    >
      <CandidateListSidebar ws={ws} />
      <CandidateDetailPanel ws={ws} />
    </div>
  )
}

function CandidateListSidebar({ ws }: { ws: ImportV2WorkspaceState }) {
  return (
    <aside className="flex w-full shrink-0 flex-col bg-black/2 dark:bg-white/2 lg:w-80 xl:w-[23rem] 2xl:w-[26rem] lg:border-r lg:border-black/6 dark:lg:border-white/8">
      <div className="shrink-0 border-b border-black/6 dark:border-white/8 bg-white/50 dark:bg-zinc-900/50 p-2 space-y-2">
        <nav aria-label="候选题状态筛选" className="grid grid-cols-4 gap-1 w-full bg-black/4 dark:bg-white/6 p-1 rounded-xl border border-black/5 dark:border-white/8 select-none">
          {ws.reviewTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => ws.setReviewTab(item.key)}
              className={`flex items-center justify-center gap-0.5 py-1.5 px-1 rounded-lg text-[11px] xl:text-xs font-semibold transition-all duration-200 ease-out cursor-pointer active:scale-95 whitespace-nowrap min-w-0 ${
                ws.activeTab === item.key
                  ? 'bg-zinc-900 text-white shadow-2xs dark:bg-zinc-100 dark:text-zinc-900 font-bold scale-[1.02]'
                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-black/5 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/10'
              }`}
            >
              <span>{item.label}</span>
              <span className="font-mono text-[10px] opacity-75">({item.count})</span>
            </button>
          ))}
        </nav>
        <div className="flex min-h-9 items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={ws.handleSelectAll}
            className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100 transition-colors"
          >
            <span className={`flex size-4 shrink-0 items-center justify-center rounded-md border transition-all duration-150 active:scale-90 ${
              ws.allSelected ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 shadow-2xs' : 'border-black/10 bg-white dark:border-white/12 dark:bg-zinc-900'
            }`}>
              {ws.allSelected ? <Check className="size-3 stroke-[3]" /> : null}
            </span>
            <span className="truncate">{ws.selectedIds.size ? `已选择 ${ws.selectedIds.size} 题` : `${ws.selectableList.length} 题可批量处理`}</span>
          </button>
          {ws.parseDiagnosticCounts.length > 0 ? (
            <select
              aria-label="结构诊断筛选"
              value={ws.activeDiagnosticCode}
              onChange={(event) => { ws.setActiveDiagnosticCode(event.target.value); ws.handleSelectAll() }}
              className="h-7.5 min-w-0 max-w-32 rounded-xl border border-black/10 bg-white/90 px-2 text-[10px] font-medium text-zinc-700 shadow-2xs outline-none focus:border-zinc-900 dark:border-white/12 dark:bg-zinc-900/90 dark:text-zinc-200 cursor-pointer"
            >
              <option value="">结构诊断</option>
              {ws.parseDiagnosticCounts.slice(0, 8).map((item) => (
                <option key={item.code} value={item.code}>{parserDiagnosticLabel(item.code)} {item.count}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      <div ref={ws.candidateListRef} data-testid="candidate-list-scroll" className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-1.5">
        {ws.filteredQuestions.length === 0 ? (
          <div className="flex h-48 items-center justify-center px-6 text-center text-xs text-zinc-400">此筛选条件下暂无题目</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {ws.filteredQuestions.map((q) => {
              const isCommitted = q.status === 'committed' || ws.committedIds.has(q.id)
              const isSelected = ws.selectedIds.has(q.id)
              const isActive = q.id === ws.activeQuestionId
              const reviewState = questionReviewState(q, isCommitted)

              return (
                <div
                  key={q.id}
                  ref={(node) => {
                    if (node) ws.candidateItemRefs.current.set(q.id, node)
                    else ws.candidateItemRefs.current.delete(q.id)
                  }}
                  className={`group flex items-center gap-2 rounded-xl border py-2.5 pl-2.5 pr-3 transition-all duration-200 ease-out shadow-2xs ${
                    isActive
                      ? 'border-zinc-900/40 bg-zinc-900/8 dark:border-zinc-100/40 dark:bg-zinc-100/12 shadow-xs translate-x-1 font-semibold ring-1 ring-zinc-900/10 dark:ring-white/15'
                      : 'border-black/6 bg-white/80 hover:bg-white hover:border-black/20 hover:shadow-xs hover:translate-x-0.5 dark:border-white/8 dark:bg-zinc-900/80 dark:hover:bg-zinc-900 dark:hover:border-white/20'
                  }`}
                >
                  <button
                    type="button"
                    aria-label={`选择第 ${q.questionNo || '未编号'} 题`}
                    disabled={isCommitted}
                    onClick={(e) => { e.stopPropagation(); ws.handleSelectToggle(q.id) }}
                    className={`flex size-4 shrink-0 items-center justify-center rounded-md border transition-all duration-150 active:scale-90 ${isCommitted ? 'cursor-not-allowed opacity-25' : ''} ${
                      isSelected
                        ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 shadow-2xs scale-105'
                        : 'border-black/15 bg-white hover:border-black/30 dark:border-white/20 dark:bg-zinc-900'
                    }`}
                  >
                    {isSelected ? <Check className="size-3 stroke-[3]" /> : null}
                  </button>
                  <button
                    type="button"
                    aria-label={`打开第 ${q.questionNo || '未编号'} 题`}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => {
                      ws.setActiveQuestionId(q.id)
                      const sourceDocId = q.rawItem?.sourceDocumentId || ws.selectedDoc?.id
                      if (sourceDocId) ws.navigateToCandidate(sourceDocId, q.id)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none cursor-pointer"
                  >
                    <span className={`shrink-0 text-xs tracking-tight transition-colors duration-150 ${
                      isActive ? 'font-bold text-zinc-900 dark:text-zinc-50' : 'font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-zinc-950 dark:group-hover:text-white'
                    }`}>
                      第 {q.questionNo || '？'} 题
                    </span>
                    {q.questionType ? <span className="min-w-0 truncate text-[10px] text-zinc-400 font-medium group-hover:text-zinc-500 transition-colors">{q.questionType}</span> : null}
                    {q.hasFigures ? <ImageIcon className="size-3 shrink-0 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" aria-label="包含题图" /> : null}
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[10px]">
                      <span className={`size-1.5 rounded-full transition-transform duration-200 group-hover:scale-125 ${reviewState.dotClass}`} />
                      <span className={reviewState.textClass}>{reviewState.label}</span>
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {ws.selectedIds.size > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-black/6 dark:border-white/8 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md p-2.5 shadow-lg">
          <span className="min-w-0 flex-1 truncate pl-1 text-xs font-semibold text-zinc-700 dark:text-zinc-200">已选 {ws.selectedIds.size} 题</span>
          <Button size="xs" variant="outline" icon={SkipForward} disabled={Boolean(ws.busy)} onClick={ws.handleBulkSkip} className="rounded-xl border-black/10">跳过</Button>
          <Button size="xs" icon={CheckCircle2} disabled={Boolean(ws.busy)} onClick={ws.handleBulkConfirm} className="rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold shadow-2xs">批量入库</Button>
        </div>
      ) : null}
    </aside>
  )
}

function CandidateDetailPanel({ ws }: { ws: ImportV2WorkspaceState }) {
  const { activeQuestion } = ws

  if (!activeQuestion) {
    return (
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white/30 dark:bg-zinc-900/30">
        <div className="flex h-full items-center justify-center p-6 text-xs text-zinc-400">
          请从左侧选择题目
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white/40 dark:bg-zinc-900/40">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex shrink-0 items-center gap-4 border-b border-black/6 dark:border-white/8 bg-white/80 dark:bg-zinc-900/80 px-5 py-3.5 backdrop-blur-md">
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            <h2 className="flex shrink-0 items-center gap-1 text-sm font-bold text-zinc-900 dark:text-zinc-50">
              <span>第</span>
              <input
                type="text"
                value={ws.editingQuestionNo}
                onChange={(e) => ws.setEditingQuestionNo(e.target.value)}
                onBlur={ws.handleSaveQuestionNo}
                onKeyDown={(e) => { if (e.key === 'Enter') { ws.handleSaveQuestionNo(); e.currentTarget.blur() } }}
                disabled={ws.activeQuestionCommitted}
                aria-label="题号"
                className="h-8 w-12 rounded-xl border border-black/10 bg-white px-1 text-center text-xs font-bold text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100 disabled:opacity-50"
              />
              <span>题</span>
            </h2>
            <span className="hidden h-4 w-px bg-black/10 dark:bg-white/10 sm:block" />
            <select
              aria-label="题型"
              className="h-8 min-w-24 shrink-0 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 dark:border-white/12 dark:bg-zinc-900 dark:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              value={activeQuestion.questionType || ''}
              disabled={ws.activeQuestionCommitted || ws.savingQuestionType === activeQuestion.id}
              onChange={(event) => ws.handleSaveQuestionType(event.target.value)}
            >
              <option value="">自动判断题型</option>
              <option value="单选题">单选题</option>
              <option value="多选题">多选题</option>
              <option value="填空题">填空题</option>
              <option value="解答题">解答题</option>
            </select>
            {ws.activeQuestionReviewState ? (
              <span className={`hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold xl:flex ${ws.activeQuestionReviewState.textClass}`}>
                <span className={`size-2 rounded-full ${ws.activeQuestionReviewState.dotClass}`} />
                {ws.savingQuestionType === activeQuestion.id ? '保存中...' : ws.activeQuestionReviewState.label}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" icon={PencilLine} disabled={ws.activeQuestionCommitted || Boolean(ws.busy)} onClick={() => ws.startManualFix(activeQuestion.id, 'stem')} className="rounded-xl border-black/10 bg-white hover:bg-zinc-50 dark:border-white/12 dark:bg-zinc-800 text-xs font-semibold shadow-2xs active:scale-95">
              编辑
            </Button>
            <Button
              size="sm"
              icon={ws.activeQuestionCommitted || ws.busy !== activeQuestion.id ? CheckCircle2 : LoaderCircle}
              disabled={ws.activeQuestionCommitted || ws.busy === activeQuestion.id || !activeQuestion.stemMarkdown.trim()}
              onClick={() => ws.commitSingleQuestion(activeQuestion)}
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-xs font-semibold shadow-2xs active:scale-95"
            >
              {ws.activeQuestionCommitted ? '已入库' : '确认入库'}
            </Button>
            <ReviewActionMenu
              label={`第 ${activeQuestion.questionNo || '未编号'} 题更多操作`}
              actions={[
                { label: '查看题干来源', icon: FileText, onSelect: () => ws.openActiveQuestionMarkdownPreview('stem') },
                {
                  label: '删除候选题', hint: '同时清除关联的框选草稿', icon: Trash2, danger: true,
                  disabled: ws.activeQuestionCommitted || Boolean(ws.busy), separatorBefore: true,
                  onSelect: () => ws.handleDeleteCandidate(activeQuestion.id),
                },
              ]}
            />
          </div>
        </header>

        {/* Scrollable content */}
        <div data-testid="candidate-review-content" tabIndex={0} aria-label="当前题校对内容" className="flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <div className="mx-auto w-full max-w-5xl px-6 py-5 xl:px-9">
            {/* Similar question warning */}
            {activeQuestion.similarQuestions && activeQuestion.similarQuestions.length > 0 && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-black/8 bg-black/3 p-4 text-xs text-zinc-800 dark:border-white/10 dark:bg-white/4 dark:text-zinc-200 shadow-2xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div className="space-y-1">
                  <p className="font-bold text-zinc-900 dark:text-zinc-100">重复入库预警</p>
                  <p className="leading-relaxed text-zinc-600 dark:text-zinc-300">
                    AI 检测到该题与系统中已有题目内容高度相似（重合度 {Math.round((activeQuestion.similarQuestions[0].similarity || 0.9) * 100)}%）。请确认是否属于相同试题。
                  </p>
                  <p className="pt-1 text-[10px] text-zinc-400">
                    <strong>相似题来源：</strong> {activeQuestion.similarQuestions[0].sourceTitle || '外部题库'} (第 {activeQuestion.similarQuestions[0].questionNo} 题)
                  </p>
                </div>
              </div>
            )}

            {/* Issues banner */}
            {activeQuestion.issues && activeQuestion.issues.length > 0 && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-black/8 bg-black/3 p-4 text-xs text-zinc-800 dark:border-white/10 dark:bg-white/4 dark:text-zinc-200 shadow-2xs">
                <BadgeAlert className="mt-0.5 size-4 shrink-0 text-rose-500" />
                <div className="space-y-1.5 flex-1 min-w-0">
                  <p className="font-bold text-zinc-900 dark:text-zinc-100">核对提示</p>
                  <ul className="list-disc pl-4 space-y-1.5">
                    {activeQuestion.issues.map((issue, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {issueLabel(issue.code) ? <span className="font-bold text-zinc-900 dark:text-zinc-100">【{issueLabel(issue.code)}】</span> : null}
                        <span>{issue.message}</span>
                        {['missing_answer', 'missing_analysis', 'missing_solution', 'solution_conflict', 'unmatched_solution'].includes(issue.code || '') ? (
                          <button
                            type="button"
                            onClick={() => ws.openActiveQuestionMarkdownPreview(issue.code === 'missing_answer' ? 'answer' : 'analysis')}
                            className="ml-2 inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-white dark:border-white/12 dark:bg-zinc-800 dark:text-zinc-200 shadow-2xs transition-all active:scale-95"
                          >
                            <HelpCircle className="size-3" />
                            查看原因
                          </button>
                        ) : null}
                        {issue.code === 'unplaced_figure' && issue.relatedFigures?.length ? (
                          <UnplacedFigureResolver ws={ws} issue={issue} />
                        ) : issue.code === 'unplaced_figure' ? (
                          <p className="mt-1 text-[10px] text-rose-500 font-medium">未找到对应图片文件，可尝试重新识别后再核对。</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Parse diagnostics */}
            {ws.visibleActiveParseDiagnostics.length > 0 && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-black/8 bg-black/3 p-4 text-xs text-zinc-800 dark:border-white/10 dark:bg-white/4 dark:text-zinc-200 shadow-2xs">
                <HelpCircle className="size-4 shrink-0 text-amber-500 mt-0.5" />
                <div className="space-y-1.5 flex-1 min-w-0">
                  <p className="font-bold text-zinc-900 dark:text-zinc-100">结构诊断</p>
                  <ul className="list-disc pl-4 space-y-1.5">
                    {ws.visibleActiveParseDiagnostics.slice(0, 6).map((diagnostic, idx) => (
                      <li key={`${diagnostic.code}:${idx}`} className="leading-relaxed">
                        <span className="font-bold text-zinc-900 dark:text-zinc-100">【{parserDiagnosticLabel(diagnostic.code)}】</span>
                        <span>{diagnostic.message}</span>
                        <button
                          type="button"
                          onClick={() => ws.openActiveQuestionMarkdownPreview(diagnostic.code.includes('answer') ? 'answer' : 'analysis')}
                          className="ml-2 inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-white dark:border-white/12 dark:bg-zinc-800 dark:text-zinc-200 shadow-2xs transition-all active:scale-95"
                        >
                          <HelpCircle className="size-3" />
                          查看来源
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Stem */}
            <section className="pb-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Layers className="size-3.5 text-muted-foreground" />
                <span>题干内容</span>
              </div>
              <div className="mt-4 text-[15px] leading-8 text-foreground">
                <QuestionMarkdownContent content={activeQuestion.stemMarkdown || '（空）'} figures={activeQuestion.figures} className="text-sm font-normal" />
              </div>
            </section>

            {/* Figure management */}
            {activeQuestion.figures.length ? (
              <FigureManagementSection ws={ws} />
            ) : null}

            {/* Answer */}
            <section className="border-t border-border py-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>自动识别答案</span>
                <button type="button" onClick={() => ws.openActiveQuestionMarkdownPreview('answer')} aria-label="查看答案来源" className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="查看答案来源">
                  <FileText className="size-3.5" />
                </button>
              </div>
              <div className="mt-4 text-[15px] leading-8 text-foreground">
                <MarkdownWithInlineFigures content={activeQuestion.answerText || '（无）'} figures={activeQuestion.figures} className="text-sm font-normal" />
              </div>
            </section>

            {/* Analysis */}
            <section className="border-t border-border py-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Compass className="size-3.5 text-muted-foreground" />
                <span>自动解析步骤</span>
                <button type="button" onClick={() => ws.openActiveQuestionMarkdownPreview('analysis')} aria-label="查看解析来源" className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title="查看解析来源">
                  <FileText className="size-3.5" />
                </button>
              </div>
              <div className="mt-4 text-[15px] leading-8 text-foreground">
                <MarkdownWithInlineFigures content={activeQuestion.analysisMarkdown || '（无）'} figures={activeQuestion.figures} className="text-sm font-normal" />
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}

function UnplacedFigureResolver({ ws, issue }: { ws: ImportV2WorkspaceState; issue: any }) {
  const activeQuestion = ws.activeQuestion
  if (!activeQuestion) return null

  return (
    <div className="mt-2 rounded-md border border-red-200/70 bg-white/80 p-2.5 text-zinc-700 dark:border-red-900/40 dark:bg-zinc-950/60 dark:text-zinc-300">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">待判断归属的原图</span>
        {issue.relatedFigures.map((figure: any) => (
          <span key={figure.id}>
            {figure.pageNo ? `第 ${figure.pageNo} 页` : '页码未知'}
            {figure.sourceBlockId || figure.blockId ? ` · 块 ${figure.sourceBlockId || figure.blockId}` : ''}
          </span>
        ))}
        <span>点击图片可放大查看</span>
      </div>
      <div className="space-y-3">
        {issue.relatedFigures.map((figure: any) => {
          const blockId = String(figure.sourceBlockId || figure.blockId || issue.relatedBlockIds?.[0] || '')
          const assignmentKey = `${activeQuestion.id}:${blockId}`
          const assignment = ws.figureAssignments[assignmentKey] || { candidateId: activeQuestion.id, usage: 'stem' as const }
          const resolving = ws.busy === `figure-${blockId}`
          return (
            <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50/40 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30 md:grid-cols-[10rem_minmax(0,1fr)]" key={figure.id}>
              <FigureGallery figures={[{ ...figure, pageNumber: figure.pageNo, bbox: undefined }]} compact />
              <div className="flex min-w-0 flex-col justify-center gap-2">
                <label className="grid gap-1 text-[10px] font-medium text-zinc-500">
                  归属题目
                  <select
                    className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                    disabled={resolving}
                    onChange={(event) => ws.setFigureAssignments((current: any) => ({ ...current, [assignmentKey]: { ...assignment, candidateId: event.target.value } }))}
                    value={assignment.candidateId}
                  >
                    {ws.questions.filter((question) => question.status !== 'committed' && !ws.committedIds.has(question.id)).map((question) => (
                      <option key={question.id} value={question.id}>第 {question.questionNo || '未编号'} 题{question.id === activeQuestion.id ? '（当前）' : ''}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[10px] font-medium text-zinc-500">
                  图片用途
                  <select
                    className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                    disabled={resolving}
                    onChange={(event) => ws.setFigureAssignments((current: any) => ({ ...current, [assignmentKey]: { ...assignment, usage: event.target.value === 'analysis' ? 'analysis' : 'stem' } }))}
                    value={assignment.usage}
                  >
                    <option value="stem">题干图</option>
                    <option value="analysis">解析图</option>
                  </select>
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="xs" disabled={!blockId || resolving} onClick={() => ws.handleResolveUnplacedFigure(blockId, 'assign')}>
                    {resolving ? '处理中…' : '确认归属'}
                  </Button>
                  <Button size="xs" variant="outline" disabled={!blockId || resolving} onClick={() => ws.handleResolveUnplacedFigure(blockId, 'ignore')}>
                    不作为题图
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FigureManagementSection({ ws }: { ws: ImportV2WorkspaceState }) {
  const activeQuestion = ws.activeQuestion
  if (!activeQuestion) return null

  return (
    <section className="border-t border-border py-6">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <ImageIcon className="size-3.5 text-muted-foreground" />
        <span>题图管理</span>
        <span className="font-normal text-muted-foreground">{activeQuestion.figures.length} 张</span>
      </div>
      <div className="mt-4 divide-y divide-border rounded-md border border-border">
        {activeQuestion.figures.map((figure, index) => {
          const draftKey = `${activeQuestion.id}:${figure.id}`
          const currentUsage = figure.usage === 'analysis' ? 'analysis' : figure.usage === 'options' ? 'options' : 'stem'
          const draft = ws.figureMoveDrafts[draftKey] || { candidateId: activeQuestion.id, usage: currentUsage, optionLabel: figure.optionLabel || 'A' }
          const moving = ws.busy === `move-figure-${figure.id}`
          const deleting = ws.busy === `delete-figure-${figure.id}`
          const figurePath = String(figure.path || '').trim()
          const renderableFigure = Boolean(figurePath) && !figurePath.startsWith('<')
          const unchanged = draft.candidateId === activeQuestion.id
            && draft.usage === currentUsage
            && (draft.usage !== 'options' || draft.optionLabel === (figure.optionLabel || 'A'))
          return (
            <div className="grid gap-3 p-3 md:grid-cols-[7rem_minmax(0,1fr)_auto] md:items-center" key={figure.id || `${figure.path}-${index}`}>
              <button
                type="button"
                className="flex h-20 w-28 items-center justify-center overflow-hidden rounded-md border border-border bg-white"
                onClick={() => renderableFigure ? window.open(assetUrl(figure.path), '_blank', 'noopener,noreferrer') : undefined}
                title="查看原图"
              >
                {renderableFigure ? (
                  <img src={assetUrl(figure.path)} alt={`题图 ${index + 1}`} className="h-full w-full object-contain" />
                ) : (
                  <span className="px-2 text-center text-[10px] leading-4 text-amber-700">该资源不是图片<br />可能是表格内容</span>
                )}
              </button>
              <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(9rem,1fr)_minmax(8rem,0.8fr)_4.5rem]">
                <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                  归属题目
                  <select
                    aria-label={`题图 ${index + 1} 归属题目`}
                    className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                    disabled={ws.activeQuestionCommitted || Boolean(ws.busy)}
                    value={draft.candidateId}
                    onChange={(event) => ws.setFigureMoveDrafts((current: any) => ({ ...current, [draftKey]: { ...draft, candidateId: event.target.value } }))}
                  >
                    {ws.questions.filter((question) => ['ready', 'needs_review', 'needs_manual_fix', 'blocked'].includes(question.status) && !ws.committedIds.has(question.id)).map((question) => (
                      <option key={question.id} value={question.id}>第 {question.questionNo || '未编号'} 题{question.id === activeQuestion.id ? '（当前）' : ''}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                  图片用途
                  <select
                    aria-label={`题图 ${index + 1} 图片用途`}
                    className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                    disabled={ws.activeQuestionCommitted || Boolean(ws.busy)}
                    value={draft.usage}
                    onChange={(event) => ws.setFigureMoveDrafts((current: any) => ({ ...current, [draftKey]: { ...draft, usage: event.target.value as 'stem' | 'analysis' | 'options' } }))}
                  >
                    <option value="stem">题干图</option>
                    <option value="options">选项图</option>
                    <option value="analysis">解析图</option>
                  </select>
                </label>
                {draft.usage === 'options' ? (
                  <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                    选项
                    <select
                      aria-label={`题图 ${index + 1} 对应选项`}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                      disabled={ws.activeQuestionCommitted || Boolean(ws.busy)}
                      value={draft.optionLabel}
                      onChange={(event) => ws.setFigureMoveDrafts((current: any) => ({ ...current, [draftKey]: { ...draft, optionLabel: event.target.value } }))}
                    >
                      {['A', 'B', 'C', 'D'].map((label) => <option key={label} value={label}>{label}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button size="xs" variant="outline" icon={moving ? LoaderCircle : ArrowRightLeft} disabled={ws.activeQuestionCommitted || Boolean(ws.busy) || unchanged} onClick={() => ws.handleMoveCandidateFigure(figure)}>
                  {moving ? '处理中…' : draft.candidateId === activeQuestion.id ? '应用' : '移动'}
                </Button>
                <Button size="xs" variant="outline" icon={deleting ? LoaderCircle : Trash2} disabled={ws.activeQuestionCommitted || Boolean(ws.busy)} onClick={() => ws.handleDeleteCandidateFigure(figure)}>
                  {deleting ? '删除中…' : '删除'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
