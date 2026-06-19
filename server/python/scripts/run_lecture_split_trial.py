#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree

import fitz
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = Path(os.getenv("QUESTION_DATA_DIR", PROJECT_ROOT))
PYTHON_ROOT = PROJECT_ROOT / "server" / "python"
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from src.common.schema import SliceSegment
from src.cutter.crop_questions import detect_figures, summarize_graphic_candidates
from src.cutter.render_pdf import load_document
from src.lab.word import analyze_docx_formula_types

RUNS_ROOT = DATA_ROOT / "experiments" / "pdf_slicer" / "runs"
SQLITE_PATH = DATA_ROOT / "data" / "question.sqlite"
SOFFICE = Path(os.getenv("SOFFICE_PATH", "soffice"))
DPI = 150
PAGE_MARGIN_X = 28.0
TOP_PADDING = 8.0
BOTTOM_PADDING = 10.0

SAMPLES: list[Path] = []


@dataclass
class TextLine:
    index: int
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str


@dataclass
class Candidate:
    start: TextLine
    end: TextLine
    label: str
    kind: str
    section: str
    training_section: bool


CN_NUM = "一二三四五六七八九十百"
TRAINING_RE = re.compile(
    r"(限时训练|课后训练|课后作业|课时作业|过关检测|小试牛刀|巩固提升|巩固练习|"
    r"课堂检测|随堂检测|随堂练习|当堂检测|核心突破提升练|真题溯源通关练|"
    r"常考题型过关练|综合检测|达标检测|训练模拟|模拟实战|提升练|通关练|专项训练)"
)
PRACTICE_PART_RE = re.compile(
    r"^(单选题|多选题|选择题|填空题|解答题|证明题|应用题|练习题|综合题)(?:$|[（(：:\s])"
)
SECTION_RE = re.compile(
    rf"^(?:【)?(?:知识点\s*(?:\d+|[{CN_NUM}]+)|考点\s*(?:\d+|[{CN_NUM}]+)|"
    rf"题型\s*(?:[{CN_NUM}]+|\d+)[：:、\s]|【题型\s*(?:[{CN_NUM}]+|\d+)|"
    r"模块[一二三四五六七八九十\d]+|核心突破|真题溯源|小试牛刀|过关检测|"
    r"限时训练|课后训练|课后作业|课时作业|巩固提升|巩固练习|常考题型过关练|核心突破提升练|真题溯源通关练|"
    r"综合检测|达标检测|知识点梳理|知识点思维导图)"
)
EXAMPLE_RE = re.compile(r"^【?(典例|例题|例)\s*\d+(?:[-－–]\d+)?(?:】|[：:\s）)]|[\u4e00-\u9fff（(])")
VARIANT_RE = re.compile(r"^【?(变式(?:训练)?|即学即练)\s*\d+(?:[-－–]\d+)?")
NUMBERED_RE = re.compile(r"^([1-9]\d{0,2})(?:[．、]\s*|\.(?!\d)\s*|(?=[（(]))")
ANSWERISH_RE = re.compile(r"^【?(答案|解析|详解|分析|解题思路|方法技巧)")
TABLE_AS_TEXT_CONTEXT_RE = re.compile(r"(分布列|概率分布表|分布表|分布律|列联表)")
NUMBERED_NON_QUESTION_RE = re.compile(
    r"(概念|定义|性质|步骤|策略|思路|公式|方法|注意|一般地|分类|原则|目标|要求|标准|"
    r"判断所求|可用|检验|理解|掌握|了解|会用|运用|意义|关系|应用)"
)
NUMBERED_SOURCE_RE = re.compile(r"(20\d{2}|高考|模拟|期中|期末|专题练习|阶段练习|课时练习|一模|二模|三模|开学考试|高[一二三])")
NUMBERED_STEM_START_RE = re.compile(r"^(已知|设|若|如图|某|从|在|记|求|证明)")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_name(value: str) -> str:
    safe = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "_", value).strip("_")
    return safe[:80] or "lecture"


def make_id(prefix: str, name: str = "") -> str:
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    suffix = datetime.now().strftime("%f")[:6]
    tail = f"_{safe_name(name)}" if name else ""
    return f"{prefix}_{stamp}_{suffix}{tail}"


def rel(path: Path) -> str:
    return str(path.resolve().relative_to(PROJECT_ROOT)).replace("\\", "/")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create review-only lecture split trial runs.")
    parser.add_argument("--reset", action="store_true", help="Delete previous lecture_trial_* runs and artifacts before creating new ones.")
    parser.add_argument("--max-per-file", type=int, default=0, help="Debug limit for candidate count per file. 0 means no limit.")
    return parser.parse_args()


def ensure_schema() -> None:
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(SQLITE_PATH) as db:
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS pdf_slicer_batches (
              id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              uploaded_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS pdf_slicer_runs (
              run_id TEXT PRIMARY KEY,
              batch_id TEXT NOT NULL,
              upload_mode TEXT NOT NULL DEFAULT 'single_pdf',
              paper_title TEXT NOT NULL DEFAULT '',
              pdf_name TEXT NOT NULL,
              pdf_path TEXT NOT NULL,
              source_file_name TEXT NOT NULL DEFAULT '',
              source_file_kind TEXT NOT NULL DEFAULT 'pdf',
              run_dir TEXT NOT NULL,
              document_diagnostics_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              slice_status TEXT NOT NULL,
              slice_error TEXT NOT NULL DEFAULT '',
              quick_review_status TEXT NOT NULL DEFAULT 'pending',
              total_questions INTEGER NOT NULL DEFAULT 0,
              approved_questions INTEGER NOT NULL DEFAULT 0,
              unreviewed_questions INTEGER NOT NULL DEFAULT 0,
              ocr_status TEXT NOT NULL,
              ocr_error TEXT NOT NULL DEFAULT '',
              ocr_started_at TEXT NOT NULL DEFAULT '',
              ocr_finished_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS pdf_slicer_review_items (
              result_id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              question_label TEXT NOT NULL,
              page_start INTEGER NOT NULL,
              page_end INTEGER NOT NULL,
              page_image_path TEXT NOT NULL,
              auto_image_path TEXT NOT NULL,
              bbox_json TEXT NOT NULL DEFAULT '{}',
              segments_json TEXT NOT NULL DEFAULT '[]',
              text_regions_json TEXT NOT NULL DEFAULT '[]',
              figures_json TEXT NOT NULL DEFAULT '[]',
              review_status TEXT NOT NULL,
              note TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )


def reset_previous_trials() -> None:
    with sqlite3.connect(SQLITE_PATH) as db:
        db.execute("PRAGMA foreign_keys = ON")
        rows = db.execute("SELECT run_id, run_dir FROM pdf_slicer_runs WHERE run_id LIKE 'lecture_trial_%'").fetchall()
        for run_id, _run_dir in rows:
            db.execute("DELETE FROM pdf_slicer_review_items WHERE run_id = ?", (run_id,))
            db.execute("DELETE FROM question_bank_items WHERE source_run_id = ?", (run_id,))
            db.execute("DELETE FROM pdf_slicer_runs WHERE run_id = ?", (run_id,))
        db.execute("DELETE FROM pdf_slicer_batches WHERE id LIKE 'lecture_trial_batch_%'")
    for path in RUNS_ROOT.glob("lecture_trial_*"):
        if path.is_dir():
            shutil.rmtree(path)


def convert_docx_to_pdf(docx_path: Path, run_dir: Path) -> Path:
    if not SOFFICE.exists():
        raise RuntimeError(f"LibreOffice not found at {SOFFICE}")
    subprocess.run(
        [str(SOFFICE), "--headless", "--convert-to", "pdf", "--outdir", str(run_dir), str(docx_path)],
        cwd=run_dir,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    expected = run_dir / f"{docx_path.stem}.pdf"
    if expected.exists():
        return expected
    pdfs = sorted(run_dir.glob("*.pdf"))
    if not pdfs:
        raise RuntimeError(f"LibreOffice did not produce a PDF for {docx_path}")
    return pdfs[0]


def render_pages(doc: fitz.Document, pages_dir: Path) -> list[Path]:
    pages_dir.mkdir(parents=True, exist_ok=True)
    zoom = DPI / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    paths: list[Path] = []
    for index, page in enumerate(doc, start=1):
        output = pages_dir / f"page_{index:03d}.png"
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        pix.save(output)
        paths.append(output)
    return paths


def extract_pdf_lines(doc: fitz.Document) -> list[TextLine]:
    lines: list[TextLine] = []
    idx = 0
    for page_index, page in enumerate(doc, start=1):
        payload = page.get_text("dict")
        page_lines: list[TextLine] = []
        for block in payload.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                text = "".join(span.get("text", "") for span in spans).strip()
                text = re.sub(r"\s+", " ", text)
                if not text:
                    continue
                x0, y0, x1, y1 = line.get("bbox", (0, 0, 0, 0))
                page_lines.append(TextLine(idx, page_index, x0, y0, x1, y1, text))
                idx += 1
        page_lines.sort(key=lambda item: (round(item.y0, 1), item.x0))
        lines.extend(page_lines)
    for index, line in enumerate(lines):
        line.index = index
    return lines


def compact(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_heading(text: str) -> str:
    clean = compact(text).strip("【】[] ")
    clean = re.sub(r"^[（(]?[一二三四五六七八九十\d]+[）)、.．:：]\s*", "", clean)
    return clean.strip("【】[] ")


def is_section(text: str) -> bool:
    clean = compact(text)
    return bool(SECTION_RE.search(clean) or is_training_section(clean))


def is_training_section(text: str) -> bool:
    clean = compact(text)
    if len(clean) > 120:
        return False
    if ANSWERISH_RE.search(clean) or EXAMPLE_RE.search(clean) or VARIANT_RE.search(clean) or NUMBERED_RE.search(clean):
        return False
    heading = normalize_heading(clean)
    return bool(TRAINING_RE.search(heading) or PRACTICE_PART_RE.search(heading))


def candidate_kind(text: str, in_training_section: bool) -> str:
    clean = compact(text)
    if ANSWERISH_RE.search(clean):
        return ""
    if EXAMPLE_RE.search(clean):
        return "example"
    if VARIANT_RE.search(clean):
        return "variant"
    if NUMBERED_RE.search(clean) and (in_training_section or looks_like_numbered_question(clean)):
        return "training"
    return ""


def looks_like_numbered_question(text: str) -> bool:
    match = NUMBERED_RE.search(text)
    if not match:
        return False
    rest = text[match.end():].strip()
    if not rest:
        return False
    head = rest[:90]
    if NUMBERED_NON_QUESTION_RE.search(head):
        return False
    if rest.startswith(("（", "(")):
        return True
    if NUMBERED_SOURCE_RE.search(head):
        return True
    return bool(NUMBERED_STEM_START_RE.search(head))


def candidate_label(text: str, kind: str) -> str:
    clean = compact(text)
    if kind == "training":
        match = NUMBERED_RE.search(clean)
        return match.group(1) if match else "训练"
    match = re.match(r"^【?([^】：:\s]{1,18})", clean)
    if match:
        return match.group(1)
    return clean[:12] or "候选"


def find_candidates(lines: list[TextLine], max_per_file: int = 0) -> list[Candidate]:
    section = ""
    in_training = False
    starts: list[tuple[TextLine, str, str, bool]] = []
    breakpoints: set[int] = set()

    for line in lines:
        text = compact(line.text)
        if is_section(text):
            section = text[:120]
            in_training = is_training_section(text)
            breakpoints.add(line.index)
            continue
        kind = candidate_kind(text, in_training)
        if kind:
            starts.append((line, kind, section, in_training))
            breakpoints.add(line.index)

    candidates: list[Candidate] = []
    sorted_breaks = sorted(breakpoints)
    for start, kind, section, training in starts:
        later = [idx for idx in sorted_breaks if idx > start.index]
        end_index = (later[0] - 1) if later else min(len(lines) - 1, start.index + 80)
        if end_index < start.index:
            continue
        end = lines[end_index]
        label = candidate_label(start.text, kind)
        candidates.append(Candidate(start, end, label, kind, section, training))
        if max_per_file and len(candidates) >= max_per_file:
            break
    return candidates


def bbox_for_page(doc: fitz.Document, candidate: Candidate, page_number: int) -> tuple[float, float, float, float]:
    page = doc[page_number - 1]
    width = page.rect.width
    height = page.rect.height
    if candidate.start.page == candidate.end.page == page_number:
        y0 = max(0.0, candidate.start.y0 - TOP_PADDING)
        y1 = min(height, candidate.end.y1 + BOTTOM_PADDING)
    elif page_number == candidate.start.page:
        y0 = max(0.0, candidate.start.y0 - TOP_PADDING)
        y1 = height - 24.0
    elif page_number == candidate.end.page:
        y0 = 24.0
        y1 = min(height, candidate.end.y1 + BOTTOM_PADDING)
    else:
        y0 = 24.0
        y1 = height - 24.0
    if y1 - y0 < 24.0:
        y1 = min(height, y0 + 24.0)
    return (PAGE_MARGIN_X, y0, width - PAGE_MARGIN_X, y1)


def crop_and_stitch(candidate: Candidate, doc: fitz.Document, page_images: list[Path], output_path: Path) -> tuple[list[dict], dict]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    scale = DPI / 72.0
    crops: list[Image.Image] = []
    segments: list[dict] = []
    for page_number in range(candidate.start.page, candidate.end.page + 1):
        bbox = bbox_for_page(doc, candidate, page_number)
        image = Image.open(page_images[page_number - 1]).convert("RGB")
        left = max(0, int(round(bbox[0] * scale)))
        top = max(0, int(round(bbox[1] * scale)))
        right = min(image.width, int(round(bbox[2] * scale)))
        bottom = min(image.height, int(round(bbox[3] * scale)))
        if right <= left or bottom <= top:
            continue
        crop = image.crop((left, top, right, bottom))
        crops.append(crop)
        segments.append(
            {
                "page_number": page_number,
                "page_image_path": rel(page_images[page_number - 1]),
                "bbox": bbox_to_json(bbox),
            }
        )
    if not crops:
        raise RuntimeError(f"No crops generated for {candidate.label}")
    width = max(crop.width for crop in crops)
    divider = 14 if len(crops) > 1 else 0
    height = sum(crop.height for crop in crops) + divider * (len(crops) - 1)
    stitched = Image.new("RGB", (width, height), "white")
    y = 0
    for index, crop in enumerate(crops):
        stitched.paste(crop, (0, y))
        y += crop.height
        if divider and index < len(crops) - 1:
            y += divider
    stitched.save(output_path, optimize=True)
    return segments, segments[0]["bbox"]


def detect_candidate_figures(document, segments: list[dict], result_prefix: str) -> list[dict]:
    slice_segments: list[SliceSegment] = []
    for segment in segments:
        bbox = segment.get("bbox") or {}
        x = float(bbox.get("x", 0))
        y = float(bbox.get("y", 0))
        width = float(bbox.get("width", 0))
        height = float(bbox.get("height", 0))
        if width <= 0 or height <= 0:
            continue
        slice_segments.append(
            SliceSegment(
                page_number=int(segment.get("page_number") or 1),
                bbox=(x, y, x + width, y + height),
            )
        )
    if not slice_segments:
        return []
    figures = detect_figures(document, SimpleNamespace(segments=slice_segments))
    normalized: list[dict] = []
    for index, figure in enumerate(figures, start=1):
        if is_page_brand_decoration_figure(document, figure):
            continue
        if is_table_as_text_figure(document, figure):
            continue
        if is_tiny_inline_image_figure(document, figure):
            continue
        item = dict(figure)
        item.setdefault("id", f"{result_prefix}_fig_{index}")
        item.setdefault("usage", "stem")
        item.setdefault("category", item["usage"])
        item.setdefault("kind", "image")
        normalized.append(item)
    return normalized


def is_page_brand_decoration_figure(document, figure: dict) -> bool:
    bbox = figure.get("bbox") or {}
    x = float(bbox.get("x", 0))
    y = float(bbox.get("y", 0))
    width = float(bbox.get("width", 0))
    height = float(bbox.get("height", 0))
    if width <= 0 or height <= 0:
        return True
    page_number = int(figure.get("page_number") or 1)
    if 1 <= page_number <= len(document.pages):
        page = document.pages[page_number - 1]
        page_width = max(float(page.width), 1.0)
        page_height = max(float(page.height), 1.0)
    else:
        page_width = 595.0
        page_height = 842.0
    near_page_edge = x <= page_width * 0.04 and width >= page_width * 0.86
    shallow_banner = height <= max(90.0, page_height * 0.11)
    near_top_or_bottom = y <= 90.0 or y + height >= page_height - 90.0
    return near_page_edge and shallow_banner and near_top_or_bottom


def is_table_as_text_figure(document, figure: dict) -> bool:
    bbox = figure.get("bbox") or {}
    x = float(bbox.get("x", 0))
    y = float(bbox.get("y", 0))
    width = float(bbox.get("width", 0))
    height = float(bbox.get("height", 0))
    if width <= 0 or height <= 0:
        return True
    page_number = int(figure.get("page_number") or 1)
    if not (1 <= page_number <= len(document.pages)):
        return False
    page = document.pages[page_number - 1]
    page_width = max(float(page.width), 1.0)
    table_sized = width <= page_width * 0.46 and height <= 150.0
    if not table_sized:
        return False
    context = nearby_figure_text(page, (x, y, x + width, y + height))
    return bool(TABLE_AS_TEXT_CONTEXT_RE.search(context))


def nearby_figure_text(page, bbox: tuple[float, float, float, float]) -> str:
    x0, y0, x1, y1 = bbox
    parts: list[str] = []
    for line in page.text_lines:
        lx0, ly0, lx1, ly1 = line.bbox
        vertical_gap = max(y0 - ly1, ly0 - y1, 0.0)
        horizontal_overlap = min(x1, lx1) - max(x0, lx0)
        near_same_column = horizontal_overlap >= -12.0
        near_body_line = vertical_gap <= 90.0 and (near_same_column or lx0 <= x1 + 120.0 and lx1 >= x0 - 120.0)
        if near_body_line:
            parts.append(line.text)
    return re.sub(r"\s+", "", "".join(parts))


def is_tiny_inline_image_figure(document, figure: dict) -> bool:
    if figure.get("kind") != "image":
        return False
    bbox = figure.get("bbox") or {}
    width = float(bbox.get("width", 0))
    height = float(bbox.get("height", 0))
    if width <= 0 or height <= 0:
        return True
    page_number = int(figure.get("page_number") or 1)
    page_width = 595.0
    if 1 <= page_number <= len(document.pages):
        page_width = max(float(document.pages[page_number - 1].width), 1.0)
    tiny_width = width <= max(48.0, page_width * 0.08)
    tiny_area = width * height <= 1800.0
    return tiny_width and height <= 48.0 and tiny_area


def bbox_to_json(bbox: tuple[float, float, float, float]) -> dict:
    x0, y0, x1, y1 = bbox
    return {
        "x": round(x0, 2),
        "y": round(y0, 2),
        "width": round(x1 - x0, 2),
        "height": round(y1 - y0, 2),
    }


def docx_preview_stats(docx_path: Path) -> dict:
    stats = {"paragraphs": 0, "tables": 0}
    try:
        import zipfile

        with zipfile.ZipFile(docx_path) as archive:
            root = ElementTree.fromstring(archive.read("word/document.xml"))
            for elem in root.iter():
                if elem.tag.endswith("}p"):
                    stats["paragraphs"] += 1
                elif elem.tag.endswith("}tbl"):
                    stats["tables"] += 1
    except Exception:
        pass
    return stats


def insert_run(batch_id: str, run_id: str, docx_path: Path, pdf_path: Path, run_dir: Path, diagnostics: dict, count: int) -> None:
    now = now_iso()
    with sqlite3.connect(SQLITE_PATH) as db:
        db.execute(
            """
            INSERT INTO pdf_slicer_runs (
              run_id, batch_id, upload_mode, paper_title, pdf_name, pdf_path,
              source_file_name, source_file_kind, run_dir, document_diagnostics_json,
              created_at, updated_at, slice_status, slice_error, quick_review_status,
              total_questions, approved_questions, unreviewed_questions, ocr_status,
              ocr_error, ocr_started_at, ocr_finished_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', '', 'pending', ?, 0, ?, 'idle', '', '', '')
            """,
            (
                run_id,
                batch_id,
                diagnostics["lectureRoute"],
                docx_path.stem,
                pdf_path.name,
                rel(pdf_path),
                docx_path.name,
                "docx",
                rel(run_dir),
                json.dumps(diagnostics, ensure_ascii=False),
                now,
                now,
                count,
                count,
            ),
        )


def insert_items(run_id: str, items: list[dict]) -> None:
    now = now_iso()
    with sqlite3.connect(SQLITE_PATH) as db:
        for item in items:
            db.execute(
                """
                INSERT INTO pdf_slicer_review_items (
                  result_id, run_id, question_label, page_start, page_end, page_image_path,
                  auto_image_path, bbox_json, segments_json, text_regions_json,
                  figures_json, review_status, note, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?)
                """,
                (
                    item["resultId"],
                    run_id,
                    item["label"],
                    item["pageStart"],
                    item["pageEnd"],
                    item["pageImagePath"],
                    item["autoImagePath"],
                    json.dumps(item["bbox"], ensure_ascii=False),
                    json.dumps(item["segments"], ensure_ascii=False),
                    json.dumps(item["textRegions"], ensure_ascii=False),
                    json.dumps(item["figures"], ensure_ascii=False),
                    item["note"],
                    now,
                    now,
                ),
            )


def process_docx(batch_id: str, docx_path: Path, max_per_file: int = 0) -> dict:
    if not docx_path.exists():
        raise FileNotFoundError(docx_path)
    run_id = make_id("lecture_trial", docx_path.stem)
    run_dir = RUNS_ROOT / run_id
    output_dir = run_dir / "output"
    pages_dir = output_dir / "pages"
    cuts_dir = output_dir / "lecture_cuts"
    run_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(docx_path, run_dir / docx_path.name)

    formula = analyze_docx_formula_types(docx_path)
    route = "lecture_docx_native_trial" if formula.get("classification") in {"editable_formula", "no_formula_detected"} else "lecture_pdf_ocr_trial"
    pdf_path = convert_docx_to_pdf(docx_path, run_dir)
    document = load_document(pdf_path)
    doc = fitz.open(pdf_path)
    try:
        page_images = render_pages(doc, pages_dir)
        lines = extract_pdf_lines(doc)
        candidates = find_candidates(lines, max_per_file=max_per_file)
        items: list[dict] = []
        manifest: list[dict] = []
        for index, candidate in enumerate(candidates, start=1):
            result_id = f"{run_id}_LECTURE_{index:04d}"
            cut_path = cuts_dir / f"LECTURE_{index:04d}.png"
            segments, bbox = crop_and_stitch(candidate, doc, page_images, cut_path)
            figures = detect_candidate_figures(document, segments, result_id)
            text_regions = [
                {
                    "kind": "problem",
                    "label": "讲义候选",
                    "segments": segments,
                    "start_marker": candidate.start.text,
                    "end_marker": "",
                    "section": candidate.section,
                    "candidate_kind": candidate.kind,
                }
            ]
            item = {
                "resultId": result_id,
                "label": candidate.label,
                "pageStart": candidate.start.page,
                "pageEnd": candidate.end.page,
                "pageImagePath": rel(page_images[candidate.start.page - 1]),
                "autoImagePath": rel(cut_path),
                "bbox": bbox,
                "segments": segments,
                "textRegions": text_regions,
                "figures": figures,
                "note": f"{candidate.kind} · {candidate.section or '未识别章节'} · {candidate.start.text[:160]}",
            }
            items.append(item)
            manifest.append(item)

        figure_count = sum(len(item["figures"]) for item in items)
        diagnostics = {
            "docxFormulaAnalysis": formula,
            "lectureRoute": route,
            "lectureSplit": {
                "strategy": "lecture_marker_trial_v1",
                "candidateCount": len(items),
                "candidateFigureCount": figure_count,
                "candidatesWithFigures": sum(1 for item in items if item["figures"]),
                "pageCount": len(doc),
                "docxStats": docx_preview_stats(docx_path),
                "graphics": summarize_graphic_candidates(document),
                "rules": [
                    "examples_variants_practice_markers",
                    "numbered_questions_inside_training_sections",
                    "figure_detection_from_pdf_graphic_clusters",
                    "knowledge_and_method_sections_as_context_only",
                ],
            },
        }
        (output_dir / "lecture_segments.json").write_text(json.dumps({"results": manifest, "diagnostics": diagnostics}, ensure_ascii=False, indent=2), encoding="utf-8")
        insert_run(batch_id, run_id, docx_path, pdf_path, run_dir, diagnostics, len(items))
        insert_items(run_id, items)
        return {
            "runId": run_id,
            "source": str(docx_path),
            "pdf": rel(pdf_path),
            "route": route,
            "classification": formula.get("classification"),
            "candidateCount": len(items),
            "pages": len(doc),
        }
    finally:
        doc.close()


def main() -> int:
    args = parse_args()
    if not SAMPLES:
        raise SystemExit("No lecture trial samples are configured. Add local DOCX paths before running this private trial script.")
    ensure_schema()
    if args.reset:
        reset_previous_trials()
    batch_id = make_id("lecture_trial_batch")
    now = now_iso()
    with sqlite3.connect(SQLITE_PATH) as db:
        db.execute("INSERT INTO pdf_slicer_batches (id, created_at, uploaded_count) VALUES (?, ?, ?)", (batch_id, now, len(SAMPLES)))
    summaries = [process_docx(batch_id, path, max_per_file=args.max_per_file) for path in SAMPLES]
    print(json.dumps({"batchId": batch_id, "runs": summaries}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
