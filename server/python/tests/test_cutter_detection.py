from __future__ import annotations

import unittest

from src.common.schema import DocumentData, PageData, TextLine
from src.cutter.detect_questions import detect_question_anchors, detect_solution_anchors


def line(text: str, y: float, x: float = 90.0) -> TextLine:
    return TextLine(text=text, bbox=(x, y, x + 200.0, y + 16.0), block_index=0, line_index=0)


def document(lines: list[TextLine] | list[list[TextLine]]) -> DocumentData:
    page_lines = lines if lines and isinstance(lines[0], list) else [lines]
    return DocumentData(
        source_pdf="fixture.pdf",
        file_name="fixture.pdf",
        document_type="exam_like",
        page_count=len(page_lines),
        pages=[
            PageData(
                number=index + 1,
                width=595.0,
                height=842.0,
                body_bbox=(82.0, 70.0, 520.0, 800.0),
                text_blocks=[],
                text_lines=list(page),
                image_boxes=[],
                drawing_boxes=[],
                graphic_clusters=[],
                block_density=0,
                has_text=True,
            )
            for index, page in enumerate(page_lines)
        ],
    )


def answer_only_document(lines: list[TextLine]) -> DocumentData:
    return DocumentData(
        source_pdf="answer.pdf",
        file_name="answer.pdf",
        document_type="answer_like",
        page_count=1,
        pages=[
            PageData(
                number=1,
                width=595.0,
                height=842.0,
                body_bbox=(82.0, 70.0, 520.0, 800.0),
                text_blocks=[],
                text_lines=lines,
                image_boxes=[],
                drawing_boxes=[],
                graphic_clusters=[],
                block_density=0,
                has_text=True,
            )
        ],
    )


class CutterDetectionTests(unittest.TestCase):
    def test_compatibility_ideograph_section_keeps_first_page_questions(self) -> None:
        anchors = detect_question_anchors(
            document(
                [
                    line("⼀、单选题", 181.96),
                    line("1．已知复数z 满足条件，则", 205.36),
                    line("2．已知 tan a，tan b 分别为", 267.76),
                    line("3．设在三角形 ABC 中", 326.26),
                    line("4．某班从5名同学中选3名同学", 404.26),
                    line("5．已知 p 是 q 的条件", 478.36),
                ]
            )
        )

        self.assertEqual([anchor.question_id for anchor in anchors], ["1", "2", "3", "4", "5"])
        self.assertTrue(all(anchor.in_valid_section for anchor in anchors))

    def test_notice_numbering_is_still_skipped_before_sections(self) -> None:
        anchors = detect_question_anchors(
            document(
                [
                    line("注意事项", 110.0),
                    line("1. 填写姓名和考号。", 140.0),
                    line("2. 答案写在答题卡上。", 170.0),
                    line("一、单选题", 230.0),
                    line("1. 第一题题干", 260.0),
                    line("2. 第二题题干", 320.0),
                ]
            )
        )

        self.assertEqual([anchor.question_id for anchor in anchors], ["1", "2"])
        self.assertEqual([anchor.bbox[1] for anchor in anchors], [260.0, 320.0])

    def test_full_exam_stops_before_reference_answer_section(self) -> None:
        anchors = detect_question_anchors(
            document(
                [
                    [
                        line("一、单选题", 180.0),
                        line("1. 第一题题干", 210.0),
                        line("2. 第二题题干", 300.0),
                    ],
                    [
                        line("《某某试卷》参考答案", 72.0),
                        line("1.C", 170.0),
                        line("2.B", 260.0),
                    ],
                ]
            )
        )

        self.assertEqual([anchor.question_id for anchor in anchors], ["1", "2"])

    def test_answer_only_documents_are_not_truncated_on_first_page(self) -> None:
        anchors = detect_question_anchors(
            answer_only_document(
                [
                    line("《某某试卷》参考答案", 72.0),
                    line("1.C", 170.0),
                    line("2.B", 260.0),
                ]
            )
        )

        self.assertEqual([anchor.question_id for anchor in anchors], ["1", "2"])

    def test_solution_anchors_are_extracted_after_reference_answer_heading(self) -> None:
        anchors = detect_solution_anchors(
            document(
                [
                    [line("一、单选题", 180.0), line("1. 第一题题干", 210.0)],
                    [
                        line("《某某试卷》参考答案", 72.0),
                        line("题号", 90.0),
                        line("1", 90.0, x=130.0),
                        line("答案", 106.0),
                        line("A", 106.0, x=130.0),
                        line("1.A", 170.0),
                        line("2.B", 260.0),
                        line("13.10100", 360.0),
                    ],
                ]
            )
        )

        self.assertEqual([anchor.question_id for anchor in anchors], ["1", "2", "13"])


if __name__ == "__main__":
    unittest.main()
