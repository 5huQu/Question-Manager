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

    try:
        result_path = args.artifact_dir / "parse.status.json"
        payload = None
        if result_path.exists() and not args.force:
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            update("normalizing", 92, uid=state.get("uid", ""), result_path=str(result_path))
        else:
            uid = str(state.get("uid") or "")
            uploaded = bool(state.get("uploaded"))
            if not uid or not uploaded:
                update("preupload", 1)
                upload = client.preupload()
                uid = upload["uid"]
                update("uploading", 3, uid=uid, uploaded=False)
                client.upload(upload["url"], args.pdf)
                update("parsing", 5, uid=uid, uploaded=True)
            while True:
                payload = client.status(uid)
                data = payload.get("data") or {}
                status = str(data.get("status") or "")
                remote_progress = int(data.get("progress") or 0)
                mapped_progress = min(90, 5 + round(remote_progress * 0.85))
                update("parsing", mapped_progress, uid=uid, uploaded=True, remote_status=status)
                if status == "success":
                    args.artifact_dir.mkdir(parents=True, exist_ok=True)
                    atomic_json(result_path, payload)
                    break
                if status == "failed":
                    raise Doc2xError(str(data.get("detail") or "Doc2X 解析失败"), code="parse_failed")
                time.sleep(settings.poll_seconds)

        manifest_payload = json.loads(args.manifest.read_text(encoding="utf-8"))
        manifest = manifest_payload.get("results") or []
        update("downloading_assets", 93, uid=state.get("uid", ""), result_path=str(result_path))
        report = build_drafts(
            result_payload=payload,
            manifest=manifest,
            drafts_root=args.drafts_root,
            artifact_dir=args.artifact_dir,
            storage_root=args.storage_root,
            download_asset=client.download_asset,
        )
        update("importing", 99, uid=state.get("uid", ""), result_path=str(result_path), report=report)
        update("succeeded", 100, uid=state.get("uid", ""), result_path=str(result_path), report=report)
        return 0 if report["successful"] > 0 else 3
    except (Doc2xError, OSError, ValueError, json.JSONDecodeError) as exc:
        code = exc.code if isinstance(exc, Doc2xError) else "runner_error"
        update("failed", int(state.get("progress") or 0), error=str(exc), error_code=code)
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
