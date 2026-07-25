import type { ReactNode } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import {
  type FigureAlignment,
  type FigurePlacement,
  type QuestionLayout,
} from "@/api/layoutDrafts";
import {
  allowedFigurePlacements,
  choiceSuggestion,
  defaultSolutionAnswerAreaHeightCm,
  figureIdOf,
  isSolutionQuestion,
  orderedQuestions,
  resetQuestionLayout,
} from "@/components/questions/layoutWorkbenchModel";
import {
  isChoiceQuestionType,
  parseChoiceQuestion,
} from "@/utils/questionDisplay";

const control =
  "h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-800 dark:bg-zinc-950";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mb-4 border-b border-zinc-100 pb-4 dark:border-zinc-900">
      <label className="mb-2 block text-[11px] font-medium text-zinc-500">
        {label}
      </label>
      {children}
    </section>
  );
}

export function Properties({
  selected,
  onChange,
  onEditContent,
}: {
  selected?: ReturnType<typeof orderedQuestions>[number];
  onChange: (p: Partial<QuestionLayout>) => void;
  onEditContent: () => void;
}) {
  if (!selected)
    return (
      <aside className="w-72 bg-white p-4 text-xs dark:bg-zinc-950">
        请选择题目
      </aside>
    );
  const { question, layout } = selected;
  const hasChoices =
    isChoiceQuestionType(question.item.questionType) &&
    Boolean(parseChoiceQuestion(question.item.stemMarkdown));
  const solution = isSolutionQuestion(question);
  const suggestion = hasChoices
    ? choiceSuggestion(question.item.stemMarkdown)
    : null;
  const updateFigure = (id: string, p: Record<string, unknown>) =>
    onChange({
      figures: [
        ...layout.figures.filter((x) => x.figureId !== id),
        {
          figureId: id,
          placement: "auto" as const,
          ...layout.figures.find((x) => x.figureId === id),
          ...p,
        },
      ],
    });
  const automaticBreak = layout.equalizedPageBreakBefore === true;
  const stemFigures = question.item.figures.filter(
    (figure) => String(figure.usage || "stem") !== "analysis",
  );
  return (
    <aside className="w-72 shrink-0 overflow-auto bg-white p-4 dark:bg-zinc-950">
      <div className="mb-4 flex items-center justify-between gap-2">
        <b className="text-xs">题目属性</b>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
          onClick={onEditContent}
        >
          <Pencil className="size-3.5" />编辑内容
        </button>
      </div>
      {hasChoices && suggestion ? (
        <Field label="选项布局">
          <select
            className={control}
            value={layout.choiceLayout}
            onChange={(e) =>
              onChange({
                choiceLayout: e.target.value as QuestionLayout["choiceLayout"],
              })
            }
          >
            <option value="auto">
              自动（建议
              {suggestion.layout === "four"
                ? "四栏"
                : suggestion.layout === "two"
                  ? "两栏"
                  : "单栏"}
              ）
            </option>
            <option value="four">四栏</option>
            <option value="two">两栏</option>
            <option value="one">单栏</option>
          </select>
          <p className="mt-1 text-[10px] text-zinc-400">{suggestion.reason}</p>
        </Field>
      ) : (
        <Field label="题型">
          <p className="text-xs text-zinc-500">
            {question.item.questionType || "未设题型"}，无选项布局。
          </p>
        </Field>
      )}
      <Field label="分页">
        <label className="mb-2 flex gap-2 text-xs">
          <input
            type="checkbox"
            checked={Boolean(layout.pageBreakBefore || automaticBreak)}
            onChange={(e) =>
              onChange({
                pageBreakBefore: e.target.checked,
                equalizedPageBreakBefore: e.target.checked
                  ? layout.equalizedPageBreakBefore
                  : false,
              })
            }
          />
          题前分页{automaticBreak ? "（等高排版自动设置）" : ""}
        </label>
        <label className="flex gap-2 text-xs">
          <input
            type="checkbox"
            checked={layout.keepTogether !== false}
            onChange={(e) => onChange({ keepTogether: e.target.checked })}
          />
          尽量保持整题
        </label>
        {automaticBreak ? (
          <p className="mt-2 text-[10px] leading-4 text-amber-700">
            取消"题前分页"可移除本题的隐藏自动分页，同时保留当前答题区高度。
          </p>
        ) : null}
      </Field>
      {solution ? (
        <Field label="答题区高度">
          <input
            className="w-full"
            type="range"
            min="0"
            max="12"
            step="0.2"
            value={
              layout.answerAreaHeight ??
              layout.equalizedAnswerAreaHeight ??
              defaultSolutionAnswerAreaHeightCm
            }
              onChange={(e) =>
                onChange({
                  answerAreaHeight: Number(e.target.value) || undefined,
                  answerAreaManual: true,
                  equalizedAnswerAreaHeight: undefined,
                })
            }
          />
          <span className="text-xs">
            {(
              layout.answerAreaHeight ??
              layout.equalizedAnswerAreaHeight ??
              defaultSolutionAnswerAreaHeightCm
            ).toFixed(1)}
            cm
          </span>
        </Field>
      ) : null}
      {stemFigures.length > 1 ? (
        <Field label="多图布局">
          <select
            className={control}
            value={layout.multiFigureLayout || "auto"}
            onChange={(e) =>
              onChange({
                multiFigureLayout: e.target.value as QuestionLayout["multiFigureLayout"],
              })
            }
          >
            <option value="auto">自动（2-4 张优先并排）</option>
            <option value="row">并排显示</option>
            <option value="column">纵向显示</option>
          </select>
          <p className="mt-1 text-[10px] leading-4 text-zinc-400">
            控制本题连续题图的组合方式，单图宽度仍可在下方分别调整。
          </p>
        </Field>
      ) : null}
      {question.item.figures.map((f, i) => {
        const id = figureIdOf(f, i),
          c = layout.figures.find((x) => x.figureId === id);
        const anchored = String(question.item.stemMarkdown || "").includes(id);
        const allowed = allowedFigurePlacements({
          usage: String(f.usage || "stem"),
          stemFigureCount: stemFigures.length,
          anchored,
        });
        const analysis = String(f.usage || "") === "analysis";
        return (
          <Field key={id} label={`题图 ${i + 1}`}>
            <select
              disabled={analysis}
              className={control}
              value={
                allowed.includes(c?.placement || "auto")
                  ? c?.placement || "auto"
                  : "auto"
              }
              onChange={(e) =>
                updateFigure(id, {
                  placement: e.target.value as FigurePlacement,
                })
              }
            >
              <option value="auto">自动</option>
              <option
                value="before-choices"
                disabled={!allowed.includes("before-choices")}
              >
                选项前
              </option>
              <option
                value="side-right"
                disabled={!allowed.includes("side-right")}
              >
                选项右侧
              </option>
              <option
                value="side-left"
                disabled={!allowed.includes("side-left")}
              >
                选项左侧
              </option>
              <option
                value="after-choices"
                disabled={!allowed.includes("after-choices")}
              >
                选项后
              </option>
            </select>
            {analysis ? (
              <p className="mt-1 text-[10px] text-zinc-400">
                解析图固定保留在解析区域。
              </p>
            ) : anchored ? (
              <p className="mt-1 text-[10px] text-zinc-400">
                带正文锚点的图片保持原位置。
              </p>
            ) : stemFigures.length > 1 ? (
              <p className="mt-1 text-[10px] text-zinc-400">
                多图题不支持左右混排。
              </p>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
              <span className="font-medium text-zinc-600 dark:text-zinc-300">图片宽度</span>
              <div className="flex items-center gap-2">
                <span>{c?.widthRatio ? `${Math.round(c.widthRatio * 100)}%` : "自动"}</span>
                {c?.widthRatio ? (
                  <button
                    type="button"
                    className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    onClick={() => updateFigure(id, { widthRatio: undefined })}
                  >
                    恢复自动
                  </button>
                ) : null}
              </div>
            </div>
            <input
              disabled={analysis}
              aria-label={`题图 ${i + 1} 宽度`}
              className="mt-1 w-full"
              type="range"
              min="15"
              max="100"
              step="5"
              value={(c?.widthRatio ?? 0.3) * 100}
              onChange={(e) => updateFigure(id, { widthRatio: Number(e.target.value) / 100 })}
            />
            <select
              disabled={analysis}
              className={`${control} mt-2`}
              value={c?.alignment || "center"}
              onChange={(e) =>
                updateFigure(id, {
                  alignment: e.target.value as FigureAlignment,
                })
              }
            >
              <option value="left">左对齐</option>
              <option value="center">居中</option>
              <option value="right">右对齐</option>
            </select>
          </Field>
        );
      })}
      <button
        className="flex h-8 w-full items-center justify-center gap-1 rounded-md border text-xs"
        onClick={() => onChange(resetQuestionLayout(layout, solution))}
      >
        <RotateCcw className="size-3.5" />
        恢复本题自动排版
      </button>
    </aside>
  );
}
