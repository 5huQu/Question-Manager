from __future__ import annotations

import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError

from src.ocr.doc2x import Doc2xClient, Doc2xError, Doc2xSettings, classify_solution_document, inline_doc2x_figures, solution_fields, split_exam_markdown


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def read(self) -> bytes:
        import json
        return json.dumps(self.payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class Doc2xClientTests(unittest.TestCase):
    def test_preupload_uses_v3_model(self) -> None:
        client = Doc2xClient(Doc2xSettings(api_key="test", max_retries=0))
        with patch("urllib.request.urlopen", return_value=FakeResponse({"code": "success", "data": {"uid": "u1", "url": "https://upload.test/u1"}})) as mocked:
            response = client.preupload()
        self.assertEqual(response["uid"], "u1")
        request = mocked.call_args.args[0]
        self.assertIn(b'"model": "v3-2026"', request.data)

    def test_business_quota_error_is_not_silently_accepted(self) -> None:
        client = Doc2xClient(Doc2xSettings(api_key="test", max_retries=0))
        with patch("urllib.request.urlopen", return_value=FakeResponse({"code": "parse_quota_limit", "msg": "解析额度不足"})):
            with self.assertRaises(Doc2xError) as raised:
                client.preupload()
        self.assertEqual(raised.exception.code, "parse_quota_limit")

    def test_http_429_is_reported_after_retry_budget(self) -> None:
        client = Doc2xClient(Doc2xSettings(api_key="test", max_retries=0))
        error = HTTPError("https://doc2x.test", 429, "too many", {}, BytesIO(b"busy"))
        with patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(Doc2xError) as raised:
                client.preupload()
        self.assertEqual(raised.exception.code, "http_429")


class Doc2xMarkdownSplitTests(unittest.TestCase):
    def test_replaces_doc2x_media_html_with_local_figure_marker(self) -> None:
        content = "如图，\n<!-- Media -->\n<img src=\"https://example.test/a.jpg\">\n<!-- Media -->\n继续证明。"
        rendered = inline_doc2x_figures(content, {"https://example.test/a.jpg": {"id": "blk_p2_6"}})
        self.assertIn("<!-- DOC2X_FIGURE:blk_p2_6 -->", rendered)
        self.assertNotIn("<!-- Media -->", rendered)
        self.assertNotIn("<img", rendered)

    def test_uses_section_to_skip_instruction_numbers_and_keeps_cross_page_image(self) -> None:
        pages = [
            {
                "page_idx": 0,
                "md": """
<!-- Meanless: 学科网 -->
# 注意事项
1. 填写姓名。
2. 保持答题卡整洁。
## 一、选择题
1. 题干一
【答案】A
【解析】解析一
2. 题干二 <img src=\"https://example.test/q2.png\">
""",
            },
            {
                "page_idx": 1,
                "md": """
【答案】B
【解析】解析二
## 二、选择题
3. 题干三
【答案】C
【解析】解析三
""",
            },
        ]
        result = split_exam_markdown(pages, ["1", "2", "3"])

        self.assertEqual(list(result), ["1", "2", "3"])
        self.assertEqual(result["1"]["answer"], "A")
        self.assertEqual(result["2"]["answer"], "B")
        self.assertEqual(result["2"]["page_indices"], [0, 1])
        self.assertEqual(result["2"]["image_urls"], ["https://example.test/q2.png"])
        self.assertNotIn("填写姓名", result["1"]["stem"])

    def test_missing_question_is_not_invented(self) -> None:
        pages = [{"page_idx": 0, "md": "## 一、选择题\n1. 题干\n【答案】A\n【解析】解析"}]
        result = split_exam_markdown(pages, ["1", "2"])
        self.assertEqual(list(result), ["1"])

    def test_unordered_manifest_does_not_change_document_boundaries(self) -> None:
        pages = [{
            "page_idx": 0,
            "md": """
## 一、选择题
1. 题干一
2. 题干二
3. 题干三
""",
        }]

        result = split_exam_markdown(pages, ["3", "1", "2"])

        self.assertEqual(list(result), ["1", "2", "3"])
        self.assertEqual(result["1"]["stem"], "题干一")
        self.assertEqual(result["2"]["stem"], "题干二")
        self.assertEqual(result["3"]["stem"], "题干三")

    def test_classifies_numbered_answer_key_without_markers(self) -> None:
        pages = [{"md": "1. A\n2. C\n3. D\n4. B"}]
        self.assertEqual(classify_solution_document(pages), "answer_key")

    def test_classifies_worked_solution_without_markers(self) -> None:
        pages = [{"md": "1. 由题意可得 x=1，故选 A。\n2. 证明：设 f(x)=x^2。"}]
        self.assertEqual(classify_solution_document(pages), "analysis")

    def test_keeps_solution_before_empty_next_section_marker(self) -> None:
        answer, analysis, marked = solution_fields("推导过程\n## 【解析】", "marked")
        self.assertEqual(answer, "")
        self.assertEqual(analysis, "推导过程")
        self.assertFalse(marked)


if __name__ == "__main__":
    unittest.main()
