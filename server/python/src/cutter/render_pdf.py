from __future__ import annotations

import re
from pathlib import Path

import fitz

from ..common.schema import (
    BBox,
    DocumentData,
    DocumentType,
    GraphicCluster,
    PageData,
    TextBlock,
    TextLine,
)

ANSWER_FILE_TERMS = ("答案", "解析版", "详解", "参考答案")
ANSWER_CONTENT_TERMS = ("【答案】", "【解析】", "【详解】", "解析：", "详解：", "参考答案", "故选：")
EXAM_TERMS = ("试卷", "试题", "月考", "考试", "联考")
WORKSHEET_TERMS = ("专题", "题型", "讲义", "练习")
HEADER_TERMS = ("页/共", "数学试卷", "学科网", "股份有限公司")


def load_document(pdf_path: Path) -> DocumentData:
    pdf_path = pdf_path.resolve()
    pages: list[PageData] = []
    sample_texts: list[str] = []

    with fitz.open(pdf_path) as doc:
        for page_index, page in enumerate(doc):
            page_dict = page.get_text("dict", sort=True)
            text_blocks: list[TextBlock] = []
            text_lines: list[TextLine] = []
            image_boxes: list[BBox] = []

            for block_index, block in enumerate(page_dict.get("blocks", [])):
                bbox = _to_bbox(block.get("bbox", (0.0, 0.0, 0.0, 0.0)))
                if block.get("type") == 0:
                    lines: list[TextLine] = []
                    line_texts: list[str] = []
                    for line_index, line in enumerate(block.get("lines", [])):
                        spans = line.get("spans", [])
                        text = "".join(span.get("text", "") for span in spans).strip()
                        if not text:
                            continue
                        text_line = TextLine(
                            text=text,
                            bbox=_to_bbox(line.get("bbox", bbox)),
                            block_index=block_index,
                            line_index=line_index,
                            font_sizes=[float(span.get("size", 0.0)) for span in spans if span.get("size")],
                        )
                        lines.append(text_line)
                        text_lines.append(text_line)
                        line_texts.append(text)
                    block_text = " ".join(line_texts).strip()
                    if block_text:
                        text_blocks.append(TextBlock(index=block_index, bbox=bbox, text=block_text, lines=lines))
                elif block.get("type") == 1:
                    image_boxes.append(bbox)

            drawing_boxes = _extract_drawing_boxes(page.get_drawings())
            body_bbox = _infer_body_bbox(page.rect, text_blocks)
            graphic_clusters = _merge_graphics(
                [(box, "image") for box in image_boxes] + [(box, "drawing") for box in drawing_boxes],
                merge_gap=10.0,
            )
            pages.append(
                PageData(
                    number=page_index + 1,
                    width=float(page.rect.width),
                    height=float(page.rect.height),
                    body_bbox=body_bbox,
                    text_blocks=text_blocks,
                    text_lines=sorted(text_lines, key=lambda item: (item.bbox[1], item.bbox[0])),
                    image_boxes=image_boxes,
                    drawing_boxes=drawing_boxes,
                    graphic_clusters=graphic_clusters,
                    block_density=len(text_blocks),
                    has_text=bool(text_lines),
                )
            )
            sample_texts.append(" ".join(line.text for line in text_lines[:24]))

    document_type = _classify_document(pdf_path.name, sample_texts)
    notes: list[str] = []
    if document_type == "answer_like":
        notes.append("检测到答案/解析特征，已启用答案版切题规则。")

    return DocumentData(
        source_pdf=str(pdf_path),
        file_name=pdf_path.name,
        document_type=document_type,
        page_count=len(pages),
        pages=pages,
        notes=notes,
    )


def extract_answer_summaries(document: DocumentData) -> dict[str, str]:
    summaries: dict[str, str] = {}
    answer_token_pattern = re.compile(r"^[A-D]+$")

    for page in document.pages:
        lines = page.text_lines
        for index, line in enumerate(lines):
            if line.text.strip() != "题号":
                continue

            question_y = line.bbox[1]
            answer_line = None
            for candidate in lines[index + 1 :]:
                if candidate.bbox[1] - question_y > 32.0:
                    break
                if candidate.text.strip() == "答案":
                    answer_line = candidate
                    break

            if answer_line is None:
                continue

            question_tokens = [
                item
                for item in lines
                if abs(item.bbox[1] - question_y) <= 8.0 and re.fullmatch(r"\d{1,2}", item.text.strip())
            ]
            answer_tokens = [
                item
                for item in lines
                if abs(item.bbox[1] - answer_line.bbox[1]) <= 8.0 and answer_token_pattern.fullmatch(item.text.strip())
            ]

            question_tokens.sort(key=lambda item: item.bbox[0])
            answer_tokens.sort(key=lambda item: item.bbox[0])

            for question_token, answer_token in zip(question_tokens, answer_tokens):
                summaries[question_token.text.strip()] = answer_token.text.strip()

    return summaries


def _classify_document(file_name: str, sample_texts: list[str]) -> DocumentType:
    joined_text = " ".join(sample_texts)
    if any(term in file_name for term in ANSWER_FILE_TERMS):
        return "answer_like"
    if any(term in joined_text for term in ANSWER_CONTENT_TERMS):
        return "answer_like"
    if any(term in file_name or term in joined_text for term in EXAM_TERMS):
        return "exam_like"
    if any(term in file_name or term in joined_text for term in WORKSHEET_TERMS):
        return "worksheet_like"
    return "unknown"


def _infer_body_bbox(page_rect: fitz.Rect, text_blocks: list[TextBlock]) -> BBox:
    default_x_margin = max(24.0, page_rect.width * 0.08)
    default_top = max(36.0, page_rect.height * 0.06)
    default_bottom = page_rect.height - max(28.0, page_rect.height * 0.05)
    body_candidates: list[TextBlock] = []

    for block in text_blocks:
        if _looks_like_header_or_footer(block.text, block.bbox, page_rect):
            continue
        body_candidates.append(block)

    if not body_candidates:
        return (default_x_margin, default_top, page_rect.width - default_x_margin, default_bottom)

    x0 = max(0.0, min(block.bbox[0] for block in body_candidates) - 8.0)
    y0 = max(default_top * 0.6, min(block.bbox[1] for block in body_candidates) - 10.0)
    x1 = min(page_rect.width, max(block.bbox[2] for block in body_candidates) + 8.0)
    y1 = min(default_bottom, max(block.bbox[3] for block in body_candidates) + 10.0)
    return (x0, y0, x1, y1)


def _looks_like_header_or_footer(text: str, bbox: BBox, page_rect: fitz.Rect) -> bool:
    compact = re.sub(r"\s+", "", text)
    y0, y1 = bbox[1], bbox[3]
    top_cutoff = page_rect.height * 0.12
    bottom_cutoff = page_rect.height * 0.88

    if y1 <= top_cutoff and any(term in compact for term in HEADER_TERMS):
        return True
    if y0 >= bottom_cutoff and re.fullmatch(r"第?\d+页?(?:/共\d+页)?", compact):
        return True
    if y0 >= bottom_cutoff and compact.isdigit():
        return True
    return False


def _extract_drawing_boxes(drawings: list[dict]) -> list[BBox]:
    boxes: list[BBox] = []
    for drawing in drawings:
        rect = drawing.get("rect")
        if rect is None:
            continue
        bbox = (float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1))
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        if max(width, height) < 12.0:
            continue
        boxes.append(bbox)
    return boxes


def _merge_graphics(items: list[tuple[BBox, str]], merge_gap: float) -> list[GraphicCluster]:
    clusters: list[tuple[list[float], int, set[str]]] = []

    for bbox, kind in items:
        if _bbox_area(bbox) < 140.0 and max(bbox[2] - bbox[0], bbox[3] - bbox[1]) < 18.0:
            continue
        target_index = None
        for index, (current_bbox, _, _) in enumerate(clusters):
            if _bbox_close(tuple(current_bbox), bbox, merge_gap):
                target_index = index
                break
        if target_index is None:
            clusters.append(([bbox[0], bbox[1], bbox[2], bbox[3]], 1, {kind}))
            continue

        current_bbox, source_count, kinds = clusters[target_index]
        current_bbox[0] = min(current_bbox[0], bbox[0])
        current_bbox[1] = min(current_bbox[1], bbox[1])
        current_bbox[2] = max(current_bbox[2], bbox[2])
        current_bbox[3] = max(current_bbox[3], bbox[3])
        clusters[target_index] = (current_bbox, source_count + 1, kinds | {kind})

    merged = [
        GraphicCluster(
            bbox=(cluster_bbox[0], cluster_bbox[1], cluster_bbox[2], cluster_bbox[3]),
            source_count=source_count,
            kinds=sorted(kinds),
        )
        for cluster_bbox, source_count, kinds in clusters
        if _bbox_area(tuple(cluster_bbox)) >= 200.0 or max(cluster_bbox[2] - cluster_bbox[0], cluster_bbox[3] - cluster_bbox[1]) >= 24.0
    ]
    return sorted(merged, key=lambda item: (item.bbox[1], item.bbox[0]))


def _bbox_close(left: BBox, right: BBox, gap: float) -> bool:
    return not (
        left[2] + gap < right[0]
        or right[2] + gap < left[0]
        or left[3] + gap < right[1]
        or right[3] + gap < left[1]
    )


def _bbox_area(bbox: BBox) -> float:
    return max(1.0, bbox[2] - bbox[0]) * max(1.0, bbox[3] - bbox[1])


def _to_bbox(values: tuple[float, float, float, float] | list[float]) -> BBox:
    x0, y0, x1, y1 = values
    return (float(x0), float(y0), float(x1), float(y1))
