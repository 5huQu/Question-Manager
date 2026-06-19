#!/usr/bin/env python3
"""Export OCR input manifest from reviewed_results.json.

This script does not call OCR. It only selects ready_for_ocr records with
existing reviewed_image_path and writes output/ocr_manifest.json.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"
REVIEWED_RESULTS_PATH = OUTPUT_DIR / "reviewed_results.json"
CUT_RESULTS_PATH = OUTPUT_DIR / "cut_results.json"
MANIFEST_PATH = OUTPUT_DIR / "ocr_manifest.json"
REPORT_PATH = OUTPUT_DIR / "ocr_manifest_report.md"

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


def load_reviewed_results() -> list[dict]:
    if not REVIEWED_RESULTS_PATH.exists():
        return []
    data = json.loads(REVIEWED_RESULTS_PATH.read_text(encoding="utf-8"))
    results = data.get("results", [])
    return results if isinstance(results, list) else []


def load_cut_results_map() -> dict[str, dict]:
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


def build_report(
    *,
    ready_count: int,
    manifest_count: int,
    excluded_missing_image: list[dict],
    excluded_bad_status: list[dict],
) -> str:
    lines = [
        "# OCR 输入清单报告",
        "",
        f"- ready_for_ocr 记录数量: {ready_count}",
        f"- 成功进入 manifest 的数量: {manifest_count}",
        f"- 因图片缺失被排除的数量: {len(excluded_missing_image)}",
        f"- 因状态不符合被排除的数量: {len(excluded_bad_status)}",
        "",
        "## 异常记录列表",
        "",
    ]

    if excluded_missing_image:
        lines.append("### 图片缺失")
        for item in excluded_missing_image:
            lines.append(
                f"- {item['id']} / {item['reason']}"
                + (f" / {item.get('path')}" if item.get("path") else "")
            )
        lines.append("")

    if excluded_bad_status:
        lines.append("### 状态不符合")
        for item in excluded_bad_status:
            lines.append(f"- {item['id']} / {item['status']}")
        lines.append("")

    if not excluded_missing_image and not excluded_bad_status:
        lines.append("- 无")

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    records = load_reviewed_results()
    cut_results_map = load_cut_results_map()
    ready_records = [r for r in records if r.get("status") == "ready_for_ocr"]

    manifest: list[dict] = []
    excluded_missing_image: list[dict] = []
    excluded_bad_status: list[dict] = []

    for record in records:
        rid = record.get("id", "<missing-id>")
        status = record.get("status")
        if status != "ready_for_ocr":
            excluded_bad_status.append({"id": rid, "status": status if status is not None else "<missing>"})
            continue

        image_path = record.get("reviewed_image_path")
        if not image_path:
            excluded_missing_image.append({"id": rid, "reason": "missing_reviewed_image_path"})
            continue
        resolved = PROJECT_ROOT / image_path
        if not resolved.exists():
            excluded_missing_image.append({"id": rid, "reason": "missing_file", "path": image_path})
            continue

        item = {field: record[field] for field in MANIFEST_FIELDS if field in record}
        if "text_regions" not in item:
            cut_record = cut_results_map.get(rid)
            if isinstance(cut_record, dict) and "text_regions" in cut_record:
                item["text_regions"] = cut_record["text_regions"]
        manifest.append(item)

    payload = {"results": manifest}
    MANIFEST_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    report = build_report(
        ready_count=len(ready_records),
        manifest_count=len(manifest),
        excluded_missing_image=excluded_missing_image,
        excluded_bad_status=excluded_bad_status,
    )
    REPORT_PATH.write_text(report, encoding="utf-8")

    print("OCR 输入清单导出完成")
    print(f"ready_for_ocr: {len(ready_records)}")
    print(f"manifest: {len(manifest)}")
    print(f"excluded_missing_image: {len(excluded_missing_image)}")
    print(f"excluded_bad_status: {len(excluded_bad_status)}")
    print(f"manifest written to: {MANIFEST_PATH.relative_to(PROJECT_ROOT)}")
    print(f"report written to: {REPORT_PATH.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
