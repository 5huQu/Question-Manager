from __future__ import annotations

import re

from ..common.schema import DocumentData, QuestionAnchor
from .rules import SlicerRules

SECTION_PATTERN = re.compile(
    r"^(?:(?P<cn>[一二三四五六七八九十]+)[、.．]\s*(?P<section>.+?(?:题|部分))|(?P<topic>题型\s*0?\d+.*)|(?P<example>例题.*))"
)
ARABIC_PATTERN = re.compile(r"^(?P<num>\d{1,2})(?P<sep>[.．、])(?!\d)\s*(?P<rest>.*)")
SECTION_QUESTION_PATTERN = re.compile(r"^第\s*(?P<num>\d{1,2})\s*题\s*(?P<rest>.*)")
EXAMPLE_PATTERN = re.compile(r"^例\s*(?P<num>\d{1,2})\s*(?P<rest>.*)")
SUBQUESTION_PATTERN = re.compile(r"^[（(]\s*\d+\s*[)）]")

# Fallback defaults — used when detect_question_anchors is called without rules
NOTICE_TERMS = ("答题", "注意事项", "作答", "考试结束", "答卷前", "答案不能答在试卷上")
AUXILIARY_MARKERS = ("目录", "解题规律", "提分快招", "题型归纳", "题型探析", "思维导图", "知识点", "规律方法", "方法技巧")
REFERENCE_FORMULA_MARKERS = ("参考公式", "参考关系式", "参考数据")
TRAINING_MARKERS = ("【典例训练】", "【例题】", "一、解答题", "一、单选题", "一、选择题", "二、填空题", "三、多选题", "二、多选题")
NON_QUESTION_REMAINDERS = ("其他类型", "常见类型", "方法总结", "规律总结")


def _resolve_markers(rules: SlicerRules | None) -> tuple:
    """Extract enabled marker tuples from rules, or fall back to module-level constants."""
    if rules is None:
        return AUXILIARY_MARKERS, NOTICE_TERMS, REFERENCE_FORMULA_MARKERS, TRAINING_MARKERS, NON_QUESTION_REMAINDERS
    return (
        rules.auxiliary_terms,
        rules.notice_terms_tuple,
        rules.reference_formula_terms,
        rules.training_terms,
        rules.non_question_remainder_terms,
    )


def detect_question_anchors(document: DocumentData, rules: SlicerRules | None = None) -> list[QuestionAnchor]:
    _aux, _notice, _ref, _train, _nqr = _resolve_markers(rules)

    anchors: list[QuestionAnchor] = []
    active_section: str | None = None
    seen_valid_section = False

    for page in document.pages:
        auxiliary_mode = False
        for line_index, line in enumerate(page.text_lines):
            text = _normalize_line(line.text)
            if not text:
                continue

            if any(marker in text for marker in _aux):
                auxiliary_mode = True

            section_title = _match_section(text)
            if section_title is not None:
                active_section = section_title
                seen_valid_section = True
                auxiliary_mode = False
                continue

            if any(marker in text for marker in _train):
                auxiliary_mode = False
                continue

            anchor = _match_anchor(text)
            if anchor is None:
                continue

            label, display_label, kind, remainder = anchor
            reasons: list[str] = []
            in_valid_section = seen_valid_section or page.number > 1

            if SUBQUESTION_PATTERN.match(text):
                continue
            if _looks_like_notice(text, _notice) and page.number == 1 and not seen_valid_section:
                continue
            if _is_probable_instruction_anchor(text, page.number, line.bbox[1], page.height, seen_valid_section):
                continue
            if auxiliary_mode:
                continue
            if _has_auxiliary_context(page.text_lines, line_index, line.bbox[1], _aux):
                continue
            if kind == "arabic" and _has_reference_formula_context(page.text_lines, line_index, line.bbox[1], _ref):
                continue
            if remainder in _nqr or (remainder.endswith("类型") and len(remainder) <= 8):
                continue
            if not remainder and line.bbox[0] > page.body_bbox[0] + page.width * 0.10:
                continue
            if line.bbox[0] > page.body_bbox[0] + page.width * 0.22:
                reasons.append("题号缩进较深，可能误报。")
                in_valid_section = False
            if not seen_valid_section:
                reasons.append("文档内未检测到明确题目章节。")
            if remainder and any(term in remainder for term in _notice):
                continue

            anchors.append(
                QuestionAnchor(
                    question_id=label,
                    display_label=display_label,
                    page_number=page.number,
                    bbox=line.bbox,
                    raw_text=text,
                    anchor_kind=kind,
                    section_title=active_section,
                    in_valid_section=in_valid_section,
                    score_hints=reasons,
                )
            )

    return _deduplicate(anchors)


def _match_section(text: str) -> str | None:
    match = SECTION_PATTERN.match(text)
    if not match:
        return None
    if match.group("section"):
        return match.group("section").strip()
    if match.group("topic"):
        return match.group("topic").strip()
    if match.group("example"):
        return match.group("example").strip()
    return None


def _match_anchor(text: str) -> tuple[str, str, str, str] | None:
    match = ARABIC_PATTERN.match(text)
    if match:
        number = match.group("num")
        remainder = match.group("rest").strip()
        return (number, number, "arabic", remainder)

    match = SECTION_QUESTION_PATTERN.match(text)
    if match:
        number = match.group("num")
        remainder = match.group("rest").strip()
        return (f"第{number}题", f"第{number}题", "section_question", remainder)

    match = EXAMPLE_PATTERN.match(text)
    if match:
        number = match.group("num")
        remainder = match.group("rest").strip()
        return (f"例{number}", f"例{number}", "example", remainder)

    return None


def _normalize_line(text: str) -> str:
    text = text.replace("　", " ")
    text = text.replace("､", "、")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _looks_like_notice(text: str, _notice: tuple[str, ...] = NOTICE_TERMS) -> bool:
    return any(term in text for term in _notice)


def _is_probable_instruction_anchor(text: str, page_number: int, y0: float, page_height: float, seen_valid_section: bool) -> bool:
    if page_number != 1:
        return False
    if seen_valid_section:
        return False
    if y0 > page_height * 0.55:
        return False
    return bool(ARABIC_PATTERN.match(text))


def _deduplicate(anchors: list[QuestionAnchor]) -> list[QuestionAnchor]:
    counts: set[tuple[int, str, int]] = set()
    deduplicated: list[QuestionAnchor] = []
    for anchor in anchors:
        key = (anchor.page_number, anchor.question_id, int(anchor.bbox[1]))
        if key in counts:
            continue
        counts.add(key)
        deduplicated.append(anchor)
    return deduplicated


def _has_auxiliary_context(lines: list, current_index: int, current_y: float, _aux: tuple[str, ...] = AUXILIARY_MARKERS, max_gap: float = 170.0) -> bool:
    for previous_line in reversed(lines[:current_index]):
        gap = current_y - previous_line.bbox[1]
        if gap < 0:
            continue
        if gap > max_gap:
            break
        text = _normalize_line(previous_line.text)
        if any(marker in text for marker in _aux):
            return True
    return False


def _has_reference_formula_context(lines: list, current_index: int, current_y: float, _ref: tuple[str, ...] = REFERENCE_FORMULA_MARKERS, max_gap: float = 130.0) -> bool:
    for previous_line in reversed(lines[:current_index]):
        gap = current_y - previous_line.bbox[1]
        if gap < 0:
            continue
        if gap > max_gap:
            break
        text = _normalize_line(previous_line.text)
        if any(marker in text for marker in _ref):
            return True
    return False
