from __future__ import annotations

import json
from pathlib import Path

from ..common.paths import AUTO_CUTS_DIR, OUTPUT_DIR, PAGES_DIR, RESULTS_PATH
from ..common.schema import CutResult
from .crop_questions import CUT_ID_PREFIX, QuestionSlice


def build_cut_results(
    slices: list[QuestionSlice],
    page_image_map: dict[str, list[Path]],
) -> list[CutResult]:
    """Build cut_results.json records from question slices."""
    results: list[CutResult] = []

    for index, item in enumerate(slices):
        cut_id = f"{CUT_ID_PREFIX}_{index + 1:04d}"

        pdf_name = Path(item.source_pdf).name
        page = item.page_number
        page_span = list(item.page_span) if item.page_span else [page, page]

        # Compute primary page image path
        page_paths = page_image_map.get(str(item.source_pdf), [])
        page_image_path = _page_image_path(page_paths, page)

        if item.image_path:
            auto_image_path = str(Path(item.image_path).relative_to(OUTPUT_DIR.parent))
        else:
            auto_image_path = ""

        bbox = _bbox_to_dict(item.bbox) if item.bbox else None
        flags = list(item.flags)

        # Build per-page segments array
        segments = []
        for seg in item.segments:
            segments.append({
                "page_number": seg.page_number,
                "page_image_path": _page_image_path(page_paths, seg.page_number),
                "bbox": _bbox_to_dict(seg.bbox),
            })

        result = CutResult(
            id=cut_id,
            source_pdf=pdf_name,
            page=page,
            question_no=item.question_id if item.question_id else None,
            auto_image_path=auto_image_path,
            page_image_path=page_image_path,
            bbox=bbox,
            page_span=page_span,
            segments=segments,
            status="pending_review",
            review_flags=flags,
            note=item.text_excerpt or "",
            figures=item.figures if hasattr(item, "figures") else [],
            text_regions=item.text_regions if hasattr(item, "text_regions") else [],
        )
        results.append(result)

    return results


def write_cut_results(results: list[CutResult], output_path: Path | None = None) -> Path:
    """Write cut results to JSON file."""
    if output_path is None:
        output_path = RESULTS_PATH

    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "results": [_cut_result_to_dict(r) for r in results],
    }

    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return output_path


def build_run_summary(
    pdf_count: int,
    page_count: int,
    cut_count: int,
    failed_pdfs: list[dict],
    output_paths: dict[str, Path],
) -> dict:
    return {
        "processed_pdf_count": pdf_count,
        "rendered_page_count": page_count,
        "cut_question_count": cut_count,
        "failed_pdfs": failed_pdfs,
        "output_paths": {k: str(v) for k, v in output_paths.items()},
    }


def _cut_result_to_dict(result: CutResult) -> dict:
    return {
        "id": result.id,
        "source_pdf": result.source_pdf,
        "page": result.page,
        "page_span": result.page_span,
        "segments": result.segments,
        "figures": result.figures,
        "question_no": result.question_no,
        "auto_image_path": result.auto_image_path,
        "page_image_path": result.page_image_path,
        "bbox": result.bbox,
        "status": result.status,
        "review_flags": result.review_flags,
        "note": result.note,
        "text_regions": result.text_regions,
    }


def _page_image_path(page_paths: list[Path], page_number: int) -> str:
    if 1 <= page_number <= len(page_paths):
        return str(page_paths[page_number - 1].relative_to(OUTPUT_DIR.parent))
    return ""


def _bbox_to_dict(bbox: tuple) -> dict:
    x0, y0, x1, y1 = bbox
    return {
        "x": round(x0, 2),
        "y": round(y0, 2),
        "width": round(x1 - x0, 2),
        "height": round(y1 - y0, 2),
    }
