import {
  Check,
  CheckCircle2,
  Database,
  FileText,
  LoaderCircle,
  PencilLine,
  Play,
  RefreshCcw,
  Trash2,
} from 'lucide-react'
import { Badge, Button, Empty, Panel } from '@/components/ui'
import { importJobDocumentRoleLabel, paperKindOptions } from '../importV2PageModel'
import { importJobQuestionsPath } from '../importV2Routes'
import type { ImportV2WorkspaceState } from '../useImportV2Workspace'

export function UploadWorkflowPanel({ ws }: { ws: ImportV2WorkspaceState }) {
  const { selectedDoc, activeImportJob, activeImportJobDocuments } = ws

  return (
    <div className="grid gap-6 lg:grid-cols-12 items-start">
      {/* Left column: metadata + document list */}
      <div className="lg:col-span-4 space-y-4 flex flex-col">
        <Panel
          title="试卷与批次信息"
          actions={selectedDoc ? (
            <button
              type="button"
              onClick={ws.openEditModal}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              <PencilLine className="size-3.5" />
              编辑
            </button>
          ) : null}
        >
          {selectedDoc && (
            <div className="space-y-2 text-[11px] text-zinc-500">
              <div className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                {activeImportJob?.paperTitle || activeImportJob?.title || selectedDoc.paperTitle || '未命名资料'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{paperKindOptions.find((item) => item.value === (activeImportJob?.paperKind || selectedDoc.paperKind))?.label || '未分类'}</Badge>
                <Badge variant="outline">{activeImportJob?.stage || selectedDoc.stage || '高三'}</Badge>
                <Badge variant="outline">{activeImportJob?.subject || selectedDoc.subject || '数学'}</Badge>
              </div>
              <div className="truncate">
                {[activeImportJob?.province || selectedDoc.province, activeImportJob?.city || selectedDoc.city, activeImportJob?.examYear || selectedDoc.examYear || '', activeImportJob?.sourceOrg || selectedDoc.sourceOrg].filter(Boolean).join(' · ') || '未填写地区、年份和来源机构'}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="批次内文档列表">
          <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
            {activeImportJobDocuments.length === 0 ? (
              <Empty text="此批次暂无关联文档" />
            ) : (
              activeImportJobDocuments.map((jobDoc) => {
                const item = jobDoc.sourceDocument
                const statusInfo = ws.getDocStatus(item)
                const isSelected = selectedDoc?.id === item.id

                return (
                  <div
                    key={item.id}
                    onClick={() => ws.navigateToDocument(item.id)}
                    className={`group border rounded-xl p-3 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-zinc-900 bg-zinc-50/40 dark:border-zinc-100 dark:bg-zinc-900/40'
                        : 'border-zinc-200 bg-white hover:bg-zinc-50/10 dark:border-zinc-800 dark:bg-zinc-955'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200 max-w-[65%]" title={item.originalFileName || item.title}>
                        {item.originalFileName || item.title}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant={jobDoc.role === 'solutions' ? 'warning' : 'outline'}>{importJobDocumentRoleLabel(jobDoc.role)}</Badge>
                        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                        <button
                          disabled={ws.busy === `delete-${item.id}`}
                          onClick={(e) => { e.stopPropagation(); void ws.handleDeleteSourceDoc(item.id) }}
                          className="text-zinc-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-400 p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer"
                          title="删除资料"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400 space-y-0.5">
                      {item.importStats && item.importStats.candidateCount > 0 ? (
                        <>
                          <div>已生成 {item.importStats.candidateCount} 道待确认题目</div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>已入库 {item.importStats.committedCount} / {item.importStats.candidateCount}</span>
                            {(item.importStats.needsManualFixCount + item.importStats.blockedCount) > 0 && (
                              <span className="text-red-500 font-medium">需要修正 {(item.importStats.needsManualFixCount + item.importStats.blockedCount)}</span>
                            )}
                            {item.importStats.needsReviewCount > 0 && (
                              <span className="text-amber-600 font-medium">建议核对 {item.importStats.needsReviewCount}</span>
                            )}
                            {item.importStats.parseDiagnosticCount > 0 && (
                              <span className="text-sky-600 font-medium dark:text-sky-400">结构诊断 {item.importStats.parseDiagnosticCount}</span>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="italic text-zinc-400">暂无识别题目</div>
                      )}

                      {item.status === 'ocr_failed' && ws.sourceOcrErrors[item.id] && (
                        <p className="text-red-500 truncate mt-1" title={ws.sourceOcrErrors[item.id]}>
                          错误: {ws.sourceOcrErrors[item.id]}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Panel>
      </div>

      {/* Right column: workflow operations */}
      <div className="lg:col-span-8 space-y-4">
        {selectedDoc ? (
          <Panel title="导入工作流操作">
            <div className="space-y-6">
              {/* Title & status */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 dark:border-zinc-800">
                <div className="space-y-1 min-w-0 flex-1">
                  <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate pr-4" title={selectedDoc.originalFileName || selectedDoc.title}>
                    {selectedDoc.originalFileName || selectedDoc.title}
                  </h2>
                  <p className="text-[10px] text-zinc-400">
                    创建时间: {new Date(selectedDoc.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="shrink-0">
                  <Badge variant={ws.getDocStatus(selectedDoc).variant} className="text-xs px-2.5 py-1">
                    {ws.getDocStatus(selectedDoc).label}
                  </Badge>
                </div>
              </div>

              {/* Stepper */}
              <div className="bg-white/70 dark:bg-zinc-900/70 p-4 rounded-2xl border border-black/6 dark:border-white/8 backdrop-blur-xl shadow-2xs">
                <div className="flex items-center w-full select-none">
                  {ws.steps.map((step, idx) => (
                    <div key={idx} className="flex items-center flex-1 last:flex-initial">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex size-7 items-center justify-center rounded-full border text-xs font-bold transition-all ${
                            step.state === 'done'
                              ? 'bg-emerald-500 border-emerald-500 text-white shadow-2xs'
                              : step.state === 'current'
                                ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-100 dark:border-zinc-100 dark:text-zinc-950 shadow-xs ring-2 ring-zinc-900/15 dark:ring-white/20'
                                : 'bg-black/4 border-black/10 text-zinc-400 dark:bg-white/6 dark:border-white/12 dark:text-zinc-500'
                          }`}
                        >
                          {step.state === 'done' ? <Check className="size-4 stroke-[3]" /> : idx + 1}
                        </div>
                        <span
                          className={`text-xs font-semibold whitespace-nowrap ${
                            step.state === 'done'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : step.state === 'current'
                                ? 'text-zinc-900 dark:text-zinc-100 font-bold'
                                : 'text-zinc-400 dark:text-zinc-500'
                          }`}
                        >
                          {step.title}
                        </span>
                      </div>
                      {idx < ws.steps.length - 1 && (
                        <div
                          className={`h-[2px] flex-1 mx-4 rounded-full min-w-[20px] transition-all ${
                            step.state === 'done' ? 'bg-emerald-500' : 'bg-black/10 dark:bg-white/10'
                          }`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Parser preset selector */}
              {!ws.selectedDocIsImportJobSolution && ws.parserPresets.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-2xl border border-black/6 bg-white/70 p-3.5 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-900/70 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">导入规则预设</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">生成或重解析候选题时使用。</p>
                  </div>
                  <select
                    className="h-8.5 min-w-56 rounded-xl border border-black/10 bg-white/90 px-3 text-xs font-medium text-zinc-900 shadow-2xs outline-none transition-all focus:border-zinc-900 dark:border-white/12 dark:bg-zinc-900/90 dark:text-zinc-100"
                    value={ws.selectedParserPresetId}
                    onChange={(event) => ws.setSelectedParserPresetId(event.target.value)}
                    disabled={Boolean(ws.busy)}
                  >
                    {ws.parserPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/* Core action area */}
              <div className="bg-white/80 dark:bg-zinc-900/80 p-6 rounded-2xl border border-black/6 dark:border-white/8 shadow-2xs backdrop-blur-xl space-y-4">
                {/* uploaded */}
                {selectedDoc.status === 'uploaded' && (
                  <div className="space-y-4">
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      资料已成功保存。点击“开始自动识别”将通过 {ws.currentOcrProviderLabel} 自动提取试卷题目、公式及插图。
                    </p>
                    <Button
                      size="default"
                      icon={Play}
                      disabled={Boolean(ws.busy)}
                      onClick={() => ws.startSourceOcr(selectedDoc.id)}
                      className="w-full sm:w-auto bg-zinc-900 text-white shadow-xs hover:bg-zinc-800 active:scale-[0.98] rounded-xl dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {ws.busy === `ocr-${selectedDoc.id}` ? '正在启动...' : '开始自动识别'}
                    </Button>
                  </div>
                )}

                {/* ocr_failed */}
                {selectedDoc.status === 'ocr_failed' && (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-red-50/20 border border-red-200/30 p-3 text-xs text-red-700 dark:text-red-400">
                      <p className="font-semibold mb-1">OCR 识别失败错误信息：</p>
                      <p className="font-mono">{ws.sourceOcrErrors[selectedDoc.id] || '未知识别错误。'}</p>
                    </div>
                    <Button size="default" icon={Play} disabled={Boolean(ws.busy)} onClick={() => ws.startSourceOcr(selectedDoc.id)} className="w-full sm:w-auto">
                      重新识别
                    </Button>
                  </div>
                )}

                {/* ocr_running */}
                {selectedDoc.status === 'ocr_running' && (
                  <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
                    <LoaderCircle className="size-8 animate-spin text-zinc-500" />
                    <p className="text-xs text-zinc-500 font-medium">
                      识别中，可能需要几十秒到数分钟，系统正在后台轮询...
                    </p>
                  </div>
                )}

                {/* ocr_succeeded */}
                {selectedDoc.status === 'ocr_succeeded' && (selectedDoc.importStats?.candidateCount || 0) === 0 && (
                  <div className="space-y-4">
                    {ws.selectedDocIsImportJobSolution ? (
                      <>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          答案解析文档已识别完成。它会在原卷生成候选题时自动参与合并。
                        </p>
                        {ws.activeImportJobQuestionSource ? (
                          <div className="flex flex-wrap gap-3">
                            <Button size="default" icon={FileText} variant="outline" onClick={() => ws.activeImportJobQuestionSource && ws.navigateToDocument(ws.activeImportJobQuestionSource.id)} className="w-full sm:w-auto">
                              切换到原卷
                            </Button>
                            <Button
                              size="default" variant="outline"
                              icon={ws.busy === `ocr-${selectedDoc.id}` ? LoaderCircle : RefreshCcw}
                              disabled={Boolean(ws.busy) || !ws.canReidentifySelectedDoc}
                              title={ws.selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新识别。' : '重新调用 OCR，并清空未入库候选题。'}
                              onClick={() => ws.handleReidentifySource(selectedDoc)}
                              className="w-full sm:w-auto"
                            >
                              {ws.busy === `ocr-${selectedDoc.id}` ? '识别中...' : '重新识别'}
                            </Button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          {ws.selectedDocIsImportJobQuestion
                            ? ws.activeImportJobSolutionReady
                              ? '原卷与答案解析均已准备好。现在可合并生成待核对的题目草稿列表。'
                              : '原卷已识别完成。请先完成答案解析文档 OCR，再合并生成待核对题目。'
                            : 'OCR 智能识别已完成，现在可分析并生成待核对的题目草稿列表。'}
                        </p>
                        {ws.selectedDocIsImportJobQuestion && ws.activeImportJobSolutionSource ? (
                          <div className="rounded-lg border border-zinc-200 bg-zinc-50/40 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30">
                            答案解析：{ws.activeImportJobSolutionSource.originalFileName || ws.activeImportJobSolutionSource.title} · {ws.getDocStatus(ws.activeImportJobSolutionSource).label}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-3">
                          <Button
                            size="default" icon={Play}
                            disabled={Boolean(ws.busy) || (ws.selectedDocIsImportJobQuestion && !ws.activeImportJobSolutionReady)}
                            onClick={() => ws.handleGenerateCandidates(selectedDoc)}
                            className="w-full sm:w-auto"
                          >
                            {ws.busy === `action-${selectedDoc.id}` ? '生成中...' : ws.selectedDocIsImportJobQuestion ? '合并生成待确认题目' : '生成待确认题目'}
                          </Button>
                          <Button
                            size="default" variant="outline"
                            icon={ws.busy === `ocr-${selectedDoc.id}` ? LoaderCircle : RefreshCcw}
                            disabled={Boolean(ws.busy) || !ws.canReidentifySelectedDoc}
                            title={ws.selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新识别。' : '重新调用 OCR，并清空未入库候选题。'}
                            onClick={() => ws.handleReidentifySource(selectedDoc)}
                            className="w-full sm:w-auto"
                          >
                            {ws.busy === `ocr-${selectedDoc.id}` ? '识别中...' : '重新识别'}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* parsed / partially_parsed */}
                {(selectedDoc.status === 'parsed' || selectedDoc.status === 'partially_parsed') && !selectedDoc.importStats?.allCommitted && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg p-3 bg-zinc-50/10">
                        <span className="text-[10px] text-zinc-400 block">已入库</span>
                        <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                          {selectedDoc.importStats?.committedCount || 0} / {selectedDoc.importStats?.candidateCount || 0}
                        </span>
                      </div>
                      <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg p-3 bg-zinc-50/10">
                        <span className="text-[10px] text-zinc-400 block">剩余待核对</span>
                        <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                          {selectedDoc.importStats?.uncommittedCount || 0} 题
                        </span>
                      </div>
                      <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg p-3 bg-zinc-50/10 col-span-2 sm:col-span-1">
                        <span className="text-[10px] text-zinc-400 block font-medium">需要修正</span>
                        <span className="text-sm font-bold text-red-500">
                          {(selectedDoc.importStats?.needsManualFixCount || 0) + (selectedDoc.importStats?.blockedCount || 0)} 题
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 pt-2">
                      <Button size="default" icon={CheckCircle2} disabled={Boolean(ws.busy)} onClick={() => ws.handleContinueCheck(selectedDoc)} className="w-full sm:w-auto">
                        进入题目核对区
                      </Button>
                      <Button
                        size="default" variant="outline"
                        icon={ws.busy === `ocr-${selectedDoc.id}` ? LoaderCircle : RefreshCcw}
                        disabled={Boolean(ws.busy) || !ws.canReidentifySelectedDoc}
                        title={ws.selectedDocCommittedCount > 0 ? '该批次已有题目入库，暂不支持重新识别。' : '重新调用 OCR，并清空未入库候选题。'}
                        onClick={() => ws.handleReidentifySource(selectedDoc)}
                        className="w-full sm:w-auto"
                      >
                        {ws.busy === `ocr-${selectedDoc.id}` ? '识别中...' : '重新识别'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* allCommitted */}
                {selectedDoc.importStats?.allCommitted && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                      <CheckCircle2 className="size-4" />
                      <span>所有题目均已确认存入题库！</span>
                    </div>
                    <Button
                      size="default" icon={Database}
                      disabled={!activeImportJob?.id}
                      onClick={() => {
                        if (!activeImportJob?.id) return
                        ws.navigate(importJobQuestionsPath(activeImportJob.id))
                      }}
                      className="w-full sm:w-auto"
                    >
                      在题库中查看
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        ) : (
          <Panel title="工作流操作">
            <div className="h-48 flex items-center justify-center text-xs text-zinc-400 bg-zinc-50/10 border border-dashed rounded-xl">
              请在左侧资料列表中选择一份资料以开始，或上传新文件。
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
