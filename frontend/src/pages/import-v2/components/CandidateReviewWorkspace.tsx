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
    <div ref={ws.checkAreaRef} className="flex h-auto min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background lg:h-[calc(100vh-10rem)] lg:min-h-[32rem] lg:flex-row">
      <CandidateListSidebar ws={ws} />
      <CandidateDetailPanel ws={ws} />
    </div>
  )
}

function CandidateListSidebar({ ws }: { ws: ImportV2WorkspaceState }) {
  return (
    <aside className="flex w-full shrink-0 flex-col bg-muted/20 lg:w-72 xl:w-80 2xl:w-[22rem] lg:border-r lg:border-border">
      <div className="shrink-0 border-b border-border bg-background">
        <nav aria-label="候选题状态筛选" className="flex h-10 items-end overflow-x-auto px-2">
          {ws.reviewTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => ws.setReviewTab(item.key)}
              className={`relative flex h-10 shrink-0 items-center gap-1.5 px-2 text-[11px] transition-colors duration-150 active:scale-[0.97] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:transition-all after:duration-200 after:ease-out ${
                ws.activeTab === item.key
                  ? 'font-semibold text-foreground after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground after:bg-transparent'
              }`}
            >
              <span>{item.label}</span>
              <span className="font-mono text-[10px] opacity-70">{item.count}</span>
            </button>
          ))}
        </nav>
        <div className="flex min-h-10 items-center gap-2 border-t border-border/60 px-3">
          <button
            type="button"
            onClick={ws.handleSelectAll}
            className="flex min-w-0 flex-1 items-center gap-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-all duration-150 active:scale-90 ${
              ws.allSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'
            }`}>
              {ws.allSelected ? <Check className="size-2.5 stroke-[3]" /> : null}
            </span>
            <span className="truncate">{ws.selectedIds.size ? `已选择 ${ws.selectedIds.size} 题` : `${ws.selectableList.length} 题可批量处理`}</span>
          </button>
          {ws.parseDiagnosticCounts.length > 0 ? (
            <select
              aria-label="结构诊断筛选"
              value={ws.activeDiagnosticCode}
              onChange={(event) => { ws.setActiveDiagnosticCode(event.target.value); ws.handleSelectAll() }}
              className="h-7 min-w-0 max-w-32 rounded-md border border-input bg-background px-1.5 text-[10px] text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">结构诊断</option>
              {ws.parseDiagnosticCounts.slice(0, 8).map((item) => (
                <option key={item.code} value={item.code}>{parserDiagnosticLabel(item.code)} {item.count}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      <div ref={ws.candidateListRef} data-testid="candidate-list-scroll" className="flex-1 overflow-y-auto overscroll-contain bg-muted/10 p-2">
        {ws.filteredQuestions.length === 0 ? (
          <div className="flex h-48 items-center justify-center px-6 text-center text-xs text-muted-foreground">此筛选条件下暂无题目</div>
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
                  className={`flex items-center gap-2 rounded-lg border py-2 pl-2.5 pr-3 transition-all duration-150 ease-out ${
                    isActive
                      ? 'border-primary/50 bg-accent/60'
                      : 'border-border/60 bg-background hover:border-border hover:bg-accent/30'
                  }`}
                >
                  <button
                    type="button"
                    aria-label={`选择第 ${q.questionNo || '未编号'} 题`}
                    disabled={isCommitted}
                    onClick={(e) => { e.stopPropagation(); ws.handleSelectToggle(q.id) }}
                    className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-all duration-150 active:scale-90 ${isCommitted ? 'cursor-not-allowed opacity-25' : ''} ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:border-foreground/40'}`}
                  >
                    {isSelected ? <Check className="size-2.5 stroke-[3]" /> : null}
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
                    className="sf-pressable flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="shrink-0 text-xs font-semibold tracking-tight text-foreground">第 {q.questionNo || '？'} 题</span>
                    {q.questionType ? <span className="min-w-0 truncate text-[10px] text-muted-foreground">{q.questionType}</span> : null}
                    {q.hasFigures ? <ImageIcon className="size-3 shrink-0 text-muted-foreground/70" aria-label="包含题图" /> : null}
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[10px]">
                      <span className={`size-1.5 rounded-full transition-colors duration-200 ${reviewState.dotClass}`} />
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
        <div className="flex shrink-0 animate-slide-up-in items-center gap-2 border-t border-border bg-background p-2.5">
          <span className="min-w-0 flex-1 truncate pl-1 text-[11px] font-medium text-muted-foreground">已选 {ws.selectedIds.size} 题</span>
          <Button size="xs" variant="outline" icon={SkipForward} disabled={Boolean(ws.busy)} onClick={ws.handleBulkSkip} className="sf-pressable">跳过</Button>
          <Button size="xs" icon={CheckCircle2} disabled={Boolean(ws.busy)} onClick={ws.handleBulkConfirm} className="sf-pressable">批量入库</Button>
        </div>
      ) : null}
    </aside>
  )
}

function CandidateDetailPanel({ ws }: { ws: ImportV2WorkspaceState }) {
  const { activeQuestion } = ws

  if (!activeQuestion) {
    return (
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
          请从左侧选择题目
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex shrink-0 items-center gap-4 border-b border-border bg-background px-5 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            <h2 className="flex shrink-0 items-center gap-1 text-sm font-semibold text-foreground">
              <span>第</span>
              <input
                type="text"
                value={ws.editingQuestionNo}
                onChange={(e) => ws.setEditingQuestionNo(e.target.value)}
                onBlur={ws.handleSaveQuestionNo}
                onKeyDown={(e) => { if (e.key === 'Enter') { ws.handleSaveQuestionNo(); e.currentTarget.blur() } }}
                disabled={ws.activeQuestionCommitted}
                aria-label="题号"
                className="h-7 w-11 rounded-md border border-input bg-background px-1 text-center text-xs font-semibold text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <span>题</span>
            </h2>
            <span className="hidden h-4 w-px bg-border sm:block" />
            <select
              aria-label="题型"
              className="h-7 min-w-24 shrink-0 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
              <span className={`hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] xl:flex ${ws.activeQuestionReviewState.textClass}`}>
                <span className={`size-1.5 rounded-full ${ws.activeQuestionReviewState.dotClass}`} />
                {ws.savingQuestionType === activeQuestion.id ? '保存中...' : ws.activeQuestionReviewState.label}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" icon={PencilLine} disabled={ws.activeQuestionCommitted || Boolean(ws.busy)} onClick={() => ws.startManualFix(activeQuestion.id, 'stem')}>
              编辑
            </Button>
            <Button
              size="sm"
              icon={ws.activeQuestionCommitted || ws.busy !== activeQuestion.id ? CheckCircle2 : LoaderCircle}
              disabled={ws.activeQuestionCommitted || ws.busy === activeQuestion.id || !activeQuestion.stemMarkdown.trim()}
              onClick={() => ws.commitSingleQuestion(activeQuestion)}
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
              <div className="mb-5 flex items-start gap-2.5 border-l-2 border-amber-500 bg-amber-50/50 px-4 py-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1">
                  <p className="font-semibold">重复入库预警</p>
                  <p className="leading-relaxed">
                    AI 检测到该题与系统中已有题目内容高度相似（重合度 {Math.round((activeQuestion.similarQuestions[0].similarity || 0.9) * 100)}%）。请确认是否属于相同试题。
                  </p>
                  <p className="pt-1 text-[10px] opacity-80">
                    <strong>相似题来源：</strong> {activeQuestion.similarQuestions[0].sourceTitle || '外部题库'} (第 {activeQuestion.similarQuestions[0].questionNo} 题)
                  </p>
                </div>
              </div>
            )}

            {/* Issues banner */}
            {activeQuestion.issues && activeQuestion.issues.length > 0 && (
              <div className="mb-5 flex items-start gap-2.5 border-l-2 border-red-500 bg-red-50/50 px-4 py-3 text-xs text-red-800 dark:bg-red-950/20 dark:text-red-300">
                <BadgeAlert className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                <div className="space-y-1">
                  <p className="font-semibold">核对提示</p>
                  <ul className="list-disc pl-4 space-y-1">
                    {activeQuestion.issues.map((issue, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {issueLabel(issue.code) ? <span className="font-semibold">【{issueLabel(issue.code)}】</span> : null}
                        {issue.message}
                        {['missing_answer', 'missing_analysis', 'missing_solution', 'solution_conflict', 'unmatched_solution'].includes(issue.code || '') ? (
                          <button
                            type="button"
                            onClick={() => ws.openActiveQuestionMarkdownPreview(issue.code === 'missing_answer' ? 'answer' : 'analysis')}
                            className="ml-2 inline-flex items-center gap-1 rounded border border-red-200/70 bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
                          >
                            <HelpCircle className="size-3" />
                            查看原因
                          </button>
                        ) : null}
                        {issue.code === 'unplaced_figure' && issue.relatedFigures?.length ? (
                          <UnplacedFigureResolver ws={ws} issue={issue} />
                        ) : issue.code === 'unplaced_figure' ? (
                          <p className="mt-1 text-[10px] text-red-500 dark:text-red-400">未找到对应图片文件，可尝试重新识别后再核对。</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Parse diagnostics */}
            {ws.visibleActiveParseDiagnostics.length > 0 && (
              <div className="mb-5 flex items-start gap-2.5 border-l-2 border-amber-500 bg-amber-50/40 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/15 dark:text-amber-300">
                <HelpCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">结构诊断</p>
                  <ul className="list-disc pl-4 space-y-1">
                    {ws.visibleActiveParseDiagnostics.slice(0, 6).map((diagnostic, idx) => (
                      <li key={`${diagnostic.code}:${idx}`} className="leading-relaxed">
                        <span className="font-semibold">【{parserDiagnosticLabel(diagnostic.code)}】</span>{diagnostic.message}
                        <button
                          type="button"
                          onClick={() => ws.openActiveQuestionMarkdownPreview(diagnostic.code.includes('answer') ? 'answer' : 'analysis')}
                          className="ml-2 inline-flex items-center gap-1 rounded border border-amber-200/70 bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"
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
