#!/usr/bin/env python3
"""Batch-level OCR draft format cleanup for the migrated Question app."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib import error, request

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = Path(os.getenv("QUESTION_PYTHON_DATA_DIR", PROJECT_ROOT))
REPO_ROOT = PROJECT_ROOT.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.ocr.config import load_dotenv
from src.ocr.latex_cleanup import normalize_model_output_fields
from src.ocr.runner import render_question_markdown


FIELD_KEYS = ("problem_text", "answer", "analysis")
TAG_KEYS = ("knowledge_points", "solution_methods")
SEMANTIC_EXERCISE_LABEL_RE = re.compile(
    r"^\s*(?:[【［\[]\s*)?(?:第\s*)?"
    r"(?:典例|例题|变式|即学即练|即学即练习|课堂练习|限时训练|课后训练|巩固训练|能力提升)"
    r"\s*(?:\d+|[一二三四五六七八九十]+)?"
    r"(?:\s*[-—–_·：:、.．]\s*(?:\d+|[一二三四五六七八九十]+))?"
    r"\s*(?:题)?\s*(?:[】］\]]\s*)?"
)
PROMPT_SETTINGS_PATH = Path(os.getenv("QUESTION_PROMPT_SETTINGS_PATH", DATA_ROOT / "config" / "ocr_prompt_settings.json"))
MATH_RENDER_VALIDATOR = PROJECT_ROOT.parent / "scripts" / "validate_math_render.mjs"
KNOWLEDGE_LIBRARY_PATH = Path(os.environ["KNOWLEDGE_LIBRARY_PATH"]) if os.getenv("KNOWLEDGE_LIBRARY_PATH") else REPO_ROOT / "server" / "tag_libraries" / "high_school_math_cn_default.json"
METHOD_LIBRARY_PATH = Path(os.environ["METHOD_LIBRARY_PATH"]) if os.getenv("METHOD_LIBRARY_PATH") else REPO_ROOT / "server" / "tag_libraries" / "high_school_methods.json"

DEFAULT_CLEANUP_SYSTEM_PROMPT = """你是高中数学 OCR 文本清理与分类工具。

你只做轻量文本清理，不解题、不补写、不改写数学含义，不强制重写 LaTeX。

必须修复：
1. 题干里的【答案】、【解析】、【详解】应移动到 answer / analysis 字段。
2. 删除页眉页脚、页码、版权水印、网站来源和模板品牌。
3. 删除题号和题干开头的讲义结构标签，如“典例”“例题”“变式”“即学即练”“课堂练习”“限时训练”“课后训练”。
4. 不要为了前端渲染强行改写公式；除非是明显 OCR 噪声，否则保留模型原生文本。
5. 请进行适当排版，必要时换行或分段展示公式，不要把多个公式杂糅在同一行或同一段里。

同时完成题目分类与难度评估：
- knowledge_points：根据题干、答案、解析识别本题涉及的高中数学知识点，返回字符串数组。
- solution_methods：识别本题使用的解题方法，返回字符串数组。
- difficulty_score_10：按高考/高三统考语境给 1-10 的整数难度分。
- difficulty_label：按分值输出基础/中等/较难/压轴之一。1-3 基础，4-6 中等，7-8 较难，9-10 压轴。
- 标签必须优先从 allowed_knowledge_points 与 allowed_solution_methods 中选择，使用完整名称。

只输出 JSON 对象，字段仅包含 problem_text、answer、analysis、knowledge_points、solution_methods、difficulty_score_10、difficulty_label。不要输出 Markdown 代码块，不要解释。"""

DEFAULT_CLEANUP_USER_PROMPT = """请轻量清理以下 OCR 字段并完成分类与难度评估，返回 JSON 对象，字段仅包含 problem_text、answer、analysis、knowledge_points、solution_methods、difficulty_score_10、difficulty_label。

不要强制修复 LaTeX；只处理页眉页脚、水印、字段错位、下一题混入等明显文本问题。
请进行适当排版，必要时换行或分段展示公式，不要把多个公式杂糅在同一行或同一段里。

{payload}"""

DEFAULT_CLASSIFICATION_SYSTEM_PROMPT = """你是高中数学题目分类工具。

根据题干、答案和解析识别：
1. knowledge_points：本题涉及的知识点，返回 1-6 个中文短标签。
2. solution_methods：本题使用的解题方法，返回 1-6 个中文短标签。
3. difficulty_score_10：按高考/高三统考语境给 1-10 的整数难度分。
4. difficulty_label：按分值输出基础/中等/较难/压轴之一。1-3 基础，4-6 中等，7-8 较难，9-10 压轴。

要求：
- 不改写题干、答案、解析。
- 标签要具体，例如“函数零点”“导数与单调性”“分类讨论”“数形结合”。
- 标签必须优先从 allowed_knowledge_points 与 allowed_solution_methods 中选择，使用完整名称。
- 只输出 JSON 对象，字段仅包含 knowledge_points、solution_methods、difficulty_score_10、difficulty_label。"""

DEFAULT_CLASSIFICATION_USER_PROMPT = """请对以下题目进行分类。

{payload}"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="清洗指定 run 的 OCR 草稿格式")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--root", type=Path, default=DATA_ROOT / "ocr_drafts")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--model", action="store_true", help="对需要模型清洗的记录调用清洗模型")
    parser.add_argument("--classify", action="store_true", help="使用清洗模型为题目生成知识点与解题方法标签")
    parser.add_argument("--concurrency", type=int, default=None, help="格式清洗并发数，最大 20")
    return parser.parse_args()


def cleanup_concurrency(override: int | None = None) -> int:
    load_dotenv()
    raw = override
    if raw is None:
        try:
            raw = int(os.getenv("OCR_CLEANUP_CONCURRENCY", "20") or "20")
        except ValueError:
            raw = 20
    return max(1, min(raw or 20, 20))


def model_fields(data: dict[str, object]) -> dict[str, object]:
    return {
        "problem_text": data.get("problem_text", ""),
        "answer": data.get("answer", ""),
        "analysis": data.get("analysis", ""),
        "figure_labels": data.get("figure_labels", []),
        "figure_visual_elements": data.get("figure_visual_elements", []),
        "possible_extra_content": data.get("possible_extra_content", []),
        "latex_risk": data.get("latex_risk", []),
        "uncertain_parts": data.get("uncertain_parts", []),
        "needs_human_review": data.get("needs_human_review", True),
    }


def strip_semantic_exercise_label(text: str) -> tuple[str, bool]:
    raw = str(text or "")
    cleaned = SEMANTIC_EXERCISE_LABEL_RE.sub("", raw, count=1).lstrip()
    return cleaned, cleaned != raw


def math_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for pattern in (r"\$\$.*?\$\$", r"\$[^$\n]*?\$"):
        spans.extend((match.start(), match.end()) for match in re.finditer(pattern, text, flags=re.S))
    return spans


def inside_span(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(span_start <= start and end <= span_end for span_start, span_end in spans)


def wrap_bare_cases_environment(text: str) -> tuple[str, bool]:
    spans = math_spans(text)
    changed = False

    def replace(match: re.Match[str]) -> str:
        nonlocal changed
        start, end = match.span()
        if inside_span(start, end, spans):
            return match.group(0)
        changed = True
        return f"$${match.group(0).strip()}$$"

    cleaned = re.sub(r"\\begin\{cases\}.*?\\end\{cases\}", replace, text, flags=re.S)
    return cleaned, changed


def repair_mixed_inline_display_delimiters(text: str) -> tuple[str, bool]:
    changed = False

    def replace(match: re.Match[str]) -> str:
        nonlocal changed
        changed = True
        return f"{match.group(1)}${match.group(2).strip()}${match.group(3)}"

    cleaned = re.sub(r"(^|[\u4e00-\u9fff，,；;：:\s])\$\$([^$\n]{1,240}?)\$(?=([。．.,，；;\s]|$))", replace, text)
    return cleaned, changed


def repair_nested_inline_math(text: str) -> tuple[str, bool]:
    changed = False
    command_pattern = (
        r"cup|cap|to|rightarrow|leftarrow|leftrightarrow|Rightarrow|Leftarrow|"
        r"cdot|times|leq|geq|neq|in|notin|subset|supset|subseteq|supseteq|"
        r"perp|parallel|triangle|angle|overrightarrow|vec"
    )
    token_pattern = r"[A-Za-z][A-Za-z0-9_{}\\^]*"
    next_text = text
    for _ in range(6):
        previous = next_text
        next_text = re.sub(
            rf"\$([^$\n]*\\(?:{command_pattern})\s*)\$({token_pattern})\$",
            lambda match: f"${match.group(1)}{match.group(2)}$",
            next_text,
        )
        if next_text == previous:
            break
        changed = True
    return next_text, changed


def wrap_raw_latex_field(text: str) -> tuple[str, bool]:
    value = str(text or "").strip()
    if not value or value.startswith("$") or "$" in value:
        return text, False
    if re.search(r"[\u4e00-\u9fff]", value):
        return text, False
    if not re.search(r"\\(?:frac|dfrac|sqrt|begin|overrightarrow|vec|triangle|angle|perp|parallel|cdot|times|leq|geq|neq)\b", value):
        return text, False
    depth = 0
    for char in value:
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        if depth < 0:
            return text, False
    if depth != 0:
        return text, False
    prefix = str(text or "")[: len(str(text or "")) - len(str(text or "").lstrip())]
    suffix = str(text or "")[len(str(text or "").rstrip()) :]
    return f"{prefix}${value}${suffix}", True


def script_clean(data: dict[str, object]) -> tuple[dict[str, object], bool, dict[str, object]]:
    cleaned = dict(data)
    normalized, post = normalize_model_output_fields(model_fields(cleaned))
    changed = False
    for key in FIELD_KEYS:
        value = str(normalized.get(key, ""))
        value, label_changed = strip_semantic_exercise_label(value)
        value, cases_changed = wrap_bare_cases_environment(value)
        value, delimiter_changed = repair_mixed_inline_display_delimiters(value)
        value, nested_changed = repair_nested_inline_math(value)
        value, raw_latex_changed = wrap_raw_latex_field(value)
        if cleaned.get(key, "") != value:
            cleaned[key] = value
            changed = True
        changed = changed or label_changed or cases_changed or delimiter_changed or nested_changed or raw_latex_changed
    if post:
        pp = dict(cleaned.get("post_processing") or {})
        pp["format_cleanup"] = post
        cleaned["post_processing"] = pp
    return cleaned, changed, post


def delimiter_balance_issues(text: str) -> list[str]:
    issues: list[str] = []
    if any(not match.group(1).strip() for match in re.finditer(r"\$\$(.*?)\$\$", text, flags=re.S)):
        issues.append("empty_or_stray_dollar_run")
    if text.count("$$") % 2:
        issues.append("display_math_delimiter_unbalanced")
    if "\\begin{cases}" in text and "\\end{cases}" not in text:
        issues.append("cases_environment_unclosed")
    if "\\end{cases}" in text and "\\begin{cases}" not in text:
        issues.append("cases_environment_unopened")
    if re.search(r"\$(即|则|于是|所以|故|可得|有)[^$\n]*(?:\\(?:frac|dfrac|sum|sqrt|cdot|binom|infty|mathbb)|[A-Z]\()[^$\n]*\$", text):
        issues.append("inline_math_contains_chinese_connector")
    if "\\left" in text and "\\right" not in text:
        issues.append("left_right_delimiter_suspect")
    return issues


def detect_model_cleanup_reasons(data: dict[str, object], *, include_review_reasons: bool = True) -> list[str]:
    reasons: list[str] = []
    problem = str(data.get("problem_text") or "")
    answer = str(data.get("answer") or "")
    analysis = str(data.get("analysis") or "")
    if re.search(r"(【答案】|答案[:：]|【解析】|解析[:：]|【详解】|详解[:：])", problem):
        reasons.append("problem_contains_answer_or_analysis_marker")
    for key, text in (("problem_text", problem), ("answer", answer), ("analysis", analysis)):
        for issue in delimiter_balance_issues(text):
            reasons.append(f"{key}:{issue}")
    post_processing = data.get("post_processing") if isinstance(data.get("post_processing"), dict) else {}
    format_cleanup = post_processing.get("format_cleanup") if isinstance(post_processing, dict) and isinstance(post_processing.get("format_cleanup"), dict) else {}
    model_reviewed = bool(format_cleanup.get("model_reviewed")) if isinstance(format_cleanup, dict) else False
    if include_review_reasons and not model_reviewed and (len(analysis) > 3500 or len(problem) > 1800):
        reasons.append("long_content_needs_model_review")
    if any(isinstance(data.get(key), str) and "\\\\ E(" in str(data.get(key)) for key in FIELD_KEYS):
        reasons.append("formula_linebreak_suspect")
    return sorted(set(reasons))


def cleanup_model_settings() -> dict[str, str]:
    load_dotenv()
    return {
        "api_base_url": os.getenv("OCR_CLEANUP_API_BASE_URL") or os.getenv("OCR_API_BASE_URL") or "",
        "api_key": os.getenv("OCR_CLEANUP_API_KEY") or os.getenv("OCR_API_KEY") or "",
        "model": os.getenv("OCR_CLEANUP_MODEL") or os.getenv("OCR_MODEL") or "",
        "timeout": os.getenv("OCR_CLEANUP_TIMEOUT_SECONDS") or "60",
    }


def prompt_settings() -> dict[str, str]:
    if not PROMPT_SETTINGS_PATH.exists():
        return {}
    try:
        payload = json.loads(PROMPT_SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {str(k): str(v) for k, v in payload.items() if str(v).strip()}


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
        tag = re.sub(r"\s+", "", str(item).strip())
        if not tag or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag[:30])
    return tags[:8]


def read_tag_libraries() -> dict[str, list[str]]:
    try:
        knowledge_payload = json.loads(KNOWLEDGE_LIBRARY_PATH.read_text(encoding="utf-8")) if KNOWLEDGE_LIBRARY_PATH.exists() else {}
        method_payload = json.loads(METHOD_LIBRARY_PATH.read_text(encoding="utf-8")) if METHOD_LIBRARY_PATH.exists() else {}
    except Exception:
        return {"knowledge_points": [], "solution_methods": []}
    knowledge_points = [
        str(item.get("name", ""))
        for chapter in knowledge_payload.get("chapters", [])
        for item in chapter.get("knowledgePoints", [])
        if item.get("name")
    ]
    solution_methods = [
        str(item.get("name", ""))
        for group in method_payload.get("groups", [])
        for item in group.get("tags", [])
        if item.get("name")
    ]
    return {"knowledge_points": knowledge_points, "solution_methods": solution_methods}


def has_classification(data: dict[str, object]) -> bool:
    return bool(normalize_tags(data.get("knowledge_points")) or normalize_tags(data.get("solution_methods"))) and difficulty_score(data.get("difficulty_score_10")) > 0


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


def endpoint_candidates(base_url: str) -> list[str]:
    base = base_url.strip().rstrip("/")
    if not base:
        return []
    return [base] if base.endswith("/chat/completions") else [base, f"{base}/chat/completions"]


def validate_render_errors(data: dict[str, object]) -> list[dict[str, object]]:
    payload = {key: data.get(key, "") for key in FIELD_KEYS}
    try:
        proc = subprocess.run(
            ["node", str(MATH_RENDER_VALIDATOR)],
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            capture_output=True,
            timeout=5,
            cwd=str(PROJECT_ROOT.parent),
            check=False,
        )
    except Exception as exc:
        return [{
            "field": "system",
            "code": "render_validator_failed",
            "message": str(exc),
            "snippet": "",
        }]
    if proc.returncode != 0:
        return [{
            "field": "system",
            "code": "render_validator_failed",
            "message": (proc.stderr or proc.stdout or "").strip(),
            "snippet": "",
        }]
    try:
        result = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return [{
            "field": "system",
            "code": "render_validator_invalid_output",
            "message": proc.stdout[:500],
            "snippet": "",
        }]
    errors = result.get("errors", [])
    return errors if isinstance(errors, list) else []


def render_error_reasons(errors: list[dict[str, object]]) -> list[str]:
    reasons: list[str] = []
    for error_item in errors:
        field = str(error_item.get("field") or "unknown")
        code = str(error_item.get("code") or "render_error")
        reasons.append(f"{field}:{code}")
    return sorted(set(reasons))


def call_cleanup_model(data: dict[str, object], reasons: list[str], render_errors: list[dict[str, object]] | None = None) -> dict[str, object]:
    settings = cleanup_model_settings()
    if not settings["api_base_url"] or not settings["api_key"] or not settings["model"]:
        raise RuntimeError("缺少清洗模型配置：OCR_CLEANUP_API_BASE_URL / OCR_CLEANUP_API_KEY / OCR_CLEANUP_MODEL")
    prompt = {
        "problem_text": data.get("problem_text", ""),
        "answer": data.get("answer", ""),
        "analysis": data.get("analysis", ""),
        "knowledge_points": normalize_tags(data.get("knowledge_points")),
        "solution_methods": normalize_tags(data.get("solution_methods")),
        "difficulty_score_10": difficulty_score(data.get("difficulty_score_10")),
        "difficulty_label": data.get("difficulty_label", ""),
        "allowed_knowledge_points": read_tag_libraries()["knowledge_points"],
        "allowed_solution_methods": read_tag_libraries()["solution_methods"],
        "cleanup_reasons": reasons,
        "render_errors": render_errors or [],
    }
    prompts = prompt_settings()
    system_prompt = prompts.get("cleanup_system_prompt", DEFAULT_CLEANUP_SYSTEM_PROMPT)
    user_template = prompts.get("cleanup_user_prompt", DEFAULT_CLEANUP_USER_PROMPT)
    user_prompt = user_template.format(payload=json.dumps(prompt, ensure_ascii=False), reasons=json.dumps(reasons, ensure_ascii=False))
    messages = [
        {
            "role": "system",
            "content": system_prompt,
        },
        {
            "role": "user",
            "content": user_prompt,
        },
    ]
    payload = {
        "model": settings["model"],
        "messages": messages,
        "temperature": 0.01,
        "top_p": 0.1,
        "stream": False,
    }
    last_error = ""
    for endpoint in endpoint_candidates(settings["api_base_url"]):
        req = request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={"Authorization": f"Bearer {settings['api_key']}", "Content-Type": "application/json"},
        )
        try:
            with request.urlopen(req, timeout=max(10, int(float(settings.get("timeout") or "60")))) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                body = json.loads(raw)
                text = (body.get("choices") or [{}])[0].get("message", {}).get("content", "")
                cleaned = extract_json(text)
                merged = dict(data)
                for key in FIELD_KEYS:
                    if isinstance(cleaned.get(key), str):
                        merged[key] = cleaned[key].strip()
                for key in TAG_KEYS:
                    tags = normalize_tags(cleaned.get(key))
                    if tags:
                        merged[key] = tags
                score = difficulty_score(cleaned.get("difficulty_score_10"))
                if score:
                    merged["difficulty_score_10"] = score
                    merged["difficulty_label"] = difficulty_label(score)
                return merged
        except Exception as exc:
            last_error = str(exc)
            if isinstance(exc, error.HTTPError) and exc.code == 404:
                continue
            break
    raise RuntimeError(last_error or "清洗模型调用失败")


def call_classification_model(data: dict[str, object]) -> dict[str, object]:
    settings = cleanup_model_settings()
    if not settings["api_base_url"] or not settings["api_key"] or not settings["model"]:
        raise RuntimeError("缺少分类模型配置：分类任务沿用 OCR_CLEANUP_API_BASE_URL / OCR_CLEANUP_API_KEY / OCR_CLEANUP_MODEL")
    prompt = {
        "problem_text": data.get("problem_text", ""),
        "answer": data.get("answer", ""),
        "analysis": data.get("analysis", ""),
        "allowed_knowledge_points": read_tag_libraries()["knowledge_points"],
        "allowed_solution_methods": read_tag_libraries()["solution_methods"],
    }
    prompts = prompt_settings()
    messages = [
        {"role": "system", "content": prompts.get("classification_system_prompt", DEFAULT_CLASSIFICATION_SYSTEM_PROMPT)},
        {
            "role": "user",
            "content": prompts.get("classification_user_prompt", DEFAULT_CLASSIFICATION_USER_PROMPT).format(
                payload=json.dumps(prompt, ensure_ascii=False)
            ),
        },
    ]
    payload = {
        "model": settings["model"],
        "messages": messages,
        "temperature": 0.01,
        "top_p": 0.1,
        "stream": False,
    }
    last_error = ""
    for endpoint in endpoint_candidates(settings["api_base_url"]):
        req = request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={"Authorization": f"Bearer {settings['api_key']}", "Content-Type": "application/json"},
        )
        try:
            with request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                body = json.loads(raw)
                text = (body.get("choices") or [{}])[0].get("message", {}).get("content", "")
                classified = extract_json(text)
                merged = dict(data)
                merged["knowledge_points"] = normalize_tags(classified.get("knowledge_points"))
                merged["solution_methods"] = normalize_tags(classified.get("solution_methods"))
                score = difficulty_score(classified.get("difficulty_score_10"))
                if score:
                    merged["difficulty_score_10"] = score
                    merged["difficulty_label"] = difficulty_label(score)
                return merged
        except Exception as exc:
            last_error = str(exc)
            if isinstance(exc, error.HTTPError) and exc.code == 404:
                continue
            break
    raise RuntimeError(last_error or "分类模型调用失败")


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
    raise RuntimeError("清洗模型没有返回合法 JSON")


def process_result_path(result_path: Path, *, apply_changes: bool, use_model: bool, classify: bool) -> dict[str, object]:
    data = json.loads(result_path.read_text(encoding="utf-8"))
    cleaned, changed, post = script_clean(data)
    pre_reasons = detect_model_cleanup_reasons(cleaned, include_review_reasons=True)
    render_errors = validate_render_errors(cleaned)
    reasons = sorted(set(pre_reasons + render_error_reasons(render_errors)))
    model_error = ""
    classification_error = ""
    model_attempted = False
    model_resolved = False
    classification_attempted = False
    classification_resolved = False
    if use_model and reasons:
        model_attempted = True
        for attempt in range(2):
            try:
                before_model = {key: cleaned.get(key, "") for key in FIELD_KEYS}
                cleaned = call_cleanup_model(cleaned, reasons, render_errors)
                model_field_changed = any(before_model.get(key, "") != cleaned.get(key, "") for key in FIELD_KEYS)
                cleaned, model_changed, post2 = script_clean(cleaned)
                changed = changed or model_field_changed or model_changed
                post = {**post, **post2}
                render_errors = validate_render_errors(cleaned)
                reasons = sorted(set(detect_model_cleanup_reasons(cleaned, include_review_reasons=False) + render_error_reasons(render_errors)))
                if not reasons:
                    pp = dict(cleaned.get("post_processing") or {})
                    fc = dict(pp.get("format_cleanup") or {})
                    fc["model_reviewed"] = True
                    fc["model_cleanup_attempts"] = attempt + 1
                    pp["format_cleanup"] = fc
                    cleaned["post_processing"] = pp
                    changed = True
                    model_resolved = True
                    break
            except Exception as exc:
                model_error = str(exc)
                break
    if classify and (not has_classification(cleaned) or (use_model and reasons)):
        classification_attempted = True
        try:
            before_tags = {key: normalize_tags(cleaned.get(key)) for key in TAG_KEYS}
            before_score = difficulty_score(cleaned.get("difficulty_score_10"))
            if use_model and reasons:
                tagged = cleaned
            else:
                tagged = call_classification_model(cleaned)
            for key in TAG_KEYS:
                cleaned[key] = normalize_tags(tagged.get(key))
            score = difficulty_score(tagged.get("difficulty_score_10"))
            if score:
                cleaned["difficulty_score_10"] = score
                cleaned["difficulty_label"] = difficulty_label(score)
            classification_resolved = bool(normalize_tags(cleaned.get("knowledge_points")) or normalize_tags(cleaned.get("solution_methods"))) and difficulty_score(cleaned.get("difficulty_score_10")) > 0
            changed = changed or any(before_tags[key] != normalize_tags(cleaned.get(key)) for key in TAG_KEYS) or before_score != difficulty_score(cleaned.get("difficulty_score_10"))
        except Exception as exc:
            classification_error = str(exc)
    if apply_changes and changed:
        result_path.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
        (result_path.parent / "question.md").write_text(render_question_markdown(cleaned), encoding="utf-8")
    return {
        "id": data.get("id") or result_path.parent.name,
        "draft": result_path.parent.name,
        "scriptChanged": changed,
        "needsModelCleanup": bool(reasons),
        "reasons": reasons,
        "renderErrors": render_errors,
        "modelError": model_error,
        "classificationError": classification_error,
        "knowledgePoints": normalize_tags(cleaned.get("knowledge_points")),
        "solutionMethods": normalize_tags(cleaned.get("solution_methods")),
        "difficultyScore10": difficulty_score(cleaned.get("difficulty_score_10")),
        "difficultyLabel": cleaned.get("difficulty_label") or difficulty_label(difficulty_score(cleaned.get("difficulty_score_10"))),
        "_modelAttempted": model_attempted,
        "_modelResolved": model_resolved,
        "_classificationAttempted": classification_attempted,
        "_classificationResolved": classification_resolved,
        "_failed": bool(model_error or classification_error),
    }


def main() -> int:
    args = parse_args()
    report_dir = DATA_ROOT / "format_cleanup_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"{args.run_id}.json"
    records = []
    examined = script_changed = model_needed = model_attempted = model_resolved = classification_attempted = classification_resolved = failed = 0
    result_paths = sorted(args.root.glob(f"{args.run_id}*/ocr_result.json"))
    workers = min(cleanup_concurrency(args.concurrency), len(result_paths) or 1)
    if workers <= 1:
        records = [
            process_result_path(result_path, apply_changes=args.apply, use_model=args.model, classify=args.classify)
            for result_path in result_paths
        ]
    else:
        completed: dict[int, dict[str, object]] = {}
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(process_result_path, result_path, apply_changes=args.apply, use_model=args.model, classify=args.classify): index
                for index, result_path in enumerate(result_paths)
            }
            for future in as_completed(futures):
                index = futures[future]
                try:
                    completed[index] = future.result()
                except Exception as exc:
                    completed[index] = {
                        "id": result_paths[index].parent.name,
                        "draft": result_paths[index].parent.name,
                        "scriptChanged": False,
                        "needsModelCleanup": True,
                        "reasons": ["format_cleanup_worker_failed"],
                        "renderErrors": [],
                        "modelError": str(exc),
                        "classificationError": "",
                        "knowledgePoints": [],
                        "solutionMethods": [],
                        "_modelAttempted": False,
                        "_modelResolved": False,
                        "_classificationAttempted": False,
                        "_classificationResolved": False,
                        "_failed": True,
                    }
        records = [completed[index] for index in sorted(completed)]
    examined = len(records)
    script_changed = sum(1 for record in records if record.get("scriptChanged"))
    model_needed = sum(1 for record in records if record.get("needsModelCleanup"))
    model_attempted = sum(1 for record in records if record.get("_modelAttempted"))
    model_resolved = sum(1 for record in records if record.get("_modelResolved"))
    classification_attempted = sum(1 for record in records if record.get("_classificationAttempted"))
    classification_resolved = sum(1 for record in records if record.get("_classificationResolved"))
    failed = sum(1 for record in records if record.get("_failed"))
    for record in records:
        record.pop("_modelAttempted", None)
        record.pop("_modelResolved", None)
        record.pop("_classificationAttempted", None)
        record.pop("_classificationResolved", None)
        record.pop("_failed", None)
    report = {
        "runId": args.run_id,
        "concurrency": workers,
        "examinedCount": examined,
        "scriptChangedCount": script_changed,
        "modelNeededCount": model_needed,
        "modelAttemptedCount": model_attempted,
        "modelResolvedCount": model_resolved,
        "modelCleanedCount": model_resolved,
        "classificationAttemptedCount": classification_attempted,
        "classificationResolvedCount": classification_resolved,
        "failedCount": failed,
        "applied": args.apply,
        "modelMode": args.model,
        "classificationMode": args.classify,
        "records": records,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
