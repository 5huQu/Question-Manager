from __future__ import annotations

import tempfile
from pathlib import Path

from flask import Blueprint, jsonify, request

from src.ocr.client import call_chat_completions, extract_assistant_text
from src.ocr.config import OCRSettings

from .profiles import get_model_profile, sanitized_profiles, upsert_model_profile, upsert_prompt_profile
from .service import create_run, get_questions, get_run, list_runs, run_cut, run_ocr
from .word import analyze_docx_formula_types

lab_bp = Blueprint("lab_api", __name__, url_prefix="/api/lab")


@lab_bp.route("/model-profiles", methods=["GET", "POST", "PUT"])
def model_profiles():
    if request.method == "GET":
        return jsonify({"success": True, "data": sanitized_profiles().get("model_profiles", [])})
    body = request.get_json(silent=True) or {}
    return jsonify({"success": True, "data": upsert_model_profile(body)})


@lab_bp.route("/model-profiles/test", methods=["POST"])
def test_model_profile():
    body = request.get_json(silent=True) or {}
    profile = get_model_profile(str(body.get("id") or "")) if body.get("id") else body
    if not profile:
        return jsonify({"success": False, "error": "未找到模型配置"}), 404
    try:
        settings = OCRSettings(
            api_base_url=str(profile.get("api_base_url") or ""),
            api_key=str(profile.get("api_key") or body.get("api_key") or ""),
            model=str(profile.get("model") or ""),
            temperature=float(profile.get("temperature", 0.01) or 0.01),
            top_p=float(profile.get("top_p", 0.1) or 0.1),
            top_k=None,
            max_tokens=64,
        )
        result = call_chat_completions(
            settings,
            messages=[
                {"role": "system", "content": "You are a connection test endpoint."},
                {"role": "user", "content": "Reply with OK."},
            ],
            timeout_seconds=30,
        )
        return jsonify({
            "success": True,
            "data": {"ok": True, "sample": extract_assistant_text(result.payload)[:200]},
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@lab_bp.route("/prompt-profiles", methods=["GET", "POST", "PUT"])
def prompt_profiles():
    if request.method == "GET":
        return jsonify({"success": True, "data": sanitized_profiles().get("prompt_profiles", [])})
    body = request.get_json(silent=True) or {}
    return jsonify({"success": True, "data": upsert_prompt_profile(body)})


@lab_bp.route("/runs", methods=["GET", "POST"])
def runs():
    if request.method == "GET":
        return jsonify({"success": True, "data": list_runs()})
    file = request.files.get("file")
    if file is None:
        return jsonify({"success": False, "error": "missing file"}), 400
    try:
        return jsonify({"success": True, "data": create_run(file)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@lab_bp.route("/runs/<run_id>", methods=["GET"])
def run_detail(run_id: str):
    try:
        return jsonify({"success": True, "data": get_run(run_id)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 404


@lab_bp.route("/runs/<run_id>/cut", methods=["POST"])
def cut_run(run_id: str):
    body = request.get_json(silent=True) or {}
    try:
        return jsonify({"success": True, "data": run_cut(run_id, dpi=int(body.get("dpi") or 180))})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@lab_bp.route("/runs/<run_id>/ocr", methods=["POST"])
def ocr_run(run_id: str):
    body = request.get_json(silent=True) or {}
    try:
        return jsonify({
            "success": True,
            "data": run_ocr(
                run_id,
                model_profile_ids=list(body.get("model_profile_ids") or []),
                prompt_profile_id=str(body.get("prompt_profile_id") or "default"),
                max_items=body.get("max_items"),
                resume=bool(body.get("resume")),
            ),
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400


@lab_bp.route("/runs/<run_id>/questions", methods=["GET"])
def questions(run_id: str):
    try:
        return jsonify({"success": True, "data": get_questions(run_id)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 404


@lab_bp.route("/word/analyze", methods=["POST"])
def analyze_word():
    file = request.files.get("file")
    if file is None:
        return jsonify({"success": False, "error": "missing file"}), 400
    suffix = Path(file.filename or "").suffix or ".docx"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        file.save(tmp.name)
        try:
            result = analyze_docx_formula_types(Path(tmp.name))
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
    return jsonify({"success": True, "data": result})
