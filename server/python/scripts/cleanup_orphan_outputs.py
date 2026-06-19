#!/usr/bin/env python3
"""Find orphan output images and optionally move them to output/_orphaned/.

This script does not modify any JSON result file. Dry-run by default.
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"
CUT_RESULTS_PATH = OUTPUT_DIR / "cut_results.json"
REVIEWED_RESULTS_PATH = OUTPUT_DIR / "reviewed_results.json"
ORPHAN_DIR = OUTPUT_DIR / "_orphaned"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def collect_path_refs(value, refs: set[Path]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(key, str) and key.endswith("_path") and isinstance(item, str) and item:
                refs.add((PROJECT_ROOT / item).resolve())
            collect_path_refs(item, refs)
    elif isinstance(value, list):
        for item in value:
            collect_path_refs(item, refs)


def collect_json_refs() -> tuple[set[Path], list[dict], list[dict]]:
    refs: set[Path] = set()
    cut_records: list[dict] = []
    reviewed_records: list[dict] = []

    cut_data = load_json(CUT_RESULTS_PATH)
    reviewed_data = load_json(REVIEWED_RESULTS_PATH)

    if cut_data and isinstance(cut_data.get("results"), list):
        cut_records = cut_data["results"]
        collect_path_refs(cut_data, refs)
    if reviewed_data and isinstance(reviewed_data.get("results"), list):
        reviewed_records = reviewed_data["results"]
        collect_path_refs(reviewed_data, refs)

    return refs, cut_records, reviewed_records


def scan_images() -> list[Path]:
    files: list[Path] = []
    for path in OUTPUT_DIR.rglob("*"):
        if not path.is_file():
            continue
        if ORPHAN_DIR in path.parents:
            continue
        if path.suffix.lower() in IMAGE_SUFFIXES:
            files.append(path.resolve())
    return sorted(files)


def validate_reviewed_records(records: list[dict]) -> list[dict]:
    issues: list[dict] = []
    for record in records:
        rid = record.get("id", "<missing-id>")
        for field in ("auto_image_path", "reviewed_image_path", "page_image_path"):
            value = record.get(field)
            if not value:
                issues.append({"id": rid, "field": field, "reason": "empty_path"})
                continue
            resolved = (PROJECT_ROOT / value).resolve()
            if not resolved.exists():
                issues.append({"id": rid, "field": field, "reason": "missing_file", "path": value})
    return issues


def build_report(
    *,
    orphan_files: list[Path],
    reviewed_issues: list[dict],
    move_plan: list[tuple[Path, Path]],
    applied: bool,
) -> str:
    lines = [
        "# 孤立输出清理报告",
        "",
        f"- 模式: {'apply' if applied else 'dry-run'}",
        f"- 孤立图片数量: {len(orphan_files)}",
        f"- reviewed_results 记录异常数: {len(reviewed_issues)}",
        "",
        "## 孤立图片",
    ]

    if orphan_files:
        for src in orphan_files:
            lines.append(f"- {src.relative_to(PROJECT_ROOT)}")
    else:
        lines.append("- 无")

    lines += ["", "## reviewed_results 异常记录"]
    if reviewed_issues:
        for item in reviewed_issues:
            line = f"- {item['id']} / {item['field']} / {item['reason']}"
            if item.get("path"):
                line += f" / {item['path']}"
            lines.append(line)
    else:
        lines.append("- 无")

    lines += ["", "## 计划移动"]
    if move_plan:
        for src, dst in move_plan:
            lines.append(f"- {src.relative_to(PROJECT_ROOT)} -> {dst.relative_to(PROJECT_ROOT)}")
    else:
        lines.append("- 无")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="清理孤立输出图片")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="实际移动孤立文件到 output/_orphaned/，默认仅 dry-run",
    )
    args = parser.parse_args()

    refs, cut_records, reviewed_records = collect_json_refs()
    all_images = scan_images()
    orphan_files = [path for path in all_images if path not in refs]
    reviewed_issues = validate_reviewed_records(reviewed_records)

    move_plan: list[tuple[Path, Path]] = []
    for src in orphan_files:
        rel = src.relative_to(OUTPUT_DIR)
        dst = ORPHAN_DIR / rel
        move_plan.append((src, dst))

    print("孤立输出清理检查")
    print("=" * 40)
    print(f"cut_results 记录数: {len(cut_records)}")
    print(f"reviewed_results 记录数: {len(reviewed_records)}")
    print(f"引用到的图片数: {len(refs)}")
    print(f"扫描到的图片数: {len(all_images)}")
    print(f"孤立图片数: {len(orphan_files)}")
    print(f"reviewed_results 异常记录数: {len(reviewed_issues)}")

    if orphan_files:
        print("\n孤立图片:")
        for src in orphan_files:
            print(f"- {src.relative_to(PROJECT_ROOT)}")
    else:
        print("\n孤立图片: 无")

    if reviewed_issues:
        print("\nreviewed_results 异常记录:")
        for item in reviewed_issues:
            line = f"- {item['id']} / {item['field']} / {item['reason']}"
            if item.get("path"):
                line += f" / {item['path']}"
            print(line)
    else:
        print("\nreviewed_results 异常记录: 无")

    if args.apply and move_plan:
        ORPHAN_DIR.mkdir(parents=True, exist_ok=True)
        for src, dst in move_plan:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
        applied = True
        print("\n已移动孤立文件到 output/_orphaned/")
    else:
        applied = False
        if args.apply:
            print("\n没有需要移动的孤立文件")
        else:
            print("\n当前为 dry-run，没有移动文件")

    report = build_report(
        orphan_files=orphan_files,
        reviewed_issues=reviewed_issues,
        move_plan=move_plan,
        applied=applied,
    )
    report_path = OUTPUT_DIR / "orphan_cleanup_report.md"
    report_path.write_text(report, encoding="utf-8")
    print(f"\n清理报告已写入: {report_path.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
