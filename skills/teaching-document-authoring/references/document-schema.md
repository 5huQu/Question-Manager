# TeachingDocumentV1 schema

Use a JSON object with `version: 1`, `documentType`, `title`, object `metadata`, and array `content`. Every block, including children in a box, needs a unique nonempty `id`.

```json
{
  "version": 1,
  "documentType": "lecture",
  "title": "函数的单调性",
  "metadata": { "subject": "数学", "stage": "高中", "source": "课堂资料" },
  "style": { "typographyPreset": "lecture", "marginPreset": "normal", "questionSpacing": "normal" },
  "content": [
    { "type": "heading", "id": "mono-h1", "level": 1, "content": [{ "type": "text", "text": "一、导数与单调性" }] },
    { "type": "paragraph", "id": "mono-p1", "content": [{ "type": "text", "text": "若 " }, { "type": "inlineMath", "latex": "f'(x)>0" }, { "type": "text", "text": "，则函数递增。" }] },
    { "type": "blockMath", "id": "mono-m1", "latex": "f'(x)=0" },
    { "type": "box", "id": "mono-concept", "templateId": "concept", "title": "核心结论", "breakBehavior": "avoid", "children": [{ "type": "paragraph", "id": "mono-concept-p", "content": [{ "type": "text", "text": "结合定义域讨论导数符号。" }] }] }
  ]
}
```

## Blocks

| Block | Required fields | Notes |
| --- | --- | --- |
| `heading` | `id`, `level` 1–4, `content` | Supports optional alignment and numbering. |
| `paragraph` | `id`, `content` | Inline content uses `text`, `inlineMath`, or `hardBreak`. Text marks are `bold`, `italic`, `underline`, `strikethrough`, `code`. |
| `blockMath` | `id`, `latex` | Optional `label` for a displayed equation number. |
| `table` | `id`, `rows` | Each cell is `{ "content": [inline nodes] }`; use 1–20 rows. |
| `figure` | `id`, `asset`, `alignment` | Alignment is `left`, `center`, or `right`; add `caption`, `alt`, `widthMm`, or `widthRatio` as needed. |
| `tikz` | `id`, `source`, `alignment` | Render with the TikZ API first and store `svgAssetId` / `sourceHash` returned by it. |
| `question` | `id`, `questionId` | `questionId` must be a verified existing bank ID. |
| `box` | `id`, `templateId`, `breakBehavior`, `children` | Use `concept`, `method`, `example`, `warning`, `practice`, or `summary`. Children cannot be headings, page breaks, or boxes. |
| `divider` | `id` | Use sparingly between distinct sections. |
| `spacer` | `id`, `heightEm` | Use controlled white space; `heightMm` may override it. |
| `pageBreak` | `id` | Insert only at deliberate print boundaries. |
| `rawMarkdown` | `id`, `markdown`, `reason` | Last-resort fallback only; reason is `fallback`, `user-inserted`, or `unsupported-structure`. |

## References and display options

Uploaded assets use:

```json
{ "type": "documentAsset", "assetId": "tdasset_123" }
```

Question figures already in the bank can use:

```json
{ "type": "questionFigure", "questionId": "q_123", "figureId": "fig_456" }
```

Use question display options to make student-facing material:

```json
{
  "type": "question",
  "id": "practice-q1",
  "questionId": "q_123",
  "display": {
    "displayNumber": "1",
    "showAnswer": false,
    "showAnalysis": false,
    "showScore": true,
    "scoreOverride": 5,
    "answerSpace": { "heightMm": 28, "style": "lines" }
  }
}
```

## Type defaults

- `lecture`: use `{ "typographyPreset": "lecture", "marginPreset": "normal", "questionSpacing": "normal" }`; organize explanation and teaching cards.
- `worksheet`: use the exam typography preset with student-facing question display; hide answer and analysis unless explicitly producing a teacher version.
- `exam`: use `{ "typographyPreset": "exam", "marginPreset": "compact", "questionSpacing": "compact" }`; hide answer and analysis by default.
- `wrong-question-collection`: use the exam typography preset; the editor and print output keep only `question` blocks (top-level and inside cards) and hide all headings, paragraphs, and other blocks, so author it question-first.

Never persist arbitrary HTML, CSS, base64, remote URLs, file URLs, or absolute `legacyPath` paths. Do not use `unknown` nodes in newly authored material. Preflight JSON before API writes.

