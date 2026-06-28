#!/usr/bin/env python3
"""Classify existing question-bank items with the configured cleanup model."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib import error, request

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = Path(os.getenv("QUESTION_DATA_DIR", PROJECT_ROOT))
PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from src.ocr.config import load_dotenv


FALLBACK_KNOWLEDGE_LIBRARY_PATH = PROJECT_ROOT / "server" / "tag_libraries" / "high_school_math_cn_default.json"
FALLBACK_METHOD_LIBRARY_PATH = PROJECT_ROOT / "server" / "tag_libraries" / "high_school_methods.json"
DB_PATH = DATA_ROOT / "data" / "question.sqlite"
KNOWLEDGE_LIBRARY_PATH = Path(os.environ["KNOWLEDGE_LIBRARY_PATH"]) if os.getenv("KNOWLEDGE_LIBRARY_PATH") else FALLBACK_KNOWLEDGE_LIBRARY_PATH
METHOD_LIBRARY_PATH = Path(os.environ["METHOD_LIBRARY_PATH"]) if os.getenv("METHOD_LIBRARY_PATH") else FALLBACK_METHOD_LIBRARY_PATH
PROMPT_SETTINGS_PATH = Path(os.getenv("QUESTION_PROMPT_SETTINGS_PATH", PYTHON_ROOT / "ocr_prompt_settings.json"))

SYSTEM_PROMPT = """你是高中数学题目分类工具。

根据题干、答案和解析识别：
1. knowledge_points：本题涉及的知识点，返回 1-6 个中文短标签。
2. solution_methods：本题使用的解题方法，返回 1-6 个中文短标签。
3. difficulty_score_10：按高考/高三统考语境给 1-10 的整数难度分。
4. difficulty_label：按分值输出基础/中等/较难/压轴之一。1-3 基础，4-6 中等，7-8 较难，9-10 压轴。

要求：
- 标签必须优先从 allowed_knowledge_points 与 allowed_solution_methods 中选择，使用完整名称。
- 不要创造近义词标签；确实没有合适标签时才用一个极短中文标签。
- 不改写题干、答案、解析。
- 只输出 JSON 对象，字段仅包含 knowledge_points、solution_methods、difficulty_score_10、difficulty_label。"""

USER_PROMPT = """请对以下题目进行分类。

{payload}"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="对当前题库题目批量生成知识点与解题方法标签")
    parser.add_argument("--run-id", default="", help="兼容参数：只处理指定 OCR 批次导入的题目")
    parser.add_argument("--import-job-id", default="", help="兼容参数：只处理指定资料导入批次的题目")
    parser.add_argument("--scope-type", choices=["all", "pdf_slicer_run", "import_job"], default="", help="题目批次范围类型")
    parser.add_argument("--scope-id", default="", help="题目批次范围 ID")
    parser.add_argument("--limit", type=int, default=0, help="限制处理题目数量；0 表示全量")
    parser.add_argument("--only-missing", action="store_true", help="只处理还没有标签的题目")
    parser.add_argument("--concurrency", type=int, default=4, help="并发数，最大 10")
    return parser.parse_args()


def normalize_tags(value: object) -> list[str]:
    if isinstance(value, str):
        parts = re.split(r"[,，、;/；\n]+", value)
    elif isinstance(value, list):
        parts = [str(item) for item in value]
    else:
        parts = []
    tags: list[str] = []
    seen: set[str] = set()
    for item in parts:
        tag = re.sub(r"\s+", " ", str(item).strip())
        if not tag or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag[:40])
    return tags[:8]


def difficulty_score(value: object) -> int:
    try:
        parsed = int(float(str(value)))
    except Exception:
        return 0
    return max(1, min(parsed, 10))


def difficulty_label(score: int) -> str:
    if score <= 0:
        return ""
    if score <= 3:
        return "基础"
    if score <= 6:
        return "中等"
    if score <= 8:
        return "较难"
    return "压轴"


def read_json(path: Path) -> dict[str, object]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def first_existing_path(*paths: Path) -> Path:
    return next((path for path in paths if path.exists()), paths[0])


def read_tag_libraries() -> dict[str, list[str]]:
    knowledge_payload = read_json(first_existing_path(KNOWLEDGE_LIBRARY_PATH, FALLBACK_KNOWLEDGE_LIBRARY_PATH))
    method_payload = read_json(first_existing_path(METHOD_LIBRARY_PATH, FALLBACK_METHOD_LIBRARY_PATH))
    knowledge_points = [
        str(item.get("name", ""))
        for chapter in knowledge_payload.get("chapters", [])
        for item in chapter.get("knowledgePoints", [])
        if isinstance(item, dict) and item.get("name")
    ]
    solution_methods = [
        str(item.get("name", ""))
        for group in method_payload.get("groups", [])
        for item in group.get("tags", [])
        if isinstance(item, dict) and item.get("name")
    ]
    return {"knowledge_points": knowledge_points, "solution_methods": solution_methods}


def prompt_settings() -> dict[str, str]:
    try:
        payload = json.loads(PROMPT_SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {str(k): str(v) for k, v in payload.items() if str(v).strip()}


def settings() -> dict[str, str]:
    load_dotenv()
    return {
        "api_base_url": os.getenv("OCR_CLEANUP_API_BASE_URL") or os.getenv("OCR_API_BASE_URL") or "",
        "api_key": os.getenv("OCR_CLEANUP_API_KEY") or os.getenv("OCR_API_KEY") or "",
        "model": os.getenv("OCR_CLEANUP_MODEL") or os.getenv("OCR_MODEL") or "",
    }


def endpoints(base_url: str) -> list[str]:
    base = base_url.strip().rstrip("/")
    if not base:
        return []
    return [base] if base.endswith("/chat/completions") else [base, f"{base}/chat/completions"]


def extract_json(text: str) -> dict[str, object]:
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", candidate, flags=re.S)
    if fenced:
        candidate = fenced.group(1).strip()
    try:
        value = json.loads(candidate)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start >= 0 and end > start:
        value = json.loads(candidate[start : end + 1])
        if isinstance(value, dict):
            return value
    raise RuntimeError("分类模型没有返回合法 JSON")


def classify(row: sqlite3.Row, libraries: dict[str, list[str]], cfg: dict[str, str]) -> dict[str, object]:
    if not cfg["api_base_url"] or not cfg["api_key"] or not cfg["model"]:
        raise RuntimeError("缺少分类模型配置：OCR_CLEANUP_API_BASE_URL / OCR_CLEANUP_API_KEY / OCR_CLEANUP_MODEL")
    model_input = {
        "problem_text": row["stem_markdown"],
        "answer": row["answer_text"],
        "analysis": row["analysis_markdown"],
        "allowed_knowledge_points": libraries["knowledge_points"],
        "allowed_solution_methods": libraries["solution_methods"],
    }
    prompts = prompt_settings()
    system_prompt = prompts.get("classification_system_prompt", SYSTEM_PROMPT)
    user_template = prompts.get("classification_user_prompt", USER_PROMPT)
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_template.format(payload=json.dumps(model_input, ensure_ascii=False))},
        ],
        "temperature": 0.01,
        "top_p": 0.1,
        "stream": False,
    }
    last_error = ""
    for endpoint in endpoints(cfg["api_base_url"]):
        req = request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
        )
        try:
            with request.urlopen(req, timeout=180) as resp:
                body = json.loads(resp.read().decode("utf-8", errors="replace"))
                text = (body.get("choices") or [{}])[0].get("message", {}).get("content", "")
                result = extract_json(text)
                return {
                    "id": row["id"],
                    "knowledge_points": normalize_tags(result.get("knowledge_points")),
                    "solution_methods": normalize_tags(result.get("solution_methods")),
                    "difficulty_score_10": difficulty_score(result.get("difficulty_score_10")),
                    "difficulty_label": str(result.get("difficulty_label") or ""),
                }
        except Exception as exc:
            last_error = str(exc)
            if isinstance(exc, error.HTTPError) and exc.code == 404:
                continue
            break
    raise RuntimeError(last_error or "分类模型调用失败")


def classification_scope(args: argparse.Namespace) -> tuple[str, str]:
    if args.scope_type:
        return args.scope_type, str(args.scope_id or "")
    if args.import_job_id:
        return "import_job", str(args.import_job_id)
    if args.run_id:
        return "pdf_slicer_run", str(args.run_id)
    return "all", ""


def import_job_source_ids(conn: sqlite3.Connection, job_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT source_document_id FROM import_job_documents WHERE job_id = ? ORDER BY sort_order ASC, created_at ASC",
        [job_id],
    ).fetchall()
    return [str(row["source_document_id"]) for row in rows if str(row["source_document_id"] or "").strip()]


def scoped_where(conn: sqlite3.Connection, scope_type: str, scope_id: str) -> tuple[list[str], list[object]]:
    if scope_type == "all":
        return [], []
    if not scope_id:
        raise RuntimeError("题目分类缺少批次范围 ID")
    if scope_type == "pdf_slicer_run":
        return ["source_run_id = ?"], [scope_id]
    if scope_type == "import_job":
        import_source_ids = [scope_id, f"ifv2-job:{scope_id}", *import_job_source_ids(conn, scope_id)]
        placeholders = ", ".join("?" for _ in import_source_ids)
        return [f"import_source_id IN ({placeholders})"], import_source_ids
    raise RuntimeError(f"不支持的题目分类范围：{scope_type}")


def main() -> int:
    args = parse_args()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(question_bank_items)").fetchall()}
    if "difficulty_score_10" not in columns:
        conn.execute("ALTER TABLE question_bank_items ADD COLUMN difficulty_score_10 INTEGER NOT NULL DEFAULT 0")
    if "difficulty_label" not in columns:
        conn.execute("ALTER TABLE question_bank_items ADD COLUMN difficulty_label TEXT NOT NULL DEFAULT ''")
    conn.commit()
    scope_type, scope_id = classification_scope(args)
    where_clauses, params = scoped_where(conn, scope_type, scope_id)
    if args.only_missing:
        where_clauses.append("(knowledge_points_json = '[]' OR solution_methods_json = '[]' OR difficulty_score_10 = 0 OR difficulty_label = '')")
    where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    rows = conn.execute(
        f"SELECT id, stem_markdown, answer_text, analysis_markdown FROM question_bank_items {where} ORDER BY updated_at DESC",
        params,
    ).fetchall()
    if args.limit > 0:
        rows = rows[: args.limit]
    libraries = read_tag_libraries()
    cfg = settings()
    workers = max(1, min(args.concurrency, 10, len(rows) or 1))
    results: list[dict[str, object]] = []
    failures: list[dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(classify, row, libraries, cfg): row["id"] for row in rows}
        for future in as_completed(futures):
            qid = futures[future]
            try:
                result = future.result()
                score = int(result["difficulty_score_10"] or 0)
                label = str(result.get("difficulty_label") or difficulty_label(score))
                results.append(result)
                conn.execute(
                    "UPDATE question_bank_items SET knowledge_points_json = ?, solution_methods_json = ?, difficulty_score_10 = ?, difficulty_label = ?, chapter = COALESCE(NULLIF(?, ''), chapter), updated_at = datetime('now') WHERE id = ?",
                    (
                        json.dumps(result["knowledge_points"], ensure_ascii=False),
                        json.dumps(result["solution_methods"], ensure_ascii=False),
                        score,
                        label,
                        (result["knowledge_points"] or [""])[0],
                        qid,
                    ),
                )
                conn.commit()
            except Exception as exc:
                failures.append({"id": qid, "error": str(exc)})
    report = {
        "scopeType": scope_type,
        "scopeId": scope_id,
        "runId": scope_id if scope_type == "pdf_slicer_run" else "",
        "importJobId": scope_id if scope_type == "import_job" else "",
        "total": len(rows),
        "updated": len(results),
        "failed": len(failures),
        "failures": failures,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
