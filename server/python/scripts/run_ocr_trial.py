#!/usr/bin/env python3
"""Run an OCR trial from output/ocr_manifest.json."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.ocr.config import load_settings
from src.ocr.runner import check_manifest_freshness, run_trial


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OCR 试跑脚本")
    parser.add_argument("--max-items", type=int, default=None, help="覆盖 OCR_MAX_ITEMS")
    parser.add_argument("--dry-run", action="store_true", help="不调用 API，仅生成草稿输出")
    parser.add_argument("--concurrency", type=int, default=None, help="覆盖 OCR_CONCURRENCY")
    parser.add_argument("--force", action="store_true", help="强制重新 OCR 已有结果")
    parser.add_argument("--skip-manifest-check", action="store_true", help="跳过 manifest 一致性检查")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.skip_manifest_check:
        is_fresh, message = check_manifest_freshness()
        print(message)
        if not is_fresh:
            print("\n如需跳过此检查，请使用 --skip-manifest-check 参数。")
            return 1

    settings = load_settings(
        max_items_override=args.max_items,
        concurrency_override=args.concurrency,
        dry_run_override=True if args.dry_run else None,
    )
    return run_trial(settings, force=args.force)


if __name__ == "__main__":
    raise SystemExit(main())
