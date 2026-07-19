import { api, jsonHeaders } from "./client";
export type ChoiceLayoutOverride = "auto" | "four" | "two" | "one";
export type FigurePlacement =
  "auto" | "before-choices" | "after-choices" | "side-left" | "side-right";
export type FigureAlignment = "left" | "center" | "right";
export type MultiFigureLayout = "auto" | "row" | "column";
export type FigureLayout = {
  figureId: string;
  placement: FigurePlacement;
  widthRatio?: number;
  alignment?: FigureAlignment;
};
export type QuestionLayout = {
  relationId: string;
  order?: number;
  choiceLayout: ChoiceLayoutOverride;
  multiFigureLayout?: MultiFigureLayout;
  figures: FigureLayout[];
  keepTogether?: boolean;
  pageBreakBefore?: boolean;
  answerAreaHeight?: number;
  answerAreaManual?: boolean;
  equalizedAnswerAreaHeight?: number;
  equalizedPageBreakBefore?: boolean;
  equalizedGroupId?: string;
  equalizedGroupSize?: 2 | 3;
  equalizedPreviousAnswerAreaHeight?: number;
  equalizedPreviousAnswerAreaManual?: boolean;
};
export type PaperLayout = {
  version: 1;
  solutionPageStrategy?: "auto" | "two" | "three";
  questions: QuestionLayout[];
};
export type LayoutPreview = PreviewState;
export type LayoutWarning = {
  code:
    | "choice-overflow"
    | "figure-too-small"
    | "question-split"
    | "page-overflow"
    | "missing-figure"
    | "layout-fallback";
  questionId: string;
  questionNo?: string;
  variant?: "student" | "teacher";
  source?: "pdf";
  figureId?: string;
  message: string;
  page?: number;
  suggestion?: string;
};
export type PreviewVariant = {
  pdfUrl: string;
  pages: string[];
  pageImages: string[];
  pageCount: number;
};
export type QuestionPageTelemetry = {
  startPage: number;
  startPageTotal?: number;
  endPage: number;
  endPageTotal?: number;
  pageGoal?: number;
};
export type PreviewState = {
  revision: number;
  displayRevision?: number;
  status: "idle" | "queued" | "rendering" | "ready" | "failed";
  pdfUrl: string;
  pages: string[];
  pageImages: string[];
  pageCount: number;
  variants?: { student: PreviewVariant; teacher: PreviewVariant };
  questionPages?: Partial<
    Record<"student" | "teacher", Record<string, QuestionPageTelemetry>>
  >;
  warnings: LayoutWarning[];
  error: string;
};
export type TemplateRenderSpec = {
  version: 1;
  templateId: "exam" | "worksheet";
  page: {
    widthMm: number;
    heightMm: number;
    marginTopMm: number;
    marginRightMm: number;
    marginBottomMm: number;
    marginLeftMm: number;
  };
  typography: {
    bodyFont: string;
    headingFont: string;
    bodySizePt: number;
    lineHeight: number;
    questionGapMm: number;
  };
  header: { heightMm: number; label: string; subject: string };
  footer: { heightMm: number };
  title: { sizePt: number; gapAfterMm: number };
  section: { sizePt: number; gapBeforeMm: number; gapAfterMm: number };
  choices: { columnGapMm: number; rowGapMm: number };
  figures: {
    maxHeightMm: number;
    defaultWidthRatio: number;
    sideWidthRatio: number;
  };
  colors: {
    ink: string;
    tint: string;
    line: string;
    warm: string;
    alert: string;
  };
};
export type LayoutDraft = {
  id: string;
  collectionId: string;
  collectionTitle?: string;
  name: string;
  template: string;
  templateSpec: TemplateRenderSpec;
  templateSpecVersion: number;
  variant: "student" | "teacher";
  revision: number;
  layout: PaperLayout;
  contentSnapshot: any;
  contentOverrides?: Record<string, {
    questionId: string;
    stemMarkdown: string;
    answerText: string;
    analysisMarkdown: string;
    baseContentRevision: number;
  }>;
  effectiveContentSnapshot?: any;
  createdAt?: string;
  updatedAt: string;
  preview: PreviewState;
};
type DraftResponse = { draft: LayoutDraft; preview: PreviewState };
export const layoutDraftsApi = {
  list: (collectionId: string) =>
    api<{ items: LayoutDraft[] }>(
      `/api/question-bank/collections/${encodeURIComponent(collectionId)}/layout-drafts`,
    ),
  search: (params: Record<string, string | number | undefined> = {}) => {
    const query = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)]),
    );
    return api<{
      items: LayoutDraft[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/question-bank/layout-drafts?${query}`);
  },
  create: (collectionId: string, body: Record<string, unknown> = {}) =>
    api<DraftResponse & { draftId: string }>(
      `/api/question-bank/collections/${encodeURIComponent(collectionId)}/layout-drafts`,
      { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) },
    ),
  get: (id: string) =>
    api<DraftResponse>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}`,
    ),
  save: (id: string, body: {
    revision: number;
    layout?: any;
    name?: string;
    contentEdits?: Array<{
      relationId: string;
      content: { stemMarkdown: string; answerText: string; analysisMarkdown: string };
    }>;
  }) =>
    api<DraftResponse>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}`,
      { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(body) },
    ),
  syncContentToBank: (id: string, relationId: string, body: { revision: number; expectedContentRevision: number }) =>
    api<{ draft: LayoutDraft; item: unknown; warnings?: Array<{ code: string; message: string }> }>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}/content/${encodeURIComponent(relationId)}/sync-to-bank`,
      { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) },
    ),
  refreshContent: (id: string, revision: number) =>
    api<DraftResponse & { changed: boolean }>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}/refresh-content`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ revision }),
      },
    ),
  preview: (id: string, revision: number) =>
    api<{ preview: PreviewState }>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}/preview`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ revision }),
      },
    ),
  status: (id: string) =>
    api<PreviewState>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}/preview-status`,
    ),
  pages: (id: string) =>
    api<{ revision: number; displayRevision?:number; status: string; pages: string[]; pdfUrl: string }>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}/pages`,
    ),
  export: (id: string, revision: number) =>
    api<any>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}/export`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ revision, format: "pdf" }),
      },
    ),
  remove: (id: string) =>
    api<{ deleted: boolean }>(
      `/api/question-bank/layout-drafts/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};
