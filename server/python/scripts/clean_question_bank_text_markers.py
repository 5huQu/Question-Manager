#!/usr/bin/env python3
"""Clean standalone answer/analysis section labels from question-bank records."""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = Path(os.getenv("QUESTION_DATA_DIR", PROJECT_ROOT))
PYTHON_ROOT = PROJECT_ROOT / "server" / "python"
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from src.ocr.latex_cleanup import split_answer_analysis_from_problem_text, strip_field_section_markers


DB_PATH = DATA_ROOT / "data" / "question.sqlite"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="清洗当前题库字段中的独立答案/解析标题")
    parser.add_argument("--db", type=Path, default=DB_PATH, help="SQLite 数据库路径")
    parser.add_argument("--apply", action="store_true", help="写回数据库；默认只预览")
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少条；0 表示全量")
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_row(row: sqlite3.Row) -> tuple[str, str, str]:
    normalized, _ = split_answer_analysis_from_problem_text(
        {
            "problem_text": row["stem_markdown"] or "",
            "answer": row["answer_text"] or "",
            "analysis": row["analysis_markdown"] or "",
        }
    )
    return (
        str(normalized.get("problem_text") or "").strip(),
        strip_field_section_markers(str(normalized.get("answer") or ""), ("答案",)),
        strip_field_section_markers(str(normalized.get("analysis") or ""), ("解析", "分析", "详解")),
    )


def main() -> None:
    args = parse_args()
    if not args.db.exists():
        raise SystemExit(f"数据库不存在: {args.db}")

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, stem_markdown, answer_text, analysis_markdown
        FROM question_bank_items
        ORDER BY serial_no ASC
        """
    ).fetchall()
    if args.limit > 0:
        rows = rows[: args.limit]

    changed: list[tuple[sqlite3.Row, str, str, str]] = []
    for row in rows:
        stem, answer, analysis = normalize_row(row)
        if stem != row["stem_markdown"] or answer != row["answer_text"] or analysis != row["analysis_markdown"]:
            changed.append((row, stem, answer, analysis))

    if args.apply and changed:
        with conn:
            for row, stem, answer, analysis in changed:
                conn.execute(
                    """
                    UPDATE question_bank_items
                    SET stem_markdown = ?,
                        answer_text = ?,
                        analysis_markdown = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (stem, answer, analysis, now_iso(), row["id"]),
                )

    print(f"scanned={len(rows)} changed={len(changed)} applied={bool(args.apply)}")
    for row, _, answer, analysis in changed[:12]:
        print(f"- {row['id']}")
        print(f"  answer: {answer[:80]!r}")
        print(f"  analysis: {analysis[:120]!r}")


if __name__ == "__main__":
    main()
