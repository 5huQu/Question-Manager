from __future__ import annotations

import tempfile
import unittest
import json
from pathlib import Path
from unittest.mock import patch

import fitz

from src.ocr.glm import _fields_from_regions, _ignored_glm_image_blocks, _region_fraction, _with_pdf_page_sizes, build_drafts, split_exam_markdown


class GlmOcrTests(unittest.TestCase):
    def test_region_fraction_uses_source_pdf_page_size(self) -> None:
        record = {"_pdf_page_sizes": {"1": (600.0, 1200.0)}}
        segment = {"page_number": 1, "bbox": {"x": 60, "y": 360, "width": 480, "height": 240}}
        self.assertEqual(_region_fraction(segment, record), (0.1, 0.3, 0.9, 0.5))

    def test_source_pdf_page_sizes_are_loaded_for_non_a4_pages(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            pdf_path = root / "landscape.pdf"
            document = fitz.open()
            document.new_page(width=1200, height=600)
            document.save(pdf_path)
            document.close()
            manifest = _with_pdf_page_sizes([{"source_pdf": "landscape.pdf"}], root)
        self.assertEqual(manifest[0]["_pdf_page_sizes"]["1"], (1200.0, 600.0))

    def test_split_exam_markdown_groups_consecutive_question_numbers(self) -> None:
        grouped = split_exam_markdown([
            "1. 第一题题干\n【答案】A\n【解析】第一题解析\n\n2. 第二题题干\n【答案】B",
            "【解析】第二题解析\n\n3. 第三题题干",
        ], ["1", "2", "3"])
        self.assertEqual(grouped["1"]["answer"], "A")
        self.assertIn("第二题解析", grouped["2"]["analysis"])
        self.assertEqual(grouped["3"]["stem"], "第三题题干")

    def test_split_exam_markdown_skips_numbered_cover_instructions(self) -> None:
        grouped = split_exam_markdown([
            "1. 本试卷分第I卷和第II卷。\n2. 回答第I卷时写在答题卡上。\n"
            "## 一、单项选择题\n1. 第一题题干\n【答案】A\n【解析】第一题解析\n"
            "2. 第二题题干\n【答案】B\n【解析】第二题解析",
        ], ["1", "2"])
        self.assertEqual(grouped["1"]["stem"], "第一题题干")
        self.assertEqual(grouped["2"]["stem"], "第二题题干")
        self.assertEqual(grouped["1"]["parse_confidence"], "high")

    def test_text_regions_take_priority_over_marker_split(self) -> None:
        payload = {
            "data_info": {"pages": [{"width": 1000, "height": 1000}]},
            "layout_details": [[
                {"label": "text", "content": "题干", "bbox_2d": [0, 0, 1000, 300]},
                {"label": "text", "content": "答案", "bbox_2d": [0, 300, 1000, 500]},
                {"label": "text", "content": "解析", "bbox_2d": [0, 500, 1000, 900]},
            ]],
        }
        fields = _fields_from_regions({"text_regions": [
            {"kind": "problem", "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 0, "width": 595.3, "height": 252.57}}]},
            {"kind": "answer", "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 252.57, "width": 595.3, "height": 168.38}}]},
            {"kind": "analysis", "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 420.95, "width": 595.3, "height": 336.76}}]},
        ]}, payload)
        self.assertEqual(fields, {"problem": "题干", "answer": "答案", "analysis": "解析"})

    def test_text_regions_do_not_pull_in_adjacent_block_from_tiny_overlap(self) -> None:
        payload = {
            "data_info": {"pages": [{"width": 1000, "height": 1000}]},
            "layout_details": [[
                {"label": "text", "content": "6. 上一题", "bbox_2d": [0, 700, 1000, 790]},
                {"label": "text", "content": "7. 当前题", "bbox_2d": [0, 800, 1000, 920]},
            ]],
        }
        fields = _fields_from_regions({"text_regions": [
            # The first block overlaps this region by 10 pixels only.
            {"kind": "problem", "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 780 * 0.8419, "width": 595.3, "height": 220 * 0.8419}}]},
        ]}, payload)
        self.assertEqual(fields["problem"], "7. 当前题")

    def test_build_drafts_region_mode_keeps_same_pdf_solution_separate(self) -> None:
        payload = {
            "data_info": {"pages": [{"width": 1000, "height": 1000}]},
            "layout_details": [[
                {"label": "text", "content": "1. 第一题题干", "bbox_2d": [0, 0, 1000, 300]},
                {"label": "text", "content": "1. 【答案】A\n【解析】第一题解析", "bbox_2d": [0, 600, 1000, 950]},
            ]],
        }
        manifest = [
            {
                "id": "CUT_0001",
                "question_no": "1",
                "page": 1,
                "page_span": [1, 1],
                "ocr_record_kind": "question",
                "ocr_parse_mode": "region",
                "text_regions": [{"kind": "problem", "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 0, "width": 595.3, "height": 252.57}}]}],
                "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 0, "width": 595.3, "height": 252.57}}],
            },
            {
                "id": "SOL_0001",
                "question_no": "1",
                "page": 1,
                "page_span": [1, 1],
                "ocr_record_kind": "solution",
                "ocr_parse_mode": "region",
                "text_regions": [{"kind": "analysis", "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 505.14, "width": 595.3, "height": 294.67}}]}],
                "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 505.14, "width": 595.3, "height": 294.67}}],
            },
        ]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            report = build_drafts(result_payload=payload, manifest=manifest, drafts_root=root / "drafts", artifact_dir=root / "artifact", storage_root=root)
            self.assertEqual(report["successful"], 2)
            question = json.loads((root / "drafts" / "CUT_0001" / "ocr_result.json").read_text(encoding="utf-8"))
            solution = json.loads((root / "drafts" / "SOL_0001" / "ocr_result.json").read_text(encoding="utf-8"))
        self.assertEqual(question["problem_text"], "1. 第一题题干")
        self.assertEqual(question["answer"], "")
        self.assertEqual(question["analysis"], "")
        self.assertEqual(solution["problem_text"], "")
        self.assertEqual(solution["answer"], "A")
        self.assertEqual(solution["analysis"], "第一题解析")
        self.assertTrue(question["post_processing"]["used_text_regions"])
        self.assertTrue(solution["post_processing"]["used_text_regions"])

    def test_build_drafts_solution_document_maps_unmarked_text_to_analysis(self) -> None:
        payload = {
            "data_info": {"pages": [{"width": 1000, "height": 1000}]},
            "layout_details": [[{"label": "text", "content": "1. 由题意可得 $x=1$，故选 A。", "bbox_2d": [0, 0, 1000, 300]}]],
        }
        manifest = [{"id": "SOL_0001", "question_no": "1", "page": 1, "page_span": [1, 1], "ocr_record_kind": "solution", "ocr_parse_mode": "document"}]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            report = build_drafts(result_payload=payload, manifest=manifest, drafts_root=root / "drafts", artifact_dir=root / "artifact", storage_root=root, document_role="solution")
            result = json.loads((root / "drafts" / "SOL_0001" / "ocr_result.json").read_text(encoding="utf-8"))
        self.assertEqual(report["successful"], 1)
        self.assertEqual(result["problem_text"], "")
        self.assertIn("故选 A", result["analysis"])
        self.assertEqual(result["post_processing"]["document_role"], "solution")

    def test_build_drafts_marks_missing_question_number_for_review(self) -> None:
        payload = {"data_info": {"pages": [{"width": 1000, "height": 1000}]}, "layout_details": [[{"label": "text", "content": "1. 第一题", "bbox_2d": [0, 0, 1000, 200]}]]}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            report = build_drafts(result_payload=payload, manifest=[{"id": "CUT_0002", "question_no": "2", "page": 1, "page_span": [1, 1], "_pdf_page_sizes": {"1": (595.3, 841.9)}}], drafts_root=root / "drafts", artifact_dir=root / "artifact", storage_root=root)
            self.assertEqual(report["failed"], 1)
            result = json.loads((root / "drafts" / "CUT_0002" / "ocr_result.json").read_text(encoding="utf-8"))
            self.assertEqual(result["post_processing"]["error"], "question_number_not_found")
            self.assertNotIn("_pdf_page_sizes", result)

    def test_build_drafts_records_figure_and_formula_diagnostics(self) -> None:
        payload = {
            "data_info": {"pages": [{"width": 1000, "height": 1000}]},
            "layout_details": [[
                {"label": "image", "index": "image-top", "content": "https://example.test/image.jpg", "bbox_2d": [100, 100, 900, 400]},
                {"label": "text", "content": "17. 题干\n【解析】$ B=\\left\\{x\\mid x\\geq 2 $或 $ x<1\\right\\} $", "bbox_2d": [0, 0, 1000, 900]},
                {"label": "text", "content": "18. 下一题", "bbox_2d": [0, 900, 1000, 1000]},
            ]],
        }
        manifest = [
            {"id": "CUT_0017", "question_no": "17", "page": 1, "page_span": [1, 1], "figures": [{"id": "review-17", "page_number": 1, "bbox": {"x": 59.53, "y": 84.19, "width": 476.24, "height": 252.57}}], "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 0, "width": 595.3, "height": 420.95}}]},
            {"id": "CUT_0018", "question_no": "18", "page": 1, "page_span": [1, 1], "figures": [{"id": "review-18"}], "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 420.95, "width": 595.3, "height": 420.95}}]},
        ]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def download(_: str, target: Path) -> str:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"image")
                return str(target)
            with patch("src.ocr.glm._download_asset", side_effect=download):
                build_drafts(result_payload=payload, manifest=manifest, drafts_root=root / "drafts", artifact_dir=root / "artifact", storage_root=root)
            result = json.loads((root / "drafts" / "CUT_0017" / "ocr_result.json").read_text(encoding="utf-8"))
            binding = result["post_processing"]["figure_binding"]
            self.assertEqual(binding["image_blocks"][0]["segment_candidates"], ["17"])
            self.assertEqual(binding["image_blocks"][0]["page_span_candidates"], ["17", "18"])
            self.assertEqual(binding["bindings"][0]["review_figure_id"], "review-17")
            self.assertEqual(binding["unmatched_review_figure_ids"], [])
            self.assertEqual([figure["id"] for figure in result["figures"][:1]], ["review-17"])
            self.assertEqual(len(result["figures"]), 2)
            next_result = json.loads((root / "drafts" / "CUT_0018" / "ocr_result.json").read_text(encoding="utf-8"))
            self.assertEqual(next_result["post_processing"]["figure_binding"]["image_blocks"][0]["current_binding"], "page_span_only")
            self.assertEqual([figure["id"] for figure in next_result["figures"]], ["review-18"])
            diagnostics = result["post_processing"]["render_diagnostics"]
            self.assertEqual([item["code"] for item in diagnostics], ["latex_left_right_unbalanced", "latex_left_right_unbalanced"])

    def test_build_drafts_ignores_glm_header_images(self) -> None:
        payload = {
            "data_info": {"pages": [{"width": 1000, "height": 1000}]},
            "layout_details": [[
                {"label": "image", "native_label": "header_image", "content": "https://example.test/watermark.png", "bbox_2d": [100, 20, 900, 80]},
                {"label": "text", "content": "2. 题干\n【答案】A\n【解析】解析内容", "bbox_2d": [0, 100, 1000, 900]},
            ]],
        }
        manifest = [{"id": "CUT_0002", "question_no": "2", "page": 1, "page_span": [1, 1], "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 0, "width": 595.3, "height": 841.9}}]}]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            build_drafts(result_payload=payload, manifest=manifest, drafts_root=root / "drafts", artifact_dir=root / "artifact", storage_root=root)
            result = json.loads((root / "drafts" / "CUT_0002" / "ocr_result.json").read_text(encoding="utf-8"))
        self.assertNotIn("<img", result["analysis"])
        self.assertNotIn("watermark.png", result["analysis"])
        self.assertEqual(result["figures"], [])
        self.assertEqual(result["post_processing"]["figure_binding"]["ignored_non_content_images"], 1)

    def test_build_drafts_drops_unmatched_plain_image_from_question_text(self) -> None:
        payload = {
            "data_info": {"pages": [{"width": 1000, "height": 1000}]},
            "layout_details": [[
                {"label": "text", "content": "10. 题干\n【答案】A\n【解析】解析", "bbox_2d": [0, 0, 1000, 400]},
                {"label": "image", "native_label": "image", "content": "https://example.test/page-watermark.png", "bbox_2d": [100, 600, 900, 950]},
            ]],
        }
        manifest = [{"id": "CUT_0010", "question_no": "10", "page": 1, "page_span": [1, 1], "segments": [{"page_number": 1, "bbox": {"x": 0, "y": 0, "width": 595.3, "height": 336.76}}]}]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            build_drafts(result_payload=payload, manifest=manifest, drafts_root=root / "drafts", artifact_dir=root / "artifact", storage_root=root)
            result = json.loads((root / "drafts" / "CUT_0010" / "ocr_result.json").read_text(encoding="utf-8"))
        self.assertNotIn("page-watermark.png", result["analysis"])
        self.assertNotIn("<img", result["raw_model_output"])

    def test_repeated_thin_header_images_are_ignored_without_native_label(self) -> None:
        payload = {
            "data_info": {"pages": [{"width": 1000, "height": 1000}] * 4},
            "layout_details": [[
                {"label": "image", "content": f"https://example.test/watermark-{index}.png", "bbox_2d": [100, 20, 900, 80]},
            ] for index in range(4)],
        }
        ignored, reasons = _ignored_glm_image_blocks(payload)
        self.assertEqual(len(ignored), 4)
        self.assertEqual(reasons["repeated_header_footer"], 4)


if __name__ == "__main__":
    unittest.main()
