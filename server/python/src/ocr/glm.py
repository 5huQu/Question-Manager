from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
import shutil
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .doc2x import normalize_math_delimiters, normalize_question_no


DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/layout_parsing"
DEFAULT_MODEL = "glm-ocr"
QUESTION_START_RE = r"(?m)(?:^|\n)\s*(?:第\s*)?{number}\s*[.．、]\s*"
IMAGE_RE = re.compile(r"<img\b[^>]*\bsrc=['\"]([^'\"]+)['\"][^>]*>", re.IGNORECASE)


class GlmOcrError(RuntimeError):
    def __init__(self, message: str, *, code: str = "", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class GlmOcrSettings:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL
    max_retries: int = 2
    timeout_seconds: int = 900


def _atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def _atomic_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(value, encoding="utf-8")
    temp.replace(path)


def _split_fields(value: str) -> tuple[str, str, str, bool]:
    answer = re.search(r"【答案】", value)
    analysis = re.search(r"【(?:解析|分析)】", value)
    if answer and analysis and answer.start() < analysis.start():
        return value[:answer.start()].strip(), value[answer.end():analysis.start()].strip(), value[analysis.end():].strip(), True
    if answer:
        return value[:answer.start()].strip(), value[answer.end():].strip(), "", True
    if analysis:
        return value[:analysis.start()].strip(), "", value[analysis.end():].strip(), True
    return value.strip(), "", "", False


def _block_text(block: dict[str, Any]) -> str:
    label = str(block.get("label") or "")
    content = str(block.get("content") or "").strip()
    if not content:
        return ""
    if label == "image":
        return f"\n\n<img src=\"{content}\">\n\n"
    return content


def _page_texts(payload: dict[str, Any]) -> list[str]:
    pages: list[str] = []
    for page in payload.get("layout_details") or []:
        parts = [_block_text(block) for block in page if isinstance(block, dict)]
        pages.append("\n\n".join(part for part in parts if part).strip())
    return pages


def _joined_pages(pages: list[str]) -> str:
    return "\n\n".join(f"<!-- GLM_PAGE:{index + 1} -->\n{content}" for index, content in enumerate(pages))


def split_exam_markdown(pages: list[str], expected_numbers: list[str]) -> dict[str, dict[str, Any]]:
    source = _joined_pages(pages)
    starts: list[tuple[str, int, int]] = []
    cursor = 0
    for number in expected_numbers:
        normalized = normalize_question_no(number)
        if not normalized:
            continue
        match = re.search(QUESTION_START_RE.format(number=re.escape(normalized)), source[cursor:])
        if not match:
            continue
        start = cursor + match.start()
        starts.append((normalized, start, cursor + match.end()))
        cursor += match.end()
    output: dict[str, dict[str, Any]] = {}
    for index, (number, start, content_start) in enumerate(starts):
        end = starts[index + 1][1] if index + 1 < len(starts) else len(source)
        raw = source[content_start:end].strip()
        stem, answer, analysis, has_markers = _split_fields(raw)
        page_values = [int(value) for value in re.findall(r"<!-- GLM_PAGE:(\d+) -->", source[start:end])]
        output[number] = {
            "question_no": number,
            "raw": raw,
            "stem": normalize_math_delimiters(re.sub(r"<!-- GLM_PAGE:\d+ -->", "", stem)),
            "answer": normalize_math_delimiters(re.sub(r"<!-- GLM_PAGE:\d+ -->", "", answer)),
            "analysis": normalize_math_delimiters(re.sub(r"<!-- GLM_PAGE:\d+ -->", "", analysis)),
            "has_markers": has_markers,
            "page_indices": page_values,
        }
    return output


def _bbox_fraction(block: dict[str, Any], page_info: dict[str, Any]) -> tuple[float, float, float, float] | None:
    bbox = block.get("bbox_2d")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    try:
        x1, y1, x2, y2 = [float(value) for value in bbox]
        width = float(page_info.get("width") or 0)
        height = float(page_info.get("height") or 0)
    except (TypeError, ValueError):
        return None
    if max(abs(x1), abs(y1), abs(x2), abs(y2)) <= 1:
        return x1, y1, x2, y2
    if width <= 0 or height <= 0:
        return None
    return x1 / width, y1 / height, x2 / width, y2 / height


def _region_fraction(segment: dict[str, Any]) -> tuple[float, float, float, float] | None:
    bbox = segment.get("bbox") or {}
    try:
        x = float(bbox.get("x", bbox.get("x0", 0))) / 595.3
        y = float(bbox.get("y", bbox.get("y0", 0))) / 841.9
        width = float(bbox.get("width", bbox.get("w", 0))) / 595.3
        height = float(bbox.get("height", bbox.get("h", 0))) / 841.9
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return x, y, x + width, y + height


def _overlap(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> float:
    x1, y1 = max(left[0], right[0]), max(left[1], right[1])
    x2, y2 = min(left[2], right[2]), min(left[3], right[3])
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def _fields_from_regions(record: dict[str, Any], payload: dict[str, Any]) -> dict[str, str]:
    regions = record.get("text_regions") or []
    details = payload.get("layout_details") or []
    infos = ((payload.get("data_info") or {}).get("pages") or [])
    values: dict[str, list[str]] = {"problem": [], "answer": [], "analysis": []}
    for region in regions:
        kind = str(region.get("kind") or "")
        if kind not in values:
            continue
        for segment in region.get("segments") or []:
            page_number = int(segment.get("page_number") or segment.get("pageNumber") or 0)
            page_index = page_number - 1
            if page_index < 0 or page_index >= len(details):
                continue
            target = _region_fraction(segment)
            if not target:
                continue
            page_info = infos[page_index] if page_index < len(infos) and isinstance(infos[page_index], dict) else {}
            for block in details[page_index]:
                if str(block.get("label") or "") == "image":
                    continue
                block_box = _bbox_fraction(block, page_info)
                text = _block_text(block)
                if block_box and text and _overlap(target, block_box) > 0.0001:
                    values[kind].append(text)
    return {key: normalize_math_delimiters("\n\n".join(dict.fromkeys(value))) for key, value in values.items()}


def _download_asset(url: str, target: Path) -> str:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "Question-Manager/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output)
    return str(target)


def _glm_figures(record: dict[str, Any], payload: dict[str, Any], artifact_dir: Path, storage_root: Path) -> list[dict[str, Any]]:
    figures: list[dict[str, Any]] = []
    page_span = set(range(int(record.get("page") or 1), int((record.get("page_span") or [record.get("page") or 1])[-1]) + 1))
    infos = ((payload.get("data_info") or {}).get("pages") or [])
    for page_index, page in enumerate(payload.get("layout_details") or []):
        page_number = page_index + 1
        if page_number not in page_span:
            continue
        page_info = infos[page_index] if page_index < len(infos) and isinstance(infos[page_index], dict) else {}
        for block in page:
            if str(block.get("label") or "") != "image" or not str(block.get("content") or "").startswith("http"):
                continue
            url = str(block["content"])
            digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
            target = artifact_dir / "assets" / f"glm_{page_number}_{digest}.jpg"
            try:
                local = Path(_download_asset(url, target))
                relative = local.resolve().relative_to(storage_root.resolve()).as_posix()
            except (OSError, urllib.error.URLError, ValueError):
                continue
            fraction = _bbox_fraction(block, page_info)
            bbox = {"x": fraction[0] if fraction else 0, "y": fraction[1] if fraction else 0, "width": (fraction[2] - fraction[0]) if fraction else 0, "height": (fraction[3] - fraction[1]) if fraction else 0}
            figures.append({"id": f"glm_{page_number}_{digest}", "origin": "glm_ocr", "usage": "stem", "category": "question", "pageNumber": page_number, "bbox": bbox, "path": relative, "blockId": str(block.get("index") or digest)})
    return figures


def build_drafts(*, result_payload: dict[str, Any], manifest: list[dict[str, Any]], drafts_root: Path, artifact_dir: Path, storage_root: Path, single_question: bool = False) -> dict[str, Any]:
    pages = _page_texts(result_payload)
    expected = [normalize_question_no(record.get("question_no")) for record in manifest]
    parsed = split_exam_markdown(pages, expected)
    successes = 0
    failures: list[dict[str, str]] = []
    for record in manifest:
        record_id = str(record.get("id") or "")
        question_no = normalize_question_no(record.get("question_no"))
        item = parsed.get(question_no)
        if single_question and len(manifest) == 1 and not item:
            raw = _joined_pages(pages)
            stem, answer, analysis, has_markers = _split_fields(raw)
            item = {"raw": raw, "stem": stem, "answer": answer, "analysis": analysis, "has_markers": has_markers, "page_indices": list(range(1, len(pages) + 1))}
        draft_dir = drafts_root / record_id
        draft_dir.mkdir(parents=True, exist_ok=True)
        if not item:
            failures.append({"id": record_id, "question_no": question_no, "error": "GLM-OCR 未找到题号"})
            result = {**record, "id": record_id, "ocr_status": "failed", "problem_text": "", "answer": "", "analysis": "", "figures": record.get("figures") or [], "needs_human_review": True, "post_processing": {"provider": "glm", "error": "question_number_not_found"}}
        else:
            region_fields = {} if single_question else _fields_from_regions(record, result_payload)
            problem = region_fields.get("problem") or item["stem"]
            answer = region_fields.get("answer") or item["answer"]
            analysis = region_fields.get("analysis") or item["analysis"]
            figures = _glm_figures(record, result_payload, artifact_dir, storage_root) or (record.get("figures") or [])
            result = {**record, "id": record_id, "question_no": record.get("question_no", question_no), "ocr_status": "draft", "problem_text": normalize_math_delimiters(problem), "answer": normalize_math_delimiters(answer), "analysis": normalize_math_delimiters(analysis), "figures": figures, "needs_human_review": not bool(problem) or (not bool(answer) and not bool(analysis)), "raw_model_output": item["raw"], "post_processing": {"provider": "glm", "page_indices": item.get("page_indices") or [], "used_text_regions": bool(region_fields.get("problem") or region_fields.get("answer") or region_fields.get("analysis")), "has_answer_analysis_markers": bool(item.get("has_markers"))}}
            successes += 1
        _atomic_json(draft_dir / "ocr_result.json", result)
        _atomic_text(draft_dir / "question.md", f"# 题目\n\n{result.get('problem_text') or ''}\n\n# 答案\n\n{result.get('answer') or ''}\n\n# 解析\n\n{result.get('analysis') or ''}\n")
    report = {"total": len(manifest), "successful": successes, "failed": len(failures), "failures": failures}
    _atomic_json(artifact_dir / "normalize.report.json", report)
    return report


class GlmOcrClient:
    def __init__(self, settings: GlmOcrSettings):
        self.settings = settings

    def parse(self, file_path: Path, *, request_id: str) -> dict[str, Any]:
        if not file_path.exists():
            raise GlmOcrError(f"找不到 OCR 输入文件：{file_path}", code="missing_input")
        limit = 50 * 1024 * 1024 if file_path.suffix.lower() == ".pdf" else 10 * 1024 * 1024
        if file_path.stat().st_size > limit:
            raise GlmOcrError("GLM-OCR 输入文件超过官方大小限制，请改用单题重新 OCR。", code="file_too_large")
        mime = mimetypes.guess_type(file_path.name)[0] or ("application/pdf" if file_path.suffix.lower() == ".pdf" else "image/png")
        encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
        body = json.dumps({"model": self.settings.model, "file": f"data:{mime};base64,{encoded}", "return_crop_images": True, "need_layout_visualization": True, "request_id": request_id, "user_id": "question-manager"}, ensure_ascii=False).encode("utf-8")
        last_error: Exception | None = None
        for attempt in range(self.settings.max_retries + 1):
            request = urllib.request.Request(self.settings.base_url, data=body, headers={"Authorization": f"Bearer {self.settings.api_key}", "Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=self.settings.timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                if exc.code in {429, 500, 502, 503, 504} and attempt < self.settings.max_retries:
                    time.sleep(2 ** attempt)
                    continue
                raise GlmOcrError(f"GLM-OCR HTTP {exc.code}: {raw[:500]}", code=f"http_{exc.code}", retryable=exc.code == 429) from exc
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt < self.settings.max_retries:
                    time.sleep(2 ** attempt)
                    continue
        raise GlmOcrError(f"GLM-OCR 请求失败：{last_error}", code="network_error", retryable=True)
