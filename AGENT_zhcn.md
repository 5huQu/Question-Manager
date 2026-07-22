# Question Manager Agent Guide

本文件是后续 Agent 进入本仓库后的首读文档。它记录当前项目目录、功能预期、实现方法和操作注意事项。开始任何编码前，先读本文件，再按任务类型打开对应的项目文档和源码入口。

## 项目定位

Question Manager 是一个本地优先的数学题库桌面工具，覆盖资料导入、整卷 OCR、题号切分、候选题确认、人工修正、题库维护、试题篮组卷、Markdown/LaTeX/PDF 导出和桌面打包。技术栈是 Electron + React + Vite + TypeScript + Express + SQLite + Python。

当前产品主线是导入流程 v2：

1. 资料导入：上传单文档，或上传原卷 + 答案解析双文档。
2. 整卷 OCR：使用 Doc2X 或 GLM-OCR 生成统一 OCRDocument。
3. 题号切分：由 question-parser 根据可配置规则生成 QuestionCandidate。
4. 待确认与修正：用户检查题干、答案、解析、题图、来源和诊断。
5. 正式入库：候选题 commit 后写入 question_bank_items。
6. 题库与组卷：在题库检索、编辑、加试题篮、导出。

旧的 PDF 切分生产链路已经退役。在真实数据迁移门槛通过前，仍保留兼容表、只读迁移适配器和异常修正支持；不要在没有明确要求时删除这些兼容内容。

## 文档目录

优先阅读顺序：

- `README.md`：项目能力、运行方式、环境变量、打包、安全说明。
- `AGENTS.md`：英文版后续 Agent 操作指南，也是 Codex 的仓库级入口。
- `AGENT_zhcn.md`：本文件，中文版操作指南。
- `docs/ui_design_specification.md`：shadcn/ui 风格设计规范。普通页面开发必须遵守；默认不要顺手修改 AppSidebar、AppPageHeader、整体外壳。
- `backend-layered-refactor-plan.md`：后端 route/service/repository 分层迁移原则和测试重点。
- `WINDOWS_BUILD.md`：Windows 构建与安装排错。

## 目录地图

- `frontend/`：React 19 + Vite 前端。
  - `frontend/src/App.tsx`：前端路由、应用外壳、首次设置入口、自动更新提醒。
  - `frontend/src/api/`：前端 API 封装。页面应调用这里的方法，不要散写 `fetch('/api/...')`。
  - `frontend/src/pages/import-v2/`：当前主导入流程页面。
  - 旧 PDF 切题页面已删除；历史 URL 只显示只读退役提示或跳转到 V2。
  - `frontend/src/pages/questions/`：题库列表、详情、新建、试卷预览。
  - `frontend/src/components/questions/`：题目渲染、编辑、题图和 BBoxCanvas。
  - `frontend/src/components/ui/` 与 `frontend/src/components/ui.tsx`：shadcn 风格基础组件。
- `server/`：TypeScript 后端。
  - `server/src/index.ts`：总装配点，初始化 schema、恢复中断 run、挂载所有 route。
  - `server/src/server.ts`：Express app、`/assets` 安全文件访问、前端静态资源托管。
  - `server/src/db/`：SQLite 连接、schema、兼容迁移、部分基础 CRUD。
  - `server/src/routes/`：HTTP 入口，只做参数读取、调用 service、返回 JSON。
  - `server/src/services/`：业务逻辑、状态流转、OCR/导出/Python 调用。
  - `server/src/repositories/`：SQL、row 映射、事务相关数据访问。
  - `server/src/types/`：SourceDocument、OCRDocument、QuestionCandidate 等业务类型。
  - `server/tag_libraries/`：内置学习标签库。
- `server/python/`：V2 PDF 页面渲染/裁剪和题库分类所需的白名单运行时工具。
  - 生产包只包含 `crop_manual_annotation.py`、`render_pdf_page.py`、`classify_question_bank.py` 与最小配置模块。
  - `server/python/requirements.txt` 与 `runtime-requirements.txt`：源码开发和打包运行时依赖。
- `electron/`：Electron 主进程、preload、更新逻辑。
  - `electron/main.cjs`：生产桌面版启动本地 API 服务，并将 `QUESTION_DATA_DIR` 指向 Electron userData。
  - `electron/preload.cjs`：向前端暴露 API base URL 和更新能力。
  - `electron/updater.cjs`：桌面更新检查/下载。
- `templates/latex/`：LaTeX/Examch 导出模板。
- `scripts/`：开发服务器、Python runtime 准备/校验、迁移脚本、打包辅助。
- `data/`、`config/`、`experiments/`、`runtime/`、`dist/`、`node_modules/`：本地运行或生成目录，不应提交。

## 运行与验证

环境要求：

- Node.js 24 或更高。
- 源码开发需要 Python 3.11 或更高。
- 可选：XeLaTeX、LibreOffice。

常用命令：

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

默认开发地址：

- 前端：`http://127.0.0.1:5174`
- API：`http://127.0.0.1:8797`

`scripts/dev-server.mjs` 会把 API 端口固定为 `QUESTION_SERVER_PORT || 8797`，避免继承前端预览工具注入的 `PORT`。

改动后按影响范围选择验证：

- 改导入解析：至少 `npm run build:server` 和 `npm run test:question-parser`。
- 改 API route：至少 `npm run build:server` 和 `npm run test:routes`；如确实新增/删除路由，同步更新 `server/scripts/route-contract.test.mjs`。
- 改启动、设置、schema：至少 `npm run build` 和 `npm run test:smoke`。
- 改题目渲染/公式：跑 `npm run test:math-render`。
- 改 Python runtime 或打包：跑 `npm run verify:python-runtime`，必要时 `npm run pack:desktop`。

## 数据与安全

开发模式默认把数据写在仓库根目录下，或使用 `QUESTION_DATA_DIR` 覆盖；桌面版由 Electron 设置为系统 userData 目录。常见数据位置：

- SQLite：`data/question.sqlite`
- 导入 v2：`data/import-flow-v2/source-documents/`、`data/import-flow-v2/ocr-documents/`
- 旧切题 run：`experiments/pdf_slicer/runs/`
- OCR/应用设置：`config/ocr.env`、`config/app_settings.json`
- 题图与导出：`data/question_figures/`、导出文件由服务生成并通过 `/assets` 暴露。

安全规则：

- 不提交 `config/`、`data/`、`experiments/`、`runtime/`、`python/`、上传文件、导出文件、SQLite、真实 API key。
- `.env.example` 只用于字段说明；真实密钥通过系统设置或本地环境传入。
- 前端只显示 key 是否已配置，不返回完整 key。
- 文件 URL 使用 `assetPathFor()` 存为可移植路径，读取时用 `resolveStoragePath()`。不要把任意绝对路径直接拼给 `/assets`。
- `server/src/server.ts` 的 `/assets` 只允许访问 `storageRoot` 或 `sourceRoot` 内文件；新增文件服务时保持同样约束。

## 后端实现方法

坚持 route/service/repository 分层：

- route：只读 `req.params`、`req.query`、`req.body`、`req.file`，调用 service，设置状态码，返回 JSON。
- service：参数规整、业务校验、状态流转、调用 repository/db、文件处理、OCR/Python/导出编排。
- repository 或 db：SQL 查询、SQL 更新、row 映射、事务。

错误处理：

- 新 route 使用 `RouteError` 和 `sendRouteError`。
- 保留中文错误信息，避免把底层栈或密钥内容返回给前端。

数据库：

- schema 和轻量迁移集中在 `server/src/db/schema.ts` 的 `ensureSchema()` / `ensureColumn()`。
- 不要轻易 drop 表或改旧字段语义；新增表/字段要兼容已有数据。
- 多 SQL 副作用必须考虑事务，特别是候选题入库、集合题目重排/清空、删除资料及其关联文件、题图绑定。

重要副作用清单：

- `syncQuestionBankItemToOcrDraft`
- `refreshCollectionScore`
- `createExportRecord`
- `updateBatchWorkflow`
- OCR 状态更新与 task state 写入
- 导出记录写入和 items 快照
- 候选题 commit 后 `committed_question_id` / `committed_at`
- 题图文件与 inline marker 绑定
- run / batch 状态同步
- 格式校验、blocked/ready 状态更新
- `revalidateAllCandidatesForSourceDocument`

## 前端实现方法

前端页面应调用 `frontend/src/api/` 的封装：

- `importV2.ts`：导入 v2、SourceDocument、OCRDocument、QuestionCandidate、导入批次、解析预览。
- `pdfSlicer.ts`：旧切题、run、标注、复核。
- `pendingBank.ts`：旧待入库。
- `questionBank.ts`：题库题目、题图、JSON 导入。
- `collections.ts`：试题篮、集合、导出集合。
- `exportRecords.ts`：导出记录、恢复到试题篮。
- `learningTags.ts`：学习标签库。
- `settings.ts`：设置、健康检查、OCR 配置。

页面里不要新增大量 `api('/api/...')` 或 `fetch('/api/...')`。先扩展对应 API 文件，再调用封装函数。

UI 规范：

- 默认遵守 `docs/ui_design_specification.md`。
- 风格以黑白灰、高密度、细边框、少量状态色为主。
- 使用 lucide-react 图标，不用 Emoji。
- 避免大渐变、玻璃拟态、高饱和色、大面积阴影、营销型布局。
- 主外壳、侧边栏、顶栏默认视为固定边界；只有明确的导航/产品结构需求才修改 `AppSidebar`、`AppPageHeader`、`App.tsx` 外壳。
- 新页面或大幅 UI 重做，优先先做 mock 或局部组件验证；不要一边重构业务一边大改 UI。

当前前端注意点：

- `ImportV2Page.tsx` 状态复杂，已有统一数据适配层。大改时优先拆组件和保持 API 行为，不要继续堆长函数。
- `CandidateFixWorkbenchPage.tsx` 复用 `BBoxCanvas` 和旧标注 session。坐标保存为相对比例，注意页面尺寸归一化。
- `PendingBankPage.tsx` 是旧链路待入库，不等同于 v2 candidates 页面。
- `QuestionBasket` 同时有 drawer 和 page 两种模式，依赖 `question-basket-updated` 事件刷新。

## 导入流程 v2 细节

核心类型：

- SourceDocument：用户上传的一份资料及其状态。
- OCRDocument：Doc2X/GLM 等 OCR 结果的统一中间结构，保存 markdown、pages、blocks、assets、metadata 和原始返回路径。
- QuestionCandidate：待确认题目，包含题干、答案、解析、题图、来源引用、解析诊断、校验问题和入库状态。
- ImportJob：一次导入批次，支持 `single_document` 和 `separated_documents`。

核心后端位置：

- `server/src/routes/import-flow-v2.ts`
- `server/src/services/import-flow-v2/`
- `server/src/repositories/source-documents.repo.ts`
- `server/src/repositories/ocr-documents.repo.ts`
- `server/src/repositories/question-candidates.repo.ts`
- `server/src/repositories/import-jobs.repo.ts`
- `server/src/services/question-parser/`

实现规则：

- 真实 OCR 后必须先 normalizer 成 OCRDocument，不要把 provider 原始返回直接写成题库题目。
- 候选题解析使用 `parseQuestionCandidates()` 和 parser config/presets，不要为单份资料硬编码题号规则。
- 如果需要支持新的版式，优先扩展 `default-parser-config.ts`、parser preset 或 `solution-matcher`/`question-number-detector`，并补 `server/scripts/question-parser.test.mjs`。
- `startSourceDocumentOcr()` 会检查 provider 配置、文件存在、运行中任务和已入库限制；不要绕过这些保护。
- `force` OCR 会删除未入库候选和对应手动修正草稿；已入库后暂不支持重新识别。
- 候选题入库只通过 `commitQuestionCandidate(s)`，入库后写入 `question_bank_items` 并标记 candidate 为 `committed`。
- 手动修正通过 `createOrRestoreCandidateManualFixSession()` 创建/恢复旧 annotation session，修正后应更新 candidate，而不是直接改题库。

## 已退役的 V1 PDF 切题数据

V1 生产 routes、services、repositories、Python runners 和前端页面均已退役。在真实数据迁移 gate 通过前，保留 V1 表与明确隔离的只读/迁移 adapter，禁止重新挂载写接口。

## 题库、标签、组卷、导出

题库主表是 `question_bank_items`。核心字段包含题号、学段、题型、难度、知识点、解题方法、来源元数据、题干 Markdown、答案、解析、搜索文本、题图 JSON、来源 run/import id、格式复核状态。

集合/试题篮：

- 默认集合 id 是 `basket`，由 `ensureSchema()` 保证存在。
- 集合题目变动后需要刷新总分。
- `QuestionBasket` 的当前集合 id 存在 localStorage：`question-manager.activeCollectionId`。

导出：

- 后端在 `server/src/services/question-bank/export*.ts`。
- 导出记录在 `question_bank_export_records`，需要保存 items 快照，以便历史记录恢复到试题篮。
- 模板在 `templates/latex/`。
- 导出 PDF 可能依赖 XeLaTeX，DOCX/PDF 转换可能依赖 LibreOffice。

标签：

- 内置标签库在 `server/tag_libraries/`。
- 服务在 `server/src/services/tags/tag-libraries.ts`。
- 前端页面是 `frontend/src/pages/LearningTagsPage.tsx`。

## Electron 与打包

桌面版流程：

1. `npm run build` 构建 server 和 frontend。
2. `npm run prepare:python-runtime` 准备固定 Python 运行时。
3. Electron 从 `electron/main.cjs` 启动本地 API 服务。
4. 前端通过 preload 注入的 `window.questionWorkbench.apiBaseUrl` 访问随机本地端口。

打包注意：

- `package.json` 的 `build.files` 决定进入桌面包的文件。
- `asar` 关闭，Python runtime 放在 extraResources。
- Windows 安装器默认不删除 AppData，避免卸载时丢用户题库。
- GitHub Actions 的 `.github/workflows/desktop-build.yml` 会跑 math-render、updates、build、smoke、pack。

## Agent 工作流程

开始前：

1. 运行 `git status --short --branch`，确认是否有用户未提交改动。
2. 用 `rg --files` 和 `rg` 找相关文件；不要盲目全仓库改。
3. 根据任务类型阅读本文件上方列出的相关 docs。
4. 明确是否会改 API、schema、前端路由、数据文件路径或打包配置。

编码中：

- 保持小步修改，优先复用现有 service/repo/API/组件模式。
- 不做无关重构，不格式化大量无关文件。
- 不还原用户改动，不运行破坏性 git 命令。
- 不把测试数据、上传 PDF、OCR 响应、密钥或本地数据库加入提交。
- 新增 API 前先搜索是否已有同路径，避免重复 route。
- 新增前端 API 先写到 `frontend/src/api/`。
- 新增数据库字段先在 `ensureSchema()` 里兼容创建/迁移。

完成前：

1. 运行与改动范围匹配的最小测试。
2. 检查 `git diff --stat` 和 `git diff --check`。
3. 确认工作区没有意外生成文件。
4. 在最终回复里说明：
   - 修改了哪些模块。
   - 是否改变 API 路径。
   - 是否改变数据库结构。
   - 是否改变返回结构。
   - 是否新增前端 API 封装。
   - 已运行哪些检查。

## 常见任务落点

- 新增导入批次能力：`server/src/services/import-flow-v2/`、`frontend/src/api/importV2.ts`、`frontend/src/pages/import-v2/`。
- 调整 OCR provider：`server/src/services/ocr-providers/`、`server/src/services/settings/ocr-settings.ts`、相关 normalizer 测试。
- 调整题号/解析匹配：`server/src/services/question-parser/`、`server/scripts/question-parser.test.mjs`。
- 调整候选题入库：`candidate.service.ts`、`question-candidates.repo.ts`、`question-bank/items.service.ts`。
- 调整人工修正：`manual-fix.service.ts`、`annotations.service.ts`、`CandidateFixWorkbenchPage.tsx`、`BBoxCanvas.tsx`。
- 调整题库列表/详情：`question-bank/items.ts`、`items.service.ts`、`frontend/src/api/questionBank.ts`、`WorkbenchQuestionCard.tsx`。
- 调整试题篮/导出：`collections.service.ts`、`export.service.ts`、`QuestionBasket.tsx`、`ExportRecordsPage.tsx`。
- 调整设置：`settings/ocr-settings.ts`、`settings/app-settings.ts`、`SettingsPage.tsx`、`SetupPage.tsx`。
- 调整桌面更新/打包：`electron/`、`scripts/prepare-python-runtime.mjs`、`package.json` build 配置、GitHub workflow。
