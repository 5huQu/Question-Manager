from __future__ import annotations

import hashlib
import http.client
import json
import mimetypes
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


DEFAULT_BASE_URL = "https://v2.doc2x.noedgeai.com"
DEFAULT_MODEL = "v3-2026"
PAGE_MARKER_RE = re.compile(r"<!-- DOC2X_PAGE:(\d+) -->")
IMAGE_RE = re.compile(r'<img\b[^>]*\bsrc="([^"]+)"[^>]*>', re.IGNORECASE)
MEANINGLESS_RE = re.compile(r"<!--\s*Meanless:[\s\S]*?-->", re.IGNORECASE)
SECTION_RE = re.compile(r"(?m)^\s*(?:#{1,6}\s*)?[一二三四五六七八九十]+[、.．]\s*")
WATERMARK_LINE_RE = re.compile(
    r"(?m)^\s*(?:#{1,6}\s*)?(?:学科网|组卷网|菁优网)(?:\s|\+|角|企|药|①|编辑题|制图工程师|上课题|上海网|卷网|框架|上市)*\s*$"
)
ANSWER_KEY_LINE_RE = re.compile(r"(?m)^\s*(?:第\s*)?\d{1,3}\s*[.．、]\s*(?:答案\s*[:：]?\s*)?(?:[A-D](?:\s*[,，、/]\s*[A-D]){0,3}|[-+]?\d+(?:\.\d+)?|√|×)\s*$")
SOLUTION_REASONING_RE = re.compile(r"(?:【(?:解析|分析|详解)】|\b(?:证明|解答|由此|因此)\b|∵|∴|故[，：:])")


class Doc2xError(RuntimeError):
    def __init__(self, message: str, *, code: str = "", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class Doc2xSettings:
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL
    poll_seconds: float = 3.0
    max_retries: int = 3
    timeout_seconds: int = 90


def _atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def normalize_question_no(value: Any) -> str:
    compact = re.sub(r"\s+", "", str(value or ""))
    compact = re.sub(r"^(?:第)?", "", compact)
    compact = re.sub(r"(?:题)?[.．、:：)）]$", "", compact)
    match = re.search(r"\d{1,3}", compact)
    return str(int(match.group(0))) if match else compact.upper()


def normalize_math_delimiters(value: str) -> str:
    value = re.sub(r"\\\[\s*", "\n$$\n", value)
    value = re.sub(r"\s*\\\]", "\n$$\n", value)
    value = re.sub(r"\\\(", "$", value)
    value = re.sub(r"\\\)", "$", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def clean_page_markdown(value: str) -> str:
    value = MEANINGLESS_RE.sub("", value)
    value = WATERMARK_LINE_RE.sub("", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def _page_ids_for_range(source: str, start: int, end: int) -> list[int]:
    before = list(PAGE_MARKER_RE.finditer(source, 0, start))
    within = list(PAGE_MARKER_RE.finditer(source, start, end))
    values: list[int] = []
    if before:
        values.append(int(before[-1].group(1)))
    values.extend(int(match.group(1)) for match in within)
    return list(dict.fromkeys(values))


def _split_fields(chunk: str) -> tuple[str, str, str, bool]:
    answer_match = re.search(r"【答案】", chunk)
    analysis_match = re.search(r"【解析】", chunk)
    if answer_match and analysis_match and analysis_match.start() > answer_match.start():
        return (
            chunk[: answer_match.start()].strip(),
            chunk[answer_match.end() : analysis_match.start()].strip(),
            chunk[analysis_match.end() :].strip(),
            True,
        )
    if answer_match:
        return chunk[: answer_match.start()].strip(), chunk[answer_match.end() :].strip(), "", True
    if analysis_match:
        return chunk[: analysis_match.start()].strip(), "", chunk[analysis_match.end() :].strip(), True
    return chunk.strip(), "", "", False


def classify_solution_document(pages: list[dict[str, Any]]) -> str:
    """Classify a separate answer document when it lacks explicit field markers."""
    text = "\n".join(str(page.get("md") or "") for page in pages)
    if "【答案】" in text or "【解析】" in text or "【分析】" in text:
        return "marked"
    answer_lines = len(ANSWER_KEY_LINE_RE.findall(text))
    reasoning_hits = len(SOLUTION_REASONING_RE.findall(text))
    return "answer_key" if answer_lines >= 2 and answer_lines > reasoning_hits else "analysis"


def solution_fields(chunk: str, document_kind: str) -> tuple[str, str, str, bool]:
    """Return answer/analysis fields for one numbered chunk from a solution PDF."""
    _stem, answer, analysis, has_markers = _split_fields(chunk)
    if has_markers:
        # Some answer PDFs put a section-level "【解析】" heading immediately
        # after the final question of the preceding section.  It is a boundary,
        # not a field marker for that question; retain the preceding body as
        # its analysis instead of discarding it as an empty marked field.
        if not answer and not analysis and _stem.strip():
            return "", re.sub(r"\n?\s*#{1,6}\s*$", "", _stem).strip(), False
        return answer, analysis, True
    value = chunk.strip()
    if document_kind == "answer_key":
        return value, "", False
    return "", value, False


def _strip_page_markers(value: str) -> str:
    return PAGE_MARKER_RE.sub("", value).strip()


def split_exam_markdown(pages: list[dict[str, Any]], expected_numbers: list[str]) -> dict[str, dict[str, Any]]:
    joined = "\n\n".join(
        f'<!-- DOC2X_PAGE:{int(page.get("page_idx", index))} -->\n{clean_page_markdown(str(page.get("md") or ""))}'
        for index, page in enumerate(pages)
    )
    first_section = SECTION_RE.search(joined)
    search_start = first_section.start() if first_section else 0
    starts: list[tuple[str, int, int]] = []
    # The manifest is an association from question number to a review item, not
    # a trustworthy representation of the PDF's reading order: manual review
    # item IDs may be UUIDs.  Locate every expected heading independently, then
    # order the boundaries by their actual position in the Doc2X Markdown.
    # This keeps a shuffled manifest from skipping early questions or merging
    # every intervening question into the next successful match.
    for question_no in dict.fromkeys(expected_numbers):
        escaped = re.escape(question_no)
        pattern = re.compile(rf"(?m)^\s*(?:#+\s*)?{escaped}[.．、]\s+")
        match = pattern.search(joined, search_start)
        if not match:
            continue
        starts.append((question_no, match.start(), match.end()))
    starts.sort(key=lambda item: item[1])

    output: dict[str, dict[str, Any]] = {}
    for index, (question_no, start, content_start) in enumerate(starts):
        end = starts[index + 1][1] if index + 1 < len(starts) else len(joined)
        raw = joined[content_start:end].strip()
        stem, answer, analysis, has_markers = _split_fields(raw)
        output[question_no] = {
            "question_no": question_no,
            "stem": normalize_math_delimiters(_strip_page_markers(stem)),
            "answer": normalize_math_delimiters(_strip_page_markers(answer)),
            "analysis": normalize_math_delimiters(_strip_page_markers(analysis)),
            "has_markers": has_markers,
            "page_indices": _page_ids_for_range(joined, start, end),
            "image_urls": list(dict.fromkeys(IMAGE_RE.findall(raw))),
            "raw": raw,
        }
    return output


def _asset_extension(url: str, content_type: str = "") -> str:
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp"}:
        return suffix
    guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) if content_type else None
    return guessed if guessed in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"


def _figure_blocks(pages: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for page in pages:
        page_idx = int(page.get("page_idx", 0))
        for block in ((page.get("layout") or {}).get("blocks") or []):
            src = str(block.get("src") or "")
            if src and block.get("type") == "Figure":
                output[src] = {**block, "page_idx": page_idx}
    return output


def _remove_remote_images(value: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", IMAGE_RE.sub("", value)).strip()


def inline_doc2x_figures(value: str, figures_by_url: dict[str, dict[str, Any]]) -> str:
    """Replace Doc2X image HTML with a stable local rendering marker.

    The public image URLs expire, while the marker is resolved against the
    downloaded local figure record by the web client.  Doc2X wraps images in
    paired ``<!-- Media -->`` comments, which are intentionally removed here.
    """
    def replace_image(match: re.Match[str]) -> str:
        figure = figures_by_url.get(match.group(1))
        figure_id = str((figure or {}).get("id") or "")
        return f"\n\n<!-- DOC2X_FIGURE:{figure_id} -->\n\n" if figure_id else ""

    value = IMAGE_RE.sub(replace_image, value)
    value = re.sub(r"<!--\s*Media\s*-->", "", value, flags=re.IGNORECASE)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def build_drafts(
    *,
    result_payload: dict[str, Any],
    manifest: list[dict[str, Any]],
    drafts_root: Path,
    artifact_dir: Path,
    storage_root: Path,
    download_asset: Callable[[str, Path], str],
    document_role: str = "question",
) -> dict[str, Any]:
    pages = (((result_payload.get("data") or {}).get("result") or {}).get("pages") or [])
    solution_document_kind = classify_solution_document(pages) if document_role == "solution" else ""
    expected = [normalize_question_no(row.get("question_no")) for row in manifest]
    parsed = split_exam_markdown(pages, [number for number in expected if number])
    figures_by_url = _figure_blocks(pages)
    asset_dir = artifact_dir / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    downloaded: dict[str, str] = {}
    failures: list[dict[str, str]] = []
    successful = 0

    for record in manifest:
        record_id = str(record.get("id") or "")
        question_no = normalize_question_no(record.get("question_no"))
        draft_dir = drafts_root / record_id
        draft_dir.mkdir(parents=True, exist_ok=True)
        item = parsed.get(question_no)
        if not item:
            error = f"Doc2X 未找到题号 {question_no or record.get('question_no') or record_id}"
            failures.append({"id": record_id, "question_no": question_no, "error": error})
            result = {
                **record,
                "id": record_id,
                "question_no": record.get("question_no", ""),
                "ocr_status": "failed",
                "problem_text": "",
                "answer": "",
                "analysis": "",
                "figures": record.get("figures") or [],
                "needs_human_review": True,
                "raw_model_output": "",
                "post_processing": {"provider": "doc2x", "error": error},
            }
        else:
            is_solution = document_role == "solution" or str(record.get("ocr_record_kind") or "") == "solution"
            source_page_start = min(item["page_indices"]) + 1 if item["page_indices"] else record.get("page")
            source_page_end = max(item["page_indices"]) + 1 if item["page_indices"] else record.get("page")
            figures: list[dict[str, Any]] = []
            local_figures_by_url: dict[str, dict[str, Any]] = {}
            raw = str(item.get("raw") or "")
            answer_pos = raw.find("【答案】")
            for url in item["image_urls"]:
                block = figures_by_url.get(url, {})
                if url not in downloaded:
                    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
                    target = asset_dir / f'{block.get("id") or digest}{_asset_extension(url)}'
                    downloaded[url] = download_asset(url, target)
                local_abs = Path(downloaded[url])
                try:
                    local_path = local_abs.resolve().relative_to(storage_root.resolve()).as_posix()
                except ValueError:
                    local_path = local_abs.as_posix()
                image_pos = raw.find(url)
                usage = "analysis" if is_solution or (answer_pos >= 0 and image_pos > answer_pos) else "stem"
                bbox = block.get("bbox") or []
                figure = {
                    "id": str(block.get("id") or f"doc2x_{len(figures) + 1}"),
                    "origin": "doc2x_v3",
                    "usage": usage,
                    "category": "analysis" if usage == "analysis" else "question",
                    "pageNumber": int(block.get("page_idx", 0)) + 1,
                    "bbox": bbox,
                    "path": local_path,
                    "blockId": block.get("id", ""),
                }
                figures.append(figure)
                local_figures_by_url[url] = figure
            if not figures:
                figures = record.get("figures") or []
            answer = inline_doc2x_figures(item["answer"], local_figures_by_url)
            analysis = inline_doc2x_figures(item["analysis"], local_figures_by_url)
            stem = inline_doc2x_figures(item["stem"], local_figures_by_url)
            has_markers = bool(item.get("has_markers"))
            if is_solution:
                answer, analysis, has_markers = solution_fields(str(item.get("raw") or ""), solution_document_kind)
                answer = inline_doc2x_figures(answer, local_figures_by_url)
                analysis = inline_doc2x_figures(analysis, local_figures_by_url)
                stem = ""
            result = {
                **record,
                "id": record_id,
                "question_no": record.get("question_no", question_no),
                "page": source_page_start,
                "page_span": [source_page_start, source_page_end],
                "ocr_status": "draft",
                "problem_text": stem,
                "answer": answer,
                "analysis": analysis,
                "figures": figures,
                "needs_human_review": not has_markers,
                "raw_model_output": raw,
                "post_processing": {
                    "provider": "doc2x",
                    "page_indices": item["page_indices"],
                    "has_answer_analysis_markers": has_markers,
                    "document_role": document_role,
                    "solution_document_kind": solution_document_kind if is_solution else "",
                },
            }
            successful += 1
        _atomic_json(draft_dir / "ocr_result.json", result)
        (draft_dir / "question.md").write_text(
            "\n".join([
                "# 题目", "", str(result.get("problem_text") or ""), "",
                "# 答案", "", str(result.get("answer") or ""), "",
                "# 解析", "", str(result.get("analysis") or ""), "",
            ]),
            encoding="utf-8",
        )

    report = {
        "total": len(manifest),
        "successful": successful,
        "failed": len(failures),
        "failures": failures,
        "downloaded_assets": len(downloaded),
    }
    _atomic_json(artifact_dir / "normalize.report.json", report)
    return report


class Doc2xClient:
    def __init__(self, settings: Doc2xSettings):
        self.settings = settings
        self.base_url = settings.base_url.rstrip("/")

    @property
    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.settings.api_key}"}

    def _json_request(self, method: str, endpoint: str, body: Any | None = None) -> dict[str, Any]:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
        headers = self._auth_headers
        if body is not None:
            headers = {**headers, "Content-Type": "application/json"}
        last_error: Exception | None = None
        for attempt in range(self.settings.max_retries + 1):
            request = urllib.request.Request(self.base_url + endpoint, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=self.settings.timeout_seconds) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                if exc.code == 429 and attempt < self.settings.max_retries:
                    time.sleep(self.settings.poll_seconds * (attempt + 1))
                    continue
                raise Doc2xError(f"Doc2X HTTP {exc.code}: {raw[:500]}", code=f"http_{exc.code}", retryable=exc.code == 429) from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_error = exc
                if attempt < self.settings.max_retries:
                    time.sleep(self.settings.poll_seconds * (attempt + 1))
                    continue
                raise Doc2xError(f"Doc2X 网络请求失败：{exc}", code="network_error", retryable=True) from exc
            code = str(payload.get("code") or "")
            if code and code != "success":
                raise Doc2xError(str(payload.get("msg") or code), code=code, retryable=code in {"parse_error", "parse_create_task_error"})
            return payload
        raise Doc2xError(f"Doc2X 网络请求失败：{last_error}", code="network_error", retryable=True)

    def preupload(self) -> dict[str, str]:
        payload = self._json_request("POST", "/api/v2/parse/preupload", {"model": self.settings.model})
        data = payload.get("data") or {}
        if not data.get("uid") or not data.get("url"):
            raise Doc2xError("Doc2X 预上传响应缺少 uid 或 url", code="invalid_preupload_response")
        return {"uid": str(data["uid"]), "url": str(data["url"])}

    def upload(self, upload_url: str, pdf_path: Path) -> None:
        parsed = urllib.parse.urlsplit(upload_url.replace("\\u0026", "&"))
        if parsed.scheme != "https" or not parsed.hostname:
            raise Doc2xError("Doc2X 返回了无效上传地址", code="invalid_upload_url")
        target = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
        connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=max(self.settings.timeout_seconds, 240))
        try:
            connection.putrequest("PUT", target)
            connection.putheader("Content-Length", str(pdf_path.stat().st_size))
            connection.putheader("Content-Type", "application/pdf")
            connection.endheaders()
            with pdf_path.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    connection.send(chunk)
            response = connection.getresponse()
            body = response.read().decode("utf-8", errors="replace")
            if response.status != 200:
                raise Doc2xError(f"Doc2X 上传失败：HTTP {response.status} {body[:500]}", code="upload_failed", retryable=True)
        finally:
            connection.close()

    def status(self, uid: str) -> dict[str, Any]:
        return self._json_request("GET", "/api/v2/parse/status?uid=" + urllib.parse.quote(uid))

    def download_asset(self, url: str, target: Path) -> str:
        target.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url.replace("\\u0026", "&"), method="GET")
        with urllib.request.urlopen(request, timeout=self.settings.timeout_seconds) as response, target.open("wb") as output:
            shutil.copyfileobj(response, output)
        return str(target)
