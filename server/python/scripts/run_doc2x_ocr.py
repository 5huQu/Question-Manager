#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.ocr.config import load_dotenv
from src.ocr.doc2x import Doc2xClient, Doc2xError, Doc2xSettings, build_drafts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run whole-PDF Doc2X OCR and produce existing OCR drafts")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--solutions-pdf", type=Path)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--drafts-root", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--storage-root", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def main() -> int:
    args = parse_args()
    load_dotenv()
    api_key = (os.getenv("DOC2X_API_KEY") or "").strip()
    if not api_key:
        print("缺少 DOC2X_API_KEY", file=sys.stderr)
        return 2
    settings = Doc2xSettings(
        api_key=api_key,
        base_url=(os.getenv("DOC2X_API_BASE_URL") or "https://v2.doc2x.noedgeai.com").strip(),
        model=(os.getenv("DOC2X_MODEL") or "v3-2026").strip(),
        poll_seconds=max(1.0, float(os.getenv("DOC2X_POLL_SECONDS") or "3")),
        max_retries=max(0, int(os.getenv("OCR_MAX_RETRIES") or "3")),
    )
    client = Doc2xClient(settings)
    state_path = args.artifact_dir / "state.json"
    state = {}
    if state_path.exists() and not args.force:
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            state = {}
    if args.force:
        state = {}

    def update(phase: str, progress: int, **extra: object) -> None:
        state.update({"run_id": args.run_id, "phase": phase, "progress": progress, "updated_at": time.time(), **extra})
        atomic_json(state_path, state)
        print(json.dumps({"phase": phase, "progress": progress, **extra}, ensure_ascii=False), flush=True)

    def parse_document(pdf_path: Path, result_path: Path, document: str, start_progress: int, end_progress: int) -> dict:
        if result_path.exists() and not args.force:
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            update("normalizing", end_progress, document=document, result_path=str(result_path))
            return payload
        document_state = state if document == "question" else state.setdefault(f"{document}_document", {})
        uid = str(document_state.get("uid") or "")
        uploaded = bool(document_state.get("uploaded"))
        if not uid or not uploaded:
            update("preupload", start_progress, document=document)
            upload = client.preupload()
            uid = upload["uid"]
            document_state.update({"uid": uid, "uploaded": False})
            update("uploading", start_progress + 2, document=document, uid=uid, uploaded=False)
            client.upload(upload["url"], pdf_path)
            document_state["uploaded"] = True
            update("parsing", start_progress + 4, document=document, uid=uid, uploaded=True)
        while True:
            payload = client.status(uid)
            data = payload.get("data") or {}
            status = str(data.get("status") or "")
            remote_progress = int(data.get("progress") or 0)
            mapped_progress = min(end_progress, start_progress + 4 + round(remote_progress * (end_progress - start_progress - 4) / 100))
            update("parsing", mapped_progress, document=document, uid=uid, uploaded=True, remote_status=status)
            if status == "success":
                args.artifact_dir.mkdir(parents=True, exist_ok=True)
                atomic_json(result_path, payload)
                return payload
            if status == "failed":
                raise Doc2xError(f"Doc2X {document}文档解析失败：{data.get('detail') or '未知错误'}", code="parse_failed")
            time.sleep(settings.poll_seconds)

    try:
        manifest_payload = json.loads(args.manifest.read_text(encoding="utf-8"))
        manifest = manifest_payload.get("results") or []
        question_manifest = [record for record in manifest if str(record.get("ocr_record_kind") or "question") != "solution"]
        solution_manifest = [record for record in manifest if str(record.get("ocr_record_kind") or "question") == "solution"]
        question_result_path = args.artifact_dir / "parse.status.json"
        question_payload = parse_document(args.pdf, question_result_path, "question", 1, 90 if not solution_manifest else 46)
        solution_payload = None
        solution_result_path = args.artifact_dir / "solutions.parse.status.json"
        if solution_manifest:
            if not args.solutions_pdf:
                raise Doc2xError("当前批次包含解析区域，但未提供解析 PDF。", code="missing_solutions_pdf")
            solution_payload = parse_document(args.solutions_pdf, solution_result_path, "solution", 48, 90)

        update("downloading_assets", 93, result_path=str(question_result_path))
        question_report = build_drafts(
            result_payload=question_payload,
            manifest=question_manifest,
            drafts_root=args.drafts_root,
            artifact_dir=args.artifact_dir,
            storage_root=args.storage_root,
            download_asset=client.download_asset,
        )
        solution_report = {"total": 0, "successful": 0, "failed": 0, "failures": []}
        if solution_payload is not None:
            solution_report = build_drafts(
                result_payload=solution_payload,
                manifest=solution_manifest,
                drafts_root=args.drafts_root,
                artifact_dir=args.artifact_dir,
                storage_root=args.storage_root,
                download_asset=client.download_asset,
                document_role="solution",
            )
        report = {"questions": question_report, "solutions": solution_report}
        update("importing", 99, uid=state.get("uid", ""), result_path=str(question_result_path), report=report)
        update("succeeded", 100, uid=state.get("uid", ""), result_path=str(question_result_path), report=report)
        return 0 if question_report["successful"] == question_report["total"] and solution_report["successful"] == solution_report["total"] else 3
    except (Doc2xError, OSError, ValueError, json.JSONDecodeError) as exc:
        code = exc.code if isinstance(exc, Doc2xError) else "runner_error"
        update("failed", int(state.get("progress") or 0), error=str(exc), error_code=code)
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
