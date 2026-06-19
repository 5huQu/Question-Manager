from __future__ import annotations

import json
import math
import os
import shutil
import time
from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import fitz

from .client import (
    OCRAPIResult,
    OCRParseError,
    OCRRequestError,
    call_chat_completions,
    extract_assistant_text,
    extract_json_object,
    image_to_data_url,
)
from .config import OCRSettings, PROJECT_ROOT
from .latex_cleanup import normalize_latex_text, normalize_model_output_fields
from .markdown_export import convertLatexDelimitersForMarkdown
from .prompt import OCR_CHUNK_SYSTEM_PROMPT, OCR_SYSTEM_PROMPT, build_chunk_user_prompt, build_user_prompt

DATA_ROOT = Path(os.getenv("QUESTION_PYTHON_DATA_DIR", PROJECT_ROOT))
ASSET_ROOT = Path(os.getenv("QUESTION_ASSET_ROOT", PROJECT_ROOT))
OUTPUT_DIR = DATA_ROOT / "output"
OCR_DRAFTS_DIR = DATA_ROOT / "ocr_drafts"
OCR_MANIFEST_PATH = OUTPUT_DIR / "ocr_manifest.json"
OCR_TRIAL_REPORT_PATH = OCR_DRAFTS_DIR / "ocr_trial_report.md"
REVIEWED_RESULTS_PATH = OUTPUT_DIR / "reviewed_results.json"
CUT_RESULTS_PATH = OUTPUT_DIR / "cut_results.json"

DEFAULT_TIMEOUT_SECONDS = 180.0
SEGMENT_IMAGE_MARGIN = 4
SUPPLEMENTAL_REGION_MAX_SEGMENTS_PER_REQUEST = 5
ANALYSIS_MAX_SEGMENTS_PER_REQUEST = 2


def display_path(path: Path) -> str:
    resolved = path.resolve()
    for root in (DATA_ROOT, PROJECT_ROOT):
        try:
            return str(resolved.relative_to(root.resolve()))
        except ValueError:
            continue
    return str(resolved)


def resolve_runtime_path(path_value: str | Path) -> Path:
    path = Path(path_value)
    if path.is_absolute():
        return path
    parts = path.parts
    if parts and parts[0] == "question_assets":
        return ASSET_ROOT.joinpath(*parts[1:])
    asset_candidate = ASSET_ROOT / path
    if asset_candidate.exists():
        return asset_candidate
    return PROJECT_ROOT / path


def _strip_section_headers(text: str) -> str:
    """Truncate text at the first section header line.

    Section headers like "一、选择题" / "二、多选题" / "三、填空题" mark
    the boundary between the current question and the next section. Everything
    from that point is not part of the current question.
    """
    if not text:
        return text
    import re
    match = re.search(
        r'\n\s*[一二三四五六七八九十][、.．]\s*'
        r'(?:单项选择|多项选择|不定项选择|单选题|选择题|多选题|判断题|填空题|解答题|计算题|应用题|证明题)',
        text,
    )
    if match:
        return text[:match.start()].strip()
    return text.strip()


def _normalize_chunk_text(text: str) -> str:
    """Apply non-destructive cleanup to chunk OCR output before storing it."""
    if not text:
        return text
    text = normalize_latex_text(text)
    return _strip_section_headers(text)

# Image strategy labels
STRATEGY_SINGLE_REVIEWED = "single_reviewed_image"
STRATEGY_SEGMENTS_COMPRESSED = "reviewed_segments_compressed"
STRATEGY_SEGMENTS_RAW = "reviewed_segments_raw"
ROUTE_WHOLE_QUESTION = "whole_question_json"
ROUTE_REGION_CHUNKS = "region_chunks"


def compress_image(
    src: Path,
    dst: Path,
    *,
    max_width: int,
    fmt: str = "jpeg",
    jpeg_quality: int = 75,
) -> None:
    """Resize image to max_width and optionally convert format."""
    from PIL import Image

    img = Image.open(src)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    if w > max_width:
        ratio = max_width / w
        new_size = (max_width, int(h * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    save_fmt = "JPEG" if fmt.lower() in ("jpeg", "jpg") else fmt.upper()
    save_kwargs: dict[str, Any] = {}
    if save_fmt == "JPEG":
        save_kwargs["quality"] = jpeg_quality
        save_kwargs["optimize"] = True
    img.save(dst, format=save_fmt, **save_kwargs)


def _image_size(path: Path) -> tuple[int, int]:
    from PIL import Image

    with Image.open(path) as img:
        return img.size


def _stitch_image_group(paths: list[Path], out_path: Path) -> Path:
    from PIL import Image

    images = [Image.open(path).convert("RGB") for path in paths]
    try:
        width = max(image.width for image in images)
        height = sum(image.height for image in images)
        stitched = Image.new("RGB", (width, height), "white")
        cursor_y = 0
        for image in images:
            stitched.paste(image, (0, cursor_y))
            cursor_y += image.height
        stitched.save(out_path)
    finally:
        for image in images:
            image.close()
    return out_path


def _group_segment_paths(paths: list[Path], max_groups: int) -> list[list[Path]]:
    if max_groups <= 0 or len(paths) <= max_groups:
        return [[path] for path in paths]

    groups: list[list[Path]] = [[path] for path in paths]
    heights = {path: _image_size(path)[1] for path in paths}

    def group_height(group: list[Path]) -> int:
        return sum(heights[path] for path in group)

    while len(groups) > max_groups:
        smallest_index = min(range(len(groups)), key=lambda index: group_height(groups[index]))
        if smallest_index == 0:
            merge_index = 1
        elif smallest_index == len(groups) - 1:
            merge_index = len(groups) - 2
        else:
            left_height = group_height(groups[smallest_index - 1])
            right_height = group_height(groups[smallest_index + 1])
            merge_index = smallest_index - 1 if left_height <= right_height else smallest_index + 1

        left_index = min(smallest_index, merge_index)
        right_index = max(smallest_index, merge_index)
        groups[left_index] = groups[left_index] + groups[right_index]
        del groups[right_index]

    return groups


def _needs_multi_image(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
) -> bool:
    """Determine if a question needs multi-image input based on segments and image size."""
    segments = manifest_record.get("reviewed_segments") or []
    if isinstance(segments, list) and len(segments) > 1:
        return True

    image_path_str = manifest_record.get("reviewed_image_path", "")
    if image_path_str:
        image_path = resolve_runtime_path(image_path_str)
        if image_path.exists():
            from PIL import Image
            img = Image.open(image_path)
            w, h = img.size
            if h > settings.long_image_height_threshold:
                return True
            if image_path.stat().st_size > settings.long_image_bytes_threshold:
                return True
    return False


def determine_image_strategy(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
) -> str:
    segments = manifest_record.get("reviewed_segments") or []
    if isinstance(segments, list) and len(segments) > 1:
        return STRATEGY_SEGMENTS_COMPRESSED
    if _needs_multi_image(manifest_record, settings):
        return STRATEGY_SEGMENTS_COMPRESSED
    return STRATEGY_SINGLE_REVIEWED


def score_question_complexity(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
) -> dict[str, Any]:
    """Score whether a reviewed total image is still cheap enough for whole-image OCR."""
    score = 0
    factors: list[str] = []
    width = 0
    height = 0
    byte_size = 0

    reviewed_segments = manifest_record.get("reviewed_segments") or []
    segment_count = len(reviewed_segments) if isinstance(reviewed_segments, list) else 0
    if segment_count >= 3:
        score += 2
        factors.append("segments>=3:+2")
    elif segment_count == 2:
        score += 1
        factors.append("segments=2:+1")

    page_span = manifest_record.get("page_span") or []
    if isinstance(page_span, list) and len(page_span) >= 2:
        try:
            start_page = int(page_span[0])
            end_page = int(page_span[-1])
            if start_page != end_page:
                score += 1
                factors.append("multi_page:+1")
        except (TypeError, ValueError):
            score += 1
            factors.append("invalid_page_span:+1")

    image_path_str = manifest_record.get("reviewed_image_path", "")
    if image_path_str:
        image_path = resolve_runtime_path(image_path_str)
        if image_path.exists():
            width, height = _image_size(image_path)
            byte_size = image_path.stat().st_size
            if height >= 1700:
                score += 2
                factors.append("height>=1700:+2")
            elif height >= 1100:
                score += 1
                factors.append("height>=1100:+1")
            if byte_size >= 120000:
                score += 1
                factors.append("bytes>=120000:+1")
            if width > 0 and height / width >= 2.0:
                score += 1
                factors.append("aspect>=2.0:+1")
        else:
            score += 3
            factors.append("missing_reviewed_image:+3")

    return {
        "score": score,
        "factors": factors,
        "segment_count": segment_count,
        "page_span": page_span,
        "width": width,
        "height": height,
        "byte_size": byte_size,
        "threshold": 3,
    }


def determine_ocr_route(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
) -> tuple[str, str]:
    """Choose whole-question OCR by default; region OCR only runs when requested."""
    complexity = score_question_complexity(manifest_record, settings)
    factor_text = ",".join(complexity["factors"]) or "compact_total_image"
    if manifest_record.get("force_region_ocr") or manifest_record.get("ocr_route") == ROUTE_REGION_CHUNKS:
        return ROUTE_REGION_CHUNKS, f"manual_region_ocr;score={complexity['score']};{factor_text}"
    return ROUTE_WHOLE_QUESTION, f"whole_question_default;score={complexity['score']};{factor_text}"


def prepare_input_images(
    manifest_record: dict[str, Any],
    draft_dir: Path,
    settings: OCRSettings,
) -> tuple[list[Path], str]:
    """Prepare input images for OCR and return (image_paths, strategy)."""
    strategy = determine_image_strategy(manifest_record, settings)
    inputs_dir = draft_dir / "inputs"
    inputs_dir.mkdir(parents=True, exist_ok=True)
    image_paths: list[Path] = []

    if strategy == STRATEGY_SEGMENTS_COMPRESSED:
        segments = manifest_record.get("reviewed_segments") or []
        if isinstance(segments, list) and len(segments) > 1:
            raw_paths = _render_review_segments(manifest_record, draft_dir)
            grouped_paths = _group_segment_paths(raw_paths, settings.max_images_per_request)
            prepared_raw_paths: list[Path] = []
            for idx, group in enumerate(grouped_paths, start=1):
                if len(group) == 1:
                    prepared_raw_paths.append(group[0])
                    continue
                merged_path = draft_dir / "segments" / f"segment_{idx:02d}_merged.png"
                prepared_raw_paths.append(_stitch_image_group(group, merged_path))

            for idx, raw_path in enumerate(prepared_raw_paths, start=1):
                ext = "jpg" if settings.image_format.lower() in ("jpeg", "jpg") else settings.image_format.lower()
                compressed_path = inputs_dir / f"input_{idx:02d}.{ext}"
                compress_image(
                    raw_path,
                    compressed_path,
                    max_width=settings.image_max_width,
                    fmt=settings.image_format,
                    jpeg_quality=settings.image_jpeg_quality,
                )
                image_paths.append(compressed_path)
        else:
            source = resolve_runtime_path(manifest_record.get("reviewed_image_path") or "")
            if source.exists():
                ext = "jpg" if settings.image_format.lower() in ("jpeg", "jpg") else settings.image_format.lower()
                compressed_path = inputs_dir / f"input_01.{ext}"
                compress_image(
                    source,
                    compressed_path,
                    max_width=settings.image_max_width,
                    fmt=settings.image_format,
                    jpeg_quality=settings.image_jpeg_quality,
                )
                image_paths.append(compressed_path)
    else:
        source = resolve_runtime_path(manifest_record.get("reviewed_image_path") or "")
        if source.exists():
            saved = inputs_dir / "input_01.png"
            shutil.copy2(source, saved)
            image_paths.append(saved)

    return image_paths, strategy


def load_manifest_records() -> list[dict[str, Any]]:
    if not OCR_MANIFEST_PATH.exists():
        return []
    payload = json.loads(OCR_MANIFEST_PATH.read_text(encoding="utf-8"))
    records = payload.get("results", [])
    if not isinstance(records, list):
        return []

    cut_results_by_id = load_cut_results_map()
    hydrated_records: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        normalized = dict(record)
        if "text_regions" not in normalized:
            cut_record = cut_results_by_id.get(normalized.get("id", ""))
            if isinstance(cut_record, dict) and "text_regions" in cut_record:
                normalized["text_regions"] = cut_record["text_regions"]
        hydrated_records.append(normalized)
    return hydrated_records


def load_reviewed_results() -> list[dict[str, Any]]:
    if not REVIEWED_RESULTS_PATH.exists():
        return []
    data = json.loads(REVIEWED_RESULTS_PATH.read_text(encoding="utf-8"))
    results = data.get("results", [])
    return results if isinstance(results, list) else []


def load_cut_results_map() -> dict[str, dict[str, Any]]:
    if not CUT_RESULTS_PATH.exists():
        return {}
    data = json.loads(CUT_RESULTS_PATH.read_text(encoding="utf-8"))
    results = data.get("results", [])
    if not isinstance(results, list):
        return {}
    return {
        record["id"]: record
        for record in results
        if isinstance(record, dict) and isinstance(record.get("id"), str)
    }


def check_manifest_freshness() -> tuple[bool, str]:
    """Compare reviewed_results.json vs ocr_manifest.json for consistency.

    Returns (is_fresh, report_message).
    """
    reviewed = load_reviewed_results()
    manifest = load_manifest_records()

    if not reviewed:
        return False, "审核结果文件 output/reviewed_results.json 不存在或为空，请先完成审核。"
    if not manifest:
        return False, (
            "OCR 输入清单 output/ocr_manifest.json 不存在或为空。\n"
            "请先运行: python scripts/export_ocr_manifest.py"
        )

    reviewed_ready = [r for r in reviewed if r.get("status") == "ready_for_ocr"]
    if len(reviewed_ready) != len(manifest):
        return False, (
            f"记录数量不一致：reviewed_results.json 中 ready_for_ocr 有 {len(reviewed_ready)} 条，"
            f"ocr_manifest.json 中有 {len(manifest)} 条。\n"
            "请重新导出 manifest: python scripts/export_ocr_manifest.py"
        )

    reviewed_by_id: dict[str, dict[str, Any]] = {r["id"]: r for r in reviewed_ready if "id" in r}
    issues: list[str] = []

    for m in manifest:
        mid = m.get("id", "")
        r = reviewed_by_id.get(mid)
        if r is None:
            issues.append(f"- {mid}: 在 reviewed_results.json 中不存在")
            continue

        m_span = m.get("page_span", [])
        r_span = r.get("page_span", [])
        if m_span != r_span:
            issues.append(f"- {mid}: page_span 不一致 (manifest: {m_span}, reviewed: {r_span})")

        m_seg_count = len(m.get("reviewed_segments") or [])
        r_seg_count = len(r.get("reviewed_segments") or [])
        if m_seg_count != r_seg_count:
            issues.append(
                f"- {mid}: reviewed_segments 数量不一致 "
                f"(manifest: {m_seg_count}, reviewed: {r_seg_count})"
            )

        m_img = m.get("reviewed_image_path", "")
        r_img = r.get("reviewed_image_path", "")
        if m_img != r_img:
            issues.append(f"- {mid}: reviewed_image_path 不一致 (manifest: {m_img}, reviewed: {r_img})")

    if issues:
        return False, (
            "manifest 与 reviewed_results 不一致，发现以下问题：\n"
            + "\n".join(issues)
            + "\n\n请重新导出 manifest: python scripts/export_ocr_manifest.py"
        )

    return True, f"manifest 与审核结果一致，共 {len(manifest)} 条 ready_for_ocr 记录。"


def image_exists(path_str: str | None) -> bool:
    if not path_str:
        return False
    return resolve_runtime_path(path_str).exists()


def _find_source_pdf(pdf_name: str) -> Path | None:
    raw = Path(pdf_name)
    candidates = []
    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.extend([
            resolve_runtime_path(pdf_name),
            PROJECT_ROOT / "input" / "pdfs" / pdf_name,
        ])
    for path in (PROJECT_ROOT / "input" / "pdfs").rglob("*.pdf"):
        if path.name == pdf_name:
            candidates.append(path)
            break
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _segment_image_path(draft_dir: Path, index: int) -> Path:
    segment_dir = draft_dir / "segments"
    segment_dir.mkdir(parents=True, exist_ok=True)
    return segment_dir / f"segment_{index:02d}.png"


def _render_named_segments(
    manifest_record: dict[str, Any],
    segments: list[dict[str, Any]],
    output_dir: Path,
    *,
    file_prefix: str,
) -> list[Path]:
    if not isinstance(segments, list) or not segments:
        return []

    source_pdf = manifest_record.get("source_pdf", "")
    pdf_path = _find_source_pdf(source_pdf)
    if not pdf_path:
        return []

    ordered_segments = sorted(
        [seg for seg in segments if isinstance(seg, dict)],
        key=lambda seg: (
            seg.get("page_number", manifest_record.get("page", 1)),
            seg.get("bbox", {}).get("y", 0.0),
            seg.get("bbox", {}).get("x", 0.0),
        ),
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    zoom = 180 / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    out_paths: list[Path] = []

    try:
        with fitz.open(pdf_path) as doc:
            for index, seg in enumerate(ordered_segments, start=1):
                bbox = seg.get("bbox") or {}
                page_num = int(seg.get("page_number", manifest_record.get("page", 1)))
                if page_num < 1 or page_num > len(doc):
                    return []
                page = doc[page_num - 1]
                clip = fitz.Rect(
                    float(bbox.get("x", 0.0)),
                    float(bbox.get("y", 0.0)),
                    float(bbox.get("x", 0.0)) + float(bbox.get("width", 0.0)),
                    float(bbox.get("y", 0.0)) + float(bbox.get("height", 0.0)),
                )
                expanded = fitz.Rect(
                    max(0, clip.x0 - SEGMENT_IMAGE_MARGIN),
                    max(0, clip.y0 - SEGMENT_IMAGE_MARGIN),
                    min(page.rect.width, clip.x1 + SEGMENT_IMAGE_MARGIN),
                    min(page.rect.height, clip.y1 + SEGMENT_IMAGE_MARGIN),
                )
                pixmap = page.get_pixmap(matrix=matrix, clip=expanded, alpha=False)
                out_path = output_dir / f"{file_prefix}_{index:02d}.png"
                pixmap.save(str(out_path))
                out_paths.append(out_path)
    except Exception:
        return []

    return out_paths


def _render_review_segments(manifest_record: dict[str, Any], draft_dir: Path) -> list[Path]:
    reviewed_segments = manifest_record.get("reviewed_segments") or []
    if not isinstance(reviewed_segments, list) or len(reviewed_segments) <= 1:
        return []
    return _render_named_segments(
        manifest_record,
        reviewed_segments,
        draft_dir / "segments",
        file_prefix="segment",
    )


def _get_text_region(manifest_record: dict[str, Any], kind: str) -> dict[str, Any] | None:
    text_regions = manifest_record.get("text_regions") or []
    if not isinstance(text_regions, list):
        return None
    for region in text_regions:
        if isinstance(region, dict) and region.get("kind") == kind:
            return region
    return None


def _chunk_region_segments(
    segments: list[dict[str, Any]],
    *,
    max_segments_per_request: int,
) -> list[list[dict[str, Any]]]:
    if not segments:
        return []

    max_segments = max(1, max_segments_per_request)
    if len(segments) <= max_segments:
        return [segments]

    group_count = math.ceil(len(segments) / max_segments)
    base_size = len(segments) // group_count
    remainder = len(segments) % group_count

    groups: list[list[dict[str, Any]]] = []
    cursor = 0
    for index in range(group_count):
        size = base_size + (1 if index >= group_count - remainder and remainder > 0 else 0)
        groups.append(segments[cursor:cursor + size])
        cursor += size
    return [group for group in groups if group]


def sample_records(records: list[dict[str, Any]], max_items: int) -> list[dict[str, Any]]:
    if max_items <= 0:
        return []

    indexed = list(enumerate(records))
    selected: list[dict[str, Any]] = []
    used_pdfs: set[str] = set()
    used_pages: set[tuple[str, int]] = set()

    while indexed and len(selected) < max_items:
        best_pos = 0
        best_score: tuple[int, int, int, int] | None = None
        for pos, (idx, record) in enumerate(indexed):
            pdf = record.get("source_pdf", "")
            page = record.get("page")
            figures = record.get("figures") or []
            seg_count = len(record.get("reviewed_segments") or [])
            score = (
                1 if seg_count > 1 else 0,
                1 if figures else 0,
                1 if pdf not in used_pdfs else 0,
                1 if (pdf, page) not in used_pages else 0,
                -idx,
            )
            if best_score is None or score > best_score:
                best_score = score
                best_pos = pos
        idx, record = indexed.pop(best_pos)
        selected.append(record)
        used_pdfs.add(record.get("source_pdf", ""))
        used_pages.add((record.get("source_pdf", ""), record.get("page")))

    return selected


def _draft_dir(cut_id: str) -> Path:
    return OCR_DRAFTS_DIR / cut_id


def _existing_result_path(cut_id: str) -> Path:
    return _draft_dir(cut_id) / "ocr_result.json"


def load_json_result(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def render_question_markdown(result: dict[str, Any]) -> str:
    problem_text = convertLatexDelimitersForMarkdown(result.get("problem_text", "") or "")
    answer_text = convertLatexDelimitersForMarkdown(result.get("answer", "") or "")
    analysis_text = convertLatexDelimitersForMarkdown(result.get("analysis", "") or "")
    lines = [
        f"---",
        f"id: {result.get('id', '')}",
        f"source_pdf: {result.get('source_pdf', '')}",
        f"page: {result.get('page', '')}",
        f"question_no: {result.get('question_no', '')}",
        f"ocr_status: {result.get('ocr_status', 'draft')}",
        f"needs_human_review: {str(bool(result.get('needs_human_review', True))).lower()}",
        f"---",
        "",
        "# 题目",
        "",
        problem_text or "（空）",
        "",
        "# 答案",
        "",
        answer_text or "（空）",
        "",
        "# 解析",
        "",
        analysis_text or "（空）",
        "",
        "# 图形标注",
        "",
        "\n".join(f"- {item}" for item in (result.get("figure_labels") or [])) or "（空）",
        "",
        "# 图形可见元素",
        "",
        "\n".join(f"- {item}" for item in (result.get("figure_visual_elements") or [])) or "（空）",
        "",
        "# 疑似额外内容",
        "",
        "\n".join(f"- {item}" for item in (result.get("possible_extra_content") or [])) or "（空）",
        "",
        "# OCR 风险",
        "",
        "## LaTeX 风险",
        "",
        "\n".join(f"- {item}" for item in (result.get("latex_risk") or [])) or "（空）",
        "",
        "## 不确定内容",
        "",
        "\n".join(f"- {item}" for item in (result.get("uncertain_parts") or [])) or "（空）",
        "",
        "# 原图",
        "",
        "![原图](source.png)",
        "",
    ]
    return "\n".join(lines)


def build_result_json(
    *,
    manifest_record: dict[str, Any],
    model_output: dict[str, Any],
    raw_model_output: str,
    ocr_status: str = "draft",
    image_strategy: str = "",
    input_images: list[str] | None = None,
    post_processing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = {
        "id": manifest_record.get("id", ""),
        "original_question_id": manifest_record.get("original_question_id", ""),
        "original_source_run_id": manifest_record.get("original_source_run_id", ""),
        "source_pdf": manifest_record.get("source_pdf", ""),
        "page": manifest_record.get("page"),
        "page_span": manifest_record.get("page_span", []),
        "question_no": manifest_record.get("question_no", ""),
        "image_path": manifest_record.get("reviewed_image_path") or "",
        "ocr_status": ocr_status,
        "problem_text": model_output.get("problem_text", "") if model_output else "",
        "answer": model_output.get("answer", "") if model_output else "",
        "analysis": model_output.get("analysis", "") if model_output else "",
        "figure_labels": model_output.get("figure_labels", []) if model_output else [],
        "figure_visual_elements": model_output.get("figure_visual_elements", []) if model_output else [],
        "figures": manifest_record.get("figures") or [],
        "possible_extra_content": model_output.get("possible_extra_content", []) if model_output else [],
        "latex_risk": model_output.get("latex_risk", []) if model_output else [],
        "uncertain_parts": model_output.get("uncertain_parts", []) if model_output else [],
        "needs_human_review": bool(model_output.get("needs_human_review", True)) if model_output else True,
        "raw_model_output": raw_model_output,
        "image_strategy": image_strategy,
        "input_images": input_images or [],
        "post_processing": post_processing or {},
    }
    return result


def _normalize_model_output(parsed: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Normalize model output fields and return (normalized, post_processing_info)."""
    normalized = {
        "problem_text": parsed.get("problem_text", "") or "",
        "answer": parsed.get("answer", "") or "",
        "analysis": parsed.get("analysis", "") or "",
        "figure_labels": parsed.get("figure_labels", []) or [],
        "figure_visual_elements": parsed.get("figure_visual_elements", []) or [],
        "possible_extra_content": parsed.get("possible_extra_content", []) or [],
        "latex_risk": parsed.get("latex_risk", []) or [],
        "uncertain_parts": parsed.get("uncertain_parts", []) or [],
        "needs_human_review": parsed.get("needs_human_review", False),
    }
    return normalize_model_output_fields(normalized)


def _run_ocr_request(
    settings: OCRSettings,
    messages: list[dict[str, Any]],
) -> tuple[OCRAPIResult | None, str, int, bool | None, Exception | None]:
    retries_used = 0
    top_k_sent: bool | None = None
    raw_text = ""
    last_error: Exception | None = None
    api_result: OCRAPIResult | None = None

    for attempt in range(settings.max_retries + 1):
        try:
            api_result = call_chat_completions(
                settings,
                messages=messages,
                timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
            )
            top_k_sent = api_result.top_k_sent
            raw_text = api_result.raw_text
            break
        except (OCRRequestError, OCRParseError) as exc:
            last_error = exc
            raw_text = str(exc)
            if attempt < settings.max_retries:
                retries_used += 1
                time.sleep(settings.retry_delay_seconds)
            else:
                break

    return api_result, raw_text, retries_used, top_k_sent, last_error


def _parse_ocr_result(api_result: OCRAPIResult) -> tuple[str, dict[str, Any], dict[str, Any], Exception | None]:
    assistant_text = extract_assistant_text(api_result.payload)
    raw_text = assistant_text or api_result.raw_text
    post_processing: dict[str, Any] = {}
    last_error: Exception | None = None
    try:
        parsed = extract_json_object(assistant_text)
        parsed_model, post_processing = _normalize_model_output(parsed)
    except OCRParseError as exc:
        parsed_model = {}
        last_error = exc
    return raw_text, parsed_model, post_processing, last_error


def _build_chunk_user_content(kind: str, input_images: list[Path]) -> list[dict[str, Any]]:
    prompt_text = build_chunk_user_prompt(kind, len(input_images))
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt_text}]
    for index, image_path in enumerate(input_images, start=1):
        content.append({"type": "text", "text": f"图 {index}/{len(input_images)}"})
        content.append({
            "type": "image_url",
            "image_url": {"url": image_to_data_url(image_path), "detail": "high"},
        })
    return content


def _build_chunk_messages(kind: str, input_images: list[Path]) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": OCR_CHUNK_SYSTEM_PROMPT},
        {"role": "user", "content": _build_chunk_user_content(kind, input_images)},
    ]


def _build_whole_question_messages(input_images: list[Path]) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": OCR_SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_content({}, draft_dir=Path("."), input_images=input_images, strategy=STRATEGY_SINGLE_REVIEWED)},
    ]


def _run_whole_question_json_ocr(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
    *,
    draft_dir: Path,
    dry_run: bool,
    channel_name: str,
) -> dict[str, Any]:
    input_images, strategy = prepare_input_images(manifest_record, draft_dir, settings)
    input_image_rel_paths = [display_path(path) for path in input_images]

    if dry_run:
        return {
            "used": False,
            "status": "draft",
            "strategy": strategy,
            "channel_name": channel_name,
            "input_images": input_image_rel_paths,
            "raw_text": "",
            "parsed_model": {},
            "post_processing": {},
            "retries_used": 0,
            "top_k_sent": None,
            "error_reason": "",
        }

    messages = [
        {"role": "system", "content": OCR_SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_content(manifest_record, draft_dir=draft_dir, input_images=input_images, strategy=strategy)},
    ]
    api_result, raw_text, retries_used, top_k_sent, last_error = _run_ocr_request(settings, messages)
    if api_result is None:
        return {
            "used": False,
            "status": "failed",
            "strategy": strategy,
            "channel_name": channel_name,
            "input_images": input_image_rel_paths,
            "raw_text": raw_text,
            "parsed_model": {},
            "post_processing": {},
            "retries_used": retries_used,
            "top_k_sent": top_k_sent,
            "error_reason": str(last_error) if last_error else "whole_question_request_failed",
        }

    raw_text, parsed_model, post_processing, parse_error = _parse_ocr_result(api_result)
    if parse_error is not None:
        return {
            "used": False,
            "status": "parse_failed",
            "strategy": strategy,
            "channel_name": channel_name,
            "input_images": input_image_rel_paths,
            "raw_text": raw_text,
            "parsed_model": {},
            "post_processing": post_processing,
            "retries_used": retries_used,
            "top_k_sent": top_k_sent,
            "error_reason": str(parse_error),
        }

    return {
        "used": True,
        "status": "draft",
        "strategy": strategy,
        "channel_name": channel_name,
        "input_images": input_image_rel_paths,
        "raw_text": raw_text,
        "parsed_model": parsed_model,
        "post_processing": post_processing,
        "retries_used": retries_used,
        "top_k_sent": top_k_sent,
        "error_reason": "",
    }


def _secondary_channel_settings(settings: OCRSettings) -> OCRSettings | None:
    if not settings.secondary_api_base_url:
        return None
    return replace(
        settings,
        api_base_url=settings.secondary_api_base_url,
        api_key=settings.secondary_api_key or settings.api_key,
        model=settings.secondary_model or settings.model,
        max_images_per_request=max(1, settings.secondary_max_images_per_request or 3),
        concurrency=1,
    )


def _coalesce_region_text(kind: str, model_output: dict[str, Any]) -> str:
    if kind == "problem":
        problem_text = model_output.get("problem_text", "")
        if isinstance(problem_text, str) and problem_text.strip():
            return problem_text.strip()
        return ""
    primary = model_output.get(kind, "")
    fallback = model_output.get("problem_text", "")
    if isinstance(primary, str) and primary.strip():
        return primary.strip()
    if isinstance(fallback, str) and fallback.strip():
        return fallback.strip()
    return ""


def _run_region_supplement(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
    *,
    draft_dir: Path,
    kind: str,
    dry_run: bool,
) -> dict[str, Any]:
    return _run_region_supplement_impl(
        manifest_record,
        settings,
        draft_dir=draft_dir,
        kind=kind,
        dry_run=dry_run,
        channel_name="primary",
        region_dir_name="region_ocr",
        max_segments_limit=ANALYSIS_MAX_SEGMENTS_PER_REQUEST
        if kind == "analysis"
        else SUPPLEMENTAL_REGION_MAX_SEGMENTS_PER_REQUEST,
        sequential_chunks=False,
    )


def _run_region_supplement_seq3(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
    *,
    draft_dir: Path,
    kind: str,
    dry_run: bool,
) -> dict[str, Any]:
    return _run_region_supplement_impl(
        manifest_record,
        settings,
        draft_dir=draft_dir,
        kind=kind,
        dry_run=dry_run,
        channel_name="secondary_seq3",
        region_dir_name="region_ocr_seq3",
        max_segments_limit=3,
        sequential_chunks=True,
    )


def _run_region_supplement_impl(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
    *,
    draft_dir: Path,
    kind: str,
    dry_run: bool,
    channel_name: str,
    region_dir_name: str,
    max_segments_limit: int,
    sequential_chunks: bool,
) -> dict[str, Any]:
    region = _get_text_region(manifest_record, kind)
    if not region:
        return {"used": False, "reason": "missing_region"}

    segments = region.get("segments") or []
    if not isinstance(segments, list) or not segments:
        return {"used": False, "reason": "empty_region_segments"}

    region_dir = draft_dir / region_dir_name / kind
    raw_segments_dir = region_dir / "segments"
    input_root_dir = region_dir / "inputs"
    raw_segments = _render_named_segments(
        manifest_record,
        segments,
        raw_segments_dir,
        file_prefix=f"{kind}_segment",
    )
    if not raw_segments:
        return {"used": False, "reason": "render_region_segments_failed"}

    normalized_segments = [seg for seg in segments if isinstance(seg, dict)]
    max_segments_per_request = min(
        settings.max_images_per_request,
        max_segments_limit,
    )
    chunk_groups = _chunk_region_segments(
        normalized_segments,
        max_segments_per_request=max_segments_per_request,
    )

    total_retries = 0

    # Phase 1: prepare all chunks (render + compress, serial — PDF access must be sequential)
    chunk_tasks: list[dict[str, Any]] = []
    for chunk_index, segment_chunk in enumerate(chunk_groups, start=1):
        chunk_dir = input_root_dir / f"chunk_{chunk_index:02d}"
        rendered_chunk = _render_named_segments(
            manifest_record,
            segment_chunk,
            chunk_dir / "raw",
            file_prefix=f"{kind}_chunk",
        )
        if not rendered_chunk:
            chunk_tasks.append({
                "chunk_index": chunk_index,
                "status": "skipped",
                "reason": "render_chunk_failed",
                "segment_count": len(segment_chunk),
            })
            continue

        input_paths: list[Path] = []
        for image_index, raw_path in enumerate(rendered_chunk, start=1):
            ext = "jpg" if settings.image_format.lower() in ("jpeg", "jpg") else settings.image_format.lower()
            input_path = chunk_dir / f"input_{image_index:02d}.{ext}"
            compress_image(
                raw_path,
                input_path,
                max_width=settings.image_max_width,
                fmt=settings.image_format,
                jpeg_quality=settings.image_jpeg_quality,
            )
            input_paths.append(input_path)

        chunk_tasks.append({
            "chunk_index": chunk_index,
            "segment_count": len(segment_chunk),
            "input_count": len(input_paths),
            "input_paths": input_paths,
            "chunk_dir": chunk_dir,
            "messages": _build_chunk_messages(kind, input_paths),
            "dry_run": dry_run,
        })

    # Phase 2: execute all chunks in parallel
    chunk_reports: list[dict[str, Any]] = []
    chunk_texts: list[str] = []
    stopped_on_failure = False

    def _execute_chunk(task: dict[str, Any]) -> dict[str, Any]:
        if task.get("status") == "skipped":
            return task

        if task.get("dry_run"):
            return {
                "chunk_index": task["chunk_index"],
                "status": "dry_run",
                "segment_count": task["segment_count"],
                "input_count": task["input_count"],
            }

        api_result, raw_text, retries_used, _top_k_sent, last_error = _run_ocr_request(
            settings, task["messages"]
        )

        raw_response_path = task["chunk_dir"] / "raw_response.txt"
        if api_result is None:
            raw_response_path.write_text(raw_text, encoding="utf-8")
            return {
                "chunk_index": task["chunk_index"],
                "status": "failed",
                "segment_count": task["segment_count"],
                "input_count": task["input_count"],
                "error_reason": str(last_error) if last_error else "unknown_error",
                "retries_used": retries_used,
            }

        chunk_text = extract_assistant_text(api_result.payload)
        chunk_text = _normalize_chunk_text(chunk_text)
        raw_response_path.write_text(chunk_text, encoding="utf-8")
        text_len = len(chunk_text.strip()) if chunk_text else 0
        return {
            "chunk_index": task["chunk_index"],
            "status": "draft",
            "segment_count": task["segment_count"],
            "input_count": task["input_count"],
            "text_length": text_len,
            "text": chunk_text.strip(),
            "retries_used": retries_used,
        }

    if sequential_chunks:
        for task in chunk_tasks:
            report = _execute_chunk(task)
            chunk_reports.append(report)
            if report.get("status") == "draft" and report.get("text_length", 0) > 0:
                chunk_texts.append(report["text"])
            if report.get("status") == "failed":
                stopped_on_failure = True
                break
    else:
        with ThreadPoolExecutor(max_workers=min(len(chunk_tasks), settings.concurrency, 20)) as executor:
            futures = {executor.submit(_execute_chunk, task): task for task in chunk_tasks}
            for future in as_completed(futures):
                report = future.result()
                chunk_reports.append(report)
                if report.get("status") == "draft" and report.get("text_length", 0) > 0:
                    chunk_texts.append(report["text"])

    total_retries = sum(r.get("retries_used", 0) for r in chunk_reports)

    # Sort by chunk_index to maintain order
    chunk_reports.sort(key=lambda r: r.get("chunk_index", 0))
    # chunk_texts are already separate — they'll be joined in order via chunk_reports
    # But since we collected them in completion order, re-sort by chunk_index
    ordered_texts: list[str] = []
    for report in chunk_reports:
        if report.get("status") == "draft" and report.get("text", ""):
            ordered_texts.append(report["text"])

    any_success = len(ordered_texts) > 0
    return {
        "used": any_success,
        "kind": kind,
        "text": "\n\n".join(ordered_texts),
        "latex_risk": [],
        "uncertain_parts": [],
        "possible_extra_content": [],
        "chunk_reports": chunk_reports,
        "chunk_count": len(chunk_groups),
        "total_retries": total_retries,
        "page_span": region.get("page_span", []),
        "channel_name": channel_name,
        "sequential_chunks": sequential_chunks,
        "stopped_on_failure": stopped_on_failure,
    }


def _make_report_row(
    record: dict[str, Any],
    *,
    selected: bool,
    processed: bool,
    skipped: bool,
    skip_reason: str,
    elapsed_seconds: float = 0.0,
    retries_used: int = 0,
    top_k_sent: bool | None = None,
    ocr_status: str = "",
    generated_result: bool = False,
    generated_md: bool = False,
    parse_failed: bool = False,
    error_reason: str = "",
    image_strategy: str = "",
    image_count: int = 0,
    split_triggered: bool = False,
    math_delimiters_normalized: bool = False,
    residual_markers: bool = False,
    region_ocr_used: bool = False,
    secondary_region_ocr_used: bool = False,
    recovered_from_parse_failed: bool = False,
) -> dict[str, Any]:
    return {
        "id": record["id"],
        "source_pdf": record.get("source_pdf", ""),
        "page": record.get("page"),
        "question_no": record.get("question_no", ""),
        "selected": selected,
        "processed": processed,
        "skipped": skipped,
        "skip_reason": skip_reason,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "retries_used": retries_used,
        "top_k_sent": top_k_sent,
        "ocr_status": ocr_status,
        "generated_result": generated_result,
        "generated_md": generated_md,
        "has_figures": bool(record.get("figures")),
        "parse_failed": parse_failed,
        "error_reason": error_reason,
        "image_strategy": image_strategy,
        "image_count": image_count,
        "split_triggered": split_triggered,
        "math_delimiters_normalized": math_delimiters_normalized,
        "residual_markers": residual_markers,
        "region_ocr_used": region_ocr_used,
        "secondary_region_ocr_used": secondary_region_ocr_used,
        "recovered_from_parse_failed": recovered_from_parse_failed,
    }


def _build_user_content(
    manifest_record: dict[str, Any],
    *,
    draft_dir: Path,
    input_images: list[Path],
    strategy: str,
) -> list[dict[str, Any]]:
    """Legacy single-request JSON OCR content builder.

    The current pipeline mainly uses region-based chunk OCR. This helper is
    kept only for the older whole-question path.
    """
    if len(input_images) > 1:
        content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    "你会收到同一道题的多张连续图片。这些图片来自人工审核确认后的切块，"
                    "请按顺序一起识别并合并成同一份 OCR JSON。"
                    f"图片总数为 {len(input_images)}。"
                    "请严格按照图 1、图 2、... 的顺序，不要错位，不要跳图。"
                ),
            }
        ]
        for index, image_path in enumerate(input_images, start=1):
            content.append(
                {
                    "type": "text",
                    "text": f"图 {index}/{len(input_images)}。",
                }
            )
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_to_data_url(image_path),
                        "detail": "high",
                    },
                }
            )
        return content

    if input_images:
        return [
            {
                "type": "text",
                "text": build_user_prompt(),
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": image_to_data_url(input_images[0]),
                    "detail": "high",
                },
            },
        ]

    return [{"type": "text", "text": build_user_prompt()}]


def process_record(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
    *,
    dry_run: bool,
    force: bool,
) -> dict[str, Any]:
    cut_id = manifest_record["id"]
    draft_dir = _draft_dir(cut_id)
    result_path = draft_dir / "ocr_result.json"
    question_md_path = draft_dir / "question.md"
    source_png_path = draft_dir / "source.png"
    raw_response_path = draft_dir / "raw_response.txt"

    start = time.perf_counter()
    retries_used = 0
    top_k_sent = False
    status = "draft"
    error_reason = ""
    raw_text = ""
    parsed_model: dict[str, Any] = {}
    image_strategy = ""
    input_image_rel_paths: list[str] = []

    if result_path.exists() and not force:
        existing = load_json_result(result_path) or {}
        existing_pp = existing.get("post_processing") or {}
        elapsed = time.perf_counter() - start
        return {
            "id": cut_id,
            "source_pdf": manifest_record.get("source_pdf", ""),
            "page": manifest_record.get("page"),
            "question_no": manifest_record.get("question_no", ""),
            "selected": False,
            "processed": False,
            "skipped": True,
            "skip_reason": "resume_skip",
            "elapsed_seconds": round(elapsed, 3),
            "retries_used": 0,
            "top_k_sent": None,
            "ocr_status": existing.get("ocr_status", "draft"),
            "generated_result": result_path.exists(),
            "generated_md": question_md_path.exists(),
            "has_figures": bool(manifest_record.get("figures")),
            "parse_failed": existing.get("ocr_status") == "parse_failed",
            "error_reason": "",
            "image_strategy": existing.get("image_strategy", ""),
            "image_count": len(existing.get("input_images", [])),
            "split_triggered": bool(existing_pp.get("split_triggered")),
            "math_delimiters_normalized": bool(existing_pp.get("math_delimiters_normalized")),
            "residual_markers": bool(existing_pp.get("residual_markers_in_problem_text")),
            "region_ocr_used": bool(
                existing_pp.get("region_ocr")
                or existing_pp.get("supplemental_region_ocr")
            ),
            "secondary_region_ocr_used": bool(existing_pp.get("region_ocr_seq3")),
            "recovered_from_parse_failed": bool(existing_pp.get("recovered_from_base_parse_failed")),
        }

    draft_dir.mkdir(parents=True, exist_ok=True)
    source_image = resolve_runtime_path(manifest_record.get("reviewed_image_path") or "")
    if not source_image.exists():
        elapsed = time.perf_counter() - start
        error_reason = f"reviewed_image_path not found: {manifest_record.get('reviewed_image_path', '')}"
        result = build_result_json(
            manifest_record=manifest_record, model_output={},
            raw_model_output="", ocr_status="failed",
        )
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        question_md_path.write_text(render_question_markdown(result), encoding="utf-8")
        raw_response_path.write_text("", encoding="utf-8")
        return {
            "id": cut_id,
            "source_pdf": manifest_record.get("source_pdf", ""),
            "page": manifest_record.get("page"),
            "question_no": manifest_record.get("question_no", ""),
            "selected": True,
            "processed": False,
            "skipped": True,
            "skip_reason": "missing_reviewed_image",
            "elapsed_seconds": round(elapsed, 3),
            "retries_used": 0,
            "top_k_sent": None,
            "ocr_status": "failed",
            "generated_result": True,
            "generated_md": True,
            "has_figures": bool(manifest_record.get("figures")),
            "parse_failed": False,
            "error_reason": error_reason,
            "image_strategy": "",
            "image_count": 0,
            "split_triggered": False,
            "math_delimiters_normalized": False,
            "residual_markers": False,
            "region_ocr_used": False,
            "recovered_from_parse_failed": False,
        }

    # Copy reviewed image as source.png for human verification
    shutil.copy2(source_image, source_png_path)

    route, route_reason = determine_ocr_route(manifest_record, settings)
    image_strategy = route

    if route == ROUTE_WHOLE_QUESTION:
        whole_result = _run_whole_question_json_ocr(
            manifest_record,
            settings,
            draft_dir=draft_dir,
            dry_run=dry_run,
            channel_name="primary_whole_question",
        )
        image_strategy = whole_result.get("strategy", STRATEGY_SINGLE_REVIEWED)
        input_image_rel_paths = whole_result.get("input_images", [])
        retries_used = whole_result.get("retries_used", 0)
        top_k_sent = whole_result.get("top_k_sent")
        raw_text = whole_result.get("raw_text", "")

        if whole_result.get("used"):
            parsed_model = whole_result.get("parsed_model", {})
            post_processing = whole_result.get("post_processing", {})
            post_processing["ocr_route"] = route
            post_processing["ocr_route_reason"] = route_reason
            result = build_result_json(
                manifest_record=manifest_record,
                model_output=parsed_model,
                raw_model_output=raw_text,
                ocr_status="draft",
                image_strategy=image_strategy,
                input_images=input_image_rel_paths,
                post_processing=post_processing,
            )
            result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            question_md_path.write_text(render_question_markdown(result), encoding="utf-8")
            raw_response_path.write_text(raw_text, encoding="utf-8")
            elapsed = time.perf_counter() - start
            return _make_report_row(
                manifest_record,
                selected=True,
                processed=True,
                skipped=False,
                skip_reason="",
                elapsed_seconds=elapsed,
                retries_used=retries_used,
                top_k_sent=top_k_sent,
                ocr_status="draft",
                generated_result=True,
                generated_md=True,
                error_reason="",
                image_strategy=image_strategy,
                image_count=len(input_image_rel_paths),
                split_triggered=bool(post_processing.get("split_triggered")),
                math_delimiters_normalized=bool(post_processing.get("math_delimiters_normalized")),
                residual_markers=bool(post_processing.get("residual_markers_in_problem_text")),
                region_ocr_used=False,
                recovered_from_parse_failed=False,
            )

        # Whole-question OCR is the default path. Region OCR is a manual action,
        # so failed whole-question runs should surface as failures instead of
        # silently falling back to chunked OCR.
        post_processing = {
            "ocr_route": route,
            "ocr_route_reason": route_reason,
            "whole_question_error": {
                "status": whole_result.get("status", "failed"),
                "error_reason": whole_result.get("error_reason", ""),
                "channel_name": whole_result.get("channel_name", "primary_whole_question"),
                "strategy": image_strategy,
                "input_images": input_image_rel_paths,
            },
        }
        status = "parse_failed" if whole_result.get("status") == "parse_failed" else "failed"
        result = build_result_json(
            manifest_record=manifest_record,
            model_output={},
            raw_model_output=raw_text,
            ocr_status=status,
            image_strategy=image_strategy,
            input_images=input_image_rel_paths,
            post_processing=post_processing,
        )
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        question_md_path.write_text(render_question_markdown(result), encoding="utf-8")
        raw_response_path.write_text(raw_text, encoding="utf-8")
        elapsed = time.perf_counter() - start
        return _make_report_row(
            manifest_record,
            selected=True,
            processed=True,
            skipped=False,
            skip_reason="",
            elapsed_seconds=elapsed,
            retries_used=retries_used,
            top_k_sent=top_k_sent,
            ocr_status=status,
            generated_result=True,
            generated_md=True,
            error_reason=whole_result.get("error_reason", "whole_question_ocr_failed"),
            image_strategy=image_strategy,
            image_count=len(input_image_rel_paths),
            split_triggered=False,
            math_delimiters_normalized=False,
            residual_markers=False,
            region_ocr_used=False,
            recovered_from_parse_failed=False,
        )

    # Determine which regions to OCR based on text_regions. This path only runs
    # when the manifest explicitly requests manual region OCR.
    text_regions = manifest_record.get("text_regions") or []
    region_kinds = ["problem", "answer", "analysis"]
    active_kinds = [
        kind for kind in region_kinds
        if any(isinstance(r, dict) and r.get("kind") == kind and r.get("segments") for r in text_regions)
    ]
    if not active_kinds:
        elapsed = time.perf_counter() - start
        error_reason = "no text_regions with segments found"
        post_processing = {"region_ocr": {}, "ocr_route": route, "ocr_route_reason": route_reason}
        result = build_result_json(
            manifest_record=manifest_record, model_output={},
            raw_model_output="", ocr_status="draft",
            post_processing=post_processing,
        )
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        question_md_path.write_text(render_question_markdown(result), encoding="utf-8")
        raw_response_path.write_text("", encoding="utf-8")
        return {
            "id": cut_id,
            "source_pdf": manifest_record.get("source_pdf", ""),
            "page": manifest_record.get("page"),
            "question_no": manifest_record.get("question_no", ""),
            "selected": True,
            "processed": False,
            "skipped": True,
            "skip_reason": "no_text_regions",
            "elapsed_seconds": round(elapsed, 3),
            "retries_used": 0,
            "top_k_sent": None,
            "ocr_status": "draft",
            "generated_result": True,
            "generated_md": True,
            "has_figures": bool(manifest_record.get("figures")),
            "parse_failed": False,
            "error_reason": error_reason,
            "image_strategy": "",
            "image_count": 0,
            "split_triggered": False,
            "math_delimiters_normalized": False,
            "residual_markers": False,
            "region_ocr_used": False,
            "recovered_from_parse_failed": False,
        }

    if dry_run:
        post_processing = post_processing or {}
        post_processing["region_ocr"] = {k: {"dry_run": True} for k in active_kinds}
        result = build_result_json(
            manifest_record=manifest_record, model_output={},
            raw_model_output="", ocr_status="draft",
            image_strategy=image_strategy,
            post_processing=post_processing,
        )
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        question_md_path.write_text(render_question_markdown(result), encoding="utf-8")
        raw_response_path.write_text("", encoding="utf-8")
        elapsed = time.perf_counter() - start
        return {
            "id": cut_id,
            "source_pdf": manifest_record.get("source_pdf", ""),
            "page": manifest_record.get("page"),
            "question_no": manifest_record.get("question_no", ""),
            "selected": True,
            "processed": True,
            "skipped": False,
            "skip_reason": "",
            "elapsed_seconds": round(elapsed, 3),
            "retries_used": 0,
            "top_k_sent": None,
            "ocr_status": "draft",
            "generated_result": True,
            "generated_md": True,
            "has_figures": bool(manifest_record.get("figures")),
            "parse_failed": False,
            "error_reason": "",
            "image_strategy": image_strategy,
            "image_count": 0,
            "split_triggered": False,
            "math_delimiters_normalized": False,
            "residual_markers": False,
            "region_ocr_used": True,
            "recovered_from_parse_failed": False,
        }

    # Run primary region OCR in parallel
    region_results: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=len(active_kinds)) as executor:
        futures = {
            executor.submit(
                _run_region_supplement, manifest_record, settings,
                draft_dir=draft_dir, kind=kind, dry_run=False,
            ): kind
            for kind in active_kinds
        }
        for future in as_completed(futures):
            kind = futures[future]
            try:
                region_results[kind] = future.result()
            except Exception:
                region_results[kind] = {"used": False, "reason": "exception"}

    secondary_settings = _secondary_channel_settings(settings)
    secondary_region_results: dict[str, Any] = {}
    if secondary_settings is not None:
        for kind in active_kinds:
            try:
                secondary_region_results[kind] = _run_region_supplement_seq3(
                    manifest_record,
                    secondary_settings,
                    draft_dir=draft_dir,
                    kind=kind,
                    dry_run=False,
                )
            except Exception:
                secondary_region_results[kind] = {"used": False, "reason": "exception"}

    # Merge region results into model output
    parsed_model: dict[str, Any] = {}
    total_retries = retries_used
    any_used = False
    post_processing: dict[str, Any] = {}
    used_regions: dict[str, Any] = {}
    used_secondary_regions: dict[str, Any] = {}

    for kind in active_kinds:
        rr = region_results.get(kind, {})
        rr_secondary = secondary_region_results.get(kind, {})
        primary_text = (rr.get("text") or "").strip() if rr.get("used") else ""
        secondary_text = (rr_secondary.get("text") or "").strip() if rr_secondary.get("used") else ""
        region_text = primary_text or secondary_text
        if rr.get("used") or rr_secondary.get("used"):
            any_used = True
        if not region_text:
            continue
        target_field = "problem_text" if kind == "problem" else kind
        parsed_model[target_field] = region_text
        parsed_model["needs_human_review"] = True
        total_retries += rr.get("total_retries", 0) + rr_secondary.get("total_retries", 0)
        if rr.get("used"):
            used_regions[kind] = {
                "chunk_count": rr.get("chunk_count", 0),
                "text_length": len((rr.get("text") or "").strip()),
                "page_span": rr.get("page_span", []),
                "total_retries": rr.get("total_retries", 0),
                "chunk_reports": rr.get("chunk_reports", []),
                "sequential_chunks": rr.get("sequential_chunks", False),
                "channel_name": rr.get("channel_name", "primary"),
            }
        if rr_secondary.get("used"):
            used_secondary_regions[kind] = {
                "chunk_count": rr_secondary.get("chunk_count", 0),
                "text_length": len((rr_secondary.get("text") or "").strip()),
                "page_span": rr_secondary.get("page_span", []),
                "total_retries": rr_secondary.get("total_retries", 0),
                "chunk_reports": rr_secondary.get("chunk_reports", []),
                "sequential_chunks": rr_secondary.get("sequential_chunks", False),
                "channel_name": rr_secondary.get("channel_name", "secondary_seq3"),
                "stopped_on_failure": rr_secondary.get("stopped_on_failure", False),
            }

    if not any_used:
        status = "failed"
        parsed_model = {}
        last_error = Exception("no region OCR produced usable text")
    else:
        status = "draft"
        last_error = None
        post_processing["region_ocr"] = used_regions
        if used_secondary_regions:
            post_processing["region_ocr_seq3"] = used_secondary_regions
        post_processing["ocr_route"] = ROUTE_REGION_CHUNKS
        post_processing["ocr_route_reason"] = route_reason if route == ROUTE_REGION_CHUNKS else "whole_question_fallback"

    raw_payload = {
        "primary": {k: v.get("text", "") for k, v in region_results.items()},
    }
    if secondary_region_results:
        raw_payload["secondary_seq3"] = {
            k: v.get("text", "") for k, v in secondary_region_results.items()
        }
    raw_text = json.dumps(raw_payload, ensure_ascii=False, indent=2)
    result = build_result_json(
        manifest_record=manifest_record,
        model_output=parsed_model,
        raw_model_output=raw_text,
        ocr_status=status,
        image_strategy=image_strategy,
        post_processing=post_processing,
    )
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    question_md_path.write_text(render_question_markdown(result), encoding="utf-8")
    raw_response_path.write_text(raw_text, encoding="utf-8")
    elapsed = time.perf_counter() - start
    return {
        "id": cut_id,
        "source_pdf": manifest_record.get("source_pdf", ""),
        "page": manifest_record.get("page"),
        "question_no": manifest_record.get("question_no", ""),
        "selected": True,
        "processed": True,
        "skipped": False,
        "skip_reason": "",
        "elapsed_seconds": round(elapsed, 3),
        "retries_used": total_retries,
        "top_k_sent": None,
        "ocr_status": status,
        "generated_result": True,
        "generated_md": True,
        "has_figures": bool(manifest_record.get("figures")),
        "parse_failed": False,
        "error_reason": str(last_error) if last_error else "",
        "image_strategy": image_strategy,
        "image_count": 0,
        "split_triggered": False,
        "math_delimiters_normalized": False,
        "residual_markers": False,
        "region_ocr_used": any_used,
        "secondary_region_ocr_used": bool(used_secondary_regions),
        "recovered_from_parse_failed": False,
    }


def build_trial_report(
    *,
    manifest_path: Path,
    settings: OCRSettings,
    records: list[dict[str, Any]],
    manifest_total: int,
    selected_total: int,
    eligible_total: int,
    processed_total: int,
    skipped_total: int,
    failed_total: int,
    parse_failed_total: int,
    resume_skipped_total: int,
    missing_image_total: int,
    not_selected_total: int,
) -> str:
    top_k_not_sent_total = sum(1 for row in records if row.get("top_k_sent") is False)
    strategy_counts: dict[str, int] = {}
    for row in records:
        s = row.get("image_strategy", "")
        if s:
            strategy_counts[s] = strategy_counts.get(s, 0) + 1

    lines = [
        "# OCR 试跑报告",
        "",
        f"- 本次读取的 manifest 路径: {display_path(manifest_path)}",
        f"- manifest 中 ready_for_ocr 总数: {manifest_total}",
        f"- 通过图片可用性检查的数量: {eligible_total}",
        f"- 本次计划处理数量: {selected_total}",
        f"- 实际成功数量: {processed_total}",
        f"- 跳过数量: {skipped_total}",
        f"- 失败数量: {failed_total}",
        f"- parse_failed 数量: {parse_failed_total}",
        f"- 并发数: {settings.concurrency}",
        f"- dry_run: {str(settings.dry_run).lower()}",
        f"- top_k 配置值存在: {'是' if settings.top_k is not None else '否'}",
        f"- top_k 未实际传入的记录数: {top_k_not_sent_total}",
        "",
        "## 压缩参数",
        "",
        f"- 图片最大宽度: {settings.image_max_width}px",
        f"- 图片格式: {settings.image_format}",
        f"- JPEG 质量: {settings.image_jpeg_quality}",
        f"- 每次请求最大图片数: {settings.max_images_per_request}",
        f"- 长图高度阈值: {settings.long_image_height_threshold}px",
        f"- 长图体积阈值: {settings.long_image_bytes_threshold} bytes",
        "",
        "## 图片策略统计",
        "",
    ]
    if strategy_counts:
        for strategy, count in sorted(strategy_counts.items()):
            lines.append(f"- {strategy}: {count}")
    else:
        lines.append("- 无")
    lines += [
        "",
        "## 统计细分",
        "",
        f"- resume 跳过: {resume_skipped_total}",
        f"- 缺图跳过: {missing_image_total}",
        f"- 未选中跳过: {not_selected_total}",
        "",
        "## 逐条记录",
        "",
        "| id | source_pdf | page | question_no | figures | 策略 | 图片数 | 生成结果 | 生成 MD | 耗时(s) | 重试 | 状态 | 原因 |",
        "|---|---|---:|---|---|---|---|---|---|---:|---:|---|---|",
    ]

    for row in records:
        lines.append(
            "| {id} | {source_pdf} | {page} | {question_no} | {figures} | {strategy} | {image_count} | {generated_result} | {generated_md} | {elapsed_seconds} | {retries_used} | {ocr_status} | {reason} |".format(
                id=row["id"],
                source_pdf=row["source_pdf"],
                page=row["page"] if row["page"] is not None else "",
                question_no=row["question_no"],
                figures="yes" if row["has_figures"] else "no",
                strategy=row.get("image_strategy", ""),
                image_count=row.get("image_count", 0),
                generated_result="yes" if row["generated_result"] else "no",
                generated_md="yes" if row["generated_md"] else "no",
                elapsed_seconds=row.get("elapsed_seconds", 0),
                retries_used=row.get("retries_used", 0),
                ocr_status=row.get("ocr_status", ""),
                reason=row.get("skip_reason") or row.get("error_reason") or "",
            )
        )

    lines += [
        "",
        "## 图片策略明细",
        "",
    ]
    strategy_rows = [row for row in records if row.get("image_strategy")]
    if strategy_rows:
        for row in strategy_rows:
            lines.append(
                f"- {row['id']}: {row.get('image_strategy', '')} "
                f"({row.get('image_count', 0)} 张)"
            )
    else:
        lines.append("- 无")

    lines += [
        "",
        "## 失败原因",
        "",
    ]
    failed_rows = [row for row in records if row.get("ocr_status") == "failed"]
    if failed_rows:
        for row in failed_rows:
            lines.append(f"- {row['id']}: {row.get('error_reason', '')}")
    else:
        lines.append("- 无")

    lines += [
        "",
        "## 是否触发重试",
        "",
    ]
    retried_rows = [row for row in records if row.get("retries_used", 0) > 0]
    if retried_rows:
        for row in retried_rows:
            lines.append(f"- {row['id']}: 重试 {row['retries_used']} 次")
    else:
        lines.append("- 无")

    lines += [
        "",
        "## 后处理记录",
        "",
    ]

    split_records = [row for row in records if row.get("split_triggered")]
    lines.append("### 答案解析拆分 (split_triggered)")
    if split_records:
        lines.append("")
        lines.append("以下记录的 `problem_text` 中被检测出【答案】/【解析】标记，已自动拆分到对应字段：")
        for row in split_records:
            lines.append(f"- {row['id']}")
        lines.append("")
        lines.append("人工校对时请重点检查这些记录的 `answer` / `analysis` 字段。")
        lines.append("")
    else:
        lines.append("- 无")
        lines.append("")

    math_norm_records = [row for row in records if row.get("math_delimiters_normalized")]
    lines.append("### 公式定界符归一化 (math_delimiters_normalized)")
    if math_norm_records:
        for row in math_norm_records:
            lines.append(f"- {row['id']}")
    else:
        lines.append("- 无")
    lines.append("")

    residual_records = [row for row in records if row.get("residual_markers")]
    lines.append("### 残留标记 (residual_markers_in_problem_text)")
    if residual_records:
        lines.append("")
        lines.append("以下记录的 `problem_text` 中仍残留【答案】/【解析】标记，需人工检查：")
        for row in residual_records:
            lines.append(f"- {row['id']}")
        lines.append("")
    else:
        lines.append("- 无")
        lines.append("")

    supplemental_records = [row for row in records if row.get("region_ocr_used")]
    lines.append("### 分区 OCR (region_ocr)")
    if supplemental_records:
        for row in supplemental_records:
            lines.append(f"- {row['id']}")
    else:
        lines.append("- 无")
    lines.append("")

    secondary_records = [row for row in records if row.get("secondary_region_ocr_used")]
    lines.append("### 串行三图通道 (region_ocr_seq3)")
    if secondary_records:
        for row in secondary_records:
            lines.append(f"- {row['id']}")
    else:
        lines.append("- 无")
    lines.append("")

    recovered_records = [row for row in records if row.get("recovered_from_parse_failed")]
    lines.append("### 从 parse_failed 恢复 (recovered_from_base_parse_failed)")
    if recovered_records:
        lines.append("")
        lines.append("以下记录初始 JSON 解析失败，通过补充区域 OCR 恢复了内容：")
        for row in recovered_records:
            lines.append(f"- {row['id']}")
        lines.append("")
    else:
        lines.append("- 无")
        lines.append("")

    lines += [
        "",
        "## 下一步建议",
        "",
        "1. 先人工检查 `ocr_drafts/` 中的 `ocr_result.json` 和 `question.md`。",
        "2. 再决定是否继续批量扩大抽样数量或调整 Prompt。",
        "3. 若某些题目 `parse_failed`，优先看原图与 `raw_response.txt`。",
    ]
    return "\n".join(lines) + "\n"


def run_trial(
    settings: OCRSettings,
    *,
    force: bool = False,
) -> int:
    records = load_manifest_records()
    ready_records = [r for r in records if r.get("status") == "ready_for_ocr"]
    missing_image_records = [r for r in ready_records if not image_exists(r.get("reviewed_image_path"))]
    eligible_records = [r for r in ready_records if image_exists(r.get("reviewed_image_path"))]
    resume_skipped_records = [r for r in eligible_records if (not force and _existing_result_path(r["id"]).exists())]
    available_for_sampling = [r for r in eligible_records if force or not _existing_result_path(r["id"]).exists()]
    selected_records = sample_records(available_for_sampling, settings.max_items)

    OCR_DRAFTS_DIR.mkdir(parents=True, exist_ok=True)

    if not settings.api_base_url or not settings.api_key or not settings.model:
        if not settings.dry_run:
            print("缺少 OCR 必需配置，请先补充以下环境变量：")
            if not settings.api_base_url:
                print("- OCR_API_BASE_URL")
            if not settings.api_key:
                print("- OCR_API_KEY")
            if not settings.model:
                print("- OCR_MODEL")
            return 1

    if not selected_records:
        report = build_trial_report(
            manifest_path=OCR_MANIFEST_PATH,
            settings=settings,
            records=[],
            manifest_total=len(ready_records),
            selected_total=0,
            eligible_total=len(eligible_records),
            processed_total=0,
            skipped_total=len(ready_records),
            failed_total=0,
            parse_failed_total=0,
            resume_skipped_total=len(resume_skipped_records),
            missing_image_total=len(missing_image_records),
            not_selected_total=0,
        )
        OCR_TRIAL_REPORT_PATH.write_text(report, encoding="utf-8")
        print(report, end="")
        return 0

    results: list[dict[str, Any]] = []
    if settings.concurrency <= 1:
        for record in selected_records:
            results.append(process_record(record, settings, dry_run=settings.dry_run, force=force))
    else:
        with ThreadPoolExecutor(max_workers=min(settings.concurrency, 20)) as executor:
            future_map = {
                executor.submit(process_record, record, settings, dry_run=settings.dry_run, force=force): record
                for record in selected_records
            }
            completed: dict[str, dict[str, Any]] = {}
            for future in as_completed(future_map):
                record = future_map[future]
                try:
                    completed[record["id"]] = future.result()
                except Exception as exc:
                    completed[record["id"]] = {
                        "id": record["id"],
                        "source_pdf": record.get("source_pdf", ""),
                        "page": record.get("page"),
                        "question_no": record.get("question_no", ""),
                        "selected": True,
                        "processed": False,
                        "skipped": False,
                        "skip_reason": "",
                        "elapsed_seconds": 0.0,
                        "retries_used": 0,
                        "top_k_sent": None,
                        "ocr_status": "failed",
                        "generated_result": False,
                        "generated_md": False,
                        "has_figures": bool(record.get("figures")),
                        "parse_failed": False,
                        "error_reason": str(exc),
                        "image_strategy": "",
                        "image_count": 0,
                        "split_triggered": False,
                        "math_delimiters_normalized": False,
                        "residual_markers": False,
                        "region_ocr_used": False,
                        "recovered_from_parse_failed": False,
                    }
            results = [completed[record["id"]] for record in selected_records]

    processed_total = sum(1 for row in results if row.get("processed"))
    failed_total = sum(1 for row in results if row.get("ocr_status") == "failed")
    parse_failed_total = sum(1 for row in results if row.get("ocr_status") == "parse_failed")
    skipped_total = len(ready_records) - processed_total
    not_selected_total = len(available_for_sampling) - len(selected_records)
    report_rows = list(results)
    report_rows.extend(
        _make_report_row(
            record,
            selected=False,
            processed=False,
            skipped=True,
            skip_reason="resume_skip",
            ocr_status="skipped",
        )
        for record in resume_skipped_records
    )
    report_rows.extend(
        _make_report_row(
            record,
            selected=False,
            processed=False,
            skipped=True,
            skip_reason="missing_reviewed_image",
            ocr_status="skipped",
        )
        for record in missing_image_records
    )
    report_rows.extend(
        _make_report_row(
            record,
            selected=False,
            processed=False,
            skipped=True,
            skip_reason="not_selected",
            ocr_status="skipped",
        )
        for record in available_for_sampling
        if record not in selected_records
    )

    report = build_trial_report(
        manifest_path=OCR_MANIFEST_PATH,
        settings=settings,
        records=report_rows,
        manifest_total=len(ready_records),
        selected_total=len(selected_records),
        eligible_total=len(eligible_records),
        processed_total=processed_total,
        skipped_total=skipped_total,
        failed_total=failed_total,
        parse_failed_total=parse_failed_total,
        resume_skipped_total=len(resume_skipped_records),
        missing_image_total=len(missing_image_records),
        not_selected_total=not_selected_total,
    )
    OCR_TRIAL_REPORT_PATH.write_text(report, encoding="utf-8")
    print(report, end="")
    return 0
