from __future__ import annotations

import json
import os
import re
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

from src.ocr.config import ENV_PATH, load_dotenv
from src.ocr.prompt import OCR_CHUNK_SYSTEM_PROMPT, OCR_SYSTEM_PROMPT, build_chunk_user_prompt, build_user_prompt

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PROFILE_PATH = PROJECT_ROOT / ".codex-tools" / "ocr_lab_profiles.local.json"


def _default_payload() -> dict[str, Any]:
    return {
        "model_profiles": _default_model_profiles_from_env(),
        "prompt_profiles": [
            {
                "id": "default",
                "name": "当前 OCR 默认提示词",
                "whole_system_prompt": OCR_SYSTEM_PROMPT,
                "whole_user_prompt": build_user_prompt(),
                "chunk_system_prompt": OCR_CHUNK_SYSTEM_PROMPT,
                "chunk_user_prompt": build_chunk_user_prompt("{kind}", "{image_count}"),
            }
        ],
    }


def load_profiles() -> dict[str, Any]:
    if not PROFILE_PATH.exists():
        return _default_payload()
    data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    defaults = _default_payload()
    data.setdefault("model_profiles", [])
    data.setdefault("prompt_profiles", defaults["prompt_profiles"])
    if not data["prompt_profiles"]:
        data["prompt_profiles"] = defaults["prompt_profiles"]
    _merge_env_default_model(data)
    return data


def save_profiles(payload: dict[str, Any]) -> None:
    PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def sanitized_profiles() -> dict[str, Any]:
    payload = deepcopy(load_profiles())
    for profile in payload.get("model_profiles", []):
        key = str(profile.get("api_key", "") or "")
        profile["has_api_key"] = bool(key)
        profile["api_key_hint"] = _mask_key(key)
        profile.pop("api_key", None)
    return payload


def upsert_model_profile(data: dict[str, Any]) -> dict[str, Any]:
    payload = load_profiles()
    profiles = payload.setdefault("model_profiles", [])
    profile_id = str(data.get("id") or _new_id(data.get("name") or data.get("model") or "model"))
    existing = next((p for p in profiles if p.get("id") == profile_id), None)
    target = existing if existing is not None else {"id": profile_id}

    for field in ("name", "api_base_url", "model"):
        if field in data:
            target[field] = str(data.get(field) or "").strip()
    for field in ("temperature", "top_p"):
        if field in data:
            target[field] = float(data.get(field) or 0)
    if "max_tokens" in data:
        value = data.get("max_tokens")
        target["max_tokens"] = int(value) if value not in (None, "") else None
    if "enabled" in data:
        target["enabled"] = bool(data.get("enabled"))
    else:
        target.setdefault("enabled", True)
    if "api_key" in data and str(data.get("api_key") or "").strip():
        target["api_key"] = str(data.get("api_key") or "").strip()

    target.setdefault("name", target.get("model", profile_id))
    target.setdefault("api_base_url", "")
    target.setdefault("api_key", "")
    target.setdefault("model", "")
    target.setdefault("temperature", 0.01)
    target.setdefault("top_p", 0.1)
    target.setdefault("max_tokens", 8192)

    if existing is None:
        profiles.append(target)
    save_profiles(payload)
    return _sanitize_model(target)


def upsert_prompt_profile(data: dict[str, Any]) -> dict[str, Any]:
    payload = load_profiles()
    profiles = payload.setdefault("prompt_profiles", [])
    profile_id = str(data.get("id") or _new_id(data.get("name") or "prompt"))
    existing = next((p for p in profiles if p.get("id") == profile_id), None)
    target = existing if existing is not None else {"id": profile_id}

    for field in (
        "name",
        "whole_system_prompt",
        "whole_user_prompt",
        "chunk_system_prompt",
        "chunk_user_prompt",
    ):
        if field in data:
            target[field] = str(data.get(field) or "")
    target.setdefault("name", profile_id)
    target.setdefault("whole_system_prompt", OCR_SYSTEM_PROMPT)
    target.setdefault("whole_user_prompt", build_user_prompt())
    target.setdefault("chunk_system_prompt", OCR_CHUNK_SYSTEM_PROMPT)
    target.setdefault("chunk_user_prompt", build_chunk_user_prompt("{kind}", "{image_count}"))

    if existing is None:
        profiles.append(target)
    save_profiles(payload)
    return target


def get_model_profile(profile_id: str) -> dict[str, Any] | None:
    return next((p for p in load_profiles().get("model_profiles", []) if p.get("id") == profile_id), None)


def get_prompt_profile(profile_id: str) -> dict[str, Any] | None:
    return next((p for p in load_profiles().get("prompt_profiles", []) if p.get("id") == profile_id), None)


def _sanitize_model(profile: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(profile)
    key = str(sanitized.get("api_key", "") or "")
    sanitized["has_api_key"] = bool(key)
    sanitized["api_key_hint"] = _mask_key(key)
    sanitized.pop("api_key", None)
    return sanitized


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:4]}...{key[-4:]}"


def _new_id(label: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(label).strip().lower()).strip("-")
    slug = slug or "profile"
    return f"{slug}-{uuid.uuid4().hex[:8]}"


def _default_model_profiles_from_env() -> list[dict[str, Any]]:
    load_dotenv(ENV_PATH)
    api_base_url = (os.getenv("OCR_API_BASE_URL") or "").strip()
    api_key = (os.getenv("OCR_API_KEY") or "").strip()
    model = (os.getenv("OCR_MODEL") or "").strip()
    if not api_base_url and not api_key and not model:
        return []
    return [
        {
            "id": "env-default",
            "name": "本地 .env 默认模型",
            "api_base_url": api_base_url,
            "api_key": api_key,
            "model": model,
            "temperature": _env_float("OCR_TEMPERATURE", 0.01),
            "top_p": _env_float("OCR_TOP_P", 0.1),
            "max_tokens": _env_int("OCR_MAX_TOKENS", 8192),
            "enabled": True,
            "source": ".env",
        }
    ]


def _merge_env_default_model(payload: dict[str, Any]) -> None:
    env_profiles = _default_model_profiles_from_env()
    if not env_profiles:
        return
    profiles = payload.setdefault("model_profiles", [])
    env_profile = env_profiles[0]
    existing = next((p for p in profiles if p.get("id") == env_profile["id"]), None)
    if existing is None:
        profiles.insert(0, env_profile)
        return
    if existing.get("source") == ".env":
        existing.update(env_profile)


def _env_int(name: str, default: int) -> int:
    try:
        return int((os.getenv(name) or "").strip() or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float((os.getenv(name) or "").strip() or default)
    except ValueError:
        return default
