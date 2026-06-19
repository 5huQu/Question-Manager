from __future__ import annotations

import re


_DISPLAY_MATH_RE = re.compile(r"\$\$.*?\$\$")


def _collapse_invalid_dollar_runs(text: str) -> str:
    """Normalize invalid dollar runs for Markdown display only.

    Markdown math fences should be `$...$` or `$$...$$`.
    Any run of 3+ consecutive dollar signs is collapsed to `$$` so malformed
    display math fences like `$$$...$$$` become renderable.
    """
    if "$" not in text:
        return text

    output_parts: list[str] = []
    i = 0
    length = len(text)

    while i < length:
        if text[i] != "$":
            output_parts.append(text[i])
            i += 1
            continue

        j = i
        while j < length and text[j] == "$":
            j += 1
        run_length = j - i
        output_parts.append("$$" if run_length >= 3 else "$" * run_length)
        i = j

    return "".join(output_parts)


def _separate_display_math_from_prose(text: str) -> str:
    """Move display math blocks onto their own lines for Markdown rendering."""
    if "$$" not in text:
        return text

    output_lines: list[str] = []
    for line in text.splitlines():
        if "$$" not in line:
            output_lines.append(line)
            continue

        matches = list(_DISPLAY_MATH_RE.finditer(line))
        if not matches:
            output_lines.append(line)
            continue

        cursor = 0
        line_parts: list[str] = []
        for match in matches:
            before = line[cursor:match.start()]
            if before.strip():
                line_parts.append(before.strip().lstrip("，,。；："))
            line_parts.append(match.group(0).strip())
            cursor = match.end()

        after = line[cursor:]
        if after.strip():
            line_parts.append(after.strip().lstrip("，,。；："))

        if not line_parts:
            continue
        output_lines.extend(part for part in line_parts if part)

    return "\n".join(output_lines)


def convertLatexDelimitersForMarkdown(input: str) -> str:
    """Convert LaTeX-style outer math delimiters for Markdown export only.

    Rules:
    - `\\( ... \\)` -> `$...$`
    - `\\[ ... \\]` -> `$$...$$`
    - collapse malformed `$$$...$$$` fences to `$$...$$`
    - split display math blocks onto their own lines when they share a line
      with prose so Markdown renderers can parse them reliably
    - keep inner content untouched
    - keep unmatched openers unchanged
    """
    if not input:
        return input

    output_parts: list[str] = []
    i = 0
    length = len(input)

    while i < length:
        if input.startswith(r"\(", i):
            end = input.find(r"\)", i + 2)
            if end == -1:
                output_parts.append(input[i:])
                break
            output_parts.append("$")
            output_parts.append(input[i + 2:end])
            output_parts.append("$")
            i = end + 2
            continue

        if input.startswith(r"\[", i):
            end = input.find(r"\]", i + 2)
            if end == -1:
                output_parts.append(input[i:])
                break
            output_parts.append("$$")
            output_parts.append(input[i + 2:end])
            output_parts.append("$$")
            i = end + 2
            continue

        output_parts.append(input[i])
        i += 1

    converted = _collapse_invalid_dollar_runs("".join(output_parts))
    return _separate_display_math_from_prose(converted)
