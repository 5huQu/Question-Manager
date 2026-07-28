---
name: question-manager-ingestion
description: Extract, validate, review, and safely structure questions from PDF, scanned images, Word DOCX, LaTeX, Markdown, or similar teaching materials for this Question Manager project. Use when the model itself must read or OCR source files, map them to the question-bank contract, classify controlled tags and difficulty, and wait for user confirmation before importing questionable records.
---

# Question Manager Ingestion

Use this skill as a model-side extraction and review workflow. The model performs source reading, OCR, question-boundary detection, formula transcription, and factuality checks itself. Do not use Question Manager's OCR providers or its OCR/import-flow endpoints to perform extraction.

## Built-In Contract

This Skill embeds the current Question Manager ingestion contract. The only external project data it needs to read at runtime is the current tag library:

- Read `server/tag_libraries/*.json`, or query `GET /api/question-bank/tag-libraries` when the local server is running.
- Treat knowledge-point and solution-method names from that source as the only allowed tag values.
- Do not load the repository's general documentation, service code, OCR configuration, or parser implementation merely to extract a source file.
- When the database contract changes, update this Skill and its preflight script together. The embedded contract is intentionally self-contained and may otherwise become stale.

### Record Fields

Map each top-level question to these fields:

`questionNo`, `stage`, `subject`, `questionType`, `chapter`, `knowledgePoints`, `solutionMethods`, `sourceTitle`, `province`, `city`, `paperTitle`, `batchName`, `paperKind`, `examYear`, `sourceOrg`, `importSourceId`, `bankStatus`, `stemMarkdown`, `answerText`, `analysisMarkdown`, `difficultyScore10`, `difficultyLabel`, `totalScore`, `scoringRubric`, and `figures`.

Let the system generate `id`, `serialNo`, timestamps, search text, and derived fields. Use empty strings, empty arrays, or zero only where the field rules below permit unknown values.

### Source And Identity Rules

- The first full-width parenthesis immediately after a top-level question marker is the question source. Remove it from the stem and save it as `sourceTitle`.
- Split reliable source fragments into `examYear`, `stage`, `province`, `city`, `batchName`, `paperKind`, and `sourceOrg`; preserve the original in `sourceTitle` when any split is uncertain.
- Fill `paperTitle` only when the source contains a complete paper or assessment name. Do not use a chapter title as `paperTitle`.
- Save a stable locator in `importSourceId`: `pdf:<file>#page:<page>:item:<item>`, `docx:<file>#section:<section>:item:<item>`, or `latex:<relative-path>#<section>:<item>`. The locator must distinguish identical question numbers in different sections.
- `questionNo` contains only the source question number, without `第`, `题`, punctuation, or source text.

### Content And Status Rules

- One top-level `\item`, `example`, or custom question environment is one record. Keep nested `(1)`, `(2)` parts in the same record.
- Four consecutive options are `单选题` unless the source explicitly says multiple choice; blanks are `填空题`; proofs, calculations, and multipart open responses are `解答题`.
- `stemMarkdown` removes question number, source prefix, layout macros, `\TeacherSolution`, and `\blank[...]`; use `______` for blanks. Use `$...$` for inline math and `$$...$$` for display math.
- `answerText` contains only the final answer: `A`, `AC`, a final value, or a final open-response result. `analysisMarkdown` contains only the reasoning.
- Remove `解析来源`, `题源`, download banners, `【答案】`, `【分析】`, `【详解】`, `解：`, layout commands, and duplicate answer text from analysis. Convert `\par` to paragraph breaks.
- Store every extracted or cropped figure as a local project asset. The final relative path must be `data/question_figures/<questionId>/<figureId>.<ext>`; never store an absolute path, `file://` URL, remote URL, data URL, or a source-document path as the final `path`.
- Upload a local image through `POST /api/question-bank/items/:id/figures/upload` as multipart `file` plus `usage` (`stem`, `options`, or `analysis`) and, for option figures, `optionLabel` (`A`-`D`). The server generates the figure ID, copies the file into `data/question_figures/<questionId>/`, persists `figures_json`, and performs inline binding.
- Use `POST /api/question-bank/items/:id/figures` only when an existing project-local source image and a `bbox` are available for a server-side crop. Its `sourcePath` is provenance; the returned `path` is the stored local crop.
- Store figure metadata such as `id`, `origin`, `usage`, `category`, `optionLabel`, `pageNumber`, `bbox`, `sourcePath`, `path`, and `originalName`. Keep `path` portable and relative.
- Display or verify a stored figure through `/assets/<path>`; do not construct an arbitrary filesystem path. Essential missing, unbound, or ambiguous figures block the record.
- Use `ready` only when content, source, answer, formulas, and figures are sufficiently verified. Use `blocked` with a precise issue when any material part is uncertain.

### Acceptance Rules

- Every record has a nonempty stem and stable source.
- Choice labels are consecutive `A.` through `D.` and the final answer agrees with the options.
- Every formula has balanced delimiters and parses in KaTeX; unsupported commands or symbol ambiguity block the record.
- No adjacent question, answer, footer, or section heading leaks into a record.
- Student and teacher editions are deduplicated; solution matching uses question number plus section/source context.
- Perform exact and near-duplicate checks before import.

## Extract With The Model

- Read PDF text layers when available. For scanned pages, use the model's own visual/OCR capability and preserve page numbers, bounding boxes, and figure references.
- Read DOCX structure directly, including paragraphs, numbering, tables, equations, drawings, and embedded media. Do not route DOCX through the project's PDF OCR flow.
- Read LaTeX source directly. Resolve `\input` and `\include` recursively, respect balanced environments, and distinguish top-level questions from choices, subquestions, and ordinary lists.
- Pair student and teacher materials by question number plus section/source context. Use a teacher solution only when it is explicitly bound to that question. Do not attach the nearest solution by position.
- Keep a stable locator for every record: page/item or block for PDF and DOCX; source path/section/item for LaTeX.
- Do not execute arbitrary document code, LaTeX shell escapes, macros, or embedded scripts while reading.

## Build The Question Record

Create one record per top-level question. Keep `(1)`, `(2)`, and shared context inside the parent question unless the user explicitly requests separate records.

- Let the system generate `id` and `serialNo`.
- Save the human-readable source in `sourceTitle`; remove source prefixes and attribution banners from `stemMarkdown`.
- Save a stable source locator in `importSourceId`.
- Preserve conditions, domains, units, options, figures, and response requirements. Serialize choices consecutively as `A.` through `D.`.
- Keep `answerText` to the final answer only. Keep `analysisMarkdown` to the reasoning only.
- Remove `答案/分析/详解` headings, source/download banners, OCR furniture, and presentation-only LaTeX commands.
- Preserve useful paragraph breaks in analysis. Split long reasoning only at meaningful transitions; do not show one giant block or create excessive one-line fragments.
- Extract or crop every meaningful geometry, graph, table, or illustration into a local image file before import. Preserve the source page and bounding box in metadata when available.
- Create the question first if an ID is needed, upload each image through the supported figure endpoint, then fetch the returned question and verify its `figures` entries and rendered `/assets/` path. Do not put an unpersisted local filename into `figures`.
- Use `usage: stem` for a question diagram, `options` plus `optionLabel` for an option image, and `analysis` for a solution diagram. Never replace an essential diagram with guessed prose.

## Controlled Classification

### Tags

Use only exact existing values:

- `knowledgePoints` must be selected from the current knowledge-point library.
- `solutionMethods` must be selected from the current solution-method library.
- Select a value only when the stem, answer, or analysis supports it. A chapter heading, filename, source title, or document grouping is not evidence by itself.
- Leave either array empty when no exact supported value exists. Never invent, paraphrase, translate, or repair a tag to make it fit.

### Difficulty

Use the system's 1-10 scale only after reviewing the stem and the available answer or analysis. Apply the same criteria as the project classifier:

- Judge real-exam material by expected examination distinction, school and daily practice by the intended grade's teaching difficulty, and lecture material by knowledge-mastery burden.
- Consider linked reasoning steps, abstraction, parameter or constant conditions, root/tangent-count conditions, multipart coordination, and calculation or verification burden.
- Map `1-3` to `基础`, `4-6` to `中等`, `7-8` to `较难`, and `9-10` to `压轴`.
- Never use source title, chapter, question number, material type, or question type as the score by itself.
- If the answer/analysis is missing, contradictory, or too uncertain to judge, use `difficultyScore10: 0` and `difficultyLabel: ""`. Empty difficulty is valid.

## Validate Before Import

Run the read-only preflight script on the candidate JSON:

```sh
node skills/question-manager-ingestion/scripts/preflight-question-bank.mjs candidates.json --api-base http://127.0.0.1:8797
```

It checks exact tag membership, difficulty score/label consistency, source identity, choice structure, raw layout leakage, math delimiters, KaTeX parsing, and duplicate source locators. It does not perform OCR or write any project data.

Independently check:

- no adjacent question, answer, footer, or section heading leaked into the stem;
- the answer agrees with choices and the analysis conclusion;
- formulas, signs, indices, domains, units, and mathematical facts survive transcription;
- figures exist, are placed correctly, and remain portable;
- every nonempty figure has a local `data/question_figures/...` path, valid usage, and a file that can be served through `/assets/`;
- near-duplicates and student/teacher duplicates are identified;
- `ready` is used only when the record is safe for normal bank use.

Use `blocked` with a precise issue for uncertain formulas, missing answers, ambiguous matches, unresolved figures, factual conflicts, or other material defects. Do not silently repair uncertain source content.

## User Confirmation Gate

Before writing any record with a possible material issue, show an issue list containing the record identifier, source locator, affected field, source evidence, proposed treatment, and impact. Obtain an explicit decision for each issue or an explicitly named group:

- correct the candidate and rerun checks;
- preserve it and import as `blocked`;
- skip it.

Do not treat silence or a generic acknowledgement as confirmation. Empty tags or empty difficulty alone are acceptable and do not require a dialogue. After any correction, rerun the preflight and factuality checks.

## Import And Audit

- Write only after the candidate passes preflight and all material issues have been confirmed.
- Use the supported question-bank API; never write SQLite directly.
- Do not call the project's OCR providers, OCR document routes, candidate parser, or automatic classification service for extraction.
- Never modify a tag library to make a proposed value valid.
- After writing, query representative records and report created, blocked, skipped, duplicate, formula, figure, and unresolved counts.

## Model Limits

- Never invent answers, analyses, source metadata, tags, difficulty, diagrams, or missing mathematical conditions.
- Never claim OCR or a derivation is certain when the source is ambiguous.
- Never use a document title or chapter as a substitute for a controlled tag.
- Never score difficulty without reviewing the actual question content and available solution evidence.
- Never execute untrusted LaTeX or document code.
- Never bypass the user confirmation gate for unresolved issues.
