from __future__ import annotations

import re
from typing import Any


_PAGE_MARKER_RE = re.compile(r"^\s*第\s*\d+\s*页\s*/\s*共\s*\d+\s*页\s*$")
_STANDALONE_PAGE_NUMBER_RE = re.compile(r"^\s*\d{1,3}\s*$")
_WATERMARK_RE = re.compile(
    r"(学科网|zxxk|原创精品资源|独家享有版权|侵权必究|帮课堂.*学与练)",
    re.IGNORECASE,
)


def _strip_page_markers(text: str) -> str:
    lines = text.splitlines()
    kept = [line for line in lines if not _PAGE_MARKER_RE.match(line)]
    return "\n".join(kept)


def _is_template_watermark_line(line: str) -> bool:
    compact = re.sub(r"\s+", "", line)
    return bool(_WATERMARK_RE.search(compact))


def _strip_template_noise_lines(text: str) -> str:
    lines = text.splitlines()
    watermark_indexes = {index for index, line in enumerate(lines) if _is_template_watermark_line(line)}
    if not watermark_indexes:
        return text
    kept: list[str] = []
    for index, line in enumerate(lines):
        if index in watermark_indexes:
            continue
        if _STANDALONE_PAGE_NUMBER_RE.match(line) and (index - 1 in watermark_indexes or index + 1 in watermark_indexes):
            continue
        kept.append(line)
    return "\n".join(kept)


def _strip_trailing_figure_labels(text: str) -> str:
    lines = text.splitlines()
    end = len(lines)
    while end > 0:
        stripped = lines[end - 1].strip()
        if not stripped:
            end -= 1
            continue
        if re.fullmatch(r"[A-Za-z0-9]{1,2}", stripped):
            end -= 1
            continue
        break
    return "\n".join(lines[:end]).rstrip()


def _single_dollar_count(text: str) -> int:
    return len(re.findall(r"(?<!\$)\$(?!\$)", text))


def _outside_inline_math(text: str, index: int) -> bool:
    line_start = text.rfind("\n", 0, index) + 1
    return _single_dollar_count(text[line_start:index]) % 2 == 0


def _display_spans(text: str) -> list[tuple[int, int]]:
    return [(match.start(), match.end()) for match in re.finditer(r"\$\$.*?\$\$", text, flags=re.DOTALL)]


def _inside_span(index: int, spans: list[tuple[int, int]]) -> bool:
    return any(start <= index < end for start, end in spans)


def _repair_right_only_simple_math(text: str) -> str:
    """Repair simple `S_n$` artifacts without touching valid `$a_1, d$` spans."""

    def replace_with_source(source: str):
        def replace(match: re.Match[str]) -> str:
            if not _outside_inline_math(source, match.start(1)):
                return match.group(0)
            return f"${match.group(1)}$"

        return replace

    cleaned = text
    for _ in range(4):
        next_cleaned = re.sub(r"(?<!\$)(\\\{[A-Za-z]_\{?[A-Za-z0-9]+\}?\\\})\s*\$\$?", replace_with_source(cleaned), cleaned)
        next_cleaned = re.sub(r"(?<![\w\\$])([A-Za-z][A-Za-z0-9]*(?:_\{?[A-Za-z0-9]+\}?)?)\s*\$\$?", replace_with_source(next_cleaned), next_cleaned)
        if next_cleaned == cleaned:
            break
        cleaned = next_cleaned
    return cleaned


def _wrap_bare_simple_subscripts(text: str) -> str:
    """Wrap bare simple subscript symbols such as `T_n` outside math."""
    spans = _display_spans(text)

    def replace(match: re.Match[str]) -> str:
        if _inside_span(match.start(1), spans) or not _outside_inline_math(text, match.start(1)):
            return match.group(0)
        return f"${match.group(1)}$"

    return re.sub(r"(?<![\w\\$])([A-Za-z][A-Za-z0-9]*_\{?[A-Za-z0-9]+\}?)(?![\w}$])", replace, text)


def _repair_formula_delimiter_artifacts(text: str) -> str:
    """Repair common mixed-delimiter artifacts produced by OCR models.

    Keep these rules conservative: they only target clearly broken delimiter
    sequences that cannot render correctly as written.
    """
    cleaned = text

    # OCR/model output sometimes contains literal `\n` text instead of actual
    # line breaks. Do not replace LaTeX commands such as `\neq`.
    cleaned = re.sub(r"\\n(?![A-Za-z])", "\n", cleaned)
    cleaned = re.sub(r"\neq\b", r"\\neq", cleaned)
    # Manual edits copied from model JSON often contain escaped newlines before
    # choice labels, e.g. `...\\nA. ...\\nB. ...`.
    cleaned = re.sub(r"\\n(?=\s*[A-H][.．、])", "\n", cleaned)
    cleaned = re.sub(r"\\n(?=\s*[（(]?[1-9][）).．、])", "\n", cleaned)

    # Common artifact: an incomplete display formula is split from the following
    # cases block, e.g. `$$ b_n= $$` + `$$\begin{cases}...\end{cases}$$`.
    cleaned = re.sub(
        r"\$\$\s*([A-Za-z][A-Za-z0-9_{}\\^\s]*=)\s*\$\$\s*(?:\$\$\s*)?(\\begin\{cases\}.*?\\end\{cases\})(?:\s*\$\$)?",
        lambda m: f"$$\n{m.group(1).strip()}{m.group(2).strip()}\n$$",
        cleaned,
        flags=re.S,
    )

    # Aggressively normalize a common OCR artifact around display formulas:
    # `$$ $$\begin{cases} ... \end{cases}$$ $ $$`
    cleaned = re.sub(r"\${3,}\s*\\begin\{cases\}", r"$$\\begin{cases}", cleaned)
    cleaned = re.sub(r"\${3,}", "$$", cleaned)
    cleaned = re.sub(r"(?:\s*\$\s*){4,}([，。；：,.])", r"\1", cleaned)
    cleaned = re.sub(r"(?:\s*\$\s*){4,}", " ", cleaned)
    cleaned = re.sub(r"\$\$\s+\$\$\s*(\\begin\{cases\})", r"$$\1", cleaned)
    cleaned = re.sub(r"\$\$\s*\$\s+\$\s+\$\$", "$$", cleaned)
    cleaned = re.sub(r"\$\$\s*\$\s+\$\$", "$$", cleaned)
    cleaned = re.sub(r"(\\end\{cases\})\s*\$\$\s*\$\s*\$\$", r"\1$$", cleaned)
    cleaned = re.sub(r"(\\end\{cases\})\s*\$\s*\$\$", r"\1$$", cleaned)
    cleaned = re.sub(r"\$\$[ \t]*([^\n$]+?)[ \t]*\$\s+\$\s+\$\$", r"$$ \1 $$", cleaned)
    cleaned = re.sub(r"\$\$[ \t]*([^\n$]+?)[ \t]*\$\s+\$\$", r"$$ \1 $$", cleaned)
    cleaned = re.sub(r"(?<!\$)\$\s+\$\$([，。；：,.])", r"$\1", cleaned)
    cleaned = re.sub(
        r"(?m)^(即|则|于是|所以|故|可得|有)?\s*([^$\n]*\\(?:frac|dfrac|sum|sqrt|cdot)[^$\n]*?)\s*\$\$([，。；：,.])$",
        lambda m: f"{m.group(1) or ''}${m.group(2).strip()}${m.group(3)}",
        cleaned,
    )
    cleaned = re.sub(
        r"\$(即|则|于是|所以|故|可得|有)([^$\n]*(?:\\(?:frac|dfrac|sum|sqrt|cdot|binom|infty|mathbb)|[A-Z]\()[^$\n]*)\$([，。；：,.])",
        lambda m: f"{m.group(1)} ${m.group(2).strip()}${m.group(3)}",
        cleaned,
    )
    cleaned = re.sub(r"\$\$[ \t]*([^\n$]+?)[ \t]*\$\s*\$\$", r"$$ \1 $$", cleaned)
    cleaned = re.sub(r"\$\s+\$\s+\$\$", "$$", cleaned)

    replacements = [
        ("\\] $$", "$$"),
        ("\\]$", "$"),
        ("\\[$$", "$$"),
        ("$$[", "$$"),
    ]
    for old, new in replacements:
        cleaned = cleaned.replace(old, new)

    # A line that starts with `\[ ... $$` is almost certainly meant to be a
    # display-math line wrapped with `$$ ... $$`.
    cleaned = re.sub(r"(?m)^\\\[\s*(.+?)\s*\$\$$", r"$$ \1 $$", cleaned)

    # Convert mixed `$$ ... $，` tails into a stable closing display marker.
    cleaned = re.sub(r"\$\$[ \t]*([^\n$]+?)[ \t]*\$([，。；：])", r"$$ \1 $$\2", cleaned)
    cleaned = re.sub(r"\$\$[ \t]*([^\n$]+?)[ \t]*\$", r"$$ \1 $$", cleaned)

    # Collapse accidental duplicated display delimiters.
    cleaned = re.sub(r"\$\$\s*\$\$", "$$", cleaned)
    cleaned = re.sub(r"\$\$\$", "$$", cleaned)

    # Normalize display-math lines that were opened by `$$` but accidentally
    # closed with an inline `$` before punctuation.
    cleaned = re.sub(r"\$\$[ \t]*([^\n$]+?)[ \t]*\$\s*([，。；：])", r"$$ \1 $$\2", cleaned)

    # Common artifact: a finished display formula is immediately followed by
    # prose but another stray `$$` is inserted before the prose.
    cleaned = re.sub(r"\$\$[ \t]*([，。；：])[ \t]*\$\$[ \t]*", r"$$\1 ", cleaned)
    cleaned = re.sub(r"\$\$[ \t]*(于是|因此|所以|则|即|可得|从而|且|在)[ \t]*", r"$$\n\n\1", cleaned)

    # Repair right-only dollar artifacts around simple sequence symbols. OCR
    # often emits `S_n$`, `b_n$`, or `\{a_n\} $$` when it missed the opening `$`.
    cleaned = _repair_right_only_simple_math(cleaned)
    cleaned = _wrap_bare_simple_subscripts(cleaned)

    # Downgrade short non-formula spans that were accidentally wrapped by `$$`
    # back to plain text, e.g. `$$ ， $$` or `$$ 在 $$`.
    cleaned = re.sub(r"\$\$[ \t]*([，。；：])[ \t]*\$\$", r"\1", cleaned)
    cleaned = re.sub(r"\$\$[ \t]*([A-Za-z\u4e00-\u9fff]{1,6})[ \t]*\$\$", r"\1", cleaned)
    cleaned = re.sub(r"\$\$[ \t]*([A-Za-z][A-Za-z0-9_{}\\^]{0,24})[ \t]*\$\$", r"$\1$", cleaned)
    for _ in range(4):
        next_cleaned = re.sub(
            r"\$([^$\n]{1,240}?)\$([A-Za-z][A-Za-z0-9_{}\\^]{1,32})(?=\$)",
            r"$\1\2",
            cleaned,
        )
        if next_cleaned == cleaned:
            break
        cleaned = next_cleaned
    cleaned = re.sub(r"([，。；：,.]\s*(?:则|即|于是|所以|故|可得|有)\s*)\$\$[ \t]*([^\n$]+?)[ \t]*\$\$", r"\1$\2$", cleaned)
    cleaned = re.sub(r"([^\n])[\t ]*\$\$\n", r"\1\n\n$$\n", cleaned)
    cleaned = re.sub(r"\n\$\$[\t ]+([，。；：,.])", r"\n$$\n\1", cleaned)
    cleaned = re.sub(r"\n\$\$([，。；：,.])([^\n])", r"\n$$\n\1\n\n\2", cleaned)
    cleaned = re.sub(r"\n\$\$\n([，。；：,.])\n\n(则|即|于是|所以|故|可得|有)\s*\$\$[ \t]*([^\n$]+?)[ \t]*\$\$", r"\n$$\n\1\n\n\2 $\3$", cleaned)

    fixed_lines = []
    line_tail_pattern = re.compile(
        r"^(\s*(?:即|则|于是|所以|故|可得|有))\s*([^$\n]*\\(?:frac|dfrac|sum|sqrt|cdot|binom|infty|mathbb)[^\n]*?)\s*\$\$([，。；：,.])$"
    )
    for line in cleaned.splitlines():
        fixed_lines.append(line_tail_pattern.sub(lambda m: f"{m.group(1)} ${m.group(2).strip()}${m.group(3)}", line))
    cleaned = "\n".join(fixed_lines)
    cleaned = re.sub(
        r"\$\$\s*([A-Za-z][A-Za-z0-9_{}\\^\s]*=)\s*\$\$\s*(?:\$\$\s*)?(\\begin\{cases\}.*?\\end\{cases\})(?:\s*\$\$)?",
        lambda m: f"$$\n{m.group(1).strip()}{m.group(2).strip()}\n$$",
        cleaned,
        flags=re.S,
    )
    cleaned = _repair_right_only_simple_math(cleaned)
    cleaned = _wrap_bare_simple_subscripts(cleaned)
    return cleaned


def _repair_cases_blocks(text: str) -> str:
    """Wrap raw `cases` environments into stable display math blocks."""
    cleaned = text

    cleaned = re.sub(
        r"\$\$\s*\\begin\{cases\}(.*?)\\end\{cases\}\s*\$\$",
        lambda m: f"$$\n\\begin{{cases}}{m.group(1)}\\end{{cases}}\n$$",
        cleaned,
        flags=re.DOTALL,
    )

    display_spans = _display_spans(cleaned)

    def inside_display(start: int, end: int) -> bool:
        return any(span_start <= start and end <= span_end for span_start, span_end in display_spans)

    def wrap_if_needed(match: re.Match[str]) -> str:
        body = match.group(1)
        if inside_display(match.start(), match.end()):
            return match.group(0)
        return f"$$\n\\begin{{cases}}{body}\\end{{cases}}\n$$"

    cleaned = re.sub(r"\\begin\{cases\}(.*?)\\end\{cases\}", wrap_if_needed, cleaned, flags=re.DOTALL)
    return cleaned


def normalize_latex_text(text: str, *, strip_trailing_labels: bool = True) -> str:
    """Apply conservative OCR text cleanup for generated drafts."""
    if not text:
        return text

    cleaned = text
    # Repair previously normalized `\left|...\right|` fragments.
    cleaned = re.sub(r"\\mid\s*(.+?)\\right\|", r"|\1|", cleaned)

    replacements = [
        ("\\left\\{", "\\{"),
        ("\\right\\}", "\\}"),
        ("\\left\\[", "["),
        ("\\right\\]", "]"),
        ("\\left[", "["),
        ("\\right]", "]"),
        ("\\left(", "("),
        ("\\right)", ")"),
        ("\\left|", "|"),
        ("\\right|", "|"),
        ("\\right.", ""),
    ]
    for old, new in replacements:
        cleaned = cleaned.replace(old, new)
    cleaned = re.sub(r"\\mid(?=[A-Za-z0-9])", r"\\mid ", cleaned)
    cleaned = _repair_formula_delimiter_artifacts(cleaned)
    cleaned = _repair_cases_blocks(cleaned)
    cleaned = _repair_formula_delimiter_artifacts(cleaned)
    cleaned = re.sub(r"\n\$\$[\t ]*([，。；：,.])", r"\n$$\n\1", cleaned)
    cleaned = re.sub(r"\n\$\$([，。；：,.])([^\n])", r"\n$$\n\1\n\n\2", cleaned)
    cleaned = _strip_page_markers(cleaned)
    cleaned = _strip_template_noise_lines(cleaned)
    if strip_trailing_labels:
        cleaned = _strip_trailing_figure_labels(cleaned)
    return cleaned


def strip_field_section_markers(text: str, markers: tuple[str, ...]) -> str:
    """Remove standalone OCR section labels while preserving specific subquestion headings."""
    if not text:
        return text

    marker_pattern = "|".join(re.escape(marker) for marker in markers)
    pattern = re.compile(rf"(?m)^[ \t]*(?:【\s*(?:{marker_pattern})\s*】|(?:{marker_pattern})\s*[:：])[ \t]*")
    cleaned = text
    while True:
        next_cleaned = pattern.sub("", cleaned)
        if next_cleaned == cleaned:
            break
        cleaned = next_cleaned
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def normalize_model_output_fields(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (normalized_payload, post_processing_info)."""
    normalized = dict(payload)
    normalized, post_processing = split_answer_analysis_from_problem_text(normalized)
    for key in ("problem_text", "answer", "analysis"):
        value = normalized.get(key, "")
        if isinstance(value, str):
            cleaned_value = normalize_latex_text(
                value,
                strip_trailing_labels=(key != "answer"),
            )
            if key == "answer":
                cleaned_value = strip_field_section_markers(cleaned_value, ("答案",))
            elif key == "analysis":
                cleaned_value = strip_field_section_markers(cleaned_value, ("解析", "分析", "详解"))
            normalized[key] = cleaned_value

    # Check for residual answer/analysis markers in problem_text
    problem_text = normalized.get("problem_text", "")
    if isinstance(problem_text, str) and problem_text:
        residual_answer = re.search(r"(【答案】|答案[:：])", problem_text)
        residual_analysis = re.search(r"(【解析】|解析[:：]|【详解】|详解[:：]|分析[:：])", problem_text)
        if residual_answer or residual_analysis:
            post_processing["residual_markers_in_problem_text"] = True
            post_processing["residual_details"] = []
            if residual_answer:
                post_processing["residual_details"].append("problem_text 中仍残留【答案】标记")
            if residual_analysis:
                post_processing["residual_details"].append("problem_text 中仍残留【解析】标记")

    return normalized, post_processing


def split_answer_analysis_from_problem_text(payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Move obvious answer/analysis sections out of problem_text when the model missed the schema.

    Returns (normalized_payload, post_processing_info).
    """
    normalized = dict(payload)
    post_processing: dict[str, Any] = {}
    problem_text = normalized.get("problem_text", "")
    if not isinstance(problem_text, str) or not problem_text:
        return normalized, post_processing

    answer_text = normalized.get("answer", "")
    analysis_text = normalized.get("analysis", "")
    answer_match = re.search(r"(^|\n)\s*(【答案】|答案[:：])", problem_text)
    analysis_match = re.search(r"(^|\n)\s*(【解析】|解析[:：]|【详解】|详解[:：]|分析[:：])", problem_text)

    split_at = None
    if answer_match:
        split_at = answer_match.start()
    elif analysis_match:
        split_at = analysis_match.start()

    if split_at is not None:
        normalized["problem_text"] = problem_text[:split_at].strip()

    split_triggered = False
    extracted_answer = ""
    extracted_analysis = ""
    if answer_match:
        answer_start = answer_match.end()
        answer_end = analysis_match.start() if analysis_match and analysis_match.start() > answer_start else len(problem_text)
        extracted_answer = problem_text[answer_start:answer_end].strip()

    if analysis_match:
        extracted_analysis = problem_text[analysis_match.end():].strip()

    if answer_match and extracted_answer:
        current_answer = answer_text if isinstance(answer_text, str) else ""
        if not current_answer or len(extracted_answer) > len(current_answer) * 2:
            normalized["answer"] = extracted_answer
            split_triggered = True

    if analysis_match and extracted_analysis:
        current_analysis = analysis_text if isinstance(analysis_text, str) else ""
        if not current_analysis or len(extracted_analysis) > len(current_analysis) * 2:
            normalized["analysis"] = extracted_analysis
            split_triggered = True

    if split_triggered:
        post_processing["split_triggered"] = True
        post_processing["split_reason"] = "从 problem_text 中拆分出答案/解析区域"
        normalized["needs_human_review"] = True

    return normalized, post_processing
