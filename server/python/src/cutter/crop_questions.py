from __future__ import annotations

import re
from pathlib import Path

import fitz

from ..common.paths import AUTO_CUTS_DIR
from ..common.schema import (
    BBox,
    Confidence,
    DocumentData,
    GraphicCluster,
    PageData,
    QuestionAnchor,
    QuestionSlice,
    SliceSegment,
)

TOP_PADDING = 10.0
BOTTOM_PADDING = 8.0
GRAPHIC_PADDING = 10.0
MIN_SEGMENT_HEIGHT = 32.0
REGION_VERTICAL_PADDING = 4.0
CONTINUATION_TOP_PADDING = 24.0
CONTINUATION_GRAPHIC_TOP_GAP = 18.0

ANSWER_MARKERS = ("【答案】", "答案：", "答案:", "参考答案", "故选：", "故选:")
ANALYSIS_MARKERS = ("【解析】", "解析：", "解析:", "【详解】", "详解：", "详解:", "【分析】", "分析：", "分析:")

CUT_ID_PREFIX = "CUT"


def render_page_images(document: DocumentData, output_dir: Path, dpi: int = 180) -> list[Path]:
    """Render each page of the PDF as a full-page image."""
    output_dir.mkdir(parents=True, exist_ok=True)
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    page_paths: list[Path] = []

    pdf_name = Path(document.source_pdf).stem
    safe_name = _safe_name(pdf_name)

    with fitz.open(document.source_pdf) as doc:
        for page_index in range(document.page_count):
            page = doc[page_index]
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            page_num_str = f"{page_index + 1:03d}"
            image_name = f"{safe_name}_page_{page_num_str}.png"
            image_path = output_dir / image_name
            pixmap.save(image_path)
            page_paths.append(image_path)

    return page_paths


def infer_question_slices(document: DocumentData, anchors: list[QuestionAnchor]) -> list[QuestionSlice]:
    slices: list[QuestionSlice] = []

    for index, anchor in enumerate(anchors):
        next_anchor = anchors[index + 1] if index + 1 < len(anchors) else None
        segments: list[SliceSegment] = []
        notes = list(document.notes)
        notes.extend(anchor.score_hints)
        has_possible_figure = False
        dense_pages = 0
        multi_page = False
        ambiguous_boundary = False

        last_page_number = next_anchor.page_number if next_anchor else document.page_count
        for page_number in range(anchor.page_number, last_page_number + 1):
            page = document.pages[page_number - 1]
            max_segment_bottom = page.body_bbox[3]
            if page_number > anchor.page_number:
                stop_marker_y = _find_top_stop_marker(page)
                if stop_marker_y is not None:
                    candidate_bottom = min(page.body_bbox[3], stop_marker_y - BOTTOM_PADDING)
                    if candidate_bottom - page.body_bbox[1] <= MIN_SEGMENT_HEIGHT + 8.0:
                        break
                    max_segment_bottom = candidate_bottom
            segment_top = page.body_bbox[1]
            segment_bottom = page.body_bbox[3]

            if page_number == anchor.page_number:
                segment_top = max(page.body_bbox[1], anchor.bbox[1] - TOP_PADDING)
                if next_anchor is not None and page_number == next_anchor.page_number:
                    inner_stop_marker_y = _find_inner_stop_marker(page, segment_top, next_anchor.bbox[1])
                    if inner_stop_marker_y is not None:
                        max_segment_bottom = min(max_segment_bottom, inner_stop_marker_y - BOTTOM_PADDING)
            else:
                segment_top = max(0.0, page.body_bbox[1] - CONTINUATION_TOP_PADDING)

            if next_anchor is not None and page_number == next_anchor.page_number:
                max_segment_bottom = min(max_segment_bottom, next_anchor.bbox[1] - BOTTOM_PADDING)
                segment_bottom = max_segment_bottom

            if next_anchor is None or page_number < last_page_number:
                segment_bottom = max_segment_bottom

            if segment_bottom <= segment_top + MIN_SEGMENT_HEIGHT:
                if page_number > anchor.page_number:
                    break
                segment_bottom = min(page.body_bbox[3], segment_top + MIN_SEGMENT_HEIGHT)
                ambiguous_boundary = True

            graphic_min_top = segment_top
            if page_number > anchor.page_number:
                graphic_min_top = _continuation_graphic_min_top(page, segment_top)

            rect = (0.0, segment_top, page.width, segment_bottom)
            rect, segment_has_figure = _expand_with_graphics(
                rect=rect,
                page=page,
                min_top=graphic_min_top,
                max_bottom=max_segment_bottom,
                lock_top=page_number == anchor.page_number,
            )
            has_possible_figure = has_possible_figure or segment_has_figure

            segments.append(SliceSegment(page_number=page_number, bbox=rect))
            if page.block_density >= 45:
                dense_pages += 1

        if len(segments) > 1:
            multi_page = True

        confidence = _score_slice(
            document=document,
            anchor=anchor,
            next_anchor=next_anchor,
            dense_pages=dense_pages,
            multi_page=multi_page,
            ambiguous_boundary=ambiguous_boundary,
            has_possible_figure=has_possible_figure,
        )
        notes.extend(confidence.reasons)

        slices.append(
            QuestionSlice(
                source_pdf=document.source_pdf,
                page_number=anchor.page_number,
                question_id=anchor.question_id,
                question_label=anchor.display_label,
                bbox=segments[0].bbox,
                page_span=[segments[0].page_number, segments[-1].page_number],
                segments=segments,
                confidence=confidence,
                has_possible_figure=has_possible_figure,
                notes=_unique(notes),
                image_path="",
                document_type=document.document_type,
                section_title=anchor.section_title,
                text_excerpt=_collect_text_excerpt(document, segments),
                flags=list(confidence.flags),
                text_regions=_infer_text_regions(document, segments),
            )
        )

    return slices


def crop_question_images(
    slices: list[QuestionSlice],
    output_dir: Path,
    dpi: int = 180,
) -> list[QuestionSlice]:
    """Crop question regions from PDF pages and save as PNG images."""
    output_dir.mkdir(parents=True, exist_ok=True)
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    # Group slices by source PDF
    grouped: dict[str, list[QuestionSlice]] = {}
    for s in slices:
        grouped.setdefault(s.source_pdf, []).append(s)

    for source_pdf, pdf_slices in grouped.items():
        pdf_name = Path(source_pdf).stem
        safe_name = _safe_name(pdf_name)

        with fitz.open(source_pdf) as doc:
            for index, item in enumerate(pdf_slices):
                pixmaps = []
                for segment in item.segments:
                    page = doc[segment.page_number - 1]
                    clip = _expand_clip(fitz.Rect(*segment.bbox), page.rect)
                    pixmap = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
                    pixmaps.append(pixmap)

                # Generate stable image filename
                image_name = f"{CUT_ID_PREFIX}_{index + 1:04d}__{safe_name}_p{item.page_number:03d}.png"
                image_path = output_dir / image_name

                if len(pixmaps) == 1:
                    pixmaps[0].save(image_path)
                else:
                    stitched = _stitch_pixmaps(pixmaps)
                    stitched.save(image_path)

                item.image_path = str(image_path)

    return slices


def _expand_with_graphics(
    rect: BBox,
    page: PageData,
    min_top: float,
    max_bottom: float,
    lock_top: bool = False,
) -> tuple[BBox, bool]:
    x0, y0, x1, y1 = rect
    original_top = y0
    attached = False

    for cluster in page.graphic_clusters:
        cluster_bbox = cluster.bbox
        if _looks_like_page_decoration(cluster_bbox, page.width, page.height):
            continue
        if _looks_like_inline_math_artifact(cluster, page):
            continue
        if cluster_bbox[3] <= y0 + 2.0:
            continue
        if cluster_bbox[1] > y1 + 28.0:
            continue
        if cluster_bbox[1] > max_bottom + 4.0:
            continue
        x0 = min(x0, cluster_bbox[0] - GRAPHIC_PADDING)
        x1 = max(x1, cluster_bbox[2] + GRAPHIC_PADDING)
        y0 = min(y0, cluster_bbox[1] - GRAPHIC_PADDING)
        y1 = max(y1, cluster_bbox[3] + GRAPHIC_PADDING)
        attached = True

    x0 = max(0.0, x0)
    y0 = max(min_top, y0)
    if lock_top:
        y0 = max(original_top, y0)
    x1 = min(page.width, x1)
    y1 = min(max_bottom, min(page.height, y1))
    return (x0, y0, x1, y1), attached


def _continuation_graphic_min_top(page: PageData, segment_top: float) -> float:
    """Allow a continuation page to keep a figure that starts above first text.

    On answer PDFs a page can begin with an analysis figure, followed by the
    first extractable text line. The body bbox is inferred from text, so the
    default continuation top can cut off the figure before graphic expansion
    gets a chance to attach it.
    """
    min_top = segment_top
    for cluster in page.graphic_clusters:
        cluster_bbox = cluster.bbox
        if _looks_like_page_decoration(cluster_bbox, page.width, page.height):
            continue
        if _looks_like_inline_math_artifact(cluster, page):
            continue
        if cluster_bbox[1] >= segment_top:
            continue
        if cluster_bbox[3] < segment_top - CONTINUATION_GRAPHIC_TOP_GAP:
            continue
        min_top = min(min_top, cluster_bbox[1] - GRAPHIC_PADDING)
    return max(0.0, min_top)


def _score_slice(
    document: DocumentData,
    anchor: QuestionAnchor,
    next_anchor: QuestionAnchor | None,
    dense_pages: int,
    multi_page: bool,
    ambiguous_boundary: bool,
    has_possible_figure: bool,
) -> Confidence:
    reasons: list[str] = []
    flags: list[str] = []
    weak_heading_match = False

    if anchor.in_valid_section:
        heading_match = 0.92
    else:
        heading_match = 0.46
        weak_heading_match = True
        flags.append("weak_heading_match")
        reasons.append("题号不在明确题目章节内。")

    if next_anchor is not None:
        boundary_stability = 0.90
    else:
        boundary_stability = 0.76
        flags.append("missing_next_anchor")
        reasons.append("最后一题缺少下一个题号作为边界。")

    if anchor.score_hints:
        heading_match = max(0.40, heading_match - 0.12)
        weak_heading_match = True
        if "weak_heading_match" not in flags:
            flags.append("weak_heading_match")

    if document.document_type == "answer_like":
        flags.append("answer_like_document")

    if multi_page:
        boundary_stability = max(0.54, boundary_stability - 0.10)
        flags.append("multi_page")
        reasons.append("题目跨页，边界按下一题与续页标记综合截断。")

    if dense_pages >= 2:
        boundary_stability = max(0.42, boundary_stability - min(0.10, dense_pages * 0.03))
        flags.append("dense_layout")
        reasons.append("页面文字块较密，可能影响边界稳定性。")

    if ambiguous_boundary:
        boundary_stability = max(0.28, boundary_stability - 0.24)
        flags.append("ambiguous_boundary")
        reasons.append("相邻题目距离较近，边界存在模糊区。")

    if has_possible_figure:
        image_linking = 0.82
        flags.append("has_possible_figure")
        reasons.append("已尝试吸附邻近图像/图表区域。")
    else:
        image_linking = 0.90

    if weak_heading_match:
        heading_match = max(0.32, heading_match)

    if anchor.in_valid_section and next_anchor is not None and not ambiguous_boundary:
        boundary_stability = max(boundary_stability, 0.78 if multi_page else 0.88)

    score = 0.4 * heading_match + 0.4 * boundary_stability + 0.2 * image_linking
    score = max(0.20, min(0.98, score))
    if score >= 0.74:
        level = "high"
    elif score >= 0.55:
        level = "medium"
    else:
        level = "low"

    return Confidence(
        score=round(score, 3),
        level=level,
        reasons=_unique(reasons),
        heading_match=round(heading_match, 3),
        boundary_stability=round(boundary_stability, 3),
        image_linking=round(image_linking, 3),
        flags=_unique(flags),
    )


def _find_top_stop_marker(page: PageData, top_limit: float = 220.0) -> float | None:
    stop_patterns = ("题型", "【解题规律", "【典例训练】", "目录", "题型归纳", "题型探析")
    top_cutoff = page.body_bbox[1] + top_limit
    for line in page.text_lines:
        if line.bbox[1] > top_cutoff:
            break
        text = line.text.strip()
        if any(pattern in text for pattern in stop_patterns) or _looks_like_section_heading(text) or _looks_like_answer_table_row(text):
            return line.bbox[1]
    return None


def _find_inner_stop_marker(page: PageData, lower_y: float, upper_y: float) -> float | None:
    for line in page.text_lines:
        y0 = line.bbox[1]
        if y0 <= lower_y + 20.0:
            continue
        if y0 >= upper_y:
            break
        text = line.text.strip()
        if _looks_like_section_heading(text) or _looks_like_answer_table_row(text):
            return y0
    return None


def _looks_like_section_heading(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    return bool(re.match(r"^[一二三四五六七八九十]+[、.．].*(选择题|单选题|多选题|填空题|解答题)$", compact))


def _looks_like_answer_table_row(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    return compact in {"题号", "答案"}


def _looks_like_page_decoration(cluster_bbox: BBox, page_width: float, page_height: float) -> bool:
    width = max(1.0, cluster_bbox[2] - cluster_bbox[0])
    height = max(1.0, cluster_bbox[3] - cluster_bbox[1])
    width_ratio = width / max(1.0, page_width)
    height_ratio = height / max(1.0, page_height)
    area_ratio = (width * height) / max(1.0, page_width * page_height)
    top_logo = (
        cluster_bbox[1] <= page_height * 0.08
        and width_ratio <= 0.34
        and height_ratio <= 0.08
        and area_ratio <= 0.03
    )
    return top_logo or area_ratio > 0.60 or (width_ratio > 0.92 and height_ratio > 0.52)


def _collect_text_excerpt(document: DocumentData, segments: list[SliceSegment], limit: int = 280) -> str:
    snippets: list[str] = []
    for segment in segments:
        page = document.pages[segment.page_number - 1]
        x0, y0, x1, y1 = segment.bbox
        for line in page.text_lines:
            lx0, ly0, lx1, ly1 = line.bbox
            if lx1 < x0 or lx0 > x1 or ly1 < y0 or ly0 > y1:
                continue
            snippets.append(line.text.strip())
            if len(" ".join(snippets)) >= limit:
                break
        if len(" ".join(snippets)) >= limit:
            break

    excerpt = " ".join(snippets)
    excerpt = " ".join(excerpt.split())
    return excerpt[:limit]


def _infer_text_regions(document: DocumentData, segments: list[SliceSegment]) -> list[dict]:
    line_items: list[dict] = []
    for seg_index, segment in enumerate(segments):
        page = document.pages[segment.page_number - 1]
        for line in page.text_lines:
            if not _line_overlaps_segment(line.bbox, segment.bbox):
                continue
            text = line.text.strip()
            if not text:
                continue
            line_items.append(
                {
                    "seg_index": seg_index,
                    "page_number": segment.page_number,
                    "text": text,
                    "bbox": line.bbox,
                }
            )

    if not line_items:
        return []

    answer_idx = _find_marker_index(line_items, ANSWER_MARKERS)
    analysis_idx = _find_marker_index(line_items, ANALYSIS_MARKERS)
    first_boundary_idx = min(
        [idx for idx in (answer_idx, analysis_idx) if idx is not None],
        default=len(line_items),
    )

    regions: list[dict] = []
    problem_lines = line_items[:first_boundary_idx]
    if problem_lines:
        regions.append(
            _build_text_region(
                kind="problem",
                label="题干",
                lines=problem_lines,
                segments=segments,
                start_marker="",
                end_marker=_line_text_at(line_items, first_boundary_idx),
            )
        )

    if answer_idx is not None:
        answer_end_idx = analysis_idx if analysis_idx is not None and analysis_idx > answer_idx else len(line_items)
        answer_lines = line_items[answer_idx:answer_end_idx]
        if answer_lines:
            regions.append(
                _build_text_region(
                    kind="answer",
                    label="答案",
                    lines=answer_lines,
                    segments=segments,
                    start_marker=line_items[answer_idx]["text"],
                    end_marker=_line_text_at(line_items, answer_end_idx),
                )
            )

    if analysis_idx is not None:
        analysis_lines = line_items[analysis_idx:]
        if analysis_lines:
            regions.append(
                _build_text_region(
                    kind="analysis",
                    label="解析",
                    lines=analysis_lines,
                    segments=segments,
                    start_marker=line_items[analysis_idx]["text"],
                    end_marker="",
                )
            )

    return [region for region in regions if region.get("segments")]


def _build_text_region(
    *,
    kind: str,
    label: str,
    lines: list[dict],
    segments: list[SliceSegment],
    start_marker: str,
    end_marker: str,
) -> dict:
    by_segment: dict[int, list[dict]] = {}
    for item in lines:
        by_segment.setdefault(item["seg_index"], []).append(item)

    region_segments: list[dict] = []
    for seg_index, seg_lines in sorted(by_segment.items()):
        segment = segments[seg_index]
        x0, y0, x1, y1 = segment.bbox
        top = max(y0, min(line["bbox"][1] for line in seg_lines) - REGION_VERTICAL_PADDING)
        bottom = min(y1, max(line["bbox"][3] for line in seg_lines) + REGION_VERTICAL_PADDING)
        if bottom <= top + 2.0:
            continue
        region_segments.append(
            {
                "page_number": segment.page_number,
                "bbox": _bbox_to_dict((x0, top, x1, bottom)),
            }
        )

    preview_lines = [item["text"] for item in lines[:8]]
    preview_text = " ".join(preview_lines)
    preview_text = " ".join(preview_text.split())[:220]
    page_span = [region_segments[0]["page_number"], region_segments[-1]["page_number"]] if region_segments else []
    return {
        "kind": kind,
        "label": label,
        "start_marker": start_marker,
        "end_marker": end_marker,
        "page_span": page_span,
        "segments": region_segments,
        "preview_text": preview_text,
    }


def _find_marker_index(line_items: list[dict], markers: tuple[str, ...]) -> int | None:
    for index, item in enumerate(line_items):
        text = re.sub(r"\s+", "", item["text"])
        if any(marker in text for marker in markers):
            return index
    return None


def _line_text_at(line_items: list[dict], index: int) -> str:
    if 0 <= index < len(line_items):
        return line_items[index]["text"]
    return ""


def _line_overlaps_segment(line_bbox: BBox, segment_bbox: BBox) -> bool:
    lx0, ly0, lx1, ly1 = line_bbox
    sx0, sy0, sx1, sy1 = segment_bbox
    return not (lx1 < sx0 or sx1 < lx0 or ly1 < sy0 or sy1 < ly0)


def _stitch_pixmaps(pixmaps: list[fitz.Pixmap]) -> fitz.Pixmap:
    width = max(pixmap.width for pixmap in pixmaps)
    height = sum(pixmap.height for pixmap in pixmaps)
    temp_doc = fitz.open()
    page = temp_doc.new_page(width=width, height=height)

    cursor_y = 0.0
    for pixmap in pixmaps:
        page.insert_image(
            fitz.Rect(0.0, cursor_y, pixmap.width, cursor_y + pixmap.height),
            pixmap=pixmap,
        )
        cursor_y += pixmap.height

    stitched = page.get_pixmap(alpha=False)
    temp_doc.close()
    return stitched


def _expand_clip(clip: fitz.Rect, page_rect: fitz.Rect) -> fitz.Rect:
    expanded = fitz.Rect(
        max(page_rect.x0, clip.x0 - 4.0),
        max(page_rect.y0, clip.y0),
        min(page_rect.x1, clip.x1 + 4.0),
        min(page_rect.y1, clip.y1 + 10.0),
    )
    return expanded


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def detect_figures(
    document: DocumentData,
    slice_item: QuestionSlice,
) -> list[dict]:
    """Detect figures (images / graphics) within a question's bbox.

    Mirrors PdfTextExtractor._extract_figures() from the old project.
    """
    figures: list[dict] = []
    for segment in slice_item.segments:
        page = document.pages[segment.page_number - 1]
        for cluster in page.graphic_clusters:
            if _looks_like_page_decoration(cluster.bbox, page.width, page.height):
                continue
            if _looks_like_inline_math_artifact(cluster, page):
                continue
            if not _bbox_intersects(cluster.bbox, segment.bbox):
                continue
            if _bbox_intersection_area(cluster.bbox, segment.bbox) / max(_bbox_area(cluster.bbox), 1.0) < 0.25:
                continue
            kind = "graphic"
            if "image" in cluster.kinds and "drawing" not in cluster.kinds:
                kind = "image"
            figure = {
                "page_number": segment.page_number,
                "bbox": _bbox_to_dict(cluster.bbox),
                "kind": kind,
            }
            usage = _default_figure_usage(slice_item, figure)
            figure["usage"] = usage
            figure["category"] = usage
            suspect_info = _formula_suspect_info(cluster, page)
            if suspect_info["formula_suspect"]:
                figure.update(suspect_info)
            figures.append(figure)
    return _dedupe_figures(figures)


def _default_figure_usage(slice_item: QuestionSlice, figure: dict) -> str:
    boundary = _answer_or_analysis_boundary(slice_item)
    if boundary is None:
        return "stem"
    figure_key = _figure_reading_key(slice_item, figure)
    if figure_key is None:
        return "stem"
    return "analysis" if figure_key >= boundary else "stem"


def _answer_or_analysis_boundary(slice_item: QuestionSlice) -> tuple[int, float] | None:
    candidates: list[tuple[int, float]] = []
    for region in getattr(slice_item, "text_regions", []) or []:
        if region.get("kind") not in {"answer", "analysis"}:
            continue
        for segment in region.get("segments") or []:
            bbox = segment.get("bbox") or {}
            key = _segment_reading_key(slice_item, segment.get("page_number"), bbox)
            if key is not None:
                candidates.append(key)
                break
    return min(candidates) if candidates else None


def _figure_reading_key(slice_item: QuestionSlice, figure: dict) -> tuple[int, float] | None:
    bbox = figure.get("bbox") or {}
    return _segment_reading_key(slice_item, figure.get("page_number"), bbox, use_center=True)


def _segment_reading_key(
    slice_item: QuestionSlice,
    page_number_raw: object,
    bbox: dict,
    *,
    use_center: bool = False,
) -> tuple[int, float] | None:
    try:
        page_number = int(page_number_raw or 0)
        y = float(bbox.get("y", 0))
        if use_center:
            y += float(bbox.get("height", 0)) / 2.0
    except (TypeError, ValueError, AttributeError):
        return None

    matching_indexes = [
        index
        for index, segment in enumerate(slice_item.segments)
        if segment.page_number == page_number
    ]
    if not matching_indexes:
        return None

    for index in matching_indexes:
        segment_bbox = slice_item.segments[index].bbox
        if segment_bbox[1] - 2.0 <= y <= segment_bbox[3] + 2.0:
            return (index, y)
    return (matching_indexes[0], y)


def summarize_graphic_candidates(document: DocumentData) -> dict:
    """Summarize graphic blocks so the UI can explain image-formula-heavy PDFs."""
    total_clusters = 0
    image_clusters = 0
    hidden_inline_formula_images = 0
    kept_figure_candidates = 0

    for page in document.pages:
        for cluster in page.graphic_clusters:
            if _looks_like_page_decoration(cluster.bbox, page.width, page.height):
                continue
            total_clusters += 1
            if "image" in cluster.kinds and "drawing" not in cluster.kinds:
                image_clusters += 1
            if _looks_like_inline_math_artifact(cluster, page):
                hidden_inline_formula_images += 1
                continue
            kept_figure_candidates += 1

    return {
        "graphic_clusters": total_clusters,
        "image_clusters": image_clusters,
        "hidden_inline_formula_images": hidden_inline_formula_images,
        "kept_figure_candidates": kept_figure_candidates,
        "formula_image_document": hidden_inline_formula_images >= 8
        and hidden_inline_formula_images >= max(kept_figure_candidates, 1),
    }


def _looks_like_inline_math_artifact(cluster: GraphicCluster, page: PageData) -> bool:
    """Filter drawing fragments that belong to rendered math, not question figures."""
    if "image" in cluster.kinds and "drawing" not in cluster.kinds:
        return _looks_like_inline_formula_image(cluster, page)

    bbox = cluster.bbox
    width = _bbox_width(bbox)
    height = _bbox_height(bbox)
    if width <= 0.0 or height <= 0.0:
        return True

    page_width = max(1.0, page.width)
    line_height = _median_text_line_height(page)
    narrow_inline_width = width <= page_width * 0.34
    inline_height = height <= max(34.0, line_height * 3.6)

    if height <= 1.4 and width <= page_width * 0.22:
        return True

    overlap_ratio, overlap_count = _text_overlap_stats(bbox, page)
    if overlap_count >= 1 and width <= line_height * 2.8 and height <= line_height * 2.6:
        return True
    if inline_height and narrow_inline_width and overlap_count >= 3 and overlap_ratio >= 0.16:
        return True
    if inline_height and overlap_count >= 6 and overlap_ratio >= 0.10:
        return True
    if width <= page_width * 0.45 and height <= max(130.0, line_height * 12.0):
        nearby = _nearby_text_line_stats(bbox, page, line_height)
        if nearby["same_row_count"] >= 4 and nearby["near_count"] >= 2 and overlap_ratio >= 0.04:
            return True
    if _looks_like_inline_formula_image(cluster, page):
        return True

    return False


def _looks_like_inline_formula_image(cluster: GraphicCluster, page: PageData) -> bool:
    """Filter rasterized Word/PDF formula images that sit inline with text."""
    bbox = cluster.bbox
    width = _bbox_width(bbox)
    height = _bbox_height(bbox)
    if width <= 0.0 or height <= 0.0:
        return True

    page_width = max(1.0, page.width)
    line_height = _median_text_line_height(page)
    small_inline_height = height <= max(38.0, line_height * 3.3)
    medium_inline_height = height <= max(48.0, line_height * 4.2)
    not_too_wide = width <= page_width * 0.42
    compact_width = width <= page_width * 0.28
    very_small = height <= line_height * 1.35 and width <= page_width * 0.24
    wide_display_formula = (
        height <= max(24.0, line_height * 1.8)
        and width <= page_width * 0.92
        and width >= page_width * 0.18
    )
    formula_dense_page = _small_image_box_count(page, line_height) >= 8

    if not (
        small_inline_height and (not_too_wide or wide_display_formula)
        or formula_dense_page and medium_inline_height and width <= page_width * 0.86
    ):
        return False

    nearby = _nearby_text_line_stats(bbox, page, line_height)
    context_text = nearby["context"]
    has_formula_context = bool(re.search(
        r"(答案|解析|分析|详解|解得|即|所以|故|不等式|函数|方程|集合|选|[ABCD][.．、:：]?)",
        context_text,
    ))

    if very_small and nearby["same_row_count"] >= 1:
        return True
    if wide_display_formula and (formula_dense_page or nearby["near_count"] == 0 or nearby["same_row_count"] >= 1):
        return True
    if formula_dense_page and height <= max(22.0, line_height * 1.7):
        return True
    if nearby["same_row_count"] >= 2 and (compact_width or has_formula_context):
        return True
    if has_formula_context and nearby["near_count"] >= 1 and (compact_width or height <= line_height * 2.8):
        return True
    if formula_dense_page and medium_inline_height and width <= page_width * 0.86 and nearby["near_count"] >= 1:
        return True

    return False


def _formula_suspect_info(cluster: GraphicCluster, page: PageData) -> dict:
    """Mark retained graphics that look formula-like but are too large to hide automatically."""
    bbox = cluster.bbox
    width = _bbox_width(bbox)
    height = _bbox_height(bbox)
    if width <= 0.0 or height <= 0.0:
        return {"formula_suspect": False}

    page_width = max(1.0, page.width)
    line_height = _median_text_line_height(page)
    overlap_ratio, overlap_count = _text_overlap_stats(bbox, page)
    nearby = _nearby_text_line_stats(bbox, page, line_height)
    formula_dense_page = _small_image_box_count(page, line_height) >= 8
    compact_width = width <= page_width * 0.46
    short_block = height <= max(165.0, line_height * 14.0)

    reasons: list[str] = []
    if overlap_count >= 8 and overlap_ratio >= 0.07:
        reasons.append("text_overlap")
    if nearby["same_row_count"] >= 6 and overlap_ratio >= 0.10:
        reasons.append("same_row_text")
    if formula_dense_page and compact_width and short_block and nearby["same_row_count"] >= 3 and overlap_ratio >= 0.035:
        reasons.append("dense_formula_page")
    if formula_dense_page and compact_width and height <= max(90.0, line_height * 8.0) and nearby["near_count"] >= 2:
        reasons.append("near_formula_text")

    if not reasons:
        return {"formula_suspect": False}
    return {
        "formula_suspect": True,
        "formula_suspect_reason": ",".join(reasons),
    }


def _bbox_intersects(a: BBox, b: BBox) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def _text_overlap_stats(bbox: BBox, page: PageData) -> tuple[float, int]:
    area = max(1.0, _bbox_area(bbox))
    overlap_area = 0.0
    overlap_count = 0

    for line in page.text_lines:
        expanded = (
            line.bbox[0] - 1.5,
            line.bbox[1] - 3.0,
            line.bbox[2] + 1.5,
            line.bbox[3] + 3.0,
        )
        intersection = _bbox_intersection_area(bbox, expanded)
        if intersection <= 0.0:
            continue
        overlap_area += intersection
        overlap_count += 1

    return overlap_area / area, overlap_count


def _median_text_line_height(page: PageData) -> float:
    heights = sorted(
        _bbox_height(line.bbox)
        for line in page.text_lines
        if _bbox_height(line.bbox) > 1.0
    )
    if not heights:
        return 12.0
    return heights[len(heights) // 2]


def _nearby_text_line_stats(bbox: BBox, page: PageData, line_height: float) -> dict:
    same_row_count = 0
    near_count = 0
    context_parts: list[str] = []
    x0, y0, x1, y1 = bbox
    center_y = (y0 + y1) / 2.0
    max_x_gap = max(34.0, page.width * 0.08)
    vertical_window = max(8.0, line_height * 1.9)

    for line in page.text_lines:
        lx0, ly0, lx1, ly1 = line.bbox
        line_center_y = (ly0 + ly1) / 2.0
        vertical_overlap = min(y1, ly1) - max(y0, ly0)
        same_row = vertical_overlap >= min(y1 - y0, ly1 - ly0) * 0.18 or abs(line_center_y - center_y) <= line_height * 0.9
        x_gap = max(lx0 - x1, x0 - lx1, 0.0)

        if same_row and x_gap <= max_x_gap:
            same_row_count += 1
        if abs(line_center_y - center_y) <= vertical_window and x_gap <= max(max_x_gap * 2.2, 90.0):
            near_count += 1
            context_parts.append(line.text.strip())

    return {
        "same_row_count": same_row_count,
        "near_count": near_count,
        "context": re.sub(r"\s+", "", "".join(context_parts)),
    }


def _small_image_box_count(page: PageData, line_height: float) -> int:
    max_height = max(48.0, line_height * 4.2)
    max_width = page.width * 0.86
    return sum(
        1
        for box in page.image_boxes
        if _bbox_height(box) <= max_height and _bbox_width(box) <= max_width
    )


def _bbox_intersection_area(a: BBox, b: BBox) -> float:
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return (x1 - x0) * (y1 - y0)


def _bbox_iou(a: BBox, b: BBox) -> float:
    intersection = _bbox_intersection_area(a, b)
    if intersection <= 0.0:
        return 0.0
    union = _bbox_area(a) + _bbox_area(b) - intersection
    if union <= 0.0:
        return 0.0
    return intersection / union


def _bbox_area(bbox: BBox) -> float:
    return _bbox_width(bbox) * _bbox_height(bbox)


def _bbox_width(bbox: BBox) -> float:
    return max(0.0, bbox[2] - bbox[0])


def _bbox_height(bbox: BBox) -> float:
    return max(0.0, bbox[3] - bbox[1])


def _dedupe_figures(figures: list[dict]) -> list[dict]:
    unique: list[dict] = []
    for fig in figures:
        bbox = _dict_to_bbox(fig["bbox"])
        if any(
            fig["page_number"] == item["page_number"]
            and fig["kind"] == item["kind"]
            and _bbox_iou(bbox, _dict_to_bbox(item["bbox"])) >= 0.82
            for item in unique
        ):
            continue
        unique.append(fig)
    return unique


def _bbox_to_dict(bbox: BBox) -> dict:
    return {
        "x": round(bbox[0], 2),
        "y": round(bbox[1], 2),
        "width": round(bbox[2] - bbox[0], 2),
        "height": round(bbox[3] - bbox[1], 2),
    }


def _dict_to_bbox(bbox: dict) -> BBox:
    x = float(bbox["x"])
    y = float(bbox["y"])
    return (x, y, x + float(bbox["width"]), y + float(bbox["height"]))


def _safe_name(text: str) -> str:
    safe = re.sub(r"[^\w.-]+", "_", text, flags=re.UNICODE)
    return safe.strip("_") or "pdf"
