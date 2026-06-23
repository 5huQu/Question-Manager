from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
import shutil
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import fitz

from .doc2x import normalize_math_delimiters, normalize_question_no


DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/layout_parsing"
DEFAULT_MODEL = "glm-ocr"
QUESTION_START_RE = r"(?m)(?:^|\n)\s*(?:第\s*)?{number}\s*[.．、]\s*"
IMAGE_RE = re.compile(r"<img\b[^>]*\bsrc=['\"]([^'\"]+)['\"][^>]*>", re.IGNORECASE)
PAGE_MARKER_RE = re.compile(r"<!-- GLM_PAGE:(\d+) -->")
ANSWER_OR_ANALYSIS_RE = re.compile(r"【(?:答案|分析|解析)】")
EXAM_SECTION_RE = re.compile(r"(?mi)^\s*#{1,6}\s*.*?(?:选择题|填空题|解答题|第[ⅠⅡIVX]+卷)")
EXAM_INSTRUCTION_RE = re.compile(r"(?:本试卷分|回答第[ⅠⅡIVX]卷|答卷前|考试结束后|考生务必)")
NON_CONTENT_IMAGE_NATIVE_LABELS = {
    "header_image", "footer_image", "watermark", "background_image", "page_number",
}


class GlmOcrError(RuntimeError):
    def __init__(self, message: str, *, code: str = "", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class GlmOcrSettings:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL
    max_retries: int = 2
    timeout_seconds: int = 900


def _atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def _atomic_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(value, encoding="utf-8")
    temp.replace(path)


def _split_fields(value: str) -> tuple[str, str, str, bool]:
    answer = re.search(r"【答案】", value)
    analysis = re.search(r"【(?:解析|分析)】", value)
    if answer and analysis and answer.start() < analysis.start():
        return value[:answer.start()].strip(), value[answer.end():analysis.start()].strip(), value[analysis.end():].strip(), True
    if answer:
        return value[:answer.start()].strip(), value[answer.end():].strip(), "", True
    if analysis:
        return value[:analysis.start()].strip(), "", value[analysis.end():].strip(), True
    return value.strip(), "", "", False


def _image_block_key(page_index: int, block_index: int) -> tuple[int, int]:
    return page_index, block_index


def _image_bbox_fraction(block: dict[str, Any], page: dict[str, Any]) -> tuple[float, float, float, float] | None:
    raw = block.get("bbox_2d") or block.get("bbox")
    if not isinstance(raw, (list, tuple)) or len(raw) < 4:
        return None
    try:
        x0, y0, x1, y1 = (float(raw[index]) for index in range(4))
        width = float(page.get("width") or block.get("width") or 0)
        height = float(page.get("height") or block.get("height") or 0)
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0 or x1 <= x0 or y1 <= y0:
        return None
    return x0 / width, y0 / height, x1 / width, y1 / height


def _ignored_glm_image_blocks(payload: dict[str, Any]) -> tuple[set[tuple[int, int]], dict[str, int]]:
    """Return non-content image blocks that must not become OCR image references.

    GLM exposes page headers/watermarks as ``label=image``.  Its native label is
    the primary signal.  A conservative repeated-header fallback covers API
    responses without that label, while leaving one-off diagrams untouched.
    """
    ignored: set[tuple[int, int]] = set()
    reasons: dict[str, int] = {}
    pages = payload.get("layout_details") or []
    infos = ((payload.get("data_info") or {}).get("pages") or [])
    repeated: dict[tuple[int, int, int, int], list[tuple[int, int]]] = {}
    for page_index, page in enumerate(pages):
        if not isinstance(page, list):
            continue
        page_info = infos[page_index] if page_index < len(infos) and isinstance(infos[page_index], dict) else {}
        for block_index, block in enumerate(page):
            if not isinstance(block, dict) or str(block.get("label") or "").lower() != "image":
                continue
            key = _image_block_key(page_index, block_index)
            native_label = str(block.get("native_label") or "").strip().lower()
            if native_label in NON_CONTENT_IMAGE_NATIVE_LABELS:
                ignored.add(key)
                reasons["native_label"] = reasons.get("native_label", 0) + 1
                continue
            fraction = _image_bbox_fraction(block, page_info)
            if not fraction:
                continue
            x0, y0, x1, y1 = fraction
            # Only consider small, top/bottom decorative marks.  A real chart
            # can repeat in a document, but is rarely a thin header/footer on
            # four or more pages at the same location.
            if (y1 - y0) <= 0.10 and (y0 <= 0.16 or y1 >= 0.84):
                signature = tuple(round(value * 40) for value in fraction)
                repeated.setdefault(signature, []).append(key)
    for keys in repeated.values():
        if len({page_index for page_index, _ in keys}) < 4:
            continue
        for key in keys:
            if key not in ignored:
                ignored.add(key)
                reasons["repeated_header_footer"] = reasons.get("repeated_header_footer", 0) + 1
    return ignored, reasons


def _block_text(block: dict[str, Any], *, ignored_image: bool = False) -> str:
    label = str(block.get("label") or "")
    content = str(block.get("content") or "").strip()
    if not content:
        return ""
    if label == "image":
        # Non-content images (headers, footers and watermarks) must disappear
        # entirely.  Falling through here used to leak the provider URL into
        # the parsed answer/analysis text.
        if ignored_image:
            return ""
        return f"\n\n<img src=\"{content}\">\n\n"
    return content


def _page_texts(payload: dict[str, Any]) -> list[str]:
    pages: list[str] = []
    ignored, _ = _ignored_glm_image_blocks(payload)
    for page_index, page in enumerate(payload.get("layout_details") or []):
        parts = [_block_text(block, ignored_image=_image_block_key(page_index, block_index) in ignored) for block_index, block in enumerate(page) if isinstance(block, dict)]
        pages.append("\n\n".join(part for part in parts if part).strip())
    return pages


def _joined_pages(pages: list[str]) -> str:
    return "\n\n".join(f"<!-- GLM_PAGE:{index + 1} -->\n{content}" for index, content in enumerate(pages))


def _page_ids_for_range(source: str, start: int, end: int) -> list[int]:
    """Return the page containing ``start`` plus later pages crossed by a chunk."""
    before = list(PAGE_MARKER_RE.finditer(source, 0, start))
    within = list(PAGE_MARKER_RE.finditer(source, start, end))
    values = ([int(before[-1].group(1))] if before else []) + [int(match.group(1)) for match in within]
    return list(dict.fromkeys(values))


def _exam_question_candidates(source: str, expected: set[str]) -> list[dict[str, Any]]:
    """Find only expected numeric headings, retaining duplicate candidates for scoring.

    Cover instructions frequently begin with ``1.``, ``2.``, etc.  We cannot
    consume the first matching number: an actual exam question is normally
    corroborated by an answer/analysis marker before the next question heading.
    """
    pattern = re.compile(r"(?m)^\s*(?:#{1,6}\s*)?(?:第\s*)?(\d{1,3})\s*[.．、]\s+")
    candidates = []
    for match in pattern.finditer(source):
        number = normalize_question_no(match.group(1))
        if number in expected:
            candidates.append({"number": number, "start": match.start(), "content_start": match.end()})
    for index, candidate in enumerate(candidates):
        candidate["end"] = candidates[index + 1]["start"] if index + 1 < len(candidates) else len(source)
        candidate["raw"] = source[candidate["content_start"] : candidate["end"]].strip()
    return candidates


def _split_numbered_markdown_legacy(pages: list[str], expected_numbers: list[str]) -> dict[str, dict[str, Any]]:
    """Compatibility path for non-exam materials such as lectures."""
    source = _joined_pages(pages)
    starts: list[tuple[str, int, int]] = []
    cursor = 0
    for number in expected_numbers:
        normalized = normalize_question_no(number)
        if not normalized:
            continue
        match = re.search(QUESTION_START_RE.format(number=re.escape(normalized)), source[cursor:])
        if not match:
            continue
        start = cursor + match.start()
        starts.append((normalized, start, cursor + match.end()))
        cursor += match.end()
    output: dict[str, dict[str, Any]] = {}
    for index, (number, start, content_start) in enumerate(starts):
        end = starts[index + 1][1] if index + 1 < len(starts) else len(source)
        raw = source[content_start:end].strip()
        stem, answer, analysis, has_markers = _split_fields(raw)
        output[number] = {
            "question_no": number,
            "raw": raw,
            "stem": normalize_math_delimiters(PAGE_MARKER_RE.sub("", stem)),
            "answer": normalize_math_delimiters(PAGE_MARKER_RE.sub("", answer)),
            "analysis": normalize_math_delimiters(PAGE_MARKER_RE.sub("", analysis)),
            "has_markers": has_markers,
            "page_indices": _page_ids_for_range(source, start, end),
            "parse_confidence": "legacy",
            "parse_warnings": ["非试卷材料沿用旧版题号切分。"],
        }
    return output


def split_exam_markdown(pages: list[str], expected_numbers: list[str]) -> dict[str, dict[str, Any]]:
    """Split a solution-paper OCR response with question, answer and analysis signals.

    This is deliberately an exam-specific parser.  It chooses a numeric heading
    only when it is corroborated by answer/analysis structure (or, for a
    questions-only paper, by an exam-section heading).  That avoids treating the
    numbered cover instructions as questions 1--4.
    """
    source = _joined_pages(pages)
    expected = [normalize_question_no(number) for number in expected_numbers]
    expected = [number for number in expected if number]
    candidates = _exam_question_candidates(source, set(expected))
    section_starts = [match.start() for match in EXAM_SECTION_RE.finditer(source)]

    selected: dict[str, dict[str, Any]] = {}
    seen_supported_question = False
    for candidate in candidates:
        raw = str(candidate["raw"])
        has_markers = bool(ANSWER_OR_ANALYSIS_RE.search(raw))
        after_exam_section = any(start < int(candidate["start"]) for start in section_starts)
        is_instruction = bool(EXAM_INSTRUCTION_RE.search(raw))
        # Marker-supported candidates are authoritative.  Questions-only
        # papers may lack markers, but cover instructions are never accepted.
        # A trailing question may omit its answer/analysis in a partial OCR
        # response.  Once a genuine marker-supported question has appeared,
        # keep such a later expected heading instead of dropping it.
        score = (10 if has_markers else 0) + (2 if after_exam_section else 0) + (1 if seen_supported_question else 0) - (20 if is_instruction else 0)
        if score <= 0:
            continue
        number = str(candidate["number"])
        existing = selected.get(number)
        if existing is None or score > existing["score"]:
            selected[number] = {**candidate, "score": score}
        if has_markers and not is_instruction:
            seen_supported_question = True

    output: dict[str, dict[str, Any]] = {}
    for number in expected:
        candidate = selected.get(number)
        if not candidate:
            continue
        start, end = int(candidate["start"]), int(candidate["end"])
        raw = str(candidate["raw"])
        stem, answer, analysis, has_markers = _split_fields(raw)
        strip_markers = lambda value: PAGE_MARKER_RE.sub("", value)
        output[number] = {
            "question_no": number,
            "raw": raw,
            "stem": normalize_math_delimiters(strip_markers(stem)),
            "answer": normalize_math_delimiters(strip_markers(answer)),
            "analysis": normalize_math_delimiters(strip_markers(analysis)),
            "has_markers": has_markers,
            "page_indices": _page_ids_for_range(source, start, end),
            "parse_confidence": "high" if has_markers else "medium",
            "parse_warnings": [] if has_markers else ["答案/解析标记缺失，按试卷章节和题号切分。"],
        }
    return output


def _bbox_fraction(block: dict[str, Any], page_info: dict[str, Any]) -> tuple[float, float, float, float] | None:
    bbox = block.get("bbox_2d")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    try:
        x1, y1, x2, y2 = [float(value) for value in bbox]
        width = float(page_info.get("width") or 0)
        height = float(page_info.get("height") or 0)
    except (TypeError, ValueError):
        return None
    if max(abs(x1), abs(y1), abs(x2), abs(y2)) <= 1:
        return x1, y1, x2, y2
    if width <= 0 or height <= 0:
        return None
    return x1 / width, y1 / height, x2 / width, y2 / height


def _region_fraction(segment: dict[str, Any], record: dict[str, Any] | None = None) -> tuple[float, float, float, float] | None:
    bbox = segment.get("bbox") or {}
    page_number = int(segment.get("page_number") or segment.get("pageNumber") or 1)
    page_sizes = (record or {}).get("_pdf_page_sizes") or {}
    page_size = page_sizes.get(str(page_number)) or page_sizes.get(page_number) or (595.3, 841.9)
    try:
        page_width, page_height = float(page_size[0]), float(page_size[1])
        x = float(bbox.get("x", bbox.get("x0", 0))) / page_width
        y = float(bbox.get("y", bbox.get("y0", 0))) / page_height
        width = float(bbox.get("width", bbox.get("w", 0))) / page_width
        height = float(bbox.get("height", bbox.get("h", 0))) / page_height
    except (TypeError, ValueError):
        return None
    if page_width <= 0 or page_height <= 0 or width <= 0 or height <= 0:
        return None
    return x, y, x + width, y + height


def _with_pdf_page_sizes(manifest: list[dict[str, Any]], storage_root: Path) -> list[dict[str, Any]]:
    """Attach source-PDF point sizes so cut boxes share GLM's normalized space."""
    page_sizes_by_pdf: dict[str, dict[str, tuple[float, float]]] = {}
    enriched: list[dict[str, Any]] = []
    for record in manifest:
        copied = dict(record)
        source_pdf = str(copied.get("source_pdf") or "")
        if not source_pdf:
            enriched.append(copied)
            continue
        if source_pdf not in page_sizes_by_pdf:
            pdf_path = Path(source_pdf)
            if not pdf_path.is_absolute():
                pdf_path = storage_root / pdf_path
            sizes: dict[str, tuple[float, float]] = {}
            try:
                with fitz.open(pdf_path) as document:
                    sizes = {str(index + 1): (float(page.rect.width), float(page.rect.height)) for index, page in enumerate(document)}
            except (OSError, RuntimeError, fitz.FileDataError):
                pass
            page_sizes_by_pdf[source_pdf] = sizes
        if page_sizes_by_pdf[source_pdf]:
            copied["_pdf_page_sizes"] = page_sizes_by_pdf[source_pdf]
        enriched.append(copied)
    return enriched


def _overlap(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> float:
    x1, y1 = max(left[0], right[0]), max(left[1], right[1])
    x2, y2 = min(left[2], right[2]), min(left[3], right[3])
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def _block_belongs_to_region(region: tuple[float, float, float, float], block: tuple[float, float, float, float]) -> bool:
    """Assign a layout block to one reviewed cut without boundary spillover.

    Adjacent cutter regions can overlap by a few PDF points.  Treating any
    non-zero intersection as membership duplicates a full block into the next
    question.  A block belongs to a region when its center is inside it, or
    when most of the block is covered by it.
    """
    overlap = _overlap(region, block)
    block_area = _bbox_area(block)
    if block_area > 0 and overlap / block_area >= 0.5:
        return True
    center_x = (block[0] + block[2]) / 2
    center_y = (block[1] + block[3]) / 2
    return region[0] <= center_x <= region[2] and region[1] <= center_y <= region[3]


def _fields_from_regions(record: dict[str, Any], payload: dict[str, Any]) -> dict[str, str]:
    regions = record.get("text_regions") or []
    details = payload.get("layout_details") or []
    infos = ((payload.get("data_info") or {}).get("pages") or [])
    values: dict[str, list[str]] = {"problem": [], "answer": [], "analysis": []}
    for region in regions:
        kind = str(region.get("kind") or "")
        if kind not in values:
            continue
        for segment in region.get("segments") or []:
            page_number = int(segment.get("page_number") or segment.get("pageNumber") or 0)
            page_index = page_number - 1
            if page_index < 0 or page_index >= len(details):
                continue
            target = _region_fraction(segment, record)
            if not target:
                continue
            page_info = infos[page_index] if page_index < len(infos) and isinstance(infos[page_index], dict) else {}
            for block in details[page_index]:
                if str(block.get("label") or "") == "image":
                    continue
                block_box = _bbox_fraction(block, page_info)
                text = _block_text(block)
                if block_box and text and _block_belongs_to_region(target, block_box):
                    values[kind].append(text)
    return {key: normalize_math_delimiters("\n\n".join(dict.fromkeys(value))) for key, value in values.items()}


def _page_indices_from_record(record: dict[str, Any]) -> list[int]:
    values: list[int] = []
    for region in record.get("text_regions") or []:
        for segment in region.get("segments") or []:
            try:
                page_number = int(segment.get("page_number") or segment.get("pageNumber") or 0)
            except (TypeError, ValueError):
                page_number = 0
            if page_number > 0:
                values.append(page_number)
    if not values:
        span = record.get("page_span") or []
        if isinstance(span, list) and span:
            try:
                start = int(span[0])
                end = int(span[-1])
                values.extend(range(start, end + 1))
            except (TypeError, ValueError):
                pass
    if not values:
        try:
            page = int(record.get("page") or 0)
        except (TypeError, ValueError):
            page = 0
        if page > 0:
            values.append(page)
    return list(dict.fromkeys(values))


def _download_asset(url: str, target: Path) -> str:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "Question-Manager/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output)
    return str(target)


def _page_span(record: dict[str, Any]) -> set[int]:
    span = record.get("page_span") or [record.get("page") or 1]
    try:
        start = int(record.get("page") or span[0])
        end = int(span[-1])
    except (TypeError, ValueError, IndexError):
        return set()
    return set(range(min(start, end), max(start, end) + 1))


def _record_segments(record: dict[str, Any]) -> list[dict[str, Any]]:
    segments = record.get("segments") or record.get("reviewed_segments") or []
    return [segment for segment in segments if isinstance(segment, dict)]


def _bbox_area(bbox: tuple[float, float, float, float]) -> float:
    return max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])


def _review_figure_fraction(figure: dict[str, Any], record: dict[str, Any]) -> tuple[float, float, float, float] | None:
    return _region_fraction({
        "page_number": figure.get("page_number") or figure.get("pageNumber"),
        "bbox": figure.get("bbox") or {},
    }, record)


def _glm_figure_id(page_number: int, url: str) -> str:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    return f"glm_{page_number}_{digest}"


def _review_matches_for_glm_figure(record: dict[str, Any], page_number: int, glm_box: tuple[float, float, float, float] | None) -> list[dict[str, Any]]:
    if not glm_box:
        return []
    matches: list[dict[str, Any]] = []
    for index, figure in enumerate(record.get("figures") or []):
        if not isinstance(figure, dict):
            continue
        figure_page = int(figure.get("page_number") or figure.get("pageNumber") or 0)
        review_box = _review_figure_fraction(figure, record)
        if figure_page != page_number or not review_box:
            continue
        overlap = _overlap(glm_box, review_box)
        smaller_area = min(_bbox_area(glm_box), _bbox_area(review_box))
        score = overlap / smaller_area if smaller_area > 0 else 0.0
        if score >= 0.35:
            matches.append({
                "review_figure_id": str(figure.get("id") or f"review_fig_{index + 1}"),
                "match_score": round(score, 4),
            })
    return sorted(matches, key=lambda item: float(item["match_score"]), reverse=True)


def _glm_figure_diagnostics(record: dict[str, Any], manifest: list[dict[str, Any]], payload: dict[str, Any]) -> dict[str, Any]:
    """Describe the current page-span binding without changing it.

    GLM supplies page-level image blocks while the reviewed cuts carry the
    authoritative geometry.  Keeping both candidate sets in the draft makes a
    boundary conflict inspectable before the binding rule is switched.
    """
    record_pages = _page_span(record)
    infos = ((payload.get("data_info") or {}).get("pages") or [])
    ignored_images, ignored_reasons = _ignored_glm_image_blocks(payload)
    blocks: list[dict[str, Any]] = []
    bindings: list[dict[str, Any]] = []
    matched_review_ids: set[str] = set()
    unmatched_glm_ids: list[str] = []
    warnings: set[str] = set()
    for page_index, page in enumerate(payload.get("layout_details") or []):
        page_number = page_index + 1
        if page_number not in record_pages:
            continue
        page_info = infos[page_index] if page_index < len(infos) and isinstance(infos[page_index], dict) else {}
        for block_index, block in enumerate(page):
            if not isinstance(block, dict) or str(block.get("label") or "") != "image":
                continue
            if _image_block_key(page_index, block_index) in ignored_images:
                continue
            figure_box = _bbox_fraction(block, page_info)
            segment_candidates: list[str] = []
            page_candidates: list[str] = []
            for candidate in manifest:
                question_no = normalize_question_no(candidate.get("question_no"))
                if not question_no:
                    continue
                if page_number in _page_span(candidate):
                    page_candidates.append(question_no)
                if figure_box:
                    for segment in _record_segments(candidate):
                        if int(segment.get("page_number") or segment.get("pageNumber") or 0) != page_number:
                            continue
                        target = _region_fraction(segment, candidate)
                        if target and _overlap(target, figure_box) > 0.0001:
                            segment_candidates.append(question_no)
                            break
            page_candidates = list(dict.fromkeys(page_candidates))
            segment_candidates = list(dict.fromkeys(segment_candidates))
            question_no = normalize_question_no(record.get("question_no"))
            current_matches_segment = question_no in segment_candidates
            binding = "segment_overlap" if current_matches_segment else "page_span_only"
            block_warnings: list[str] = []
            if not figure_box:
                block_warnings.append("ocr_image_missing_bbox")
            if binding == "page_span_only":
                block_warnings.append("ocr_image_page_span_only")
            if len(page_candidates) > 1:
                block_warnings.append("ocr_image_on_shared_question_page")
            if segment_candidates and not current_matches_segment:
                block_warnings.append("ocr_image_outside_review_segments")
            warnings.update(block_warnings)
            url = str(block.get("content") or "")
            glm_figure_id = _glm_figure_id(page_number, url) if url.startswith("http") else ""
            review_matches = _review_matches_for_glm_figure(record, page_number, figure_box) if current_matches_segment else []
            if current_matches_segment and glm_figure_id:
                if review_matches:
                    for review_match in review_matches:
                        matched_review_ids.add(str(review_match["review_figure_id"]))
                        bindings.append({
                            "glm_figure_id": glm_figure_id,
                            "review_figure_id": review_match["review_figure_id"],
                            "page_number": page_number,
                            "match_score": review_match["match_score"],
                            "status": "matched",
                        })
                else:
                    unmatched_glm_ids.append(glm_figure_id)
            blocks.append({
                "block_id": str(block.get("index") or ""),
                "glm_figure_id": glm_figure_id,
                "page_number": page_number,
                "bbox": {"x": figure_box[0], "y": figure_box[1], "width": figure_box[2] - figure_box[0], "height": figure_box[3] - figure_box[1]} if figure_box else None,
                "current_binding": binding,
                "page_span_candidates": page_candidates,
                "segment_candidates": segment_candidates,
                "review_matches": review_matches,
                "warnings": block_warnings,
            })
    review_figure_ids = [str(figure.get("id") or f"review_fig_{index + 1}") for index, figure in enumerate(record.get("figures") or []) if isinstance(figure, dict)]
    return {
        "source": "glm",
        "version": 1,
        "matched": sum(1 for block in blocks if block["current_binding"] == "segment_overlap"),
        "page_span_only": sum(1 for block in blocks if block["current_binding"] == "page_span_only"),
        "warnings": sorted(warnings),
        "image_blocks": blocks,
        "bindings": bindings,
        "unmatched_glm_figure_ids": unmatched_glm_ids,
        "unmatched_review_figure_ids": [figure_id for figure_id in review_figure_ids if figure_id not in matched_review_ids],
        "ignored_non_content_images": sum(ignored_reasons.values()),
        "ignored_non_content_image_reasons": ignored_reasons,
    }


def _formula_diagnostics(fields: dict[str, str]) -> list[dict[str, str]]:
    diagnostics: list[dict[str, str]] = []
    for field, value in fields.items():
        delimiters = value.count("$")
        if delimiters % 2:
            diagnostics.append({"field": field, "code": "math_delimiter_unclosed", "snippet": value, "message": "数学定界符 $ 未成对。"})
        for match in re.finditer(r"\$(.+?)\$", value, re.DOTALL):
            formula = match.group(1).strip()
            left_count = len(re.findall(r"\\left(?:\\[{}()|]|.)", formula))
            right_count = len(re.findall(r"\\right(?:\\[{}()|]|.)", formula))
            if left_count != right_count:
                diagnostics.append({"field": field, "code": "latex_left_right_unbalanced", "snippet": formula, "message": "公式中的 \\left 与 \\right 未配对。"})
    return diagnostics


def _glm_figures(record: dict[str, Any], manifest: list[dict[str, Any]], payload: dict[str, Any], artifact_dir: Path, storage_root: Path) -> list[dict[str, Any]]:
    figures: list[dict[str, Any]] = []
    page_span = _page_span(record)
    infos = ((payload.get("data_info") or {}).get("pages") or [])
    ignored_images, _ = _ignored_glm_image_blocks(payload)
    for page_index, page in enumerate(payload.get("layout_details") or []):
        page_number = page_index + 1
        if page_number not in page_span:
            continue
        page_info = infos[page_index] if page_index < len(infos) and isinstance(infos[page_index], dict) else {}
        for block_index, block in enumerate(page):
            if str(block.get("label") or "") != "image" or not str(block.get("content") or "").startswith("http"):
                continue
            if _image_block_key(page_index, block_index) in ignored_images:
                continue
            fraction = _bbox_fraction(block, page_info)
            if not fraction:
                continue
            current_question_no = normalize_question_no(record.get("question_no"))
            matches_review_segment = any(
                current_question_no == normalize_question_no(candidate.get("question_no"))
                and any(
                    int(segment.get("page_number") or segment.get("pageNumber") or 0) == page_number
                    and (target := _region_fraction(segment, candidate)) is not None
                    and _overlap(target, fraction) > 0.0001
                    for segment in _record_segments(candidate)
                )
                for candidate in manifest
            )
            if not matches_review_segment:
                continue
            url = str(block["content"])
            digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
            target = artifact_dir / "assets" / f"glm_{page_number}_{digest}.jpg"
            try:
                local = Path(_download_asset(url, target))
                relative = local.resolve().relative_to(storage_root.resolve()).as_posix()
            except (OSError, urllib.error.URLError, ValueError):
                continue
            bbox = {"x": fraction[0] if fraction else 0, "y": fraction[1] if fraction else 0, "width": (fraction[2] - fraction[0]) if fraction else 0, "height": (fraction[3] - fraction[1]) if fraction else 0}
            figures.append({"id": _glm_figure_id(page_number, url), "origin": "glm_ocr", "usage": "stem", "category": "question", "pageNumber": page_number, "bbox": bbox, "path": relative, "blockId": str(block.get("index") or digest)})
    return figures


def _strip_images_outside_review_segments(value: str, record: dict[str, Any], payload: dict[str, Any]) -> str:
    """Drop provider image tags that fall outside this reviewed question cut.

    Some GLM responses classify a large page watermark as an ordinary image.
    The native label is then not enough to filter it, but the reviewed cut
    remains authoritative: an image not intersecting any of its segments
    cannot be an inline image of this question.
    """
    segments = _record_segments(record)
    if not segments:
        return value

    allowed_urls: set[str] = set()
    ignored_images, _ = _ignored_glm_image_blocks(payload)
    infos = ((payload.get("data_info") or {}).get("pages") or [])
    for page_index, page in enumerate(payload.get("layout_details") or []):
        page_number = page_index + 1
        page_info = infos[page_index] if page_index < len(infos) and isinstance(infos[page_index], dict) else {}
        for block_index, block in enumerate(page):
            if not isinstance(block, dict) or str(block.get("label") or "") != "image":
                continue
            if _image_block_key(page_index, block_index) in ignored_images:
                continue
            url = str(block.get("content") or "")
            fraction = _bbox_fraction(block, page_info)
            if not url or not fraction:
                continue
            if any(
                int(segment.get("page_number") or segment.get("pageNumber") or 0) == page_number
                and (target := _region_fraction(segment, record)) is not None
                and _overlap(target, fraction) > 0.0001
                for segment in segments
            ):
                allowed_urls.add(url)

    return IMAGE_RE.sub(lambda match: match.group(0) if match.group(1) in allowed_urls else "", value)


def build_drafts(*, result_payload: dict[str, Any], manifest: list[dict[str, Any]], drafts_root: Path, artifact_dir: Path, storage_root: Path, single_question: bool = False) -> dict[str, Any]:
    manifest = _with_pdf_page_sizes(manifest, storage_root)
    pages = _page_texts(result_payload)
    expected = [normalize_question_no(record.get("question_no")) for record in manifest]
    # New manifests explicitly carry the document kind.  Older manifests were
    # produced only by the exam flow, so retain exam parsing for compatibility.
    is_exam = all(str(record.get("material_type") or "exam") == "exam" for record in manifest)
    parsed = split_exam_markdown(pages, expected) if is_exam else _split_numbered_markdown_legacy(pages, expected)
    successes = 0
    failures: list[dict[str, str]] = []
    for record in manifest:
        persisted_record = {key: value for key, value in record.items() if not key.startswith("_")}
        record_id = str(record.get("id") or "")
        question_no = normalize_question_no(record.get("question_no"))
        record_kind = str(record.get("ocr_record_kind") or "question")
        parse_mode = str(record.get("ocr_parse_mode") or "auto")
        item = None
        if parse_mode == "region":
            fields = _fields_from_regions(record, result_payload)
            raw = "\n\n".join(value for value in (fields.get("problem"), fields.get("answer"), fields.get("analysis")) if value).strip()
            if record_kind == "solution":
                solution_raw = (fields.get("analysis") or fields.get("answer") or fields.get("problem") or "").strip()
                stem, answer, analysis, has_markers = _split_fields(solution_raw)
                if not has_markers:
                    answer = ""
                    analysis = solution_raw
                item = {
                    "raw": raw or solution_raw,
                    "stem": "",
                    "answer": answer,
                    "analysis": analysis,
                    "has_markers": has_markers,
                    "page_indices": _page_indices_from_record(record),
                    "parse_confidence": "region",
                    "parse_warnings": [] if solution_raw else ["解析裁切区域未识别到文本。"],
                }
            else:
                item = {
                    "raw": raw,
                    "stem": fields.get("problem") or "",
                    "answer": fields.get("answer") or "",
                    "analysis": fields.get("analysis") or "",
                    "has_markers": bool(fields.get("answer") or fields.get("analysis")),
                    "page_indices": _page_indices_from_record(record),
                    "parse_confidence": "region",
                    "parse_warnings": [] if raw else ["题干裁切区域未识别到文本。"],
                }
        else:
            item = parsed.get(question_no)
        if single_question and len(manifest) == 1 and not item:
            raw = _joined_pages(pages)
            stem, answer, analysis, has_markers = _split_fields(raw)
            item = {"raw": raw, "stem": stem, "answer": answer, "analysis": analysis, "has_markers": has_markers, "page_indices": list(range(1, len(pages) + 1))}
        draft_dir = drafts_root / record_id
        draft_dir.mkdir(parents=True, exist_ok=True)
        if not item:
            failures.append({"id": record_id, "question_no": question_no, "error": "GLM-OCR 未找到题号"})
            result = {**persisted_record, "id": record_id, "ocr_status": "failed", "problem_text": "", "answer": "", "analysis": "", "figures": record.get("figures") or [], "needs_human_review": True, "post_processing": {"provider": "glm", "error": "question_number_not_found"}}
        else:
            # Exam text is owned by the unified question/answer/analysis parser.
            # Local cutter regions remain useful for review and image geometry,
            # but must not overwrite the logical question boundary.
            problem = _strip_images_outside_review_segments(item["stem"], record, result_payload)
            answer = _strip_images_outside_review_segments(item["answer"], record, result_payload)
            analysis = _strip_images_outside_review_segments(item["analysis"], record, result_payload)
            reviewed_figures = list(record.get("figures") or [])
            glm_figures = _glm_figures(record, manifest, result_payload, artifact_dir, storage_root)
            figures = list({str(figure.get("id") or index): figure for index, figure in enumerate([*reviewed_figures, *glm_figures])}.values())
            normalized_fields = {"problem_text": normalize_math_delimiters(problem), "answer": normalize_math_delimiters(answer), "analysis": normalize_math_delimiters(analysis)}
            needs_review = (not bool(problem) and record_kind != "solution") or (record_kind == "solution" and not bool(answer) and not bool(analysis)) or (record_kind != "solution" and not bool(answer) and not bool(analysis))
            result = {**persisted_record, "id": record_id, "question_no": record.get("question_no", question_no), "ocr_status": "draft", **normalized_fields, "figures": figures, "needs_human_review": needs_review, "raw_model_output": _strip_images_outside_review_segments(item["raw"], record, result_payload), "post_processing": {"provider": "glm", "page_indices": item.get("page_indices") or [], "used_text_regions": parse_mode == "region", "has_answer_analysis_markers": bool(item.get("has_markers")), "parse_confidence": item.get("parse_confidence", "high"), "parse_warnings": item.get("parse_warnings") or [], "figure_binding": _glm_figure_diagnostics(record, manifest, result_payload), "render_diagnostics": _formula_diagnostics(normalized_fields)}}
            successes += 1
        _atomic_json(draft_dir / "ocr_result.json", result)
        _atomic_text(draft_dir / "question.md", f"# 题目\n\n{result.get('problem_text') or ''}\n\n# 答案\n\n{result.get('answer') or ''}\n\n# 解析\n\n{result.get('analysis') or ''}\n")
    report = {"total": len(manifest), "successful": successes, "failed": len(failures), "failures": failures}
    _atomic_json(artifact_dir / "normalize.report.json", report)
    return report


class GlmOcrClient:
    def __init__(self, settings: GlmOcrSettings):
        self.settings = settings

    def parse(self, file_path: Path, *, request_id: str) -> dict[str, Any]:
        if not file_path.exists():
            raise GlmOcrError(f"找不到 OCR 输入文件：{file_path}", code="missing_input")
        limit = 50 * 1024 * 1024 if file_path.suffix.lower() == ".pdf" else 10 * 1024 * 1024
        if file_path.stat().st_size > limit:
            raise GlmOcrError("GLM-OCR 输入文件超过官方大小限制，请改用单题重新 OCR。", code="file_too_large")
        mime = mimetypes.guess_type(file_path.name)[0] or ("application/pdf" if file_path.suffix.lower() == ".pdf" else "image/png")
        encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
        body = json.dumps({"model": self.settings.model, "file": f"data:{mime};base64,{encoded}", "return_crop_images": True, "need_layout_visualization": True, "request_id": request_id, "user_id": "question-manager"}, ensure_ascii=False).encode("utf-8")
        last_error: Exception | None = None
        for attempt in range(self.settings.max_retries + 1):
            request = urllib.request.Request(self.settings.base_url, data=body, headers={"Authorization": f"Bearer {self.settings.api_key}", "Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=self.settings.timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                if exc.code in {429, 500, 502, 503, 504} and attempt < self.settings.max_retries:
                    time.sleep(2 ** attempt)
                    continue
                raise GlmOcrError(f"GLM-OCR HTTP {exc.code}: {raw[:500]}", code=f"http_{exc.code}", retryable=exc.code == 429) from exc
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt < self.settings.max_retries:
                    time.sleep(2 ** attempt)
                    continue
        raise GlmOcrError(f"GLM-OCR 请求失败：{last_error}", code="network_error", retryable=True)
