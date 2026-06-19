#!/usr/bin/env python3
"""启动本地切题审核服务。

用法:
    python scripts/run_review.py
    python scripts/run_review.py --port 8000
    python scripts/run_review.py --host 0.0.0.0 --port 8080

启动后访问 http://localhost:8000 即可使用审核界面。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.review.review_server import run


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PDF 切题审核服务")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="服务地址，默认 127.0.0.1")
    parser.add_argument("--port", type=int, default=8000, help="服务端口，默认 8000")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(host=args.host, port=args.port)
