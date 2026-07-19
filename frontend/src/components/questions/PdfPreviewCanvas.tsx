import { useEffect, useRef } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import type { PreviewState } from "@/api/layoutDrafts";

type Props = {
  preview: PreviewState;
  variant: "student" | "teacher";
  zoom?: number;
  activePage?: number;
  pageIdPrefix?: string;
  onVisiblePage?: (page: number) => void;
  onRetry?: () => void;
};

export function PdfPreviewCanvas({
  preview,
  variant,
  zoom = 100,
  activePage,
  pageIdPrefix = "pdf-preview-page",
  onVisiblePage,
  onRetry,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const shown = preview.variants?.[variant];
  const images = shown?.pageImages || [];
  const imageKey = images.join("|");
  const updating =
    preview.status === "queued" || preview.status === "rendering";
  const stale = Boolean(
    preview.displayRevision && preview.displayRevision !== preview.revision,
  );

  useEffect(() => {
    if (
      !imageKey ||
      !onVisiblePage ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const ratios = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (records) => {
        records.forEach((record) =>
          ratios.set(record.target, record.intersectionRatio),
        );
        let best: Element | undefined;
        let score = 0;
        ratios.forEach((ratio, node) => {
          if (ratio > score) {
            score = ratio;
            best = node;
          }
        });
        const visible = Number(
          (best as HTMLElement | undefined)?.dataset.pdfPreviewPage || 0,
        );
        if (visible && score > 0.05) onVisiblePage(visible);
      },
      {
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
        rootMargin: "-80px 0px -35% 0px",
      },
    );
    root.current
      ?.querySelectorAll("[data-pdf-preview-page]")
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [imageKey, onVisiblePage]);

  const status = updating
    ? `正在生成 r${preview.revision} PDF${stale ? `，当前显示 r${preview.displayRevision}` : ""}`
    : preview.status === "failed"
      ? `r${preview.revision} PDF 生成失败${stale ? `，继续显示 r${preview.displayRevision}` : ""}`
      : stale
        ? `当前显示 r${preview.displayRevision}，草稿已更新到 r${preview.revision}`
        : "";

  return (
    <div ref={root} className="relative min-h-[520px]">
      {status ? (
        <div
          className={`sticky top-12 z-20 mx-auto mt-3 flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-md ${preview.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}
          role="status"
        >
          {updating ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : preview.status === "failed" ? (
            <AlertCircle className="size-3.5" />
          ) : null}
          <span>{status}</span>
          {preview.status === "failed" && onRetry ? (
            <button
              type="button"
              className="font-medium underline"
              onClick={onRetry}
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}
      {images.length ? (
        <div className="space-y-5 py-5">
          {images.map((src, index) => {
            const page = index + 1;
            return (
              <div
                id={`${pageIdPrefix}-${page}`}
                data-pdf-preview-page={page}
                key={src}
                className={`scroll-mt-14 rounded-sm transition-shadow ${activePage === page ? "ring-2 ring-amber-400 ring-offset-4" : ""}`}
              >
                <img
                  src={src}
                  alt={`${variant === "teacher" ? "教师版" : "学生版"}第 ${page} 页`}
                  className="mx-auto bg-white shadow-sm ring-1 ring-zinc-200"
                  style={{
                    width: `${zoom}%`,
                    maxWidth: zoom === 100 ? "900px" : undefined,
                  }}
                />
              </div>
            );
          })}
        </div>
      ) : shown?.pdfUrl ? (
        <iframe
          title={`${variant === "teacher" ? "教师版" : "学生版"} PDF 预览`}
          src={`${shown.pdfUrl}#zoom=page-width`}
          className="my-4 h-[calc(100vh-205px)] w-full rounded-md border bg-white"
        />
      ) : (
        <div className="flex h-full min-h-[520px] items-center justify-center text-sm text-zinc-500">
          {updating ? (
            <>
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              正在使用最终 PDF 引擎生成预览…
            </>
          ) : preview.status === "failed" ? (
            preview.error || "PDF 预览生成失败。"
          ) : (
            "等待生成 PDF 预览…"
          )}
        </div>
      )}
    </div>
  );
}
