#!/usr/bin/env python3
"""PDF 数学题切分工具 —— 统一运行入口。

用法:
    python scripts/run_cut.py
    python scripts/run_cut.py --dpi 200
    python scripts/run_cut.py --input ./my_pdfs/

默认读取 input/pdfs/ 下所有 PDF，输出到 output/。
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

# Ensure project root is on sys.path so that `from src.xxx` works
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.common.paths import (
    AUTO_CUTS_DIR,
    INPUT_DIR,
    OUTPUT_DIR,
    PAGES_DIR,
    ensure_output_dirs,
)
from src.cutter.render_pdf import extract_answer_summaries, load_document
from src.cutter.detect_questions import detect_question_anchors
from src.cutter.crop_questions import (
    crop_question_images,
    detect_figures,
    infer_question_slices,
    render_page_images,
)
from src.cutter.export_results import (
    build_cut_results,
    build_run_summary,
    write_cut_results,
    CUT_ID_PREFIX,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="PDF 数学题自动切分工具",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=INPUT_DIR,
        help=f"PDF 输入目录，默认 {INPUT_DIR}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_DIR,
        help=f"输出目录，默认 {OUTPUT_DIR}",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=180,
        help="导出 PNG 的 DPI，默认 180",
    )
    return parser.parse_args()


def discover_pdfs(input_path: Path) -> list[Path]:
    if input_path.is_file() and input_path.suffix.lower() == ".pdf":
        return [input_path]
    if not input_path.exists():
        return []
    return sorted(
        path for path in input_path.rglob("*.pdf") if path.is_file()
    )


def main() -> None:
    args = parse_args()
    input_path = args.input.resolve()
    output_root = args.output.resolve()
    dpi = args.dpi

    ensure_output_dirs()

    pdf_paths = discover_pdfs(input_path)
    if not pdf_paths:
        print(f"未在 {input_path} 找到 PDF 文件。")
        sys.exit(1)

    print(f"发现 {len(pdf_paths)} 个 PDF 文件\n")

    all_slices: list = []
    total_pages = 0
    failed_pdfs: list[dict] = []
    page_image_map: dict[str, list[Path]] = {}

    for idx, pdf_path in enumerate(pdf_paths, start=1):
        pdf_display = pdf_path.name
        print(f"[{idx}/{len(pdf_paths)}] 处理: {pdf_display}")

        try:
            document = load_document(pdf_path)

            if not any(page.has_text for page in document.pages):
                failed_pdfs.append(
                    {
                        "pdf_name": pdf_path.name,
                        "reason": "PDF 无可用文字层，不支持扫描件或图片型 PDF。",
                    }
                )
                print(f"  → 跳过: 无文字层 (扫描件/图片型 PDF 不支持)")
                continue

            # Step 1: Render page images
            page_paths = render_page_images(document, PAGES_DIR, dpi=dpi)
            page_image_map[str(document.source_pdf)] = page_paths
            total_pages += len(page_paths)
            print(f"  → 渲染 {len(page_paths)} 页")

            # Step 2: Extract answer summaries (if available)
            answer_summaries = extract_answer_summaries(document)

            # Step 3: Detect question anchors
            anchors = detect_question_anchors(document)
            print(f"  → 检测到 {len(anchors)} 个题号")

            # Step 4: Infer question boundaries
            slices = infer_question_slices(document, anchors)
            for s in slices:
                s.answer_summary = answer_summaries.get(s.question_id)
                s.figures = detect_figures(document, s)

            # Step 5: Crop question images
            slices = crop_question_images(slices, AUTO_CUTS_DIR, dpi=dpi)
            all_slices.extend(slices)
            print(f"  → 切出 {len(slices)} 题\n")

        except Exception as exc:
            error_msg = traceback.format_exc()
            failed_pdfs.append(
                {
                    "pdf_name": pdf_path.name,
                    "reason": str(exc),
                    "traceback": error_msg,
                }
            )
            print(f"  → 失败: {exc}\n")
            continue

    # Step 6: Build and write cut_results.json
    cut_results = build_cut_results(all_slices, page_image_map)
    results_path = write_cut_results(cut_results)

    # Step 7: Print summary
    summary = build_run_summary(
        pdf_count=len(pdf_paths),
        page_count=total_pages,
        cut_count=len(cut_results),
        failed_pdfs=failed_pdfs,
        output_paths={
            "pages": PAGES_DIR,
            "auto_cuts": AUTO_CUTS_DIR,
            "cut_results": results_path,
        },
    )

    print("=" * 60)
    print("处理完成")
    print("=" * 60)
    print(f"处理 PDF 数量: {summary['processed_pdf_count']}")
    print(f"渲染页面数量: {summary['rendered_page_count']}")
    print(f"切出题目数量: {summary['cut_question_count']}")
    if failed_pdfs:
        print(f"失败文件: {len(failed_pdfs)}")
        for f in failed_pdfs:
            print(f"  - {f['pdf_name']}: {f['reason']}")
    print(f"\n输出路径:")
    for name, path in summary["output_paths"].items():
        print(f"  {name}: {path}")

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
