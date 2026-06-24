#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import fitz
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.ocr.config import load_dotenv
from src.ocr.glm import DEFAULT_BASE_URL, DEFAULT_MODEL, GlmOcrClient, GlmOcrError, GlmOcrSettings, build_drafts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run GLM-OCR and produce OCR drafts")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--solutions-pdf", type=Path)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--drafts-root", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--storage-root", type=Path, required=True)
    parser.add_argument("--single-question", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def build_single_question_pdf(manifest: list[dict], storage_root: Path, target: Path) -> Path:
    if len(manifest) != 1:
        return target
    segments = manifest[0].get("segments") or manifest[0].get("reviewed_segments") or []
    if not segments:
        return target
    document = fitz.open()
    for segment in segments:
        path_value = str(segment.get("page_image_path") or "").replace("question_assets/", "", 1)
        image_path = storage_root / path_value
        bbox = segment.get("bbox") or {}
        if not image_path.exists():
            continue
        with Image.open(image_path) as source:
            sx, sy = source.width / 595.3, source.height / 841.9
            x = float(bbox.get("x", 0)); y = float(bbox.get("y", 0)); w = float(bbox.get("width", 0)); h = float(bbox.get("height", 0))
            crop = source.crop((max(0, round(x * sx)), max(0, round(y * sy)), min(source.width, round((x + w) * sx)), min(source.height, round((y + h) * sy))))
            image_target = target.parent / f"segment_{int(segment.get('page_number') or 0):03d}.jpg"
            crop.convert("RGB").save(image_target, quality=95)
        image_doc = fitz.open(image_target)
        pdf_part = fitz.open("pdf", image_doc.convert_to_pdf())
        document.insert_pdf(pdf_part)
        pdf_part.close(); image_doc.close()
    if not len(document):
        document.close()
        raise GlmOcrError("无法从原始页面生成单题 OCR PDF", code="single_question_pdf_failed")
    document.save(target)
    document.close()
    return target


def main() -> int:
    args = parse_args()
    load_dotenv()
    key = (os.getenv("GLM_OCR_API_KEY") or "").strip()
    if not key:
        print("缺少 GLM_OCR_API_KEY", file=sys.stderr)
        return 2
    manifest = (json.loads(args.manifest.read_text(encoding="utf-8")).get("results") or [])
    state_path = args.artifact_dir / "state.json"
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    state: dict = {}
    if state_path.exists() and not args.force:
        try: state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError: state = {}
    def update(phase: str, progress: int, **extra: object) -> None:
        state.update({"run_id": args.run_id, "phase": phase, "progress": progress, "updated_at": time.time(), **extra})
        atomic_json(state_path, state)
        print(json.dumps({"phase": phase, "progress": progress, **extra}, ensure_ascii=False), flush=True)

    def parse_document(pdf_path: Path, result_path: Path, document: str, start_progress: int, end_progress: int) -> dict:
        if pdf_path.suffix.lower() == ".pdf":
            with fitz.open(pdf_path) as document_pdf:
                if len(document_pdf) > 100:
                    raise GlmOcrError("GLM-OCR 单次最多解析 100 页，请拆分 PDF 或使用单题重新 OCR。", code="too_many_pages")
        if result_path.exists() and not args.force:
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            update("normalizing", end_progress, document=document, result_path=str(result_path))
            return payload
        update("parsing", start_progress, document=document, input_path=str(pdf_path))
        client = GlmOcrClient(GlmOcrSettings(api_key=key, base_url=(os.getenv("GLM_OCR_API_BASE_URL") or DEFAULT_BASE_URL).strip(), model=(os.getenv("GLM_OCR_MODEL") or DEFAULT_MODEL).strip(), max_retries=max(0, int(os.getenv("OCR_MAX_RETRIES") or "2"))))
        payload = client.parse(pdf_path, request_id=f"{document}-{args.run_id[:48]}")
        atomic_json(result_path, payload)
        return payload
    try:
        input_pdf = args.pdf
        if args.single_question:
            input_pdf = build_single_question_pdf(manifest, args.storage_root, args.artifact_dir / "single_question.pdf")
        question_manifest = [record for record in manifest if str(record.get("ocr_record_kind") or "question") != "solution"]
        solution_manifest = [record for record in manifest if str(record.get("ocr_record_kind") or "question") == "solution"]
        question_result_path = args.artifact_dir / "parse.response.json"
        question_payload = parse_document(input_pdf, question_result_path, "question", 5, 85 if not solution_manifest else 45)
        solution_payload = None
        solution_result_path = args.artifact_dir / "solutions.parse.response.json"
        if solution_manifest:
            if not args.solutions_pdf:
                raise GlmOcrError("当前批次包含解析区域，但未提供解析 PDF。", code="missing_solutions_pdf")
            solution_payload = parse_document(args.solutions_pdf, solution_result_path, "solution", 48, 85)
        update("normalizing", 90, result_path=str(question_result_path))
        question_report = build_drafts(result_payload=question_payload, manifest=question_manifest, drafts_root=args.drafts_root, artifact_dir=args.artifact_dir, storage_root=args.storage_root, single_question=args.single_question)
        solution_report = {"total": 0, "successful": 0, "failed": 0, "failures": []}
        if solution_payload is not None:
            solution_report = build_drafts(result_payload=solution_payload, manifest=solution_manifest, drafts_root=args.drafts_root, artifact_dir=args.artifact_dir, storage_root=args.storage_root, document_role="solution")
        report = {"questions": question_report, "solutions": solution_report}
        update("importing", 99, report=report, result_path=str(question_result_path))
        update("succeeded", 100, report=report, result_path=str(question_result_path))
        return 0 if question_report["successful"] == question_report["total"] and solution_report["successful"] == solution_report["total"] else 3
    except (GlmOcrError, OSError, ValueError, json.JSONDecodeError) as exc:
        update("failed", int(state.get("progress") or 0), error=str(exc), error_code=getattr(exc, "code", "runner_error"))
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
