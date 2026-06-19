from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path
from typing import Any

from src.ocr.config import PROJECT_ROOT, OCRSettings, load_settings
from src.ocr.runner import (
    ROUTE_REGION_CHUNKS,
    ROUTE_WHOLE_QUESTION,
    _draft_dir,
    _run_region_supplement_seq3,
    _run_whole_question_json_ocr,
    _secondary_channel_settings,
    build_result_json,
    determine_ocr_route,
    load_manifest_records,
    render_question_markdown,
    score_question_complexity,
)


SUMMARY_PATH = PROJECT_ROOT / "output" / "secondary_adaptive_batch_summary.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run adaptive secondary OCR over the exported manifest.")
    parser.add_argument("--ids", nargs="*", default=[], help="Optional CUT ids to process.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing draft outputs.")
    return parser.parse_args()


def _copy_source_image(manifest_record: dict[str, Any], draft_dir: Path) -> None:
    source_rel = manifest_record.get("reviewed_image_path") or ""
    if not source_rel:
        return
    source_path = PROJECT_ROOT / source_rel
    if not source_path.exists():
        return
    target_path = draft_dir / "source.png"
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, target_path)


def _region_text(report: dict[str, Any]) -> str:
    text = report.get("text", "")
    return text if isinstance(text, str) else ""


def _write_result(draft_dir: Path, result: dict[str, Any], raw_text: str) -> None:
    (draft_dir / "raw_response.txt").write_text(raw_text, encoding="utf-8")
    (draft_dir / "ocr_result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (draft_dir / "question.md").write_text(render_question_markdown(result), encoding="utf-8")


def _run_region_route(
    manifest_record: dict[str, Any],
    settings: OCRSettings,
    *,
    draft_dir: Path,
    route_reason: str,
    fallback_from_whole: dict[str, Any] | None = None,
) -> dict[str, Any]:
    region_reports: dict[str, dict[str, Any]] = {}
    failed = False
    error_reason = ""

    for kind in ("problem", "answer", "analysis"):
        report = _run_region_supplement_seq3(
            manifest_record,
            settings,
            draft_dir=draft_dir,
            kind=kind,
            dry_run=False,
        )
        region_reports[kind] = report
        if report.get("stopped_on_failure"):
            failed = True
            chunk_reports = report.get("chunk_reports") or []
            last_failed = next((item for item in reversed(chunk_reports) if item.get("status") == "failed"), {})
            error_reason = str(last_failed.get("error_reason") or f"{kind}_chunk_failed")
            break

    problem_text = _region_text(region_reports.get("problem", {}))
    answer_text = _region_text(region_reports.get("answer", {}))
    analysis_text = _region_text(region_reports.get("analysis", {}))
    raw_payload = {"problem": problem_text, "answer": answer_text, "analysis": analysis_text}
    raw_text = json.dumps(raw_payload, ensure_ascii=False, indent=2)
    parsed_model = {
        "problem_text": problem_text,
        "answer": answer_text,
        "analysis": analysis_text,
        "figure_labels": [],
        "figure_visual_elements": [],
        "possible_extra_content": [],
        "latex_risk": [],
        "uncertain_parts": [],
        "needs_human_review": True,
    }

    status = "failed" if failed else "draft"
    post_processing: dict[str, Any] = {
        "channel": "secondary_seq3",
        "ocr_route": ROUTE_REGION_CHUNKS,
        "ocr_route_reason": route_reason,
        "region_reports": region_reports,
    }
    if fallback_from_whole is not None:
        post_processing["whole_question_fallback"] = fallback_from_whole

    result = build_result_json(
        manifest_record=manifest_record,
        model_output=parsed_model,
        raw_model_output=raw_text,
        ocr_status=status,
        image_strategy="secondary_seq3_serial",
        input_images=[],
        post_processing=post_processing,
    )
    _write_result(draft_dir, result, raw_text)
    return {
        "ocr_status": status,
        "error_reason": error_reason,
        "route": ROUTE_REGION_CHUNKS,
        "route_reason": route_reason,
        "region_reports": region_reports,
    }


def process_record(manifest_record: dict[str, Any], settings: OCRSettings, *, force: bool) -> dict[str, Any]:
    cut_id = manifest_record["id"]
    draft_dir = _draft_dir(cut_id)
    result_path = draft_dir / "ocr_result.json"
    if result_path.exists() and not force:
        return {
            "id": cut_id,
            "ocr_status": "skipped",
            "elapsed_seconds": 0.0,
            "error_reason": "existing_result",
            "route": "skipped",
        }

    started = time.perf_counter()
    draft_dir.mkdir(parents=True, exist_ok=True)
    _copy_source_image(manifest_record, draft_dir)
    route, route_reason = determine_ocr_route(manifest_record, settings)
    complexity = score_question_complexity(manifest_record, settings)

    if route == ROUTE_WHOLE_QUESTION:
        whole = _run_whole_question_json_ocr(
            manifest_record,
            settings,
            draft_dir=draft_dir,
            dry_run=False,
            channel_name="secondary_whole_question",
        )
        if whole.get("used"):
            result = build_result_json(
                manifest_record=manifest_record,
                model_output=whole.get("parsed_model", {}),
                raw_model_output=whole.get("raw_text", ""),
                ocr_status="draft",
                image_strategy=whole.get("strategy", "single_reviewed_image"),
                input_images=whole.get("input_images", []),
                post_processing={
                    "channel": "secondary_whole_question",
                    "ocr_route": ROUTE_WHOLE_QUESTION,
                    "ocr_route_reason": route_reason,
                    "route_complexity": complexity,
                    "whole_question": {
                        "status": whole.get("status", "draft"),
                        "error_reason": whole.get("error_reason", ""),
                    },
                },
            )
            _write_result(draft_dir, result, whole.get("raw_text", ""))
            elapsed = round(time.perf_counter() - started, 3)
            return {
                "id": cut_id,
                "ocr_status": "draft",
                "elapsed_seconds": elapsed,
                "error_reason": "",
                "route": ROUTE_WHOLE_QUESTION,
                "route_reason": route_reason,
                "complexity": complexity,
            }

        fallback = {
            "status": whole.get("status", "failed"),
            "error_reason": whole.get("error_reason", ""),
            "strategy": whole.get("strategy", ""),
            "input_images": whole.get("input_images", []),
        }
        region_result = _run_region_route(
            manifest_record,
            settings,
            draft_dir=draft_dir,
            route_reason="whole_question_failed_then_region",
            fallback_from_whole=fallback,
        )
        elapsed = round(time.perf_counter() - started, 3)
        return {
            "id": cut_id,
            "ocr_status": region_result["ocr_status"],
            "elapsed_seconds": elapsed,
            "error_reason": region_result.get("error_reason", ""),
            "route": ROUTE_REGION_CHUNKS,
            "route_reason": "whole_question_failed_then_region",
            "complexity": complexity,
        }

    region_result = _run_region_route(
        manifest_record,
        settings,
        draft_dir=draft_dir,
        route_reason=route_reason,
    )
    elapsed = round(time.perf_counter() - started, 3)
    return {
        "id": cut_id,
        "ocr_status": region_result["ocr_status"],
        "elapsed_seconds": elapsed,
        "error_reason": region_result.get("error_reason", ""),
        "route": ROUTE_REGION_CHUNKS,
        "route_reason": route_reason,
        "complexity": complexity,
    }


def main() -> int:
    args = parse_args()
    base_settings = load_settings(max_items_override=9999, concurrency_override=1)
    secondary_settings = _secondary_channel_settings(base_settings)
    if secondary_settings is None:
        raise SystemExit("缺少 OCR_SECONDARY_API_BASE_URL，请先配置反代通道。")

    records = load_manifest_records()
    if args.ids:
        requested = set(args.ids)
        records = [record for record in records if record.get("id") in requested]

    results: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        print(
            f"[{index}/{len(records)}] {record['id']} "
            f"page={record.get('page')} q={record.get('question_no')}",
            flush=True,
        )
        result = process_record(record, secondary_settings, force=args.force)
        results.append(result)
        print(
            f"  -> status={result['ocr_status']} route={result.get('route', '-')} "
            f"elapsed={result['elapsed_seconds']}s error={result['error_reason'] or '-'}",
            flush=True,
        )

    SUMMARY_PATH.write_text(
        json.dumps(
            {
                "total": len(results),
                "failed": sum(1 for item in results if item.get("ocr_status") == "failed"),
                "results": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"summary -> {SUMMARY_PATH}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
