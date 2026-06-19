"""
Review API for the React SPA frontend.
Serves /api/questions endpoints for the OCR review dashboard.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from flask import Blueprint, jsonify, request

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ROOT = Path(os.getenv("QUESTION_PYTHON_DATA_DIR", PROJECT_ROOT))
OUTPUT_DIR = DATA_ROOT / "output"
OCR_DRAFTS_DIR = DATA_ROOT / "ocr_drafts"
REVIEWED_RESULTS_PATH = OUTPUT_DIR / "reviewed_results.json"
CUT_RESULTS_PATH = OUTPUT_DIR / "cut_results.json"

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _load_reviewed() -> list[dict]:
    if not REVIEWED_RESULTS_PATH.exists():
        return []
    return json.loads(REVIEWED_RESULTS_PATH.read_text(encoding="utf-8")).get("results", [])


def _load_cut_map() -> dict[str, dict]:
    if not CUT_RESULTS_PATH.exists():
        return {}
    data = json.loads(CUT_RESULTS_PATH.read_text(encoding="utf-8"))
    return {
        r["id"]: r
        for r in data.get("results", [])
        if isinstance(r, dict) and isinstance(r.get("id"), str)
    }


def _load_ocr_result(qid: str) -> dict | None:
    path = OCR_DRAFTS_DIR / qid / "ocr_result.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _detect_truncation(text: str) -> bool:
    """Heuristic: text ends with partial LaTeX or a symbol suggesting cut-off."""
    if not text:
        return False
    t = text.strip()
    if t.endswith("\\frac") or t.endswith("\\sqrt") or t.endswith("\\left"):
        return True
    if t.endswith("{") or t.endswith("(") or t.endswith("[") and "\\" in t:
        return True
    dollar_count = t.count("$")
    if dollar_count % 2 != 0:
        return True
    return False


def _build_summary(record: dict, ocr: dict | None) -> dict:
    rid = record.get("id", "")
    text_regions = record.get("text_regions") or []
    ocr_pp = (ocr or {}).get("post_processing") or {}
    region_ocr = ocr_pp.get("region_ocr") or ocr_pp.get("supplemental_region_ocr") or {}

    problem_text = (ocr or {}).get("problem_text") or ""
    answer = (ocr or {}).get("answer") or ""
    analysis = (ocr or {}).get("analysis") or ""

    expected_regions = len([r for r in text_regions if isinstance(r, dict) and r.get("segments")])
    actual_regions = len(region_ocr)
    region_mismatch = expected_regions > 0 and actual_regions < expected_regions

    has_answer = bool(answer.strip())
    has_analysis = bool(analysis.strip())
    is_truncated = _detect_truncation(analysis)

    needs_review = not has_answer or is_truncated or region_mismatch

    return {
        "id": rid,
        "source_pdf": record.get("source_pdf", ""),
        "page": record.get("page"),
        "question_no": record.get("question_no", ""),
        "page_span": record.get("page_span", []),
        "problem_text": problem_text,
        "problem_length": len(problem_text),
        "answer": answer,
        "answer_length": len(answer),
        "analysis": analysis,
        "analysis_length": len(analysis),
        "region_count": actual_regions,
        "review_status": ocr.get("ocr_status", "draft") if ocr else "draft",
        "has_answer": has_answer,
        "has_analysis": has_analysis,
        "is_truncated": is_truncated,
        "region_mismatch": region_mismatch,
        "needs_review": needs_review,
    }


@api_bp.route("/questions", methods=["GET"])
def list_questions():
    reviewed = _load_reviewed()
    cut_map = _load_cut_map()
    summaries = []
    for record in reviewed:
        rid = record.get("id", "")
        # Hydrate text_regions from cut results if missing
        if not record.get("text_regions"):
            cr = cut_map.get(rid)
            if cr and "text_regions" in cr:
                record["text_regions"] = cr["text_regions"]
        ocr = _load_ocr_result(rid)
        summaries.append(_build_summary(record, ocr))
    return jsonify({"success": True, "data": summaries})


@api_bp.route("/questions/<qid>", methods=["GET"])
def get_question_detail(qid: str):
    reviewed = _load_reviewed()
    cut_map = _load_cut_map()
    record = next((r for r in reviewed if r.get("id") == qid), None)
    if not record:
        return jsonify({"success": False, "error": "not found"}), 404

    if not record.get("text_regions"):
        cr = cut_map.get(qid)
        if cr and "text_regions" in cr:
            record["text_regions"] = cr["text_regions"]

    ocr = _load_ocr_result(qid) or {}
    pp = ocr.get("post_processing") or {}
    region_ocr = pp.get("region_ocr") or pp.get("supplemental_region_ocr") or {}
    region_count = len(region_ocr)

    return jsonify({
        "success": True,
        "data": {
            "id": qid,
            "source_pdf": record.get("source_pdf", ""),
            "page": record.get("page"),
            "question_no": record.get("question_no", ""),
            "page_span": record.get("page_span", []),
            "problem_text": ocr.get("problem_text", ""),
            "answer": ocr.get("answer", ""),
            "analysis": ocr.get("analysis", ""),
            "review_status": ocr.get("ocr_status", "draft"),
            "reviewed_image_path": record.get("reviewed_image_path", ""),
            "text_regions": record.get("text_regions", []),
            "ocr_status": ocr.get("ocr_status", "draft"),
            "needs_human_review": ocr.get("needs_human_review", True),
            "image_strategy": ocr.get("image_strategy", ""),
            "post_processing": pp,
            "region_count": region_count,
        },
    })


@api_bp.route("/questions/<qid>/verify", methods=["POST"])
def verify_question(qid: str):
    ocr = _load_ocr_result(qid)
    if not ocr:
        return jsonify({"success": False, "error": "no OCR result"}), 404
    ocr["ocr_status"] = "verified"
    path = OCR_DRAFTS_DIR / qid / "ocr_result.json"
    path.write_text(json.dumps(ocr, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"success": True})


@api_bp.route("/questions/<qid>/reject", methods=["POST"])
def reject_question(qid: str):
    ocr = _load_ocr_result(qid)
    if not ocr:
        return jsonify({"success": False, "error": "no OCR result"}), 404
    ocr["ocr_status"] = "rejected"
    path = OCR_DRAFTS_DIR / qid / "ocr_result.json"
    path.write_text(json.dumps(ocr, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"success": True})


@api_bp.route("/questions/<qid>", methods=["PUT"])
def update_question_text(qid: str):
    ocr = _load_ocr_result(qid)
    if not ocr:
        return jsonify({"success": False, "error": "no OCR result"}), 404
    body = request.get_json(silent=True) or {}
    for field in ("problem_text", "answer", "analysis"):
        if field in body:
            ocr[field] = body[field]
    path = OCR_DRAFTS_DIR / qid / "ocr_result.json"
    path.write_text(json.dumps(ocr, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"success": True})
