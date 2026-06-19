from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ROOT = Path(os.getenv("QUESTION_PYTHON_DATA_DIR", PROJECT_ROOT))
ENV_PATH = Path(os.getenv("QUESTION_OCR_ENV_PATH", PROJECT_ROOT / ".env"))


@dataclass(frozen=True)
class OCRSettings:
    api_base_url: str
    api_key: str
    model: str
    secondary_api_base_url: str = ""
    secondary_api_key: str = ""
    secondary_model: str = ""
    max_items: int = 10
    dry_run: bool = False
    temperature: float = 0.01
    top_p: float = 0.1
    top_k: int | None = 1
    concurrency: int = 20
    max_retries: int = 2
    retry_delay_seconds: float = 3.0
    max_tokens: int | None = 8192
    min_p: float | None = 0.0
    frequency_penalty: float | None = 0.0
    image_max_width: int = 900
    image_format: str = "jpeg"
    image_jpeg_quality: int = 75
    max_images_per_request: int = 4
    secondary_max_images_per_request: int = 3
    long_image_height_threshold: int = 3000
    long_image_bytes_threshold: int = 700000


def load_dotenv(path: Path = ENV_PATH) -> None:
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip()


def _get_str(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value if value else default


def _get_int(name: str, default: int | None = None) -> int | None:
    value = _get_str(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _get_float(name: str, default: float | None = None) -> float | None:
    value = _get_str(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _get_bool(name: str, default: bool = False) -> bool:
    value = _get_str(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "y", "on"}


def load_settings(
    *,
    max_items_override: int | None = None,
    concurrency_override: int | None = None,
    dry_run_override: bool | None = None,
) -> OCRSettings:
    load_dotenv()

    api_base_url = _get_str("OCR_API_BASE_URL")
    api_key = _get_str("OCR_API_KEY")
    model = _get_str("OCR_MODEL")
    secondary_api_base_url = _get_str("OCR_SECONDARY_API_BASE_URL", "")
    secondary_api_key = _get_str("OCR_SECONDARY_API_KEY", "")
    secondary_model = _get_str("OCR_SECONDARY_MODEL", "")

    dry_run = _get_bool("OCR_DRY_RUN", False)
    if dry_run_override is not None:
        dry_run = dry_run_override

    missing_required = []
    if not api_base_url:
        missing_required.append("OCR_API_BASE_URL")
    if not api_key:
        missing_required.append("OCR_API_KEY")
    if not model:
        missing_required.append("OCR_MODEL")

    if missing_required and not dry_run:
        print("缺少 OCR 必需配置，请先补充以下环境变量：")
        for name in missing_required:
            print(f"- {name}")
        raise SystemExit(1)

    max_items = _get_int("OCR_MAX_ITEMS", 10) or 10
    if max_items_override is not None:
        max_items = max_items_override

    concurrency = _get_int("OCR_CONCURRENCY", 20) or 20
    if concurrency_override is not None:
        concurrency = concurrency_override
    concurrency = max(1, min(concurrency, 20))

    max_retries = _get_int("OCR_MAX_RETRIES", 2) or 2
    retry_delay_seconds = _get_float("OCR_RETRY_DELAY_SECONDS", 3.0) or 3.0

    return OCRSettings(
        api_base_url=api_base_url or "",
        api_key=api_key or "",
        model=model or "",
        secondary_api_base_url=secondary_api_base_url or "",
        secondary_api_key=secondary_api_key or "",
        secondary_model=secondary_model or "",
        max_items=max_items,
        dry_run=dry_run,
        temperature=_get_float("OCR_TEMPERATURE", 0.01) or 0.01,
        top_p=_get_float("OCR_TOP_P", 0.1) or 0.1,
        top_k=_get_int("OCR_TOP_K", 1),
        concurrency=concurrency,
        max_retries=max_retries,
        retry_delay_seconds=retry_delay_seconds,
        max_tokens=_get_int("OCR_MAX_TOKENS", 8192),
        min_p=_get_float("OCR_MIN_P", 0.0),
        frequency_penalty=_get_float("OCR_FREQUENCY_PENALTY", 0.0),
        image_max_width=_get_int("OCR_IMAGE_MAX_WIDTH", 900) or 900,
        image_format=_get_str("OCR_IMAGE_FORMAT", "jpeg") or "jpeg",
        image_jpeg_quality=_get_int("OCR_IMAGE_JPEG_QUALITY", 75) or 75,
        max_images_per_request=_get_int("OCR_MAX_IMAGES_PER_REQUEST", 4) or 4,
        secondary_max_images_per_request=_get_int("OCR_SECONDARY_MAX_IMAGES_PER_REQUEST", 3) or 3,
        long_image_height_threshold=_get_int("OCR_LONG_IMAGE_HEIGHT_THRESHOLD", 3000) or 3000,
        long_image_bytes_threshold=_get_int("OCR_LONG_IMAGE_BYTES_THRESHOLD", 700000) or 700000,
    )
