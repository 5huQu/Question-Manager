#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.cutter.crop_questions import crop_question_images, detect_figures, infer_question_slices, render_page_images, summarize_graphic_candidates
from src.cutter.detect_questions import detect_question_anchors
from src.cutter.render_pdf import extract_answer_summaries, load_document


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run migrated PDF question cutter for one PDF.")
    parser.add_argument("--input-pdf", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--asset-root", type=Path, required=True)
    parser.add_argument("--dpi", type=int, default=180)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf_path = args.input_pdf.resolve()
    output_dir = args.output_dir.resolve()
    asset_root = args.asset_root.resolve()
    pages_dir = output_dir / "pages"
    auto_cuts_dir = output_dir / "auto_cuts"
    results_path = output_dir / "cut_results.json"
    pages_dir.mkdir(parents=True, exist_ok=True)
    auto_cuts_dir.mkdir(parents=True, exist_ok=True)

    failed_pdfs: list[dict] = []
    results: list[dict] = []
    page_image_map: dict[str, list[Path]] = {}
    total_pages = 0
    diagnostics: dict = {}

    try:
      document = load_document(pdf_path)
      diagnostics = {
          "document_notes": list(document.notes),
          "graphics": summarize_graphic_candidates(document),
      }
      if not any(page.has_text for page in document.pages):
          raise RuntimeError("PDF 无可用文字层，不支持扫描件或图片型 PDF。")

      page_paths = render_page_images(document, pages_dir, dpi=args.dpi)
      page_image_map[str(document.source_pdf)] = page_paths
      total_pages += len(page_paths)

      answer_summaries = extract_answer_summaries(document)
      anchors = detect_question_anchors(document)
      slices = infer_question_slices(document, anchors)
      for item in slices:
          item.answer_summary = answer_summaries.get(item.question_id)
          item.figures = detect_figures(document, item)
      slices = crop_question_images(slices, auto_cuts_dir, dpi=args.dpi)
      results = build_results(slices, page_image_map, asset_root)
    except Exception as exc:
      failed_pdfs.append({"pdf_name": pdf_path.name, "reason": str(exc), "traceback": traceback.format_exc()})

    payload = {
        "results": results,
        "summary": {
            "processed_pdf_count": 1,
            "rendered_page_count": total_pages,
            "cut_question_count": len(results),
            "failed_pdfs": failed_pdfs,
            "output_paths": {
                "pages": str(pages_dir),
                "auto_cuts": str(auto_cuts_dir),
                "cut_results": str(results_path),
            },
            "diagnostics": diagnostics,
        },
    }
    results_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False))
    if failed_pdfs:
        sys.exit(1)


def build_results(slices: list, page_image_map: dict[str, list[Path]], asset_root: Path) -> list[dict]:
    results: list[dict] = []
    for index, item in enumerate(slices):
        cut_id = f"CUT_{index + 1:04d}"
        page_paths = page_image_map.get(str(item.source_pdf), [])
        page = item.page_number
        segments = [
            {
                "page_number": seg.page_number,
                "page_image_path": rel_asset(_page_image_path(page_paths, seg.page_number), asset_root),
                "bbox": bbox_to_dict(seg.bbox),
            }
            for seg in item.segments
        ]
        results.append({
            "id": cut_id,
            "source_pdf": Path(item.source_pdf).name,
            "page": page,
            "page_span": list(item.page_span) if item.page_span else [page, page],
            "segments": segments,
            "figures": item.figures if hasattr(item, "figures") else [],
            "question_no": item.question_id if item.question_id else None,
            "auto_image_path": rel_asset(Path(item.image_path), asset_root) if item.image_path else "",
            "page_image_path": rel_asset(_page_image_path(page_paths, page), asset_root),
            "bbox": bbox_to_dict(item.bbox) if item.bbox else None,
            "status": "pending_review",
            "review_flags": list(item.flags),
            "note": item.text_excerpt or "",
            "text_regions": item.text_regions if hasattr(item, "text_regions") else [],
        })
    return results


def _page_image_path(page_paths: list[Path], page_number: int) -> Path | None:
    if 1 <= page_number <= len(page_paths):
        return page_paths[page_number - 1]
    return None


def rel_asset(path: Path | None, asset_root: Path) -> str:
    if path is None:
        return ""
    return str(path.resolve().relative_to(asset_root)).replace("\\", "/")


def bbox_to_dict(bbox: tuple) -> dict:
    x0, y0, x1, y1 = bbox
    return {"x": round(x0, 2), "y": round(y0, 2), "width": round(x1 - x0, 2), "height": round(y1 - y0, 2)}


if __name__ == "__main__":
    main()
