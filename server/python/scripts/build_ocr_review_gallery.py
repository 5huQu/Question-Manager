#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build an HTML gallery for OCR draft review.")
    parser.add_argument("--root", required=True, help="Run directory that contains ocr_drafts/")
    parser.add_argument(
        "--output",
        default=None,
        help="Optional output HTML path. Defaults to <root>/output/ocr_review_gallery.html",
    )
    return parser.parse_args()


def _load_records(drafts_dir: Path) -> list[dict]:
    records: list[dict] = []
    for result_path in sorted(drafts_dir.glob("CUT_*/ocr_result.json")):
        payload = json.loads(result_path.read_text(encoding="utf-8"))
        draft_dir = result_path.parent
        post_processing = payload.get("post_processing") or {}
        route = post_processing.get("ocr_route", "")
        route_reason = post_processing.get("ocr_route_reason", "")
        records.append(
            {
                "id": payload.get("id", draft_dir.name),
                "question_no": str(payload.get("question_no", "")),
                "page": payload.get("page", ""),
                "status": payload.get("ocr_status", ""),
                "route": route,
                "route_reason": route_reason,
                "image_strategy": payload.get("image_strategy", ""),
                "answer": payload.get("answer", ""),
                "problem_text": payload.get("problem_text", ""),
                "analysis": payload.get("analysis", ""),
                "question_md": draft_dir / "question.md",
                "result_json": result_path,
                "raw_response": draft_dir / "raw_response.txt",
                "source_png": draft_dir / "source.png",
            }
        )
    return records


def _rel(from_dir: Path, target: Path) -> str:
    return os.path.relpath(target, start=from_dir).replace("\\", "/")


def _card_html(output_dir: Path, record: dict) -> str:
    source_rel = _rel(output_dir, record["source_png"]) if record["source_png"].exists() else ""
    md_rel = _rel(output_dir, record["question_md"]) if record["question_md"].exists() else ""
    json_rel = _rel(output_dir, record["result_json"]) if record["result_json"].exists() else ""
    raw_rel = _rel(output_dir, record["raw_response"]) if record["raw_response"].exists() else ""
    answer = html.escape(record["answer"] or "（空）")
    route_reason = html.escape(record["route_reason"] or "-")
    preview = html.escape((record["problem_text"] or "").strip()[:180] or "（空）")
    analysis_preview = html.escape((record["analysis"] or "").strip()[:220] or "（空）")
    return f"""
    <section class="card" id="{html.escape(record['id'])}">
      <div class="meta">
        <div class="title">Q{html.escape(record['question_no'])} · {html.escape(record['id'])}</div>
        <div class="badges">
          <span>{html.escape(str(record['status']))}</span>
          <span>{html.escape(record['route'] or 'unknown')}</span>
          <span>p.{html.escape(str(record['page']))}</span>
        </div>
      </div>
      <div class="reason">{route_reason}</div>
      <div class="body">
        <div class="image-pane">
          {f'<img src="{html.escape(source_rel)}" alt="{html.escape(record["id"])} source">' if source_rel else '<div class="missing">missing source.png</div>'}
        </div>
        <div class="text-pane">
          <div class="row"><strong>答案</strong><span>{answer}</span></div>
          <div class="row"><strong>策略</strong><span>{html.escape(record['image_strategy'] or '-')}</span></div>
          <div class="block">
            <div class="label">题目预览</div>
            <div class="math-text">{preview}</div>
          </div>
          <div class="block">
            <div class="label">解析预览</div>
            <div class="math-text">{analysis_preview}</div>
          </div>
          <div class="links">
            {f'<a href="{html.escape(md_rel)}">question.md</a>' if md_rel else ''}
            {f'<a href="{html.escape(json_rel)}">ocr_result.json</a>' if json_rel else ''}
            {f'<a href="{html.escape(raw_rel)}">raw_response.txt</a>' if raw_rel else ''}
          </div>
        </div>
      </div>
    </section>
    """


def build_html(output_path: Path, records: list[dict]) -> str:
    output_dir = output_path.parent
    cards = "\n".join(_card_html(output_dir, record) for record in records)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OCR Review Gallery</title>
  <script>
    window.MathJax = {{
      tex: {{
        inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
        displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
      }},
      svg: {{
        fontCache: 'global'
      }}
    }};
  </script>
  <script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
  <style>
    :root {{
      --bg: #f6f7fb;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #6b7280;
      --line: #dbe1ea;
      --accent: #0f766e;
    }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: var(--ink); background: var(--bg); }}
    header {{ padding: 20px 24px; background: #fff; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }}
    h1 {{ margin: 0 0 6px; font-size: 22px; }}
    .sub {{ color: var(--muted); font-size: 14px; }}
    main {{ padding: 20px; display: grid; gap: 18px; }}
    .card {{ background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }}
    .meta {{ display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 8px; }}
    .title {{ font-size: 18px; font-weight: 700; }}
    .badges {{ display: flex; gap: 8px; flex-wrap: wrap; }}
    .badges span {{ border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; font-size: 12px; color: var(--muted); }}
    .reason {{ font-size: 13px; color: var(--accent); margin-bottom: 12px; }}
    .body {{ display: grid; grid-template-columns: minmax(320px, 460px) 1fr; gap: 16px; align-items: start; }}
    .image-pane {{ background: #fafafa; border: 1px solid var(--line); border-radius: 10px; padding: 8px; }}
    .image-pane img {{ width: 100%; height: auto; display: block; }}
    .missing {{ color: var(--muted); font-size: 14px; padding: 24px; text-align: center; }}
    .text-pane {{ display: grid; gap: 10px; }}
    .row {{ display: grid; grid-template-columns: 72px 1fr; gap: 10px; font-size: 14px; }}
    .block .label {{ font-size: 13px; color: var(--muted); margin-bottom: 6px; }}
    pre {{ margin: 0; white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 13px; line-height: 1.6; }}
    .math-text {{ white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 13px; line-height: 1.6; }}
    .math-text mjx-container {{ overflow-x: auto; overflow-y: hidden; max-width: 100%; }}
    .links {{ display: flex; gap: 12px; flex-wrap: wrap; }}
    .links a {{ color: #2563eb; text-decoration: none; font-size: 14px; }}
    @media (max-width: 980px) {{
      .body {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>OCR Review Gallery</h1>
    <div class="sub">共 {len(records)} 题，可直接查看原图、路由和 OCR 结果。</div>
  </header>
  <main>
    {cards}
  </main>
</body>
</html>"""


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    drafts_dir = root / "ocr_drafts"
    if not drafts_dir.exists():
        raise SystemExit(f"ocr_drafts 不存在: {drafts_dir}")
    output_path = Path(args.output).expanduser().resolve() if args.output else (root / "output" / "ocr_review_gallery.html")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    records = _load_records(drafts_dir)
    output_path.write_text(build_html(output_path, records), encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
