#!/usr/bin/env python3
"""Start the v2 review API server for the React SPA frontend.

Usage:
    python scripts/run_review_v2.py          # API on :8766
    python scripts/run_review_v2.py --port 8766

Then run the React dev server separately:
    cd frontend && npm run dev              # React on :5173 (proxies to :8766)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.review.review_server import app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="v2 审核 API 服务")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(f"审核 API 服务启动: http://{args.host}:{args.port}")
    print(f"请在前端目录运行: cd frontend && npm run dev")
    print(f"然后打开: http://127.0.0.1:5173")
    app.run(host=args.host, port=args.port, debug=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
