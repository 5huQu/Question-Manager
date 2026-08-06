---
name: teaching-document-authoring
description: Create or revise structured Question Manager teaching documents—lectures, worksheets, and exams—from supplied text or source materials. Use when an agent must call the teaching-documents REST API, arrange TeachingDocumentV1 content, attach images or TikZ, or reference existing question-bank items without modifying the question bank.
---

# Teaching Document Authoring

Create a Question Manager document draft through the system API. Preserve source facts, formulae, figures, and question conditions. Do not invent missing material, write SQLite directly, or create or modify question-bank items.

## Read first

- Read `references/system-api.md` before calling the API. It defines authentication, API payloads, asset order, and conflict handling.
- Read `references/document-schema.md` before constructing `TeachingDocumentV1` JSON. It contains supported blocks and compact templates.
- Run `node skills/teaching-document-authoring/scripts/preflight-teaching-document.mjs <draft.json>` before every create or update.

## Workflow

1. Identify the target: create a new draft unless the task explicitly supplies an existing teaching-document ID. For an update, `GET` the record and preserve all content not explicitly in scope.
2. Inspect source material. Retain mathematical notation, diagrams, question conditions, units, labels, and uncertain passages. Flag ambiguity instead of guessing. Never execute untrusted LaTex or embedded document code.
3. Choose `lecture`, `worksheet`, or `exam`, then build structured blocks. Prefer headings, paragraphs, math, tables, figures, cards, and question references. Use `rawMarkdown` only as an explicit fallback for content that cannot safely be structured.
4. Generate unique, stable, nonempty IDs for every top-level and card-child block. Use an agent-local prefix such as `lecture-<topic>-h1`; never reuse IDs or save generated `_auto_` IDs.
5. For a new document, create an empty draft with `POST /api/teaching-documents`. Upload all image assets to that new ID, or call the TikZ endpoint. Use returned asset IDs in the document JSON.
6. Search the existing question bank, fetch each intended question by ID, and reference it only after confirming it is the intended record. Do not call question-bank write endpoints.
7. Run preflight. Then `PATCH /api/teaching-documents/:id` with the latest `expectedRevision`, title, and complete content. For a new document, use the revision returned by creation.
8. On `409 revision_conflict`, stop. Re-read the document and report the current revision and scope conflict; never overwrite or blindly retry.
9. Re-read the saved record. Confirm the title, document type, all block and asset IDs, all question IDs, revision increment, and absence of error-level validation issues. Report the draft ID, title, revision, source caveats, and visual-review recommendation.

## Content rules

- **Lecture:** organize learning goals, sections, concept/method/example/warning/summary cards, and optional answers or analysis.
- **Worksheet:** prioritize student-facing prompts, existing question references, and answer space. Set `showAnswer` and `showAnalysis` to `false` unless the task asks for a teacher version.
- **Exam:** use compact exam typography, stable question numbering and score display where supplied. Hide answer and analysis by default.
- Reference an uploaded asset with `{ "type": "documentAsset", "assetId": "..." }`; do not store an absolute path, remote URL, data URL, base64, or arbitrary HTML/CSS.
- Reference a bank item only as a `question` block with a verified nonempty `questionId`. New questions belong to `$question-manager-ingestion`, not this Skill.
- Keep card children flat: cards may not contain cards, headings, or page breaks. Keep tables for true row/column data, not prose layout.

## Authentication and safety

- Use `QUESTION_API_BASE_URL`, defaulting to `http://127.0.0.1:8797`. Use an already authorized local API session.
- In single-admin mode, provide the session cookie, `X-QM-CSRF`, and same-origin `Origin` only through secure runtime configuration. Never put passwords, CSRF tokens, cookies, or source-private data in the Skill, draft JSON, repository files, or logs.
- Creating or updating a document is authorized when the task asks to produce that document draft. Do not delete documents, templates, assets, or question-bank records unless the user explicitly requests deletion.

## Verification

Use the preflight script for schema errors before a write. The API is the final validation authority: do not treat warnings as invisible, and do not claim a document is visually perfect without opening it in the editor or print view. If visual tools are available, inspect `/teaching-documents/<id>` after saving, especially tables, cards, images, formulae, and page breaks.

