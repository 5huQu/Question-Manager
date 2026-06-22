from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from src.ocr.glm import _fields_from_regions, build_drafts, split_exam_markdown


class GlmOcrTests(unittest.TestCase):
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

    def test_build_drafts_marks_missing_question_number_for_review(self) -> None:
        payload = {"data_info": {"pages": [{"width": 1000, "height": 1000}]}, "layout_details": [[{"label": "text", "content": "1. 第一题", "bbox_2d": [0, 0, 1000, 200]}]]}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            report = build_drafts(result_payload=payload, manifest=[{"id": "CUT_0002", "question_no": "2", "page": 1, "page_span": [1, 1]}], drafts_root=root / "drafts", artifact_dir=root / "artifact", storage_root=root)
            self.assertEqual(report["failed"], 1)
            self.assertIn("question_number_not_found", (root / "drafts" / "CUT_0002" / "ocr_result.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
