import { AlertTriangle } from "lucide-react";
import {
  type LayoutDraft,
  type LayoutWarning,
} from "@/api/layoutDrafts";
import {
  isSolutionQuestion,
  orderedQuestions,
} from "@/components/questions/layoutWorkbenchModel";

export function exactVariant(draft: LayoutDraft, variant: "student" | "teacher") {
  return draft.preview.variants?.[variant];
}

function exactPageCount(draft: LayoutDraft, variant: "student" | "teacher") {
  const exact = exactVariant(draft, variant);
  if (exact?.pageCount) return exact.pageCount;
  return Math.max(
    1,
    ...Object.values(draft.preview.questionPages?.[variant] || {}).map(
      (item) => item.endPage,
    ),
  );
}

export function ExactPageToolbar({
  draft,
  entries,
  variant,
  page,
  onPage,
  onEqualize,
  onResetPage,
}: {
  draft: LayoutDraft;
  entries: ReturnType<typeof orderedQuestions>;
  variant: "student" | "teacher";
  page: number;
  onPage: (page: number) => void;
  onEqualize: (id: string, count: 2 | 3 | null) => void;
  onResetPage: () => void;
}) {
  const total = exactPageCount(draft, variant);
  const pages = draft.preview.questionPages?.[variant] || {};
  const pageEntries = entries.filter((entry) => {
    const range = pages[entry.layout.relationId];
    return range && range.startPage <= page && range.endPage >= page;
  });
  const pageSolutions = pageEntries.filter((entry) =>
    isSolutionQuestion(entry.question),
  );
  const start = pageSolutions[0];
  const active =
    start && start.layout.equalizedGroupId === start.layout.relationId
      ? start.layout.equalizedGroupSize
      : undefined;
  const pageButton =
    "h-7 rounded border border-zinc-300 bg-white px-2 text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";
  const layoutButton = (selected: boolean) =>
    `h-7 rounded px-2 transition-colors ${selected ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"}`;
  return (
    <div className="sticky top-2 z-20 mx-auto mt-3 flex w-fit items-center gap-2 rounded-lg border border-zinc-200 bg-white/95 px-2 py-1.5 text-xs text-zinc-700 shadow-md backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200">
      <button
        className={pageButton}
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        上一页
      </button>
      <span className="min-w-20 text-center tabular-nums text-zinc-600 dark:text-zinc-300">
        第 {page} / {total} 页
      </span>
      <button
        className={pageButton}
        disabled={page >= total}
        onClick={() => onPage(Math.min(total, page + 1))}
      >
        下一页
      </button>
      <button
        className={pageButton}
        disabled={!pageEntries.length}
        onClick={onResetPage}
      >
        本页自动
      </button>
      <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />
      {start ? (
        <>
          <span className="text-zinc-500 dark:text-zinc-400">本页解答题</span>
          {(
            [
              ["auto", "自动"],
              [2, "一页两题"],
              [3, "一页三题"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={layoutButton(
                (value === "auto" && !active) || active === value,
              )}
              onClick={() =>
                onEqualize(
                  start.layout.relationId,
                  value === "auto" ? null : value,
                )
              }
            >
              {label}
            </button>
          ))}
        </>
      ) : (
        <span className="text-zinc-400 dark:text-zinc-500">
          本页无解答题排版操作
        </span>
      )}
    </div>
  );
}

export function WarningBar({
  warnings,
  onSelect,
}: {
  warnings: LayoutWarning[];
  onSelect: (warning: LayoutWarning) => void;
}) {
  if (!warnings.length) return null;
  return (
    <section className="flex max-h-28 shrink-0 items-start gap-2 overflow-auto border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <b>排版诊断（{warnings.length}）</b>
        {warnings.map((warning, index) => (
          <button
            type="button"
            key={`${warning.code}:${warning.questionId}:${index}`}
            className="text-left hover:underline"
            onClick={() => onSelect(warning)}
          >
            {warning.questionNo ? `第 ${warning.questionNo} 题 · ` : ""}
            {warning.page ? `第 ${warning.page} 页 · ` : ""}
            {warning.message}
          </button>
        ))}
      </div>
    </section>
  );
}
