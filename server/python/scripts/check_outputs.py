#!/usr/bin/env python3
"""Lightweight integrity check for the current PDF cutter outputs.

This script only validates the already-generated output files. It does not
reprocess any PDF.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"
CUT_RESULTS_PATH = OUTPUT_DIR / "cut_results.json"
REVIEWED_RESULTS_PATH = OUTPUT_DIR / "reviewed_results.json"
PAGES_DIR = OUTPUT_DIR / "pages"
AUTO_CUTS_DIR = OUTPUT_DIR / "auto_cuts"
REVIEWED_CUTS_DIR = OUTPUT_DIR / "reviewed_cuts"

REQUIRED_BBOX_KEYS = {"x", "y", "width", "height"}


def relpath_or_none(path_str: str | None) -> Path | None:
    if not path_str:
        return None
    return PROJECT_ROOT / path_str


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def validate_bbox(value: object) -> bool:
    return isinstance(value, dict) and REQUIRED_BBOX_KEYS.issubset(value.keys())


def validate_records(
    records: list[dict],
    *,
    required_fields: list[str],
    bbox_fields: list[str],
    path_fields: list[str],
    segment_field: str | None = None,
) -> list[str]:
    errors: list[str] = []

    for index, record in enumerate(records, start=1):
        rid = record.get("id", f"<missing-id-{index}>")

        for field in required_fields:
            if field not in record:
                errors.append(f"{rid}: missing required field `{field}`")
            elif record[field] is None:
                errors.append(f"{rid}: field `{field}` is null")
            elif isinstance(record[field], str) and not record[field].strip():
                errors.append(f"{rid}: field `{field}` is empty")

        for field in bbox_fields:
            if field not in record:
                errors.append(f"{rid}: missing bbox field `{field}`")
            elif not validate_bbox(record[field]):
                errors.append(f"{rid}: field `{field}` is not a valid bbox object")

        for field in path_fields:
            value = record.get(field)
            if not value:
                errors.append(f"{rid}: missing or empty path field `{field}`")
                continue
            resolved = relpath_or_none(value)
            if resolved is None or not resolved.exists():
                errors.append(f"{rid}: path does not exist: `{value}`")

        if segment_field:
            segments = record.get(segment_field)
            if not isinstance(segments, list) or not segments:
                errors.append(f"{rid}: field `{segment_field}` is missing or empty")
            else:
                for seg_index, seg in enumerate(segments, start=1):
                    if not isinstance(seg, dict):
                        errors.append(f"{rid}: {segment_field}[{seg_index}] is not an object")
                        continue
                    if "page_number" not in seg:
                        errors.append(f"{rid}: {segment_field}[{seg_index}] missing `page_number`")
                    if "bbox" not in seg:
                        errors.append(f"{rid}: {segment_field}[{seg_index}] missing `bbox`")
                    elif not validate_bbox(seg["bbox"]):
                        errors.append(f"{rid}: {segment_field}[{seg_index}] has invalid bbox")
                    extra_path = seg.get("page_image_path")
                    if extra_path:
                        resolved = relpath_or_none(extra_path)
                        if resolved is None or not resolved.exists():
                            errors.append(
                                f"{rid}: {segment_field}[{seg_index}] path does not exist: `{extra_path}`"
                            )

    return errors


def summarize_statuses(records: list[dict]) -> Counter:
    return Counter(record.get("status", "<missing>") for record in records)


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    cut_data = load_json(CUT_RESULTS_PATH)
    reviewed_data = load_json(REVIEWED_RESULTS_PATH)

    print("PDF 切题输出检查报告")
    print("=" * 40)

    if cut_data is None:
        errors.append(f"missing file: {CUT_RESULTS_PATH.relative_to(PROJECT_ROOT)}")
        cut_records: list[dict] = []
    else:
        cut_records = cut_data.get("results") if isinstance(cut_data.get("results"), list) else []
        if not cut_records and cut_data.get("results") != []:
            errors.append("cut_results.json: top-level `results` is missing or not a list")
        print(f"cut_results.json: {len(cut_records)} records")
        print(f"cut_results.json status counts: {dict(summarize_statuses(cut_records))}")
        errors.extend(
            validate_records(
                cut_records,
                required_fields=[
                    "id",
                    "source_pdf",
                    "page",
                    "question_no",
                    "auto_image_path",
                    "page_image_path",
                    "bbox",
                    "page_span",
                    "segments",
                    "status",
                    "review_flags",
                    "note",
                    "figures",
                ],
                bbox_fields=["bbox"],
                path_fields=["auto_image_path", "page_image_path"],
                segment_field="segments",
            )
        )

    if reviewed_data is None:
        errors.append(f"missing file: {REVIEWED_RESULTS_PATH.relative_to(PROJECT_ROOT)}")
        reviewed_records = []
    else:
        reviewed_records = (
            reviewed_data.get("results") if isinstance(reviewed_data.get("results"), list) else []
        )
        if not reviewed_records and reviewed_data.get("results") != []:
            errors.append("reviewed_results.json: top-level `results` is missing or not a list")
        print(f"reviewed_results.json: {len(reviewed_records)} records")
        print(f"reviewed_results.json status counts: {dict(summarize_statuses(reviewed_records))}")
        errors.extend(
            validate_records(
                reviewed_records,
                required_fields=[
                    "id",
                    "source_pdf",
                    "page",
                    "page_span",
                    "segments",
                    "figures",
                    "question_no",
                    "page_image_path",
                    "auto_image_path",
                    "auto_bbox",
                    "reviewed_bbox",
                    "reviewed_segments",
                    "reviewed_image_path",
                    "status",
                    "review_flags",
                    "note",
                ],
                bbox_fields=["auto_bbox", "reviewed_bbox"],
                path_fields=["auto_image_path", "page_image_path", "reviewed_image_path"],
                segment_field="reviewed_segments",
            )
        )

    if cut_records and reviewed_records and len(cut_records) != len(reviewed_records):
        warnings.append(
            "record count mismatch between cut_results.json and reviewed_results.json "
            f"({len(cut_records)} != {len(reviewed_records)})"
        )

    page_count = len(list(PAGES_DIR.glob("*.png")))
    auto_cut_count = len(list(AUTO_CUTS_DIR.glob("*.png")))
    reviewed_cut_count = len(list(REVIEWED_CUTS_DIR.glob("*.png")))

    print(f"output/pages: {page_count} files")
    print(f"output/auto_cuts: {auto_cut_count} files")
    print(f"output/reviewed_cuts: {reviewed_cut_count} files")

    if warnings:
        print("\n警告:")
        for item in warnings:
            print(f"- {item}")

    if errors:
        print("\n错误:")
        for item in errors:
            print(f"- {item}")
        return 1

    print("\n检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
