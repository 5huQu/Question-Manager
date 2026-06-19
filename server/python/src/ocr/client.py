from __future__ import annotations

import base64
import http.client
import json
import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse
from urllib import error, request

from .config import OCRSettings


@dataclass
class OCRAPIResult:
    raw_text: str
    payload: dict[str, Any]
    top_k_sent: bool


class OCRRequestError(RuntimeError):
    pass


class OCRParseError(RuntimeError):
    pass


def image_to_data_url(image_path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(str(image_path))
    if not mime_type:
        mime_type = "image/png"
    data = image_path.read_bytes()
    encoded = base64.b64encode(data).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def build_payload(
    settings: OCRSettings,
    *,
    messages: list[dict[str, Any]],
    include_top_k: bool = True,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.model,
        "messages": messages,
        "temperature": settings.temperature,
        "top_p": settings.top_p,
        "stream": False,
    }
    if settings.max_tokens is not None:
        payload["max_tokens"] = settings.max_tokens
    if include_top_k and settings.top_k is not None:
        payload["top_k"] = settings.top_k
    if settings.min_p is not None:
        payload["min_p"] = settings.min_p
    if settings.frequency_penalty is not None:
        payload["frequency_penalty"] = settings.frequency_penalty
    return payload


def call_chat_completions(
    settings: OCRSettings,
    *,
    messages: list[dict[str, Any]],
    timeout_seconds: float = 180.0,
) -> OCRAPIResult:
    payload = build_payload(settings, messages=messages, include_top_k=True)
    endpoints = _candidate_endpoints(settings.api_base_url)
    last_exc: Exception | None = None

    for endpoint in endpoints:
        try:
            return _post_chat_completion(
                settings,
                endpoint=endpoint,
                payload=payload,
                timeout_seconds=timeout_seconds,
                top_k_sent=settings.top_k is not None,
            )
        except OCRRequestError as exc:
            last_exc = exc
            message = str(exc)
            if settings.top_k is not None and "top_k" in message.lower():
                fallback_payload = build_payload(settings, messages=messages, include_top_k=False)
                try:
                    return _post_chat_completion(
                        settings,
                        endpoint=endpoint,
                        payload=fallback_payload,
                        timeout_seconds=timeout_seconds,
                        top_k_sent=False,
                    )
                except OCRRequestError as exc2:
                    last_exc = exc2
            if "404" not in message:
                break

    if last_exc is not None:
        raise last_exc
    raise OCRRequestError("请求失败：无法连接到 OCR 接口")


def _candidate_endpoints(base_url: str) -> list[str]:
    base_url = base_url.strip().rstrip("/")
    if not base_url:
        return [base_url]

    endpoints = [base_url]
    if not base_url.endswith("/chat/completions"):
        endpoints.append(f"{base_url}/chat/completions")
    return endpoints


def _post_chat_completion(
    settings: OCRSettings,
    *,
    endpoint: str,
    payload: dict[str, Any],
    timeout_seconds: float,
    top_k_sent: bool,
) -> OCRAPIResult:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw_bytes = resp.read()
            raw_text = raw_bytes.decode("utf-8", errors="replace")
            try:
                payload_json = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                raise OCRParseError(f"API 返回不是合法 JSON: {exc}") from exc
            return OCRAPIResult(raw_text=raw_text, payload=payload_json, top_k_sent=top_k_sent)
    except error.HTTPError as exc:
        error_text = str(exc)
        if exc.fp:
            try:
                error_bytes = exc.read()
                error_text = error_bytes.decode("utf-8", errors="replace")
            except http.client.IncompleteRead as partial_exc:
                partial = partial_exc.partial or b""
                if partial:
                    error_text = partial.decode("utf-8", errors="replace")
                else:
                    error_text = f"{exc} (response body incomplete: expected {partial_exc.expected} more bytes)"
        raise OCRRequestError(f"HTTP {exc.code}: {error_text}") from exc
    except error.URLError as exc:
        raise OCRRequestError(f"网络请求失败: {exc.reason}") from exc
    except TimeoutError as exc:
        raise OCRRequestError(f"请求超时: {timeout_seconds} 秒") from exc


def extract_assistant_text(api_payload: dict[str, Any]) -> str:
    choices = api_payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts).strip()
    return ""


def extract_json_object(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if not candidate:
        raise OCRParseError("模型返回为空")

    fenced = _extract_fenced_json(candidate)
    if fenced is not None:
        candidate = fenced

    try:
        loaded = json.loads(candidate)
        if isinstance(loaded, dict):
            return loaded
        raise OCRParseError("模型返回的 JSON 不是对象")
    except json.JSONDecodeError:
        repaired = _repair_common_json_escapes(candidate)
        if repaired != candidate:
            try:
                loaded = json.loads(repaired)
                if isinstance(loaded, dict):
                    return loaded
            except json.JSONDecodeError:
                pass

    bracket = _extract_braced_json(candidate)
    if bracket is not None:
        try:
            loaded = json.loads(bracket)
            if isinstance(loaded, dict):
                return loaded
        except json.JSONDecodeError as exc:
            repaired = _repair_common_json_escapes(bracket)
            if repaired != bracket:
                try:
                    loaded = json.loads(repaired)
                    if isinstance(loaded, dict):
                        return loaded
                except json.JSONDecodeError:
                    pass
            raise OCRParseError(f"模型返回 JSON 解析失败: {exc}") from exc

    raise OCRParseError("无法从模型返回中提取合法 JSON")


def _extract_fenced_json(text: str) -> str | None:
    match = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if not match:
        return None
    return match.group(1).strip()


def _extract_braced_json(text: str) -> str | None:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    return text[start : end + 1]


def _repair_common_json_escapes(text: str) -> str:
    """Escape stray backslashes that frequently appear in model JSON strings.

    Keeps valid JSON escapes intact and only doubles a backslash when the next
    character is not one of the standard JSON escapes.
    """
    repaired: list[str] = []
    i = 0
    valid_next = {'"', "\\", "/", "b", "f", "n", "r", "t", "u"}
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            if i + 1 >= len(text):
                repaired.append("\\\\")
                i += 1
                continue
            nxt = text[i + 1]
            if nxt in valid_next:
                repaired.append(ch)
                repaired.append(nxt)
                i += 2
                continue
            repaired.append("\\\\")
            repaired.append(nxt)
            i += 2
            continue
        repaired.append(ch)
        i += 1
    return "".join(repaired)
