"""Local review server for PDF question cutter results."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import fitz
from flask import Flask, jsonify, request, send_file, send_from_directory

from src.lab.api import lab_bp
from .review_api import api_bp

app = Flask(__name__, static_folder=None)
app.register_blueprint(api_bp)
app.register_blueprint(lab_bp)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ROOT = Path(os.getenv("QUESTION_PYTHON_DATA_DIR", PROJECT_ROOT))
OUTPUT_DIR = DATA_ROOT / "output"
WEB_DIR = PROJECT_ROOT / "web"
OCR_DRAFTS_DIR = DATA_ROOT / "ocr_drafts"
CUT_RESULTS_PATH = OUTPUT_DIR / "cut_results.json"
REVIEWED_RESULTS_PATH = OUTPUT_DIR / "reviewed_results.json"
REVIEWED_CUTS_DIR = OUTPUT_DIR / "reviewed_cuts"
REGION_PREVIEWS_DIR = OUTPUT_DIR / "region_previews"
DPI = 180

_review_state: dict[str, dict] = {}
_lock = threading.Lock()


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {"results": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _save_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _init_review_state() -> None:
    global _review_state
    with _lock:
        if _review_state:
            return
        cut_data = _load_json(CUT_RESULTS_PATH)
        reviewed_data = _load_json(REVIEWED_RESULTS_PATH)
        reviewed_by_id: dict[str, dict] = {}
        for r in reviewed_data.get("results", []):
            reviewed_by_id[r["id"]] = r

        for item in cut_data.get("results", []):
            rid = item["id"]
            if rid in reviewed_by_id:
                _review_state[rid] = _hydrate_review_entry(reviewed_by_id[rid], item)
            else:
                auto_segments = item.get("segments", [])
                _review_state[rid] = {
                    "id": rid,
                    "source_pdf": item["source_pdf"],
                    "page": item["page"],
                    "page_span": item.get("page_span", [item["page"], item["page"]]),
                    "segments": auto_segments,
                    "figures": item.get("figures", []),
                    "question_no": item["question_no"],
                    "page_image_path": item["page_image_path"],
                    "auto_image_path": item["auto_image_path"],
                    "auto_bbox": item.get("bbox"),
                    "reviewed_bbox": item.get("bbox"),
                    "text_regions": item.get("text_regions", []),
                    "reviewed_segments": [
                        {**seg, "bbox": seg["bbox"]} for seg in auto_segments
                    ],
                    "reviewed_image_path": item["auto_image_path"],
                    "status": "pending_review",
                    "review_flags": item.get("review_flags", []),
                    "note": "",
                }


def _hydrate_review_entry(entry: dict, item: dict) -> dict:
    """Merge current auto-cut metadata into a saved review entry."""
    auto_segments = item.get("segments", [])
    previous_auto_segments = entry.get("segments", [])
    merged = dict(entry)
    merged.update(
        {
            "id": item["id"],
            "source_pdf": item["source_pdf"],
            "page": item["page"],
            "page_span": item.get("page_span", [item["page"], item["page"]]),
            "segments": auto_segments,
            "figures": item.get("figures", []),
            "page_image_path": item["page_image_path"],
            "auto_image_path": item["auto_image_path"],
            "auto_bbox": item.get("bbox"),
            "text_regions": item.get("text_regions", []),
        }
    )

    merged.setdefault("question_no", item.get("question_no"))
    merged.setdefault("reviewed_bbox", item.get("bbox"))
    merged.setdefault("reviewed_image_path", item.get("auto_image_path", ""))
    merged.setdefault("status", "pending_review")
    merged.setdefault("review_flags", item.get("review_flags", []))
    merged.setdefault("note", "")

    reviewed_segments = merged.get("reviewed_segments") or []
    if reviewed_segments:
        merged["reviewed_segments"] = _hydrate_segments(reviewed_segments, auto_segments, previous_auto_segments)
    else:
        merged["reviewed_segments"] = [
            {**seg, "bbox": seg["bbox"]} for seg in auto_segments
        ]
    if merged["reviewed_segments"]:
        merged["reviewed_bbox"] = merged["reviewed_segments"][0].get("bbox")
    return merged


def _hydrate_segments(
    segments: list[dict],
    auto_segments: list[dict],
    previous_auto_segments: list[dict],
) -> list[dict]:
    hydrated: list[dict] = []
    reviewed_by_page = {seg.get("page_number"): seg for seg in segments}
    previous_auto_by_page = {seg.get("page_number"): seg for seg in previous_auto_segments}

    for index, auto_seg in enumerate(auto_segments):
        page_number = auto_seg.get("page_number")
        reviewed_seg = reviewed_by_page.get(page_number)
        if reviewed_seg is None and index < len(segments):
            reviewed_seg = segments[index]

        previous_auto_seg = previous_auto_by_page.get(page_number)
        if previous_auto_seg is None and index < len(previous_auto_segments):
            previous_auto_seg = previous_auto_segments[index]

        bbox = auto_seg.get("bbox")
        if reviewed_seg is not None:
            reviewed_bbox = reviewed_seg.get("bbox")
            previous_auto_bbox = previous_auto_seg.get("bbox") if previous_auto_seg else None
            if reviewed_bbox and not _bbox_dict_equal(reviewed_bbox, previous_auto_bbox):
                bbox = reviewed_bbox

        hydrated.append({**auto_seg, "bbox": bbox})
    return hydrated


def _bbox_dict_equal(left: dict | None, right: dict | None, tolerance: float = 0.01) -> bool:
    if not left or not right:
        return False
    keys = ("x", "y", "width", "height")
    return all(abs(float(left.get(key, 0.0)) - float(right.get(key, 0.0))) <= tolerance for key in keys)


# ── Page image path helper ──────────────────────────────────

def _page_image_path(source_pdf: str, page_num: int) -> str:
    """Construct page image path for a given page number."""
    stem = Path(source_pdf).stem
    safe = ""
    for ch in stem:
        if ch.isalnum() or ch in ".-_":
            safe += ch
        else:
            safe += "_"
    safe = safe.strip("_") or "pdf"
    return f"output/pages/{safe}_page_{page_num:03d}.png"


# ── API routes ──────────────────────────────────────────────


@app.route("/api/results", methods=["GET"])
def list_results():
    _init_review_state()
    items = list(_review_state.values())
    items.sort(key=lambda r: r["id"])
    return jsonify(items)


@app.route("/api/results/<cut_id>", methods=["GET"])
def get_result(cut_id: str):
    _init_review_state()
    if cut_id not in _review_state:
        return jsonify({"error": "not found"}), 404
    return jsonify(_review_state[cut_id])


@app.route("/api/results/<cut_id>", methods=["POST"])
def update_result(cut_id: str):
    _init_review_state()
    if cut_id not in _review_state:
        return jsonify({"error": "not found"}), 404

    body = request.get_json(silent=True) or {}

    with _lock:
        entry = _review_state[cut_id]

        if "question_no" in body:
            entry["question_no"] = body["question_no"]
        if "status" in body:
            entry["status"] = body["status"]
        if "note" in body:
            entry["note"] = body["note"]

        # Single bbox (backward compat / quick adjust on first page)
        if "reviewed_bbox" in body:
            b = body["reviewed_bbox"]
            if b is None:
                entry["reviewed_bbox"] = entry["auto_bbox"]
            else:
                entry["reviewed_bbox"] = b
                # Also update the first segment
                if entry.get("reviewed_segments"):
                    entry["reviewed_segments"][0]["bbox"] = b

        # Per-page reviewed segments
        if "reviewed_segments" in body:
            entry["reviewed_segments"] = body["reviewed_segments"]

        # Determine if we need to re-crop
        rv_segs = entry.get("reviewed_segments")
        if rv_segs and all(
            seg.get("bbox") and all(v is not None for v in seg["bbox"].values())
            for seg in rv_segs
        ):
            entry["reviewed_image_path"] = _recrop(cut_id, rv_segs)
            if entry["status"] == "pending_review":
                entry["status"] = "ready_for_ocr"

        all_entries = list(_review_state.values())
        all_entries.sort(key=lambda r: r["id"])
        _save_json(REVIEWED_RESULTS_PATH, {"results": all_entries})

    return jsonify(_review_state[cut_id])


@app.route("/api/results/<cut_id>/reset-bbox", methods=["POST"])
def reset_bbox(cut_id: str):
    _init_review_state()
    if cut_id not in _review_state:
        return jsonify({"error": "not found"}), 404

    entry = _review_state[cut_id]
    auto_segs = entry.get("segments", [])
    with _lock:
        entry["reviewed_bbox"] = entry["auto_bbox"]
        entry["reviewed_segments"] = [
            {**seg, "bbox": seg["bbox"]} for seg in auto_segs
        ]
        entry["reviewed_image_path"] = entry["auto_image_path"]
    return jsonify(_review_state[cut_id])


@app.route("/api/results/<cut_id>/text", methods=["GET"])
def get_question_text(cut_id: str):
    """Extract full text for a question from the PDF text layer."""
    _init_review_state()
    if cut_id not in _review_state:
        return jsonify({"error": "not found"}), 404

    entry = _review_state[cut_id]
    segs = entry.get("reviewed_segments") or entry.get("segments") or []
    source_pdf = entry.get("source_pdf", "")
    pdf_path = _find_source_pdf(source_pdf)
    if not pdf_path:
        return jsonify({"error": "source pdf not found", "text": ""}), 404

    try:
        texts: list[str] = []
        with fitz.open(pdf_path) as doc:
            for seg in segs:
                bbox = seg.get("bbox", {})
                page_num = seg.get("page_number", 1)
                page = doc[page_num - 1]

                # Extract text blocks within the bbox region
                blocks = page.get_text("dict", sort=True).get("blocks", [])
                for block in blocks:
                    if block.get("type") != 0:
                        continue
                    block_bbox = block.get("bbox", (0, 0, 0, 0))
                    if not _rects_overlap(bbox, block_bbox):
                        continue
                    for line in block.get("lines", []):
                        line_text = "".join(
                            span.get("text", "") for span in line.get("spans", [])
                        ).strip()
                        if line_text:
                            texts.append(line_text)

        full_text = "\n".join(texts)
        return jsonify({
            "cut_id": cut_id,
            "text": full_text,
            "text_excerpt": entry.get("note", "")[:280],
        })
    except Exception as exc:
        return jsonify({"error": str(exc), "text": ""}), 500


@app.route("/api/results/<cut_id>/region-preview/<region_kind>", methods=["GET"])
def get_region_preview(cut_id: str, region_kind: str):
    _init_review_state()
    entry = _review_state.get(cut_id)
    if not entry:
        return jsonify({"error": "not found"}), 404

    region = next((item for item in entry.get("text_regions", []) if item.get("kind") == region_kind), None)
    if not region:
        return jsonify({"error": "region not found"}), 404

    preview_path = _render_region_preview(cut_id, region_kind, region.get("segments", []), entry.get("source_pdf", ""))
    if not preview_path or not preview_path.exists():
        return jsonify({"error": "preview render failed"}), 500
    return send_file(preview_path)


def _rects_overlap(bbox: dict, target: tuple) -> bool:
    """Check if a bbox dict overlaps with a target rect tuple."""
    x, y, w, h = bbox.get("x", 0), bbox.get("y", 0), bbox.get("width", 0), bbox.get("height", 0)
    tx0, ty0, tx1, ty1 = target
    return not (x + w < tx0 or tx1 < x or y + h < ty0 or ty1 < y)


@app.route("/api/summary", methods=["GET"])
def get_summary():
    _init_review_state()
    items = list(_review_state.values())
    status_counts: dict[str, int] = {}
    for item in items:
        s = item.get("status", "pending_review")
        status_counts[s] = status_counts.get(s, 0) + 1
    return jsonify({"total": len(items), "status_counts": status_counts})


# ── Static file serving ─────────────────────────────────────


@app.route("/output/<path:filename>")
def serve_output(filename: str):
    return send_from_directory(OUTPUT_DIR, filename)


@app.route("/")
def serve_index():
    return send_from_directory(WEB_DIR, "index.html")


@app.route("/<path:filename>")
def serve_web(filename: str):
    return send_from_directory(WEB_DIR, filename)


# ── Re-crop helper ──────────────────────────────────────────


def _find_source_pdf(pdf_name: str) -> Path | None:
    candidates = [PROJECT_ROOT / "input" / "pdfs" / pdf_name]
    for p in (PROJECT_ROOT / "input" / "pdfs").rglob("*.pdf"):
        if p.name == pdf_name:
            candidates.append(p)
            break
    for c in candidates:
        if c.exists():
            return c
    return None


def _render_region_preview(cut_id: str, region_kind: str, region_segments: list[dict], source_pdf: str) -> Path | None:
    if not region_segments:
        return None
    pdf_path = _find_source_pdf(source_pdf)
    if not pdf_path:
        return None

    REGION_PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REGION_PREVIEWS_DIR / f"{cut_id}__{region_kind}.png"
    rendered = _render_segments_to_path(pdf_path, region_segments, out_path)
    return out_path if rendered else None


def _recrop(cut_id: str, reviewed_segments: list[dict]) -> str:
    """Re-crop from source PDF using reviewed_segments (per-page bboxes).
    Multi-page questions are stitched vertically. Returns relative path."""
    entry = _review_state.get(cut_id)
    if not entry or not reviewed_segments:
        return entry.get("auto_image_path", "") if entry else ""

    source_pdf = entry.get("source_pdf", "")
    pdf_path = _find_source_pdf(source_pdf)
    if not pdf_path:
        return entry.get("auto_image_path", "")

    safe_id = cut_id.replace("/", "_").replace("\\", "_")
    out_name = f"{safe_id}.png"
    out_path = REVIEWED_CUTS_DIR / out_name
    REVIEWED_CUTS_DIR.mkdir(parents=True, exist_ok=True)

    if not _render_segments_to_path(pdf_path, reviewed_segments, out_path):
        return entry.get("auto_image_path", "")

    rel = str(out_path.relative_to(PROJECT_ROOT)).replace("\\", "/")
    return rel


def _render_segments_to_path(pdf_path: Path, segments: list[dict], out_path: Path) -> bool:
    try:
        zoom = DPI / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        with fitz.open(pdf_path) as doc:
            pixmaps = []
            for seg in segments:
                bbox = seg["bbox"]
                page_num = seg.get("page_number", 1)
                page = doc[page_num - 1]
                clip = fitz.Rect(
                    bbox["x"], bbox["y"],
                    bbox["x"] + bbox["width"],
                    bbox["y"] + bbox["height"],
                )
                expanded = fitz.Rect(
                    max(0, clip.x0 - 4),
                    max(0, clip.y0 - 4),
                    min(page.rect.width, clip.x1 + 4),
                    min(page.rect.height, clip.y1 + 4),
                )
                pixmaps.append(page.get_pixmap(matrix=matrix, clip=expanded, alpha=False))

            if len(pixmaps) == 1:
                pixmaps[0].save(out_path)
            else:
                _stitch_pixmaps(pixmaps).save(out_path)
        return True
    except Exception:
        return False


def _stitch_pixmaps(pixmaps: list[fitz.Pixmap]) -> fitz.Pixmap:
    width = max(p.width for p in pixmaps)
    height = sum(p.height for p in pixmaps)
    temp_doc = fitz.open()
    page = temp_doc.new_page(width=width, height=height)
    cursor_y = 0.0
    for p in pixmaps:
        page.insert_image(
            fitz.Rect(0.0, cursor_y, p.width, cursor_y + p.height), pixmap=p
        )
        cursor_y += p.height
    stitched = page.get_pixmap(alpha=False)
    temp_doc.close()
    return stitched


def run(host: str = "127.0.0.1", port: int = 8000) -> None:
    print(f"切题审核服务启动: http://{host}:{port}")
    app.run(host=host, port=port, debug=False)
