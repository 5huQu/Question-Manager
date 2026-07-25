import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileStack,
  GripVertical,
} from "lucide-react";
import { orderedQuestions } from "@/components/questions/layoutWorkbenchModel";

export function outlineText(markdown: string) {
  return String(markdown || "")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(
      /\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\\(?:left|right|displaystyle|textstyle|quad|qquad|,|;|!)/g, " ")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[$*_~`#>|]/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function Outline({
  entries,
  selectedId,
  warningQuestionId,
  onSelect,
  onMove,
}: {
  entries: ReturnType<typeof orderedQuestions>;
  selectedId: string;
  warningQuestionId: string;
  onSelect: (id: string) => void;
  onMove: (a: string, b: string) => void;
}) {
  const [drag, setDrag] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groups = entries.reduce<
    Array<{ key: string; name: string; start: number; items: typeof entries }>
  >((result, entry, index) => {
    const name =
      entry.question.sectionName || result[result.length - 1]?.name || "";
    const previous = result[result.length - 1];
    if (previous?.name === name) previous.items.push(entry);
    else
      result.push({
        key: `${index}:${name}`,
        name,
        start: index,
        items: [entry],
      });
    return result;
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    const group = groups.find((item) =>
      item.items.some((entry) => entry.layout.relationId === selectedId),
    );
    if (group)
      setCollapsed((current) =>
        current.has(group.key)
          ? new Set([...current].filter((key) => key !== group.key))
          : current,
      );
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-outline-question="${CSS.escape(selectedId)}"]`,
        )
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }, [selectedId]);
  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  return (
    <aside className="hidden w-64 shrink-0 overflow-auto border-r border-zinc-200 bg-white lg:block dark:border-zinc-800 dark:bg-zinc-950">
      <div className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-zinc-100 bg-white px-3 dark:border-zinc-900 dark:bg-zinc-950">
        <FileStack className="size-3.5 text-zinc-400" />
        <b className="text-xs">题目大纲</b>
        <span className="ml-auto text-[10px] text-zinc-400">
          {entries.length}
        </span>
      </div>
      <div className="p-2">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          return (
            <section key={group.key} className="mb-2">
              {group.name ? (
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-[11px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="text-[10px] font-normal tabular-nums text-zinc-400">
                    {group.items.length} 题
                  </span>
                </button>
              ) : null}
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${isCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className={group.name ? "pt-1" : ""}>
                    {group.items.map(({ question, layout }, offset) => {
                      const i = group.start + offset;
                      const isSelected = selectedId === layout.relationId;
                      const isWarning = warningQuestionId === layout.relationId;
                      const isDropTarget =
                        dropTarget === layout.relationId &&
                        drag !== layout.relationId;
                      return (
                        <div
                          key={layout.relationId}
                          data-outline-question={layout.relationId}
                          aria-current={isSelected ? "true" : undefined}
                          draggable
                          onDragStart={() => {
                            setDrag(layout.relationId);
                            setDropTarget("");
                          }}
                          onDragEnd={() => {
                            setDrag("");
                            setDropTarget("");
                          }}
                          onDragEnter={() => setDropTarget(layout.relationId)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            onMove(drag, layout.relationId);
                            setDrag("");
                            setDropTarget("");
                          }}
                          onClick={() => onSelect(layout.relationId)}
                          className={`group relative mb-1 flex cursor-pointer gap-2 overflow-hidden rounded-md border px-2 py-2 text-xs transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 ${isSelected ? "border-blue-500 bg-blue-50 shadow-md ring-1 ring-blue-500/25 hover:bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40 dark:ring-blue-400/30 dark:hover:bg-blue-950/40" : isWarning ? "border-amber-400 bg-amber-50 ring-2 ring-amber-300 dark:border-amber-500 dark:bg-amber-950/30" : "border-zinc-200 bg-white shadow-sm hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"} ${isDropTarget ? "before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:bg-blue-500" : ""}`}
                        >
                          {isSelected ? (
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-blue-600 dark:bg-blue-400"
                            />
                          ) : null}
                          <GripVertical className="mt-0.5 size-3.5 shrink-0 text-zinc-400" />
                          <div className="min-w-0 flex-1">
                            <div className="flex justify-between gap-2">
                              <b
                                className={`truncate ${isSelected ? "text-blue-950 dark:text-blue-100" : ""}`}
                              >
                                {i + 1}.{" "}
                                {question.item.questionType || "未设题型"}
                              </b>
                              <span
                                className={`shrink-0 ${isSelected ? "text-blue-700 dark:text-blue-300" : "text-zinc-400"}`}
                              >
                                {question.score || 0}分
                              </span>
                            </div>
                            <p
                              className={`mt-1 line-clamp-2 leading-5 ${isSelected ? "text-blue-900/70 dark:text-blue-100/70" : "text-zinc-500"}`}
                            >
                              {outlineText(question.item.stemMarkdown) ||
                                "题干为空"}
                            </p>
                          </div>
                          <div className="invisible flex flex-col group-hover:visible">
                            <button
                              title="上移"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (entries[i - 1])
                                  onMove(
                                    layout.relationId,
                                    entries[i - 1].layout.relationId,
                                  );
                              }}
                            >
                              ↑
                            </button>
                            <button
                              title="下移"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (entries[i + 1])
                                  onMove(
                                    layout.relationId,
                                    entries[i + 1].layout.relationId,
                                  );
                              }}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
