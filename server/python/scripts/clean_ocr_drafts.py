#!/usr/bin/env python3
"""Normalize OCR draft LaTeX delimiters in `ocr_drafts/`.

This script only performs conservative cleanup on generated OCR drafts.
It does not touch raw responses.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.ocr.latex_cleanup import normalize_model_output_fields
from src.ocr.runner import render_question_markdown


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="清洗 OCR 草稿中的 LaTeX 定界符")
    parser.add_argument("--root", type=Path, default=Path("ocr_drafts"), help="草稿根目录，默认 ocr_drafts")
    parser.add_argument("--apply", action="store_true", help="实际写回文件，默认只预览")
    return parser.parse_args()


def clean_result(data: dict[str, object]) -> tuple[dict[str, object], bool]:
    cleaned = dict(data)
    model_fields = {
        "problem_text": cleaned.get("problem_text", ""),
        "answer": cleaned.get("answer", ""),
        "analysis": cleaned.get("analysis", ""),
        "figure_labels": cleaned.get("figure_labels", []),
        "figure_visual_elements": cleaned.get("figure_visual_elements", []),
        "possible_extra_content": cleaned.get("possible_extra_content", []),
        "latex_risk": cleaned.get("latex_risk", []),
        "uncertain_parts": cleaned.get("uncertain_parts", []),
        "needs_human_review": cleaned.get("needs_human_review", True),
    }
    normalized, _post_processing = normalize_model_output_fields(model_fields)
    changed = False
    for key in ("problem_text", "answer", "analysis"):
        if cleaned.get(key, "") != normalized.get(key, ""):
            cleaned[key] = normalized[key]
            changed = True
    return cleaned, changed


def main() -> int:
    args = parse_args()
    root = args.root
    if not root.exists():
        print(f"未找到草稿目录: {root}")
        return 1

    changed_count = 0
    examined_count = 0
    for result_path in sorted(root.glob("CUT_*/ocr_result.json")):
        examined_count += 1
        data = json.loads(result_path.read_text(encoding="utf-8"))
        cleaned, changed = clean_result(data)
        if not changed:
            continue

        changed_count += 1
        draft_dir = result_path.parent
        question_md_path = draft_dir / "question.md"
        rendered = render_question_markdown(cleaned)
        if args.apply:
            result_path.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
            question_md_path.write_text(rendered, encoding="utf-8")
        print(f"{'UPDATED' if args.apply else 'WOULD UPDATE'} {result_path.parent.name}")

    print(f"examined={examined_count} changed={changed_count} apply={args.apply}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
