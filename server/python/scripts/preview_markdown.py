#!/usr/bin/env python3
"""Quick Markdown preview server with MathJax rendering.

Usage:
    python scripts/preview_markdown.py
    python scripts/preview_markdown.py docs/ocr_workflow.md
    python scripts/preview_markdown.py docs/
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import threading
import webbrowser
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 8765


def _resolve_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = (PROJECT_ROOT / path).resolve()
    else:
        path = path.resolve()
    if not path.exists():
        raise FileNotFoundError(f"路径不存在: {raw_path}")
    return path


def _collect_markdown_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    files = [p for p in root.rglob("*.md") if p.is_file()]
    return sorted(files, key=lambda p: p.as_posix().lower())


def _relative_name(root: Path, path: Path) -> str:
    if root.is_file():
        return path.name
    return path.relative_to(root).as_posix()


def _build_html(title: str, base_name: str, initial_file: str, files_json: str) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f7f5ef;
      --panel: #ffffff;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #e5e7eb;
      --accent: #2563eb;
      --accent-soft: rgba(37, 99, 235, 0.12);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #faf8f0 0%, #f4f7fb 100%);
      color: var(--ink);
    }}
    header {{
      padding: 16px 20px;
      border-bottom: 1px solid var(--line);
      background: rgba(255,255,255,0.85);
      backdrop-filter: blur(8px);
      position: sticky;
      top: 0;
      z-index: 10;
    }}
    header h1 {{
      font-size: 18px;
      margin: 0 0 6px 0;
    }}
    header .meta {{
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 13px;
      color: var(--muted);
    }}
    .shell {{
      display: grid;
      grid-template-columns: 280px 1fr;
      min-height: calc(100vh - 70px);
    }}
    aside {{
      border-right: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
      padding: 14px;
      overflow: auto;
    }}
    .section-title {{
      margin: 0 0 10px 0;
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    .file-list {{
      display: flex;
      flex-direction: column;
      gap: 6px;
    }}
    .file-item {{
      width: 100%;
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 10px;
      padding: 10px 12px;
      text-align: left;
      font-size: 14px;
      cursor: pointer;
      color: var(--ink);
    }}
    .file-item:hover {{
      border-color: var(--accent);
      background: var(--accent-soft);
    }}
    .file-item.active {{
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
      background: #eff6ff;
    }}
    main {{
      padding: 18px;
      overflow: auto;
    }}
    .toolbar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }}
    .toolbar .current {{
      font-size: 15px;
      font-weight: 600;
    }}
    .toolbar .hint {{
      color: var(--muted);
      font-size: 13px;
    }}
    article {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 28px;
      max-width: 980px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    article h1, article h2, article h3, article h4 {{
      margin-top: 1.2em;
    }}
    article h1:first-child {{
      margin-top: 0;
    }}
    article p {{
      line-height: 1.8;
      margin: 0.8em 0;
      word-break: break-word;
      overflow-wrap: break-word;
    }}
    article pre {{
      overflow: auto;
      padding: 14px;
      background: #0f172a;
      color: #e5e7eb;
      border-radius: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }}
    article code {{
      background: #eef2ff;
      padding: 0.15em 0.35em;
      border-radius: 6px;
      word-break: break-word;
    }}
    article pre code {{
      background: transparent;
      padding: 0;
      color: inherit;
      white-space: pre-wrap;
    }}
    article img {{
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      border: 1px solid var(--line);
      margin: 0.8em 0;
      display: block;
    }}
    .img-scroll {{
      max-height: 600px;
      overflow-y: auto;
      border-radius: 10px;
      border: 1px solid var(--line);
      margin: 0.8em 0;
      display: flex;
      justify-content: center;
      background: #f9fafb;
    }}
    .img-scroll img {{
      border: 0;
      margin: 0;
    }}
    article table {{
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
      display: block;
      overflow-x: auto;
    }}
    article th, article td {{
      border: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
    }}
    article blockquote {{
      border-left: 4px solid var(--accent);
      margin: 1rem 0;
      padding: 0.5rem 1rem;
      color: #374151;
      background: #f8fbff;
      word-break: break-word;
    }}
    .doc-meta {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 12px 0;
    }}
    .doc-meta .pill {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: #eef2ff;
      color: #1e3a8a;
      font-size: 12px;
      border: 1px solid #c7d2fe;
    }}
    .doc-meta .pill strong {{
      font-weight: 700;
    }}
    .empty {{
      color: var(--muted);
      font-style: italic;
      padding: 18px 0;
    }}
    mjx-merror {{
      color: #92400e !important;
      background: #fef3c7 !important;
      border: 1px solid #f59e0b !important;
      border-radius: 6px;
      padding: 0 4px;
    }}
    @media (max-width: 900px) {{
      .shell {{
        grid-template-columns: 1fr;
      }}
      aside {{
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }}
    }}
  </style>
  <script>
    window.__FILES__ = {files_json};
    window.__INITIAL_FILE__ = {json.dumps(initial_file, ensure_ascii=False)};
    window.MathJax = {{
      tex: {{
        inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
        displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
      }},
      options: {{
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      }}
    }};
  </script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js" defer></script>
</head>
<body>
  <header>
    <h1>Markdown Preview</h1>
    <div class="meta">
      <span>Base: <span id="base-name"></span></span>
      <span>MathJax: $$ / $</span>
      <span>选中: <span id="current-name"></span></span>
    </div>
  </header>
  <div class="shell">
    <aside>
      <div class="section-title">Markdown Files</div>
      <div id="file-list" class="file-list"></div>
    </aside>
    <main>
      <div class="toolbar">
        <div class="current" id="current-title"></div>
        <div class="hint">支持 `$$...$$` 和 `$...$`，渲染依赖浏览器联网加载 MathJax。</div>
      </div>
      <article id="content"><div class="empty">Loading...</div></article>
    </main>
  </div>
  <script>
    const baseName = {json.dumps(base_name, ensure_ascii=False)};
    const files = window.__FILES__ || [];
    const initialFile = window.__INITIAL_FILE__ || (files[0] ? files[0].path : "");
    const fileListEl = document.getElementById('file-list');
    const contentEl = document.getElementById('content');
    const currentTitleEl = document.getElementById('current-title');
    const currentNameEl = document.getElementById('current-name');
    const baseNameEl = document.getElementById('base-name');
    baseNameEl.textContent = baseName;

    marked.setOptions({{
      gfm: true,
      breaks: false
    }});

    function renderList(activePath) {{
      fileListEl.innerHTML = '';
      const questionFiles = files.filter((item) => item.path.endsWith('/question.md'));
      const list = questionFiles.length > 0 ? questionFiles : files;
      list.forEach((item) => {{
        const button = document.createElement('button');
        button.className = 'file-item' + (item.path === activePath ? ' active' : '');
        button.textContent = item.label;
        button.title = item.path;
        button.onclick = () => loadFile(item.path);
        fileListEl.appendChild(button);
      }});
    }}

    async function loadFile(path) {{
      const response = await fetch('/raw?file=' + encodeURIComponent(path));
      if (!response.ok) {{
        contentEl.innerHTML = '<div class="empty">无法加载文件: ' + path + '</div>';
        return;
      }}
      const md = await response.text();
      const parsed = splitFrontMatter(md);
      const previewBody = normalizeMathForPreview(parsed.body);
      currentTitleEl.textContent = path;
      currentNameEl.textContent = path;
      renderList(path);
      contentEl.innerHTML = renderFrontMatter(parsed.frontMatter) + marked.parse(previewBody);
      wrapTallImages();
      rewriteRelativeAssets(path);
      await typesetMath();
      const url = new URL(window.location.href);
      url.searchParams.set('file', path);
      history.replaceState(null, '', url.toString());
    }}

    function splitFrontMatter(md) {{
      const match = md.match(/^---\\s*\\n([\\s\\S]*?)\\n---\\s*\\n?/);
      if (!match) {{
        return {{ frontMatter: '', body: md }};
      }}
      return {{
        frontMatter: match[1],
        body: md.slice(match[0].length),
      }};
    }}

    function renderFrontMatter(frontMatter) {{
      if (!frontMatter.trim()) {{
        return '';
      }}
      const fields = {{}};
      frontMatter.split(/\\r?\\n/).forEach((line) => {{
        const idx = line.indexOf(':');
        if (idx === -1) {{
          return;
        }}
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        fields[key] = value;
      }});
      const order = ['id', 'source_pdf', 'page', 'question_no', 'ocr_status', 'needs_human_review'];
      const pills = order
        .filter((key) => fields[key] !== undefined)
        .map((key) => `<span class="pill"><strong>${{escapeHtml(key)}}</strong>${{escapeHtml(fields[key])}}</span>`)
        .join('');
      return pills ? `<div class="doc-meta">${{pills}}</div>` : '';
    }}

    function normalizeMathForPreview(md) {{
      return md
        .replace(/\\\\displaylines\\{{([\\s\\S]*?)\\}}/g, (_, expr) => '$$\\\\displaylines{{{{' + expr.trim() + '}}}}$$')
        .replace(/\\\\\\[([\\s\\S]*?)\\\\\\]/g, (_, expr) => '$$' + expr.trim() + '$$')
        .replace(/\\\\\\(([\\s\\S]*?)\\\\\\)/g, (_, expr) => '$' + expr.trim() + '$');
    }}

    function escapeHtml(text) {{
      return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }}

    function wrapTallImages() {{
      const images = contentEl.querySelectorAll('img');
      images.forEach((img) => {{
        const maybeWrap = function() {{
          if (img.naturalHeight > 600 && !img.parentElement.classList.contains('img-scroll')) {{
            const wrapper = document.createElement('div');
            wrapper.className = 'img-scroll';
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
          }}
        }};
        if (img.complete) {{
          maybeWrap();
        }} else {{
          img.addEventListener('load', maybeWrap, {{ once: true }});
        }}
      }});
    }}

    function rewriteRelativeAssets(markdownPath) {{
      const baseDir = markdownPath.includes('/') ? markdownPath.slice(0, markdownPath.lastIndexOf('/') + 1) : '';
      const assets = contentEl.querySelectorAll('img[src], a[href]');
      assets.forEach((el) => {{
        const attr = el.tagName === 'IMG' ? 'src' : 'href';
        const value = el.getAttribute(attr) || '';
        if (!value || /^(https?:|data:|mailto:|#)/i.test(value) || value.startsWith('/')) {{
          return;
        }}
        const joined = baseDir ? baseDir + value : value;
        el.setAttribute(attr, '/raw?file=' + encodeURIComponent(joined));
      }});
    }}

    async function typesetMath() {{
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {{
        if (window.MathJax && typeof MathJax.typesetPromise === 'function') {{
          try {{
            await Promise.race([
              MathJax.typesetPromise([contentEl]),
              new Promise((_, reject) => setTimeout(() => reject(new Error('MathJax timeout')), 2500)),
            ]);
          }} catch (error) {{
            console.warn('MathJax render skipped:', error);
          }}
          return;
        }}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }}
    }}

    function getUrlFileParam() {{
      const params = new URLSearchParams(window.location.search);
      return params.get('file') || '';
    }}

    if (files.length === 0) {{
      fileListEl.innerHTML = '<div class="empty">没有找到 Markdown 文件</div>';
      contentEl.innerHTML = '<div class="empty">没有找到 Markdown 文件</div>';
    }} else {{
      const urlFile = getUrlFileParam();
      const questionFiles = files.filter((item) => item.path.endsWith('/question.md'));
      const initialDefault = questionFiles.length > 0 ? questionFiles[0].path : files[0].path;
      let initial;
      if (urlFile && files.some((item) => item.path === urlFile)) {{
        initial = urlFile;
      }} else if (files.some((item) => item.path === initialFile)) {{
        initial = initialFile;
      }} else {{
        initial = initialDefault;
      }}
      loadFile(initial);
    }}
  </script>
</body>
</html>
"""


class PreviewHandler(BaseHTTPRequestHandler):
    server_version = "MarkdownPreview/0.1"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self._send_html()
            return
        if parsed.path == "/raw":
            self._send_raw(parsed)
            return
        self.send_error(404, "Not Found")

    @property
    def preview_state(self):
        return self.server.preview_state  # type: ignore[attr-defined]

    def _send_html(self) -> None:
        state = self.preview_state
        title = f"Markdown Preview - {state['base_name']}"
        html = _build_html(
            title=title,
            base_name=state["base_name"],
            initial_file=state["initial_file"],
            files_json=json.dumps(state["files"], ensure_ascii=False),
        )
        data = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_raw(self, parsed) -> None:
        state = self.preview_state
        query = parse_qs(parsed.query)
        file_name = query.get("file", [""])[0]
        if not file_name:
            self.send_error(400, "Missing file parameter")
            return
        target = (state["root"] / file_name).resolve()
        try:
            target.relative_to(state["root"])
        except ValueError:
            self.send_error(403, "Path outside preview root")
            return
        if not target.exists() or not target.is_file():
            self.send_error(404, "File not found")
            return
        mime_type, _ = mimetypes.guess_type(str(target))
        if mime_type and mime_type.startswith("text/"):
            data = target.read_text(encoding="utf-8").encode("utf-8")
        else:
            data = target.read_bytes()
        self.send_response(200)
        content_type = mime_type or "application/octet-stream"
        if content_type.startswith("text/") and "charset" not in content_type:
            content_type = f"{content_type}; charset=utf-8"
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Markdown 预览工具")
    parser.add_argument("path", nargs="?", default="README.md", help="要预览的 Markdown 文件或目录")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"监听端口，默认 {DEFAULT_PORT}")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址，默认 127.0.0.1")
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    return parser.parse_args()


def build_state(target: Path) -> dict[str, object]:
    if target.is_file():
        root = target.parent
    else:
        root = target
    files = _collect_markdown_files(root)
    if not files:
        raise SystemExit(f"未找到 Markdown 文件: {root}")
    file_items = [
        {
            "path": _relative_name(root, path),
            "label": _relative_name(root, path),
        }
        for path in files
    ]
    initial_file = _relative_name(root, target if target.is_file() else files[0])
    return {
        "root": root,
        "files": file_items,
        "initial_file": initial_file,
        "base_name": target.name if target.is_file() else target.name or root.name,
    }


def main() -> int:
    args = parse_args()
    target = _resolve_path(args.path)
    state = build_state(target)

    server = ThreadingHTTPServer((args.host, args.port), PreviewHandler)
    server.preview_state = state  # type: ignore[attr-defined]

    url = f"http://{args.host}:{args.port}/"
    if not args.no_open:
        threading.Timer(0.5, lambda: webbrowser.open(f"{url}?file={quote(state['initial_file'])}")).start()

    print(f"Markdown preview server running at {url}")
    print(f"Preview root: {state['root']}")
    print(f"Initial file: {state['initial_file']}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping preview server...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
