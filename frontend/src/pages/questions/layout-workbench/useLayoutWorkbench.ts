import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collectionsApi } from "@/api/collections";
import {
  layoutDraftsApi,
  type LayoutDraft,
  type LayoutWarning,
  type PaperLayout,
  type QuestionLayout,
} from "@/api/layoutDrafts";
import type { Basket } from "@/types";
import type { QuestionContentDraft } from "@/types/questionContent";
import {
  defaultSolutionAnswerAreaHeightCm,
  hydrateLayout,
  isSolutionQuestion,
  moveWithinSection,
  orderedQuestions,
  patchQuestion,
  resetLayoutQuestions,
} from "@/components/questions/layoutWorkbenchModel";

const pendingLayoutKey = (draftId: string) => `layout-draft-pending:${draftId}`;

export function useLayoutWorkbench() {
  const { id = "", draftId = "" } = useParams();
  const navigate = useNavigate();
  const [basket, setBasket] = useState<Basket | null>(null);
  const [draft, setDraft] = useState<LayoutDraft | null>(null);
  const [layout, setLayout] = useState<PaperLayout | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [saveState, setSaveState] = useState<
    "saved" | "dirty" | "saving" | "error"
  >("saved");
  const [message, setMessage] = useState("");
  const [warningQuestionId, setWarningQuestionId] = useState("");
  const [variant, setVariant] = useState<"student" | "teacher">("student");
  const [activePage, setActivePage] = useState(1);
  const [editingContentId, setEditingContentId] = useState("");
  const undoStack = useRef<PaperLayout[]>([]);
  const redoStack = useRef<PaperLayout[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const previewBusy = useRef(false);

  useEffect(() => {
    Promise.all([
      collectionsApi.getCollection(id),
      layoutDraftsApi.get(draftId),
    ])
      .then(([b, response]) => {
        const d = response.draft;
        const effectiveBasket = (d.effectiveContentSnapshot || b) as Basket;
        let hydrated = hydrateLayout(effectiveBasket, d.layout);
        try {
          const pending = JSON.parse(
            localStorage.getItem(pendingLayoutKey(d.id)) || "null",
          ) as { revision?: number; layout?: PaperLayout } | null;
          if (pending?.revision === d.revision && pending.layout) {
            hydrated = hydrateLayout(effectiveBasket, pending.layout);
            setSaveState("dirty");
            setMessage("已恢复上次未保存的本地排版修改。");
          }
        } catch {
          localStorage.removeItem(pendingLayoutKey(d.id));
        }
        setBasket(effectiveBasket);
        setDraft(d);
        setLayout(hydrated);
        setSelectedId(hydrated.questions[0]?.relationId || "");
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : String(e)));
  }, [draftId, id]);
  const save = useCallback(
    async (next: PaperLayout) => {
      if (!draft) return;
      clearTimeout(timer.current);
      setSaveState("saving");
      try {
        const response = await layoutDraftsApi.save(draft.id, {
          revision: draft.revision,
          layout: next,
        });
        localStorage.removeItem(pendingLayoutKey(draft.id));
        setDraft(response.draft);
        setSaveState("saved");
        return response.draft;
      } catch (e) {
        setSaveState("error");
        localStorage.setItem(
          pendingLayoutKey(draft.id),
          JSON.stringify({ revision: draft.revision, layout: next }),
        );
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [draft],
  );
  const generateExactPreview = useCallback(async (base: LayoutDraft) => {
    if (previewBusy.current) return;
    previewBusy.current = true;
    try {
      const synced = await layoutDraftsApi.refreshContent(
        base.id,
        base.revision,
      );
      const refreshed = synced.draft;
      setDraft(refreshed);
      if (refreshed.effectiveContentSnapshot)
        setBasket(refreshed.effectiveContentSnapshot as Basket);
      const response = await layoutDraftsApi.preview(
        refreshed.id,
        refreshed.revision,
      );
      setDraft((current) =>
        current?.id === refreshed.id
          ? { ...refreshed, preview: response.preview }
          : current,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      previewBusy.current = false;
    }
  }, []);
  const scheduleSave = useCallback(
    (next: PaperLayout) => {
      setSaveState("dirty");
      if (draft)
        localStorage.setItem(
          pendingLayoutKey(draft.id),
          JSON.stringify({ revision: draft.revision, layout: next }),
        );
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(next), 900);
    },
    [draft, save],
  );
  const change = useCallback(
    (next: PaperLayout) => {
      if (!layout) return;
      if (JSON.stringify(next) === JSON.stringify(layout)) return;
      undoStack.current.push(layout);
      redoStack.current = [];
      setLayout(next);
      setSaveState("dirty");
      if (draft)
        localStorage.setItem(
          pendingLayoutKey(draft.id),
          JSON.stringify({ revision: draft.revision, layout: next }),
        );
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(next), 900);
    },
    [draft, layout, save],
  );
  useEffect(() => {
    const block = (e: BeforeUnloadEvent) => {
      if (saveState !== "saved") e.preventDefault();
    };
    addEventListener("beforeunload", block);
    return () => removeEventListener("beforeunload", block);
  }, [saveState]);
  useEffect(() => {
    if (saveState !== "saved" || !draft) return;
    if (
      draft.preview.revision === draft.revision &&
      draft.preview.status !== "idle"
    )
      return;
    const handle = window.setTimeout(
      () => void generateExactPreview(draft),
      650,
    );
    return () => window.clearTimeout(handle);
  }, [
    saveState,
    draft?.id,
    draft?.revision,
    draft?.preview.revision,
    draft?.preview.status,
    generateExactPreview,
  ]);
  useEffect(() => {
    if (!draft || !["queued", "rendering"].includes(draft.preview.status))
      return;
    const handle = window.setInterval(() => {
      void layoutDraftsApi
        .status(draft.id)
        .then((next) =>
          setDraft((current) =>
            current ? { ...current, preview: next } : current,
          ),
        )
        .catch((e) => setMessage(e instanceof Error ? e.message : String(e)));
    }, 750);
    return () => window.clearInterval(handle);
  }, [draft?.id, draft?.preview.status]);
  const entries = useMemo(
    () => (basket && layout ? orderedQuestions(basket, layout) : []),
    [basket, layout],
  );
  const selected = entries.find((e) => e.layout.relationId === selectedId);
  const editingEntry = entries.find(
    (entry) => entry.layout.relationId === editingContentId,
  );
  const editingOriginalEntry = (
    (draft?.contentSnapshot?.questions || []) as Array<{
      relationId?: string;
      item?: Basket["questions"][number]["item"];
    }>
  ).find((entry) => String(entry.relationId || "") === editingContentId);

  async function saveQuestionContent(
    relationId: string,
    content: QuestionContentDraft,
  ) {
    if (!draft || !layout) return;
    const base = saveState === "saved" ? draft : await save(layout);
    if (!base) throw new Error("排版修改尚未保存，无法写入题目内容。");
    const response = await layoutDraftsApi.save(base.id, {
      revision: base.revision,
      contentEdits: [{ relationId, content }],
    });
    setDraft(response.draft);
    if (response.draft.effectiveContentSnapshot)
      setBasket(response.draft.effectiveContentSnapshot as Basket);
    setSaveState("saved");
    setMessage("已保存到当前试卷，正在更新 PDF。");
  }

  async function syncQuestionContentToBank(
    relationId: string,
    expectedContentRevision: number,
  ) {
    if (!draft) return;
    const response = await layoutDraftsApi.syncContentToBank(
      draft.id,
      relationId,
      { revision: draft.revision, expectedContentRevision },
    );
    setDraft(response.draft);
    if (response.draft.effectiveContentSnapshot)
      setBasket(response.draft.effectiveContentSnapshot as Basket);
    setSaveState("saved");
    setMessage(
      response.warnings?.length
        ? "题库原题已同步，但 OCR 草稿同步产生警告。"
        : "题库原题已同步，正在更新 PDF。",
    );
  }
  const syncVisiblePage = useCallback(
    (page: number) => {
      setActivePage(page);
      const pages = draft?.preview.questionPages?.[variant] || {};
      const selectedPage = pages[selectedId];
      if (
        selectedPage &&
        selectedPage.startPage <= page &&
        selectedPage.endPage >= page
      )
        return;
      const visible = entries.find((entry) => {
        const range = pages[entry.layout.relationId];
        return range && range.startPage <= page && range.endPage >= page;
      });
      if (visible) setSelectedId(visible.layout.relationId);
    },
    [draft?.preview.questionPages, entries, selectedId, variant],
  );
  function navigatePage(page: number) {
    setActivePage(page);
    requestAnimationFrame(() =>
      document
        .getElementById(`exact-preview-page-${page}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  function selectQuestion(id: string) {
    setSelectedId(id);
    setWarningQuestionId("");
    const page = draft?.preview.questionPages?.[variant]?.[id]?.startPage;
    if (page) navigatePage(page);
  }
  function selectWarning(warning: LayoutWarning) {
    const entry = entries.find(
      (item) =>
        item.layout.relationId === warning.questionId ||
        String(item.question.item.id) === warning.questionId,
    );
    const relationId = entry?.layout.relationId || warning.questionId;
    setSelectedId(relationId);
    setWarningQuestionId(relationId);
    const page =
      warning.page ||
      draft?.preview.questionPages?.[variant]?.[relationId]?.startPage;
    if (page) navigatePage(page);
  }
  function undo() {
    if (!layout) return;
    const v = undoStack.current.pop();
    if (v) {
      redoStack.current.push(layout);
      setLayout(v);
      scheduleSave(v);
    }
  }
  function redo() {
    if (!layout) return;
    const v = redoStack.current.pop();
    if (v) {
      undoStack.current.push(layout);
      setLayout(v);
      scheduleSave(v);
    }
  }
  function applyPageEqualization(startRelationId: string, count: 2 | 3 | null) {
    if (!layout || !draft) return;
    const activeLayout = layout;
    const activeDraft = draft;
    const restore = (item: QuestionLayout): QuestionLayout => ({
      ...item,
      answerAreaHeight: item.equalizedPreviousAnswerAreaHeight,
      answerAreaManual: item.equalizedPreviousAnswerAreaManual,
      equalizedAnswerAreaHeight: undefined,
      equalizedPageBreakBefore: undefined,
      equalizedGroupId: undefined,
      equalizedGroupSize: undefined,
      equalizedPreviousAnswerAreaHeight: undefined,
      equalizedPreviousAnswerAreaManual: undefined,
    });
    const solutions = entries.filter((entry) =>
      isSolutionQuestion(entry.question),
    );
    const startIndex = solutions.findIndex(
      (entry) => entry.layout.relationId === startRelationId,
    );
    if (startIndex < 0) return;
    const current = activeLayout.questions.find(
      (item) => item.relationId === startRelationId,
    );
    const currentGroup = current?.equalizedGroupId || startRelationId;
    if (!count) {
      change({
        ...activeLayout,
        questions: activeLayout.questions.map((item) =>
          item.equalizedGroupId === currentGroup ? restore(item) : item,
        ),
      });
      return;
    }
    const telemetry = activeDraft.preview.questionPages?.student || {};
    if (
      activeDraft.preview.displayRevision !== activeDraft.revision ||
      !telemetry[startRelationId]
    ) {
      setMessage("请先生成当前 revision 的 PDF，再使用本页等高排版。");
      return;
    }
    const grouped = solutions.slice(startIndex, startIndex + count);
    if (grouped.length < count) {
      setMessage(`本页后续不足 ${count} 道解答题，无法应用等高排版。`);
      return;
    }
    const selectedIds = new Set(
      grouped.map((entry) => entry.layout.relationId),
    );
    const conflictingGroups = new Set(
      grouped.map((entry) => entry.layout.equalizedGroupId).filter(Boolean),
    );
    const cleared = activeLayout.questions.map((item) =>
      conflictingGroups.has(item.equalizedGroupId) ? restore(item) : item,
    );
    change({
      ...activeLayout,
      questions: cleared.map((item) => {
        if (!selectedIds.has(item.relationId)) return item;
        const record = telemetry[item.relationId];
        const currentAnswerCm =
          item.answerAreaHeight ??
          item.equalizedAnswerAreaHeight ??
          defaultSolutionAnswerAreaHeightCm;
        const measuredPt =
          record && record.startPage === record.endPage
            ? Math.max(
                0,
                (record.endPageTotal || 0) - (record.startPageTotal || 0),
              )
            : 0;
        const contentPt = Math.max(0, measuredPt - currentAnswerCm * 28.3465);
        const pageGoal =
          record?.pageGoal || telemetry[startRelationId]?.pageGoal || 650;
        const equalized = Math.max(
          0.8,
          Math.min(12, (pageGoal / count - contentPt - 8) / 28.3465),
        );
        return {
          ...item,
          equalizedPreviousAnswerAreaHeight: item.answerAreaHeight,
          equalizedPreviousAnswerAreaManual: item.answerAreaManual,
          answerAreaHeight: undefined,
          answerAreaManual: false,
          equalizedAnswerAreaHeight: Number(equalized.toFixed(1)),
          equalizedPageBreakBefore: item.relationId === startRelationId,
          equalizedGroupId: startRelationId,
          equalizedGroupSize: count,
        };
      }),
    });
  }
  function resetPage() {
    if (!draft || !layout) return;
    const activeLayout = layout;
    const pages = draft.preview.questionPages?.[variant] || {};
    const ids = entries
      .filter((entry) => {
        const range = pages[entry.layout.relationId];
        return (
          range && range.startPage <= activePage && range.endPage >= activePage
        );
      })
      .map((entry) => entry.layout.relationId);
    const solutions = entries
      .filter((entry) => isSolutionQuestion(entry.question))
      .map((entry) => entry.layout.relationId);
    if (ids.length) change(resetLayoutQuestions(activeLayout, ids, solutions));
  }
  function resetAll() {
    if (!layout) return;
    const activeLayout = layout;
    const ids = activeLayout.questions.map((item) => item.relationId);
    const solutions = entries
      .filter((entry) => isSolutionQuestion(entry.question))
      .map((entry) => entry.layout.relationId);
    change(resetLayoutQuestions(activeLayout, ids, solutions));
  }
  async function exactPreview() {
    if (!layout || !draft) return;
    const saved = saveState !== "saved" ? await save(layout) : draft;
    if (
      saved &&
      !(
        saved.preview.revision === saved.revision &&
        saved.preview.status === "ready"
      )
    )
      await generateExactPreview(saved);
  }

  return {
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
  };
}
