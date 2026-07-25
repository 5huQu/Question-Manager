import {
  AlertTriangle,
  ChevronLeft,
  Eye,
  PanelLeftClose,
  PanelRightClose,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
} from "lucide-react";
import { PdfPreviewCanvas } from "@/components/questions/PdfPreviewCanvas";
import { LayoutQuestionContentSheet } from "@/components/questions/LayoutQuestionContentSheet";
import { moveWithinSection, patchQuestion } from "@/components/questions/layoutWorkbenchModel";
import { useLayoutWorkbench } from "./useLayoutWorkbench";
import { Outline } from "./OutlinePanel";
import { Properties } from "./PropertiesPanel";
import { ExactPageToolbar, WarningBar, exactVariant } from "./Toolbar";

const iconButton =
  "inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-900";

export default function LayoutWorkbenchPage() {
  const {
    navigate,
    basket,
    draft,
    layout,
    selectedId,
    leftOpen,
    rightOpen,
    saveState,
    message,
    warningQuestionId,
    variant,
    activePage,
    editingContentId,
    entries,
    selected,
    editingEntry,
    editingOriginalEntry,
    setLeftOpen,
    setRightOpen,
    setVariant,
    setMessage,
    setEditingContentId,
    save,
    change,
    undo,
    redo,
    resetAll,
    resetPage,
    exactPreview,
    selectQuestion,
    selectWarning,
    navigatePage,
    syncVisiblePage,
    applyPageEqualization,
    saveQuestionContent,
    syncQuestionContentToBank,
  } = useLayoutWorkbench();

  if (!basket || !layout || !draft)
    return (
      <div className="p-8 text-sm text-zinc-500">
        {message || "正在载入排版草稿..."}
      </div>
    );
  return (
    <div className="-m-4 flex h-[calc(100vh-65px)] min-h-0 flex-col bg-zinc-100/60 md:-m-6 dark:bg-zinc-950">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex min-w-0 items-center gap-2">
          <button
            title="返回草稿列表"
            className={iconButton}
            onClick={() => navigate("/questions/layout-drafts")}
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <b className="truncate text-sm">{draft.name || basket.title}</b>
              <span className="hidden rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 sm:inline-flex">
                PDF 精确编辑
              </span>
            </div>
            <p className="text-[10px] text-zinc-400">
              {entries.length} 题 ·{" "}
              {exactVariant(draft, variant)?.pageCount || "-"} 页 · revision{" "}
              {draft.revision}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center rounded-md border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              className={`h-7 rounded px-2 text-[11px] ${variant === "student" ? "bg-white font-medium shadow-sm dark:bg-zinc-800" : ""}`}
              onClick={() => setVariant("student")}
            >
              学生版
            </button>
            <button
              className={`h-7 rounded px-2 text-[11px] ${variant === "teacher" ? "bg-white font-medium shadow-sm dark:bg-zinc-800" : ""}`}
              onClick={() => setVariant("teacher")}
            >
              教师版
            </button>
          </div>
          <div className="hidden items-center rounded-md border border-zinc-200 p-0.5 sm:flex dark:border-zinc-800">
            <button title="撤销" className={iconButton} onClick={undo}>
              <Undo2 className="size-4" />
            </button>
            <button title="重做" className={iconButton} onClick={redo}>
              <Redo2 className="size-4" />
            </button>
          </div>
          <button
            title="恢复整卷自动排版"
            className={iconButton}
            onClick={resetAll}
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            title="切换大纲"
            className={`${iconButton} hidden lg:inline-flex`}
            onClick={() => setLeftOpen(!leftOpen)}
          >
            <PanelLeftClose className="size-4" />
          </button>
          <button
            title="切换属性"
            className={`${iconButton} hidden lg:inline-flex`}
            onClick={() => setRightOpen(!rightOpen)}
          >
            <PanelRightClose className="size-4" />
          </button>
          <button
            className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
            onClick={() => void save(layout)}
          >
            <Save className="size-3.5" />
            保存
          </button>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
            onClick={() => void exactPreview()}
          >
            <Eye className="size-3.5" />
            更新 PDF
          </button>
        </div>
      </header>
      {message ? (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="size-3.5" />
          {message}
          <button className="ml-auto" onClick={() => setMessage("")}>
            关闭
          </button>
        </div>
      ) : null}
      <WarningBar
        warnings={draft.preview.warnings.filter(
          (warning) => !warning.variant || warning.variant === variant,
        )}
        onSelect={selectWarning}
      />
      <div className="flex min-h-0 flex-1">
        {leftOpen ? (
          <Outline
            entries={entries}
            selectedId={selectedId}
            warningQuestionId={warningQuestionId}
            onSelect={selectQuestion}
            onMove={(a, b) => change(moveWithinSection(layout, basket, a, b))}
          />
        ) : null}
        <main className="min-w-0 flex-1 overflow-auto px-3 lg:px-6">
          <ExactPageToolbar
            draft={draft}
            entries={entries}
            variant={variant}
            page={activePage}
            onPage={navigatePage}
            onEqualize={applyPageEqualization}
            onResetPage={resetPage}
          />
          <PdfPreviewCanvas
            preview={draft.preview}
            variant={variant}
            activePage={
              draft.preview.questionPages?.[variant]?.[selectedId]?.startPage
            }
            pageIdPrefix="exact-preview-page"
            onVisiblePage={syncVisiblePage}
            onRetry={() => void exactPreview()}
          />
        </main>
        {rightOpen ? (
          <div className="hidden xl:contents">
            <Properties
              selected={selected}
              onEditContent={() =>
                selected && setEditingContentId(selected.layout.relationId)
              }
              onChange={(p) =>
                selected &&
                change(patchQuestion(layout, selected.layout.relationId, p))
              }
            />
          </div>
        ) : null}
      </div>
      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-zinc-200 bg-white px-4 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
        <span className="hidden sm:inline">
          左侧选择或调整题序，右侧修改属性；中间始终显示最终 PDF 结果。
        </span>
        <span
          className={
            saveState === "error"
              ? "text-red-600"
              : saveState === "dirty"
                ? "text-amber-700"
                : ""
          }
        >
          {saveState === "saved"
            ? `已保存 · r${draft.revision}`
            : saveState === "saving"
              ? "正在保存..."
              : saveState === "error"
                ? "保存失败，本地修改仍保留"
                : "有未保存修改"}
          {["queued", "rendering"].includes(draft.preview.status)
            ? " · 正在更新 PDF"
            : draft.preview.displayRevision !== draft.revision
              ? " · 当前 PDF 已过期"
              : ""}
        </span>
      </footer>
      {editingEntry ? (
        <LayoutQuestionContentSheet
          open={Boolean(editingContentId)}
          draftId={draft.id}
          relationId={editingContentId}
          item={editingEntry.question.item}
          originalItem={editingOriginalEntry?.item}
          hasOverride={Boolean(draft.contentOverrides?.[editingContentId])}
          baseContentRevision={
            draft.contentOverrides?.[editingContentId]?.baseContentRevision ??
            editingEntry.question.item.contentRevision ??
            1
          }
          onClose={() => setEditingContentId("")}
          onSaveCurrent={(value) =>
            saveQuestionContent(editingContentId, value)
          }
          onSyncToBank={(revision) =>
            syncQuestionContentToBank(editingContentId, revision)
          }
        />
      ) : null}
    </div>
  );
}
