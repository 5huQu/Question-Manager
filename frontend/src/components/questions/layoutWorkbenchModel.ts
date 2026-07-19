import type { Basket, BasketQuestion, QuestionFigure } from "@/types";
import type {
  FigurePlacement,
  PaperLayout,
  QuestionLayout,
} from "@/api/layoutDrafts";

/** Mirrors the student-paper default used by the LaTeX renderer. */
export const defaultSolutionAnswerAreaHeightCm = 4.2;

export function relationIdOf(question: BasketQuestion) {
  return String(question.relationId || question.item.id);
}

export function isSolutionQuestion(question: BasketQuestion) {
  return String(question.item.questionType || "").includes("解答");
}

export function hydrateLayout(
  basket: Basket,
  value?: PaperLayout,
): PaperLayout {
  const existing = new Map(
    (value?.questions || []).map((item) => [item.relationId, item]),
  );
  return {
    version: 1,
    solutionPageStrategy: value?.solutionPageStrategy || "auto",
    questions: basket.questions
      .map((question, order) => {
        const relationId = relationIdOf(question);
        const current = existing.get(relationId);
        return {
          relationId,
          order: current?.order ?? order,
          choiceLayout: current?.choiceLayout || "auto",
          multiFigureLayout: current?.multiFigureLayout || "auto",
          figures: current?.figures || [],
          keepTogether: current?.keepTogether ?? true,
          pageBreakBefore: current?.pageBreakBefore ?? false,
          answerAreaHeight:
            current?.answerAreaHeight ??
            (current?.equalizedAnswerAreaHeight == null &&
            isSolutionQuestion(question)
              ? defaultSolutionAnswerAreaHeightCm
              : undefined),
          answerAreaManual: current?.answerAreaManual ?? false,
          equalizedAnswerAreaHeight: current?.equalizedAnswerAreaHeight,
          equalizedPageBreakBefore: current?.equalizedPageBreakBefore,
          equalizedGroupId: current?.equalizedGroupId,
          equalizedGroupSize: current?.equalizedGroupSize,
          equalizedPreviousAnswerAreaHeight:
            current?.equalizedPreviousAnswerAreaHeight,
          equalizedPreviousAnswerAreaManual:
            current?.equalizedPreviousAnswerAreaManual,
        };
      })
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  };
}

export function orderedQuestions(basket: Basket, layout: PaperLayout) {
  const byId = new Map(
    basket.questions.map((question) => [relationIdOf(question), question]),
  );
  return layout.questions.flatMap((item) => {
    const question = byId.get(item.relationId);
    return question ? [{ question, layout: item }] : [];
  });
}

export function patchQuestion(
  layout: PaperLayout,
  relationId: string,
  patch: Partial<QuestionLayout>,
): PaperLayout {
  return {
    ...layout,
    questions: layout.questions.map((item) =>
      item.relationId === relationId ? { ...item, ...patch } : item,
    ),
  };
}

export function resetQuestionLayout(
  item: QuestionLayout,
  solution = false,
): QuestionLayout {
  return {
    relationId: item.relationId,
    order: item.order,
    choiceLayout: "auto",
    multiFigureLayout: "auto",
    figures: [],
    keepTogether: true,
    pageBreakBefore: false,
    answerAreaHeight: solution ? defaultSolutionAnswerAreaHeightCm : undefined,
    answerAreaManual: false,
  };
}

export function resetLayoutQuestions(
  layout: PaperLayout,
  relationIds: Iterable<string>,
  solutionIds: Iterable<string>,
): PaperLayout {
  const selected = new Set(relationIds);
  const solutions = new Set(solutionIds);
  return {
    ...layout,
    solutionPageStrategy:
      selected.size === layout.questions.length
        ? "auto"
        : layout.solutionPageStrategy,
    questions: layout.questions.map((item) =>
      selected.has(item.relationId)
        ? resetQuestionLayout(item, solutions.has(item.relationId))
        : item,
    ),
  };
}

export function allowedFigurePlacements(options: {
  usage?: string;
  stemFigureCount: number;
  anchored: boolean;
}): FigurePlacement[] {
  if (options.usage === "analysis") return ["auto"];
  const base: FigurePlacement[] = ["auto", "before-choices", "after-choices"];
  return options.stemFigureCount === 1 && !options.anchored
    ? [...base, "side-left", "side-right"]
    : base;
}

export function moveWithinSection(
  layout: PaperLayout,
  basket: Basket,
  sourceId: string,
  targetId: string,
): PaperLayout {
  if (sourceId === targetId) return layout;
  const byId = new Map(
    basket.questions.map((question) => [relationIdOf(question), question]),
  );
  const sectionById = new Map<string, string>();
  let currentSection = "";
  basket.questions.forEach((question) => {
    currentSection = question.sectionName || currentSection;
    sectionById.set(relationIdOf(question), currentSection);
  });
  const source = byId.get(sourceId);
  const target = byId.get(targetId);
  if (
    !source ||
    !target ||
    sectionById.get(sourceId) !== sectionById.get(targetId)
  )
    return layout;
  const questions = [...layout.questions];
  const from = questions.findIndex((item) => item.relationId === sourceId);
  const to = questions.findIndex((item) => item.relationId === targetId);
  if (from < 0 || to < 0) return layout;
  const [moved] = questions.splice(from, 1);
  questions.splice(to, 0, moved);
  return {
    ...layout,
    questions: questions.map((item, order) => ({ ...item, order })),
  };
}

export function figureIdOf(figure: QuestionFigure, index: number) {
  return String(figure.id || figure.blockId || `figure-${index + 1}`);
}

export function choiceSuggestion(stem: string) {
  let matches = [...stem.matchAll(/(?:^|\n)\s*[A-D][.．、]\s*([^\n]+)/g)];
  if (matches.length !== 4) {
    const markers = [...stem.matchAll(/(?:^|\s)([A-D])[.．、]\s*/g)];
    if (markers.map((match) => match[1]).join("") === "ABCD")
      matches = markers.map((match, index) => {
        const start = (match.index || 0) + match[0].length,
          end = markers[index + 1]?.index ?? stem.length;
        return [
          stem.slice(match.index || 0, end),
          stem.slice(start, end),
        ] as unknown as RegExpMatchArray;
      });
  }
  const choices = matches.map((match) => String(match[1] || "").trim());
  if (choices.length !== 4)
    return {
      layout: "one" as const,
      reason: "未识别到四个结构化选项，建议单栏。",
    };
  const max = Math.max(
    ...choices.map((item) => item.replace(/\\[a-zA-Z]+/g, "x").length),
  );
  if (max <= 18)
    return { layout: "four" as const, reason: "四个选项较短，建议一行四栏。" };
  if (max <= 38)
    return { layout: "two" as const, reason: "选项中等长度，建议每行两栏。" };
  return { layout: "one" as const, reason: "存在长选项，建议单栏避免溢出。" };
}
