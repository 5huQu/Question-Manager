# Question Manager Agent Guide

This file is the first document a future Agent should read when entering this repository. It explains the current project layout, product expectations, implementation patterns, and operational cautions. Before coding, read this file, then open the related project documents and source entry points for the task at hand.

## Project Purpose

Question Manager is a local-first desktop tool for building and maintaining math question banks. It covers document import, whole-document OCR, question-number parsing, candidate review, manual fixing, question-bank maintenance, basket-based paper assembly, Markdown/LaTeX/PDF export, and desktop packaging. The stack is Electron + React + Vite + TypeScript + Express + SQLite + Python.

The current main product path is import flow v2:

1. Import materials: upload one full document, or upload a separated question document plus answer/solution document.
2. Whole-document OCR: use Doc2X or GLM-OCR to produce a unified OCRDocument.
3. Question-number parsing: question-parser produces QuestionCandidate records from configurable rules.
4. Review and fix: users inspect stems, answers, analyses, figures, source references, and diagnostics.
5. Commit to bank: committed candidates are written into question_bank_items.
6. Bank and assemble: search/edit questions, add them to the basket, and export.

The older PDF slicing center is still kept for compatibility with existing data, manual annotation, the legacy slicing/OCR path, and exceptional fixes. Do not remove the legacy path unless the user explicitly asks for it.

## Documentation Map

Recommended reading order:

- `README.md`: product capabilities, run commands, environment variables, packaging, and security notes.
- `AGENT.md`: this future-Agent guide.
- `AGENT_zhcn.md`: Chinese version of this guide.
- `docs/import_flow_v2.md`: import flow v2 product goals, core types, APIs, and staged plan.
- `docs/ui_design_specification.md`: shadcn/ui style rules. Ordinary page work must follow it; do not casually change AppSidebar, AppPageHeader, or the app shell.
- `docs/AGENT_Cowork.md`: earlier Agent collaboration rules, especially backend layering, frontend API wrappers, UI constraints, and side-effect checklist.
- `backend-layered-refactor-plan.md`: backend route/service/repository layering principles and testing focus.
- `docs/tasks/*.md`: historical task designs for the basket, export, pending bank, OCR figure binding, manual annotation, and related modules.
- `docs/task_run/*.md`: execution notes for selected tasks.
- `Doc/CodeX_frontend_task/`: frontend migration task notes.
- `WINDOWS_BUILD.md`: Windows build and installer troubleshooting.

Do not treat `docs/lkcoffee-mcp.example.json` as project business documentation; it is an unrelated connector example.

## Repository Map

- `frontend/`: React 19 + Vite frontend.
  - `frontend/src/App.tsx`: frontend routes, application shell, first-run setup entry, and update reminder.
  - `frontend/src/api/`: frontend API wrappers. Pages should call these functions instead of scattering `fetch('/api/...')`.
  - `frontend/src/pages/import-v2/`: current main import flow pages.
  - Legacy PDF-slicer pages have been removed; historical URLs render a read-only retirement notice or a V2 redirect.
  - `frontend/src/pages/questions/`: question bank list, detail, create, and paper preview pages.
  - `frontend/src/components/questions/`: question rendering, editing, figures, and BBoxCanvas.
  - `frontend/src/components/ui/` and `frontend/src/components/ui.tsx`: shadcn-style base components.
- `server/`: TypeScript backend.
  - `server/src/index.ts`: assembly point; initializes schema, recovers interrupted runs, and mounts all routes.
  - `server/src/server.ts`: Express app, safe `/assets` file serving, and frontend static file hosting.
  - `server/src/db/`: SQLite connection, schema, compatibility migrations, and some base CRUD.
  - `server/src/routes/`: HTTP entry points; they should only read params/body/query, call services, and return JSON.
  - `server/src/services/`: business logic, state transitions, OCR/export/Python orchestration.
  - `server/src/repositories/`: SQL, row mapping, and transaction-oriented data access.
  - `server/src/types/`: business types such as SourceDocument, OCRDocument, and QuestionCandidate.
  - `server/tag_libraries/`: built-in learning tag libraries.
- `server/python/`: allowlisted runtime tools for V2 PDF page rendering/cropping and question classification.
  - Production packages contain only `crop_manual_annotation.py`, `render_pdf_page.py`, `classify_question_bank.py`, and the minimal config module.
  - `server/python/requirements.txt` and `runtime-requirements.txt`: source-development and packaged-runtime dependencies.
- `electron/`: Electron main process, preload, and update logic.
  - `electron/main.cjs`: starts the local API service in packaged desktop builds and points `QUESTION_DATA_DIR` to Electron userData.
  - `electron/preload.cjs`: exposes the API base URL and updater bridge to the frontend.
  - `electron/updater.cjs`: desktop update check/download logic.
- `templates/latex/`: LaTeX/Examch export templates.
- `scripts/`: dev server, Python runtime preparation/verification, migration scripts, and packaging helpers.
- `data/`, `config/`, `experiments/`, `runtime/`, `dist/`, `node_modules/`: local runtime or generated directories; do not commit them.

## Run And Verify

Environment requirements:

- Node.js 24 or newer.
- Python 3.11 or newer for source development.
- Optional: XeLaTeX and LibreOffice.

Common commands:

```sh
npm install
python3 -m pip install -r server/python/requirements.txt
npm run dev
npm run build
npm run build:server
npm run build:frontend
npm run test:math-render
npm run test:question-parser
npm run test:routes
npm run test:smoke
npm run verify:python-runtime
npm run desktop
npm run pack:desktop
```

Default development addresses:

- Frontend: `http://127.0.0.1:5174`
- API: `http://127.0.0.1:8797`

`scripts/dev-server.mjs` pins the API port to `QUESTION_SERVER_PORT || 8797` so it does not inherit a frontend preview tool's injected `PORT`.

Choose verification by impact:

- Import parsing changes: run at least `npm run build:server` and `npm run test:question-parser`.
- API route changes: run at least `npm run build:server` and `npm run test:routes`; if you intentionally add/remove a route, update `server/scripts/route-contract.test.mjs`.
- Startup, settings, or schema changes: run at least `npm run build` and `npm run test:smoke`.
- Question rendering or formula changes: run `npm run test:math-render`.
- Python runtime or packaging changes: run `npm run verify:python-runtime`, and `npm run pack:desktop` when needed.

## Data And Security

In development, data is written under the repository root by default, or under `QUESTION_DATA_DIR` if set. Packaged desktop builds set it to the OS userData directory through Electron. Common data locations:

- SQLite: `data/question.sqlite`
- Import v2: `data/import-flow-v2/source-documents/` and `data/import-flow-v2/ocr-documents/`
- Legacy slicing runs: `experiments/pdf_slicer/runs/`
- OCR/app settings: `config/ocr.env` and `config/app_settings.json`
- Figures and exports: `data/question_figures/`; exported files are served through `/assets`.

Security rules:

- Do not commit `config/`, `data/`, `experiments/`, `runtime/`, `python/`, uploaded files, exported files, SQLite databases, or real API keys.
- `.env.example` is only a field reference. Real secrets should come from the settings UI or local environment.
- The frontend should only show whether a key is configured; never return the full key.
- Store file URLs with `assetPathFor()` as portable paths, and read them with `resolveStoragePath()`. Do not pass arbitrary absolute paths directly to `/assets`.
- `/assets` in `server/src/server.ts` only allows files inside `storageRoot` or `sourceRoot`; keep the same constraint for any new file-serving code.

## Backend Implementation

Keep the route/service/repository layering:

- route: read `req.params`, `req.query`, `req.body`, and `req.file`; call a service; set status; return JSON.
- service: normalize parameters, validate business rules, handle state transitions, call repositories/db, perform file processing, and orchestrate OCR/Python/export work.
- repository or db: SQL queries, SQL updates, row mapping, and transactions.

Error handling:

- New routes should use `RouteError` and `sendRouteError`.
- Preserve Chinese user-facing error messages where existing code uses them. Do not return stack traces or secret-bearing details to the frontend.

Database:

- Schema and lightweight migrations live in `server/src/db/schema.ts` through `ensureSchema()` / `ensureColumn()`.
- Do not casually drop tables or change old field semantics. New tables/columns must be compatible with existing data.
- Multi-SQL side effects need transaction consideration, especially candidate commit, collection reorder/clear, source-document deletion and associated files, and figure binding.

Important side effects to preserve:

- `syncQuestionBankItemToOcrDraft`
- `refreshCollectionScore`
- `createExportRecord`
- `updateBatchWorkflow`
- OCR status updates and task state writes
- export record writes and item snapshots
- candidate commit writes to `committed_question_id` / `committed_at`
- figure files and inline marker binding
- run / batch status synchronization
- format validation and blocked/ready state updates
- `revalidateAllCandidatesForSourceDocument`

## Frontend Implementation

Frontend pages should call wrappers in `frontend/src/api/`:

- `importV2.ts`: import v2, SourceDocument, OCRDocument, QuestionCandidate, import jobs, and parser previews.
- `pdfSlicer.ts`: legacy slicing, runs, annotation, and review.
- `pendingBank.ts`: legacy pending bank.
- `questionBank.ts`: question-bank items, figures, and JSON import.
- `collections.ts`: basket, collections, and collection export.
- `exportRecords.ts`: export records and restore-to-basket.
- `learningTags.ts`: learning tag libraries.
- `settings.ts`: settings, health checks, and OCR config.

Do not add large amounts of `api('/api/...')` or `fetch('/api/...')` inside pages. Extend the appropriate API file first, then call the wrapper from the page.

UI rules:

- Follow `docs/ui_design_specification.md` by default.
- Use grayscale, high-density layouts, thin borders, and small status-color accents.
- Use lucide-react icons; do not use emoji.
- Avoid large gradients, glassmorphism, saturated colors, large shadows, and marketing-style layouts.
- Treat the app shell, sidebar, and topbar as fixed boundaries by default. Only modify `AppSidebar`, `AppPageHeader`, or the `App.tsx` shell when there is a clear navigation/product-structure requirement.
- For a new page or large UI rewrite, prefer a mock or isolated component pass first. Do not combine major business refactoring with a broad UI rewrite.

Current frontend cautions:

- `ImportV2Page.tsx` is state-heavy and already has a unified model adapter. For major work, prefer extracting components while preserving API behavior.
- `CandidateFixWorkbenchPage.tsx` reuses `BBoxCanvas` and legacy annotation sessions. Saved coordinates are relative ratios; keep page-size normalization intact.
- `PendingBankPage.tsx` belongs to the legacy pending-bank path; it is not the v2 candidates page.
- `QuestionBasket` has both drawer and page modes and refreshes through the `question-basket-updated` event.

## Import Flow V2 Details

Core types:

- SourceDocument: one uploaded source material and its processing state.
- OCRDocument: unified OCR intermediate output for Doc2X/GLM, storing markdown, pages, blocks, assets, metadata, and raw-result path.
- QuestionCandidate: reviewable question data, including stem, answer, analysis, figures, source refs, parser diagnostics, validation issues, and commit status.
- ImportJob: one import batch, supporting `single_document` and `separated_documents`.

Core backend locations:

- `server/src/routes/import-flow-v2.ts`
- `server/src/services/import-flow-v2/`
- `server/src/repositories/source-documents.repo.ts`
- `server/src/repositories/ocr-documents.repo.ts`
- `server/src/repositories/question-candidates.repo.ts`
- `server/src/repositories/import-jobs.repo.ts`
- `server/src/services/question-parser/`

Implementation rules:

- Real OCR must normalize into OCRDocument first. Do not write provider raw responses directly into question-bank items.
- Candidate parsing must use `parseQuestionCandidates()` and parser config/presets. Do not hard-code one document's numbering rules into a page.
- To support a new layout, first extend `default-parser-config.ts`, parser presets, or `solution-matcher` / `question-number-detector`, and add coverage in `server/scripts/question-parser.test.mjs`.
- `startSourceDocumentOcr()` checks provider configuration, source file existence, running tasks, and already-committed restrictions. Do not bypass these protections.
- Forced OCR deletes uncommitted candidates and corresponding manual-fix drafts. Re-OCR is currently not supported after candidates have been committed.
- Candidate bank insertion must go through `commitQuestionCandidate(s)`, which writes `question_bank_items` and marks the candidate as `committed`.
- Manual fixing goes through `createOrRestoreCandidateManualFixSession()` to create/restore a legacy annotation session. The fix should update the candidate rather than directly editing the question bank.

## Retired V1 PDF Slicing Data

V1 production routes, services, repositories, Python runners, and frontend pages are retired. Until the real-data migration gate passes, preserve the V1 tables and explicitly isolated read/migration adapters; do not reintroduce write routes.

## Question Bank, Tags, Basket, Export

The main question table is `question_bank_items`. Core fields include question number, stage, question type, difficulty, knowledge points, solution methods, source metadata, stem Markdown, answer, analysis, search text, figures JSON, source run/import id, and format-review state.

Collections and basket:

- The default collection id is `basket`, guaranteed by `ensureSchema()`.
- Collection item mutations must refresh total score.
- `QuestionBasket` stores the active collection id in localStorage: `question-manager.activeCollectionId`.

Export:

- Backend code lives in `server/src/services/question-bank/export*.ts`.
- Export records live in `question_bank_export_records` and must store item snapshots so history can be restored to the basket.
- Templates live in `templates/latex/`.
- PDF export may depend on XeLaTeX. DOCX/PDF conversion may depend on LibreOffice.

Tags:

- Built-in tag libraries live in `server/tag_libraries/`.
- Service code lives in `server/src/services/tags/tag-libraries.ts`.
- Frontend page is `frontend/src/pages/LearningTagsPage.tsx`.

## Electron And Packaging

Desktop flow:

1. `npm run build` builds server and frontend.
2. `npm run prepare:python-runtime` prepares the fixed Python runtime.
3. Electron starts the local API service from `electron/main.cjs`.
4. The frontend uses `window.questionWorkbench.apiBaseUrl` injected by preload to access the random local port.

Packaging notes:

- `package.json` `build.files` controls which files enter the desktop package.
- `asar` is disabled; the Python runtime is included through extraResources.
- The Windows installer does not delete AppData by default, to avoid losing user question-bank data.
- `.github/workflows/desktop-build.yml` runs math-render, updates, build, smoke, and packaging checks.

## Agent Workflow

Before starting:

1. Run `git status --short --branch` to check for user changes.
2. Use `rg --files` and `rg` to find related files; do not blindly edit the whole repository.
3. Read the relevant docs listed above for the task type.
4. Identify whether the task changes API paths, schema, frontend routes, data file paths, or packaging config.

While coding:

- Make small, focused changes and reuse existing service/repo/API/component patterns.
- Avoid unrelated refactors and broad formatting churn.
- Do not revert user changes or run destructive git commands.
- Do not commit test data, uploaded PDFs, OCR responses, secrets, or local databases.
- Search before adding an API route to avoid duplicate paths.
- Add frontend API calls in `frontend/src/api/` before using them in pages.
- Add database fields through compatible creation/migration in `ensureSchema()`.

Before finishing:

1. Run the smallest relevant verification for the changed area.
2. Check `git diff --stat` and `git diff --check`.
3. Confirm no accidental generated files are in the worktree.
4. In the final response, state:
   - which modules changed;
   - whether API paths changed;
   - whether database structure changed;
   - whether response shapes changed;
   - whether frontend API wrappers were added;
   - which checks were run.

## Common Task Targets

- New import-batch ability: `server/src/services/import-flow-v2/`, `frontend/src/api/importV2.ts`, `frontend/src/pages/import-v2/`.
- OCR provider changes: `server/src/services/ocr-providers/`, `server/src/services/settings/ocr-settings.ts`, related normalizer tests.
- Question-number / solution matching changes: `server/src/services/question-parser/`, `server/scripts/question-parser.test.mjs`.
- Candidate commit changes: `candidate.service.ts`, `question-candidates.repo.ts`, `question-bank/items.service.ts`.
- Manual fix changes: `manual-fix.service.ts`, `annotations.service.ts`, `CandidateFixWorkbenchPage.tsx`, `BBoxCanvas.tsx`.
- Question-bank list/detail changes: `question-bank/items.ts`, `items.service.ts`, `frontend/src/api/questionBank.ts`, `WorkbenchQuestionCard.tsx`.
- Basket/export changes: `collections.service.ts`, `export.service.ts`, `QuestionBasket.tsx`, `ExportRecordsPage.tsx`.
- Settings changes: `settings/ocr-settings.ts`, `settings/app-settings.ts`, `SettingsPage.tsx`, `SetupPage.tsx`.
- Desktop update/packaging changes: `electron/`, `scripts/prepare-python-runtime.mjs`, `package.json` build config, GitHub workflow.
