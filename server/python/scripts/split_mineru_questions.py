#!/usr/bin/env python3
"""Split MinerU content_list_v2 JSON into per-question Markdown files."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable


QUESTION_START_RE = re.compile(r"^\s*(\d{1,2})[\.．、]")
SKIP_TYPES = {"page_header", "page_footer", "page_number"}


def render_inline_parts(parts: Iterable[dict[str, Any]]) -> str:
    rendered: list[str] = []
    for part in parts:
        part_type = part.get("type")
        content = str(part.get("content", ""))
        if part_type == "equation_inline":
            rendered.append(f"${content}$")
        else:
            rendered.append(content)
    return "".join(rendered).strip()


def render_item(item: dict[str, Any], image_base: str = "images") -> str:
    item_type = item.get("type")
    content = item.get("content") or {}

    if item_type in SKIP_TYPES:
        return ""

    if item_type == "title":
        level = int(content.get("level") or 2)
        text = render_inline_parts(content.get("title_content") or [])
        return f"{'#' * max(1, min(level, 6))} {text}".strip()

    if item_type == "paragraph":
        return render_inline_parts(content.get("paragraph_content") or [])

    if item_type == "equation_interline":
        math = str(content.get("math_content", "")).strip()
        if not math:
            return ""
        return f"$$\n{math}\n$$"

    if item_type in {"image", "chart"}:
        source = content.get("image_source") or {}
        path = source.get("path")
        if not path:
            return ""
        image_path = Path(image_base) / Path(path).name
        return f"![]({image_path.as_posix()})"

    if item_type == "list":
        lines: list[str] = []
        for list_item in content.get("list_items") or []:
            parts = list_item.get("item_content") or []
            text = render_inline_parts(parts)
            if text:
                lines.append(text)
        return "\n\n".join(lines)

    return ""


def flatten_pages(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, list):
        raise ValueError("MinerU content list must be a list.")
    if data and all(isinstance(page, list) for page in data):
        return [item for page in data for item in page if isinstance(item, dict)]
    return [item for item in data if isinstance(item, dict)]


def question_number_from_text(text: str) -> int | None:
    match = QUESTION_START_RE.match(text)
    if not match:
        return None
    return int(match.group(1))


def split_questions(items: list[dict[str, Any]]) -> tuple[list[str], dict[int, list[str]]]:
    preface: list[str] = []
    questions: dict[int, list[str]] = {}
    current_num: int | None = None
    expected_next = 1

    for item in items:
        text = render_item(item)
        if not text:
            continue

        maybe_num = question_number_from_text(text)
        if maybe_num == expected_next:
            current_num = maybe_num
            expected_next += 1
            questions[current_num] = [text]
            continue

        if current_num is None:
            preface.append(text)
        else:
            questions[current_num].append(text)

    return preface, questions


def write_questions(
    preface: list[str],
    questions: dict[int, list[str]],
    output_dir: Path,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    if preface:
        (output_dir / "preface.md").write_text("\n\n".join(preface) + "\n", encoding="utf-8")

    index_lines = ["# 逐题 Markdown 索引", ""]
    for question_num in sorted(questions):
        filename = f"CUT_{question_num:04d}.md"
        body = "\n\n".join(questions[question_num]).strip() + "\n"
        (output_dir / filename).write_text(body, encoding="utf-8")
        title = body.splitlines()[0].strip()
        index_lines.append(f"- [{filename}]({filename}) - {title}")

    (output_dir / "index.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", required=True, type=Path, help="MinerU content_list_v2.json path")
    parser.add_argument("--output", required=True, type=Path, help="Output directory for question markdown files")
    args = parser.parse_args()

    data = json.loads(args.json.read_text(encoding="utf-8"))
    items = flatten_pages(data)
    preface, questions = split_questions(items)
    write_questions(preface, questions, args.output)

    print(f"wrote {len(questions)} questions to {args.output}")
    if preface:
        print(f"wrote preface to {args.output / 'preface.md'}")


if __name__ == "__main__":
    main()
