from __future__ import annotations

import json
import shutil
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from src.cutter.crop_questions import crop_question_images, detect_figures, infer_question_slices, render_page_images
from src.cutter.detect_questions import detect_question_anchors
from src.cutter.export_results import build_cut_results, build_run_summary, write_cut_results
from src.cutter.render_pdf import extract_answer_summaries, load_document
from src.ocr.client import call_chat_completions, extract_assistant_text, extract_json_object, image_to_data_url
from src.ocr.config import OCRSettings
from src.ocr.latex_cleanup import normalize_model_output_fields
from src.ocr.runner import build_result_json, render_question_markdown

from .profiles import get_model_profile, get_prompt_profile

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
EXPERIMENTS_DIR = PROJECT_ROOT / "output" / "experiments"
MANIFEST_FIELDS = [
    "id",
    "source_pdf",
    "page",
    "page_span",
    "question_no",
    "reviewed_image_path",
    "auto_image_path",
    "reviewed_bbox",
    "auto_bbox",
    "reviewed_segments",
    "text_regions",
    "figures",
    "status",
    "note",
]


def create_run(file: FileStorage) -> dict[str, Any]:
    original_filename = file.filename or "upload.pdf"
    if Path(original_filename).suffix.lower() != ".pdf":
        raise ValueError("请上传 PDF 文件。")
    filename = _safe_upload_filename(original_filename)

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
    run_dir = _run_dir(run_id)
    input_dir = run_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    saved_path = input_dir / filename
    file.save(saved_path)

    meta = {
        "id": run_id,
        "status": "uploaded",
        "filename": filename,
        "created_at": _now(),
        "updated_at": _now(),
        "error": "",
        "summary": {},
        "ocr_runs": [],
    }
    _write_meta(run_id, meta)
    return meta


def _safe_upload_filename(original_filename: str) -> str:
    secured = secure_filename(original_filename or "")
    if secured and Path(secured).suffix.lower() == ".pdf":
        return secured
    stem = Path(secured).stem if secured else ""
    stem = stem if stem and stem.lower() != "pdf" else "upload"
    return f"{stem}.pdf"


def list_runs() -> list[dict[str, Any]]:
    if not EXPERIMENTS_DIR.exists():
        return []
    runs = []
    for meta_path in EXPERIMENTS_DIR.glob("*/metadata.json"):
        try:
            runs.append(_enrich_meta(json.loads(meta_path.read_text(encoding="utf-8")), meta_path.parent))
        except json.JSONDecodeError:
            continue
    runs.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return runs


def get_run(run_id: str) -> dict[str, Any]:
    meta = _read_meta(run_id)
    meta = _enrich_meta(meta, _run_dir(run_id))
    meta["question_count"] = len(_load_json(_run_dir(run_id) / "cut_results.json").get("results", []))
    return meta


def run_cut(run_id: str, dpi: int = 180) -> dict[str, Any]:
    meta = _read_meta(run_id)
    _update_meta(run_id, {"status": "cutting", "error": ""})
    run_dir = _run_dir(run_id)
    input_dir = run_dir / "input"
    pages_dir = run_dir / "pages"
    auto_cuts_dir = run_dir / "auto_cuts"
    (run_dir / "reviewed_cuts").mkdir(parents=True, exist_ok=True)
    pages_dir.mkdir(parents=True, exist_ok=True)
    auto_cuts_dir.mkdir(parents=True, exist_ok=True)

    try:
        pdf_paths = sorted(path for path in input_dir.rglob("*.pdf") if path.is_file())
        if not pdf_paths:
            raise RuntimeError("实验目录中没有 PDF 文件。")

        all_slices: list[Any] = []
        total_pages = 0
        failed_pdfs: list[dict[str, Any]] = []
        page_image_map: dict[str, list[Path]] = {}

        for pdf_path in pdf_paths:
            try:
                document = load_document(pdf_path)
                if not any(page.has_text for page in document.pages):
                    failed_pdfs.append({"pdf_name": pdf_path.name, "reason": "PDF 无可用文字层。"})
                    continue
                page_paths = render_page_images(document, pages_dir, dpi=dpi)
                page_image_map[str(document.source_pdf)] = page_paths
                total_pages += len(page_paths)
                answer_summaries = extract_answer_summaries(document)
                anchors = detect_question_anchors(document)
                slices = infer_question_slices(document, anchors)
                for item in slices:
                    item.answer_summary = answer_summaries.get(item.question_id)
                    item.figures = detect_figures(document, item)
                all_slices.extend(crop_question_images(slices, auto_cuts_dir, dpi=dpi))
            except Exception as exc:
                failed_pdfs.append({"pdf_name": pdf_path.name, "reason": str(exc)})

        cut_results = build_cut_results(all_slices, page_image_map)
        write_cut_results(cut_results, run_dir / "cut_results.json")
        reviewed = _build_reviewed_results([_cut_result_to_dict(item) for item in cut_results])
        _write_json(run_dir / "reviewed_results.json", {"results": reviewed})
        manifest = _build_manifest(reviewed)
        _write_json(run_dir / "ocr_manifest.json", {"results": manifest})
        summary = build_run_summary(
            pdf_count=len(pdf_paths),
            page_count=total_pages,
            cut_count=len(cut_results),
            failed_pdfs=failed_pdfs,
            output_paths={"pages": pages_dir, "auto_cuts": auto_cuts_dir, "cut_results": run_dir / "cut_results.json"},
        )
        meta.update({"status": "cut_ready", "summary": summary, "updated_at": _now(), "error": ""})
        _write_meta(run_id, meta)
        return get_run(run_id)
    except Exception as exc:
        _update_meta(run_id, {"status": "failed", "error": str(exc)})
        raise


def run_ocr(
    run_id: str,
    model_profile_ids: list[str],
    prompt_profile_id: str,
    max_items: int | None = None,
    resume: bool = False,
) -> dict[str, Any]:
    meta = _read_meta(run_id)
    run_dir = _run_dir(run_id)
    prompt = get_prompt_profile(prompt_profile_id)
    if not prompt:
        raise ValueError("未找到提示词配置。")
    profiles = [get_model_profile(profile_id) for profile_id in model_profile_ids]
    profiles = [profile for profile in profiles if profile]
    if not profiles:
        raise ValueError("请至少选择一个模型配置。")

    manifest = _load_json(run_dir / "ocr_manifest.json").get("results", [])
    if not manifest:
        raise ValueError("当前 run 没有可 OCR 的题目。")

    jobs = []
    for profile in profiles:
        selected = _select_manifest_for_profile(
            run_dir=run_dir,
            meta=meta,
            model_profile_id=str(profile.get("id", "")),
            manifest=manifest,
            max_items=max_items,
            resume=resume,
        )
        if selected:
            jobs.append((profile, selected))
    if not jobs:
        raise ValueError("没有可续跑的题目：所选模型在当前 run 下已经都有结果。")

    _update_meta(run_id, {"status": "ocr_running", "error": ""})
    run_records: list[dict[str, Any]] = []
    try:
        with ThreadPoolExecutor(max_workers=len(profiles)) as executor:
            futures = {
                executor.submit(_run_one_model, run_id, profile, prompt, selected, resume): profile
                for profile, selected in jobs
            }
            for future in as_completed(futures):
                run_records.append(future.result())

        existing = list(meta.get("ocr_runs", []))
        existing.extend(run_records)
        _update_meta(run_id, {"status": "completed", "ocr_runs": existing})
        return get_run(run_id)
    except Exception as exc:
        _update_meta(run_id, {"status": "failed", "error": str(exc)})
        raise


def get_questions(run_id: str) -> list[dict[str, Any]]:
    run_dir = _run_dir(run_id)
    reviewed = _load_json(run_dir / "reviewed_results.json").get("results", [])
    meta = _read_meta(run_id)
    ocr_runs = meta.get("ocr_runs", [])
    questions: list[dict[str, Any]] = []
    for record in reviewed:
        qid = record.get("id", "")
        model_results = []
        for ocr_run in ocr_runs:
            result_path = run_dir / "ocr_runs" / ocr_run["id"] / qid / "ocr_result.json"
            result = _load_json(result_path) if result_path.exists() else {}
            model_results.append({
                "run_id": ocr_run["id"],
                "model_profile_id": ocr_run.get("model_profile_id", ""),
                "model_name": ocr_run.get("model_name", ""),
                "status": result.get("ocr_status", "missing") if result else "missing",
                "problem_text": result.get("problem_text", ""),
                "answer": result.get("answer", ""),
                "analysis": result.get("analysis", ""),
                "markdown_text": _read_markdown_text(run_dir, ocr_run["id"], qid),
                "error_reason": (
                    result.get("post_processing", {}).get("error_reason", "")
                    if result
                    else "未执行 OCR：未被本次最大题数选中，或结果文件不存在。"
                ),
                "elapsed_seconds": result.get("post_processing", {}).get("elapsed_seconds", 0),
            })
        questions.append({
            "id": qid,
            "question_no": record.get("question_no", ""),
            "page": record.get("page"),
            "source_pdf": record.get("source_pdf", ""),
            "reviewed_image_path": record.get("reviewed_image_path", ""),
            "model_results": model_results,
        })
    return questions


def _run_one_model(
    run_id: str,
    profile: dict[str, Any],
    prompt: dict[str, Any],
    manifest: list[dict[str, Any]],
    resume: bool = False,
) -> dict[str, Any]:
    start = time.perf_counter()
    model_run_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{profile['id']}"
    out_dir = _run_dir(run_id) / "ocr_runs" / model_run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    settings = OCRSettings(
        api_base_url=profile.get("api_base_url", ""),
        api_key=profile.get("api_key", ""),
        model=profile.get("model", ""),
        max_items=len(manifest),
        temperature=float(profile.get("temperature", 0.01)),
        top_p=float(profile.get("top_p", 0.1)),
        top_k=None,
        concurrency=1,
        max_tokens=profile.get("max_tokens", 8192),
    )

    results = []
    for record in manifest:
        results.append(_ocr_record(record, settings, prompt, out_dir / record["id"]))
    report = {
        "id": model_run_id,
        "model_profile_id": profile["id"],
        "model_name": profile.get("name") or profile.get("model", ""),
        "prompt_profile_id": prompt["id"],
        "created_at": _now(),
        "total": len(results),
        "succeeded": sum(1 for item in results if item.get("ocr_status") == "draft"),
        "failed": sum(1 for item in results if item.get("ocr_status") == "failed"),
        "elapsed_seconds": round(time.perf_counter() - start, 3),
        "resume": resume,
        "question_ids": [record.get("id", "") for record in manifest],
    }
    _write_json(out_dir / "ocr_run.json", report)
    return report


def _ocr_record(record: dict[str, Any], settings: OCRSettings, prompt: dict[str, Any], draft_dir: Path) -> dict[str, Any]:
    draft_dir.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    source = PROJECT_ROOT / (record.get("reviewed_image_path") or "")
    raw_text = ""
    post_processing: dict[str, Any] = {
        "lab_runner": True,
        "prompt_profile_id": prompt.get("id", ""),
        "model": settings.model,
    }
    try:
        if not settings.api_base_url or not settings.api_key or not settings.model:
            raise RuntimeError("模型配置缺少 api_base_url、api_key 或 model。")
        if not source.exists():
            raise RuntimeError(f"题图不存在: {record.get('reviewed_image_path', '')}")
        shutil.copy2(source, draft_dir / "source.png")
        messages = [
            {"role": "system", "content": prompt.get("whole_system_prompt", "")},
            {"role": "user", "content": [
                {"type": "text", "text": prompt.get("whole_user_prompt", "")},
                {"type": "image_url", "image_url": {"url": image_to_data_url(source), "detail": "high"}},
            ]},
        ]
        api_result = call_chat_completions(settings, messages=messages)
        assistant_text = extract_assistant_text(api_result.payload)
        raw_text = assistant_text or api_result.raw_text
        parsed = extract_json_object(raw_text)
        normalized, cleanup = normalize_model_output_fields(parsed)
        post_processing.update(cleanup)
        post_processing["elapsed_seconds"] = round(time.perf_counter() - start, 3)
        result = build_result_json(
            manifest_record=record,
            model_output=normalized,
            raw_model_output=raw_text,
            ocr_status="draft",
            image_strategy="lab_whole_question_image",
            input_images=[record.get("reviewed_image_path", "")],
            post_processing=post_processing,
        )
    except Exception as exc:
        post_processing["error_reason"] = str(exc)
        post_processing["elapsed_seconds"] = round(time.perf_counter() - start, 3)
        result = build_result_json(
            manifest_record=record,
            model_output={},
            raw_model_output=raw_text,
            ocr_status="failed",
            image_strategy="lab_whole_question_image",
            input_images=[record.get("reviewed_image_path", "")],
            post_processing=post_processing,
        )
    _write_json(draft_dir / "ocr_result.json", result)
    (draft_dir / "raw_response.txt").write_text(raw_text, encoding="utf-8")
    (draft_dir / "question.md").write_text(render_question_markdown(result), encoding="utf-8")
    return result


def _select_manifest_for_profile(
    *,
    run_dir: Path,
    meta: dict[str, Any],
    model_profile_id: str,
    manifest: list[dict[str, Any]],
    max_items: int | None,
    resume: bool,
) -> list[dict[str, Any]]:
    records = manifest
    if resume:
        executed = _executed_question_ids_for_model(run_dir, meta, model_profile_id)
        records = [record for record in manifest if record.get("id") not in executed]
    if max_items is not None and max_items > 0:
        records = records[:max_items]
    return records


def _executed_question_ids_for_model(run_dir: Path, meta: dict[str, Any], model_profile_id: str) -> set[str]:
    executed: set[str] = set()
    for ocr_run in meta.get("ocr_runs", []):
        if ocr_run.get("model_profile_id") != model_profile_id:
            continue
        run_id = str(ocr_run.get("id", ""))
        if not run_id:
            continue
        for result_path in (run_dir / "ocr_runs" / run_id).glob("CUT_*/ocr_result.json"):
            executed.add(result_path.parent.name)
    return executed


def _read_markdown_text(run_dir: Path, ocr_run_id: str, question_id: str) -> str:
    md_path = run_dir / "ocr_runs" / ocr_run_id / question_id / "question.md"
    if not md_path.exists():
        return ""
    return md_path.read_text(encoding="utf-8")


def _build_reviewed_results(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    reviewed = []
    for record in records:
        item = dict(record)
        item["auto_bbox"] = record.get("bbox")
        item["reviewed_bbox"] = record.get("bbox")
        item["reviewed_image_path"] = record.get("auto_image_path", "")
        item["reviewed_segments"] = record.get("segments", [])
        item["status"] = "ready_for_ocr"
        reviewed.append(item)
    return reviewed


def _build_manifest(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    manifest = []
    for record in records:
        if record.get("status") != "ready_for_ocr":
            continue
        if not record.get("reviewed_image_path"):
            continue
        manifest.append({field: record[field] for field in MANIFEST_FIELDS if field in record})
    return manifest


def _cut_result_to_dict(result: Any) -> dict[str, Any]:
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


def _run_dir(run_id: str) -> Path:
    return EXPERIMENTS_DIR / run_id


def _meta_path(run_id: str) -> Path:
    return _run_dir(run_id) / "metadata.json"


def _read_meta(run_id: str) -> dict[str, Any]:
    path = _meta_path(run_id)
    if not path.exists():
        raise FileNotFoundError("未找到实验 run。")
    return json.loads(path.read_text(encoding="utf-8"))


def _write_meta(run_id: str, meta: dict[str, Any]) -> None:
    _write_json(_meta_path(run_id), meta)


def _update_meta(run_id: str, updates: dict[str, Any]) -> None:
    meta = _read_meta(run_id)
    meta.update(updates)
    meta["updated_at"] = _now()
    _write_meta(run_id, meta)


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _enrich_meta(meta: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    enriched = dict(meta)
    ocr_runs = []
    for ocr_run in enriched.get("ocr_runs", []):
        item = dict(ocr_run)
        if item.get("elapsed_seconds") is None:
            item["elapsed_seconds"] = _estimate_ocr_run_elapsed(run_dir, str(item.get("id", "")))
        ocr_runs.append(item)
    enriched["ocr_runs"] = ocr_runs
    return enriched


def _estimate_ocr_run_elapsed(run_dir: Path, ocr_run_id: str) -> float:
    total = 0.0
    if not ocr_run_id:
        return total
    for result_path in (run_dir / "ocr_runs" / ocr_run_id).glob("CUT_*/ocr_result.json"):
        result = _load_json(result_path)
        try:
            total += float((result.get("post_processing") or {}).get("elapsed_seconds") or 0)
        except (TypeError, ValueError):
            continue
    return round(total, 3)
