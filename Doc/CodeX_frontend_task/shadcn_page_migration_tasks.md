# 前端 shadcn 页面迁移任务文档

生成日期：2026-06-23  
适用项目：Question Manager, Electron + React + Vite + TypeScript + Express + SQLite + Python  
输入依据：

- 现有真实前端代码：`frontend/src/App.tsx`、`frontend/src/pages/**`、`frontend/src/components/**`、`frontend/src/api/**`
- Gemini 功能对齐文档：`docs/CodeX_frontend_task/mock_pages_alignment.md`
- 现有 Mock 页面：`frontend/src/pages/mock/**`
- 现有后端路由清单：`server/src/routes/**`，仅用于识别 API 依赖，不允许在本轮页面迁移中修改

本文件只规划迁移任务，不开始迁移真实页面。

## 0. 迁移边界

本轮目标是把真实页面的主内容区迁移到 Gemini 已确认的 shadcn official Blocks 风格。不得迁移、重写或替换 AppShell、Sidebar、Topbar、后端接口、数据库结构。

必须遵守：

- 不修改 `server` 目录。
- 不修改数据库结构。
- 不修改后端 API 路径。
- 不修改 `frontend/src/components/layout/AppSidebar.tsx`。
- 不修改 `frontend/src/components/layout/AppPageHeader.tsx`，除非后续单独任务明确要求。
- 不修改 `frontend/src/App.tsx` 的 AppShell 结构，除非只是为接页面 API 状态做主内容区内部调整。
- 不重新设计视觉风格，不自行发挥设计。
- 只迁移主内容区。
- 不实现 mock only 功能。
- 不删除现有真实功能入口。
- 不把 API URL 散落回页面组件。
- 迁移前确认 `frontend/src/api` 业务分组封装已完成。

视觉规范：

- 接近 shadcn/ui official Blocks。
- 以黑白灰、zinc、neutral 为主。
- 成功状态只小范围使用低饱和 emerald。
- 警告使用 amber，危险使用 red。
- 不使用 emoji。
- 不使用大渐变、玻璃拟态、高饱和蓝紫、亮绿色、大面积阴影。
- Card 使用 `border`、`rounded-xl`、`shadow-sm`。
- 普通 Badge 使用灰色。
- 页面工具栏紧凑。
- 内容区要有清楚网格和层级。
- 题目内容、OCR 内容、原图/切片图应是视觉主角。

## 一、当前页面与文件盘点

| 页面 | 路由 | 当前文件位置 | 主要功能 | 依赖的 API | 是否已有 Gemini Mock | 是否适合本轮迁移 |
| --- | --- | --- | --- | --- | --- | --- |
| 工作台首页 | `/workbench` | `frontend/src/pages/workbench/TraditionalWorkbenchPage.tsx`、`OverviewTab.tsx`，另有旧 `SlicerTab.tsx`、`OcrTab.tsx` | 题库/切题/OCR 概览，活跃批次，最近录入，OCR 引擎配置，批次进入复核或 OCR 导入 | `pdfSlicerApi.getDashboard`、`questionBankApi.listItems`、`settingsApi.getOcrSettings`、`pdfSlicerApi.getSliceReviewItems`、`pdfSlicerApi.quickReview`；待接 `dashboardApi.getActivityHeatmap` | 有，`/mock/workbench` | 适合 A 组优先迁移，但热力图和服务状态需要先分清真实/假数据 |
| 题库管理页 | `/questions` | `frontend/src/pages/questions/QuestionBankPage.tsx`、`frontend/src/components/questions/WorkbenchQuestionCard.tsx`、`QuestionContent.tsx`、`EditDialog.tsx`、`FigureDialogs.tsx` | 题目列表、搜索、筛选、分页、编辑、删除、详情、加入试题篮、题图框选 | `questionBankApi.listItems`、`questionBankApi.updateItem`、`questionBankApi.deleteItem`、`questionBankApi.createFigure/updateFigure/deleteFigure`、`learningTagsApi.getQuestionBankTagLibraries`、`collectionsApi.addItem` via `addQuestionToActiveBasket` | 有，`/mock/question-bank` | C 组。Mock 有三栏、表格、批量操作，但真实批量打标/批量删除 API 不存在，风险高 |
| 题目新增页 | `/questions/new` | `frontend/src/pages/questions/QuestionCreatePage.tsx` | 单题表单录入、单题 JSON、整套试卷 JSON、绑定切片导入、AI 提示词复制、KaTeX/Markdown 预览 | `questionBankApi.createItem`、`questionBankApi.importJsonItems`、`questionBankApi.importJsonItemsFromSlices`、`pdfSlicerApi.getDashboard`、`pdfSlicerApi.getSliceReviewItems`、`pdfSlicerApi.openRunFolder` | 无直接 Mock | B 组。功能多但页面独立，迁移时必须保持导入校验逻辑 |
| 题目详情页 | `/questions/:id` | `frontend/src/pages/questions/QuestionDetailPage.tsx`、`FigureDialogs.tsx`、`EditDialog.tsx`、`QuestionContent.tsx` | 题目查看、答案解析、元数据、编辑、删除、重新 OCR、分块 OCR、加入试题篮、框选题图 | `questionBankApi.getItem/updateItem/deleteItem/rerunItemOcr/createFigure/updateFigure/deleteFigure`、`ocrApi.startOcr`、`ocrApi.getOcrProgress`、`collectionsApi.addItem` via `addQuestionToActiveBasket` | 无直接 Mock，视觉可参考 `/mock/ocr-review` 右侧编辑区 | B 组。真实 OCR/题图入口多，需小心保留 |
| OCR 复核/入库确认 | 实际对应 `/tools/pdf-slicer/runs/:runId/pending-bank`，另有 `/tools/pdf-slicer/runs/:runId/questions` 和 `SliceReviewDialog` | `frontend/src/pages/PendingBankPage.tsx`、`frontend/src/pages/questions/RunQuestionsPage.tsx`、`frontend/src/pages/pdf-slicer/SliceReviewDialog.tsx` | 待入库队列、识别结果复核、原图/OCR 图块预览、编辑题干答案解析、框选题图、重跑 OCR、批量确认/跳过/删除、疑似重复审核、切题复核弹窗 | `pendingBankApi.getPendingBank/createManualCandidate/rerunOcr/bulkConfirm/bulkSkip/bulkDelete`、`questionBankApi.updateItem/rerunItemOcr/createFigure/updateFigure/deleteFigure/listRunQuestions/deleteItem`、`pdfSlicerApi.getSliceReviewItems/quickReview/mergeSliceReviewItems/splitSliceReviewItem/updateSliceReviewItemFigures/deleteSliceReviewItem`、`learningTagsApi.getQuestionBankTagLibraries` | 有，`/mock/ocr-review`；切题弹窗参考 `/mock/dialogs` | C 组。最高风险之一，涉及真实入库状态和数据安全 |
| PDF 切分中心 | `/tools/pdf-slicer` | `frontend/src/pages/pdf-slicer/PdfSlicerPage.tsx`、`RunCard.tsx`、`SliceReviewDialog.tsx`、`ReviewFigureEditor.tsx`、`frontend/src/components/pdf-slicer/**` | 上传 PDF/DOC/DOCX、资料组、上传模式、分离原卷/解析、启动切题、切题复核、进入 OCR/待入库 | `pdfSlicerApi.getDashboard/upload/getRun/deleteRun/openRunFolder/updateRunClassification/startSlice/getSliceReviewItems/quickReview/mergeSliceReviewItems/splitSliceReviewItem/updateSliceReviewItemFigures`、`ocrApi.startOcr/forceRerunOcr`、`settingsApi.getOcrSettings` | 无完整页面 Mock；切题弹窗参考 `/mock/dialogs` | C 组。切题流程长，必须逐步迁移 |
| OCR 识别队列 | `/tools/pdf-slicer/ocr-jobs` | `frontend/src/pages/ocr/OcrQueuePage.tsx`、`OcrJobCard.tsx`、`OcrHistoryRow.tsx` | OCR jobs、运行中/排队/历史、进度、重跑、断点续跑、中断、删除、进入待入库 | `ocrApi.getJobs/getOcrProgress/startOcr/resumeOcr/forceRerunOcr/forceInterruptOcr/bulkOcr`、`pdfSlicerApi.deleteRun` | 无直接 Mock，局部参考 `/mock/ocr-review` | C 组。轮询、任务状态和危险操作多 |
| 待入库页面 | `/tools/pdf-slicer/runs/:runId/pending-bank` | `frontend/src/pages/PendingBankPage.tsx` | ready/blocked/banked/skipped/ocr_failed/has_figures 筛选，批量确认入库，批量跳过，批量删除，单题重跑 OCR，格式风险，疑似重复，题图预览/框选 | `pendingBankApi.*`、`questionBankApi.updateItem/rerunItemOcr/createFigure/updateFigure/deleteFigure` | 无独立 Mock，参考 `/mock/ocr-review` | C 组。不要和纯视觉 Mock 混淆 |
| 试题篮页面 | `/questions/basket`，同时全局抽屉 `QuestionBasket mode="drawer"` | `frontend/src/components/QuestionBasket.tsx` | 当前集合、试卷标题/副标题/时长、题目排序、分值、分组展示、删除、清空、导出 Markdown/PDF | `collectionsApi.listCollections/getCollection/createCollection/updateCollection/updateItem/removeItem/clearItems/reorder/exportCollection` | 有，`/mock/basket` | B 组。组件同时服务页面和抽屉，迁移时只改真实主内容区，避免破坏全局抽屉 |
| 组卷工作台/集合 | `/questions/basket`、`/questions/collections/:id/markdown-preview` | `QuestionBasket.tsx`、`MarkdownPreviewPage.tsx` | 试卷集合、题目组织、导出准备、Markdown/PDF 预览 | `collectionsApi.*`、`exportRecordsApi` 只在记录页使用 | 有，`/mock/basket` | B 组。与试题篮同源，不建议拆成新页面 |
| 导出记录页面 | `/exports` | `frontend/src/pages/ExportRecordsPage.tsx` | 导出记录列表、搜索、来源筛选、格式、时间、题目数、打开、删除、恢复到试题篮 | `exportRecordsApi.listExportRecords/deleteExportRecord/restoreToBasket`、`collectionsApi.getCollection` | 有，`/mock/export-records`，但 Gemini 文档明确“不做任何迁移操作，维持当前系统源文件设计” | A 组但仅做必要 shadcn/色彩/结构清理，不按 Mock 重构 |
| 学习标签库页面 | `/learning-tags` | `frontend/src/pages/LearningTagsPage.tsx` | 标签库读取、新增、删除、默认标签库、知识点/方法标签管理、JSON/直观编辑、AI 提示词辅助、自动保存 | `learningTagsApi.listLibraries/createLibrary/updateLibrary/deleteLibrary`，当前页面主要用 `createLibrary` 做保存/导入 | 无 | A 组但文件很大，应小步迁移。页面隔离，业务风险低于 OCR 流程 |
| 系统设置页面 | `/settings` | `frontend/src/pages/SettingsPage.tsx`、`frontend/src/components/UpdateCard.tsx`、`OcrSettingsDialog.tsx` | 基础设置、OCR 引擎、外部工具、分类设置、Prompt、导出模板、切题规则、应用更新、LibreOffice 状态 | `settingsApi.getOcrSettings/updateOcrSettings/getHealth`、`pdfSlicerApi.getRules/updateRules/validateRules`；更新能力来自 `window.questionWorkbench.updates` | 有，`/mock/settings` | A 组但要拆小任务。当前有左侧二级设置导航，迁移时必须改为纵向分组 Card 或 Tabs |
| Markdown/LaTeX 预览 | `/questions/collections/:id/markdown-preview` | `frontend/src/pages/questions/MarkdownPreviewPage.tsx` | 学生/教师版切换、Markdown 源码、渲染预览、打印/导出 A4 PDF、返回 | `collectionsApi.exportCollection(collectionId, { format: 'markdown', variant })` | 无 | B 组。与试题篮导出链路相关 |
| Setup 初始化页面 | `/setup` | `frontend/src/pages/SetupPage.tsx` | 初始化配置、系统名称、网站标题、描述、数据目录相关基础设置、模板、学段、LibreOffice 健康检查 | `settingsApi.getHealth`、`settingsApi.updateSettings` | 无 | 暂不纳入本轮。它不在 AppShell 主内容区，属于首次启动关键路径，建议后续单独迁移 |

## 二、前端 API 分组任务

### 2.1 当前状态

当前 `frontend/src/api` 已存在以下业务分组，不是只有 `client.ts` 和 `dashboard.ts`：

- `client.ts`：统一 `api<T>()`、`jsonHeaders`、`window.questionWorkbench.apiBaseUrl` 拼接。
- `dashboard.ts`：`dashboardApi.getActivityHeatmap`，对应 `GET /api/dashboard/activity-heatmap`。
- `settings.ts`：`getHealth`、`getSettings`、`updateSettings`、`getOcrSettings`、`updateOcrSettings`。
- `pdfSlicer.ts`：PDF 切分 dashboard、上传、规则、批次、运行、分类、切题、切题复核、合并、拆分、题图。
- `ocr.ts`：OCR jobs、启动、断点续跑、进度、完全重跑、中断、批量 OCR。
- `pendingBank.ts`：待入库列表、手动候选、单题重跑、批量确认、跳过、删除。
- `questionBank.ts`：题库列表、详情、创建、更新、删除、重跑 OCR、JSON 导入、按切片导入、批次题目、题图。
- `collections.ts`：试卷集合、集合题目增删改、清空、排序、导出。
- `exportRecords.ts`：导出记录列表、删除、恢复到试题篮、按 collection/run 查询、批次导出。
- `learningTags.ts`：题库标签读取、学习标签库增删改查。

### 2.2 已执行的散点 API 扫描结论

扫描命令口径：

```bash
rg -n "fetch\\s*\\(\\s*['\"]/api|api\\s*\\(\\s*['\"]/api|['\"]/api/" frontend/src --glob '*.ts' --glob '*.tsx' --glob '!frontend/src/api/**'
```

结论：

- 当前页面和业务组件中未发现直接 `fetch('/api/...')` 或 `api('/api/...')` 调用。
- 业务 API URL 目前集中在 `frontend/src/api/*.ts`。
- `frontend/src/components/questions/EditDialog.tsx` 中存在 `fetch(url)`，用途是读取图片 URL 转 Blob/PNG 并复制到剪贴板，不是业务 API URL 散落，不纳入 API 分组迁移。
- `PendingBankPage.tsx` 等页面有 `/assets/...` 图片资源路径，这是静态资源读取，不属于后端业务 API 封装范围。

### 2.3 页面迁移前必须完成的 API 分组确认

迁移任何页面前，先执行以下确认：

1. 运行散点扫描，确认页面和组件中没有新增直接 `/api` 调用。
2. 页面需要的新 API 方法必须先加到对应 `frontend/src/api/*.ts` 文件。
3. 不改 API 路径，不改业务逻辑，不改响应结构。
4. 如果页面迁移需要 mock 中的能力，但后端没有 API，必须标为 mock only，不实现。
5. 如果 API 文件已有方法，页面只改 import 和调用方式，不重复封装。

### 2.4 API 分组补齐任务清单

| API 文件 | 当前状态 | 迁移前任务 |
| --- | --- | --- |
| `client.ts` | 已集中 baseUrl 和 fetch | 保持。不要在页面重写 `fetch('/api')`。如需处理文件下载，优先在业务 API 中返回 URL 或 Blob helper |
| `dashboard.ts` | 已有 `getActivityHeatmap` | 工作台迁移前必须使用 `dashboardApi.getActivityHeatmap` 接真实热力图 |
| `settings.ts` | 已覆盖设置、OCR 设置、健康检查 | 设置页迁移只使用本文件；不要实现 mock 的假连接测试，除非后端已有真实接口 |
| `pdfSlicer.ts` | 已覆盖切题核心流程 | PDF 切分中心、切题复核弹窗、设置规则页继续使用；如要展示规则历史/回滚，需先补 `history/rollback` 方法，但本轮不要主动新增页面功能 |
| `ocr.ts` | 已覆盖队列和运行控制 | OCR 队列迁移使用本文件；不要在页面拼进度 URL |
| `pendingBank.ts` | 已覆盖待入库核心批量操作 | PendingBank 迁移使用本文件；不要新增批量接口路径 |
| `questionBank.ts` | 已覆盖题库 CRUD、导入、题图、单题重跑 | 题库、详情、新增、待入库编辑共用；批量打标/批量删除后端不存在，不实现 |
| `collections.ts` | 已覆盖试题篮、集合、排序、导出 | 试题篮/组卷/Markdown 预览使用；不要恢复 mock localStorage 作为真实路径 |
| `exportRecords.ts` | 已覆盖记录、恢复、按来源查询、批次导出 | 导出记录页使用；恢复到试题篮必须保留确认流程 |
| `learningTags.ts` | 已覆盖标签库增删改查 | 学习标签库迁移使用；当前页面保存主要用 `createLibrary` 做 upsert，迁移中不改语义，除非先确认后端更新约定 |

### 2.5 未迁移 API 调用清单

当前未发现真实页面/组件中未迁移的 `/api` 直接调用。

保留观察项：

- `EditDialog.tsx` 的图片读取 `fetch(url)` 不是 `/api`，无需迁入业务 API。
- `QuestionBasket.tsx` 内 mock 路由仍使用 `mockData` 和 localStorage，这是 Mock 专用兼容逻辑。真实 `/questions/basket` 不应使用 mock localStorage。

## 三、页面迁移分组

### A 组：低风险，可优先迁移

1. 工作台首页 `/workbench`
   - 理由：文件较小，主要是数据展示和跳转。新增热力图接真实 API 是明确前置任务。
   - 注意：当前真实页仍有 `每日一题`、`随机组卷` alert 入口，不属于已确认真实功能，不要包装成真功能。

2. 导出记录 `/exports`
   - 理由：页面独立，API 封装完整。
   - 注意：Gemini 对齐文档明确 Mock 导出记录“不做迁移操作”。本轮只做 shadcn 组件化、颜色收敛和结构清理，不照搬 Mock。

3. 设置页 `/settings`
   - 理由：虽文件较大，但 API 明确，主要是表单。
   - 注意：当前有左侧二级设置导航；迁移要求改为纵向分组 Card 或 Tabs，不再做左侧二级导航。更新卡片依赖 Electron preload，不要伪造。

4. 学习标签库 `/learning-tags`
   - 理由：业务隔离，不影响题库/OCR 核心流程。
   - 注意：文件很大，有自动保存、拖拽、JSON 编辑、AI 提示词导入，必须小步迁移。

### B 组：中风险，需对照功能文档迁移

1. 试题篮/组卷工作台 `/questions/basket`
   - 理由：真实组件同时承担页面和全局抽屉，导出链路影响较大。

2. 题目新增 `/questions/new`
   - 理由：导入校验和切片绑定逻辑复杂，但页面独立。

3. 题目详情 `/questions/:id`
   - 理由：编辑、OCR 重跑、题图裁剪、试题篮入口必须全部保留。

4. Markdown 预览 `/questions/collections/:id/markdown-preview`
   - 理由：导出链路关键，但页面较小。

### C 组：高风险，最后迁移

1. 题库管理 `/questions`
   - 理由：Mock 的三栏、表格、批量操作与真实后端能力不完全一致。批量打标/批量删除不可实现。

2. PDF 切分中心 `/tools/pdf-slicer`
   - 理由：上传、分离试卷、批次状态、切题复核、进入 OCR 串联多个真实流程。

3. OCR 队列 `/tools/pdf-slicer/ocr-jobs`
   - 理由：轮询、任务中断、重跑、删除都是高风险操作。

4. OCR 复核/待入库 `/tools/pdf-slicer/runs/:runId/pending-bank`
   - 理由：数据最终入库入口，涉及批量确认、重复题风险、格式风险、题图风险。

5. 批次识别结果 `/tools/pdf-slicer/runs/:runId/questions`
   - 理由：与 OCR、分类、导出和待入库跳转相连。

6. 切题复核弹窗 `SliceReviewDialog`
   - 理由：合并、拆分、删除、题图框选是真实后端动作，不可用 Mock 内存操作替代。

### 暂缓

Setup `/setup` 暂不纳入本轮主内容区迁移。它在 AppShell 之外，是首次启动关键路径，建议真实页面全部验收后单独处理。

## 四、每个页面的迁移任务卡

### 任务卡 A1：工作台首页 shadcn 主内容迁移

- 任务名称：迁移 `/workbench` 主内容区，并接入真实活动热力图。
- 涉及文件：`frontend/src/pages/workbench/TraditionalWorkbenchPage.tsx`、`OverviewTab.tsx`，必要时新增小组件到 `frontend/src/components/dashboard/`。
- 对应 Mock：`frontend/src/pages/mock/MockWorkbenchPage.tsx`、`/mock/workbench`。
- 必须保留的现有功能：
  - 题库总量/题库已导入、切题批次、OCR 队列状态。
  - 活跃切片与识别批次列表。
  - 最近录入记录。
  - OCR 引擎配置状态。
  - 点击批次进入切题复核、手动导入、OCR 导入、识别结果。
  - 数据刷新。
- 不允许实现的 mock only 功能：
  - 静态同比、假增长率。
  - 假服务状态，如写死 SQLite/KaTeX 正常。
  - 假热力图随机数据。
  - `每日一题`、`随机组卷` 如果没有真实功能，不要升级为真功能。
- 需要接入的前端 API 文件：
  - `dashboardApi.getActivityHeatmap` from `frontend/src/api/dashboard.ts`。
  - 继续使用 `pdfSlicerApi`、`questionBankApi`、`settingsApi`。
  - 如展示最近导出，使用 `exportRecordsApi.listExportRecords`。
- 主要 shadcn 组件：Card、Button、Badge、Table、Tabs 或紧凑 Segmented 控件、Skeleton、Tooltip、Alert。
- 视觉注意事项：
  - 热力图使用 neutral cell，低饱和 emerald 表示活跃，不使用亮绿。
  - 去掉当前 indigo/blue 大面积状态色，OCR 队列可用 amber/neutral。
  - 最近题目内容要比指标卡更突出。
- 技术风险：
  - 热力图日期范围、时区和空数据要处理。
  - 工作台当前调用 `quickReview` 会触发真实流程，迁移时不能改语义。
- 验收步骤：
  - 打开 `/workbench`。
  - 热力图请求 `GET /api/dashboard/activity-heatmap` 成功并显示真实 days。
  - 无数据时显示空状态，不显示随机数据。
  - 点击活跃批次、最近题目入口仍能跳转。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 A2：导出记录页视觉收敛

- 任务名称：导出记录页 shadcn 组件化清理，不照搬 Mock。
- 涉及文件：`frontend/src/pages/ExportRecordsPage.tsx`。
- 对应 Mock：`/mock/export-records`，但 Gemini 文档明确本页不要做迁移操作。
- 必须保留的现有功能：
  - 搜索、来源筛选、limit。
  - 统计卡片。
  - 导出记录列表。
  - 打开/下载文件。
  - 删除记录。
  - 恢复到当前试题篮，并保留覆盖确认、同步标题确认。
- 不允许实现的 mock only 功能：
  - Mock 本地缓存下载 alert。
  - Mock 详情弹窗中的假下载成功。
  - 任何 localStorage 导出记录。
- 需要接入的前端 API 文件：
  - `exportRecordsApi`。
  - `collectionsApi.getCollection`。
- 主要 shadcn 组件：Card、Button、Badge、Input、Select、Table、Dialog、Alert、Tooltip、Skeleton。
- 视觉注意事项：
  - PDF Badge 不要用大面积红，只保留小 Badge。
  - 当前页面有 blue/teal/indigo hover/icon 色，迁移时收敛为 neutral，成功动作小范围 emerald。
  - 表格密度保持适合扫描。
- 技术风险：
  - `handleRestoreToBasket` 是真实覆盖动作，确认逻辑不能丢。
  - 文件 URL 为空或失败状态的禁用态不能丢。
- 验收步骤：
  - 打开 `/exports`。
  - 搜索、来源筛选、limit 生效。
  - 成功记录可打开，失败记录不可打开。
  - 有题目快照的记录可恢复到试题篮。
  - 删除记录后列表局部更新。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 A3：设置页重构为纵向分组或 Tabs

- 任务名称：迁移 `/settings` 主内容区，移除左侧二级设置导航。
- 涉及文件：`frontend/src/pages/SettingsPage.tsx`，保留 `frontend/src/components/UpdateCard.tsx`。
- 对应 Mock：`/mock/settings`。
- 必须保留的现有功能：
  - 基础设置：系统名称、标题、描述、导出模板、水印、教学学段。
  - 外部工具：LibreOffice/soffice 路径与检测提醒。
  - OCR 设置：Doc2X、GLM-OCR、模型、密钥占位、并发、重试、图像宽度等。
  - 数据分类：启用状态、分类 API、模型、并发、分类 Prompt。
  - OCR Prompt：whole/chunk system/user prompt。
  - 切题规则：6 类规则、添加、删除、启用、matchMode、校验、保存发布、放弃修改、恢复默认。
  - 应用更新：继续使用 `UpdateCard`。
- 不允许实现的 mock only 功能：
  - 假 OCR 连接测试。
  - 假 LibreOffice 延迟/成功状态。
  - 假磁盘占用统计。
  - 假在线升级流程。更新只使用现有 `UpdateCard` 和 Electron preload。
  - 本地 rules state 保存，不调用 API 的规则持久化。
- 需要接入的前端 API 文件：
  - `settingsApi`。
  - `pdfSlicerApi.getRules/updateRules/validateRules`。
- 主要 shadcn 组件：Tabs、Card、Button、Badge、Input、Select、Checkbox、Textarea、Separator、Alert、Tooltip、Skeleton、Table。
- 视觉注意事项：
  - 不再做左侧二级设置导航。
  - 推荐顶部分段 Tabs 或纵向分组 Card，移动端可横向滚动 Tabs。
  - 表单 Label 紧凑，Prompt Textarea 使用 mono 字体但不做代码编辑器重设计。
- 技术风险：
  - 设置保存会派发 `app-settings-updated`，不能丢。
  - 密钥字段留空表示不修改，不能误清空。
  - 切题规则 `baseVersion` 并发语义不能改。
- 验收步骤：
  - 打开 `/settings`。
  - 修改基础字段保存后 App 标题/系统名更新。
  - 密钥字段留空保存不报错。
  - 切题规则可新增一条、校验、保存、放弃修改。
  - 未检测到 LibreOffice 时提醒仍可打开。
  - 更新卡片仍可检查更新。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 A4：学习标签库页面迁移

- 任务名称：迁移 `/learning-tags` 主内容区，保留自动保存和编辑能力。
- 涉及文件：`frontend/src/pages/LearningTagsPage.tsx`。
- 对应 Mock：无。
- 必须保留的现有功能：
  - 标签库列表读取。
  - 新增知识点标签库/方法题型标签库。
  - 默认标签库标记和默认库不可删除。
  - 直观视图和 JSON 视图切换。
  - 自动保存、手动保存、保存状态。
  - 章节/分组拖拽排序。
  - 增删章节/知识点/方法标签。
  - AI 辅助生成提示词复制和 JSON 导入。
  - 导出标签库 JSON。
- 不允许实现的 mock only 功能：
  - 无对应 Mock，不新增 AI 自动调用或在线生成。
  - 不新增后端没有的批量导入进度。
- 需要接入的前端 API 文件：
  - `learningTagsApi`。
- 主要 shadcn 组件：Card、Button、Badge、Input、Select、Textarea、Dialog、Tabs、ScrollArea、Separator、Alert、Tooltip、Skeleton。
- 视觉注意事项：
  - 页面很长，左右两栏可以保留，但 Card 不要套 Card。
  - JSON 编辑区要稳定高度，避免布局跳动。
  - 拖拽手柄用 icon button。
- 技术风险：
  - 当前 `saveLibrary` 使用 `createLibrary` 持久化，迁移时不要擅自改成 `updateLibrary`，除非先确认后端 upsert 约定。
  - 自动保存 debounce 不可被视觉重构破坏。
- 验收步骤：
  - 打开 `/learning-tags`。
  - 切换标签库、编辑字段，等待自动保存。
  - JSON 模式输入非法 JSON 时阻止保存并展示错误。
  - 新增标签库、删除非默认标签库、导出 JSON。
  - AI 辅助弹窗两步流程可复制提示词并导入 JSON。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 B1：试题篮/组卷工作台迁移

- 任务名称：迁移 `/questions/basket` 页面模式，谨慎处理全局抽屉。
- 涉及文件：`frontend/src/components/QuestionBasket.tsx`。
- 对应 Mock：`/mock/basket`。
- 必须保留的现有功能：
  - 选择当前集合。
  - 新建试卷。
  - 编辑标题、副标题、时长。
  - 计算总分和题数。
  - 单题分值编辑。
  - 拖拽排序和上移/下移。
  - 删除单题、清空集合。
  - 导出 Markdown 学生/教师版。
  - 导出 PDF 学生/教师版，模板区分 exam/worksheet。
  - 点击题目进入详情。
  - 抽屉模式仍可用。
- 不允许实现的 mock only 功能：
  - Mock 导出进度 setInterval。
  - Mock 下载成功 alert。
  - Mock localStorage 作为真实试题篮。
  - 后端没有的导出日志轮询。
- 需要接入的前端 API 文件：
  - `collectionsApi`。
- 主要 shadcn 组件：Sheet、Card、Button、Badge、Input、Select、DropdownMenu、Table 或列表、Dialog、Separator、Tooltip、ScrollArea。
- 视觉注意事项：
  - `/questions/basket` 是主内容区，可参考 Mock 的左右布局。
  - 全局抽屉属于 AppShell 附属，不要在本任务中大改。
  - 题目内容应比导出参数更突出。
- 技术风险：
  - 同一组件服务 page 和 drawer，建议先抽出小型 presentational 组件，再迁移 page mode。
  - 拖拽排序调用真实 `collectionsApi.reorder`，失败处理不能丢。
- 验收步骤：
  - 从题库加入题目后打开 `/questions/basket`。
  - 修改分值、标题、副标题、时长后刷新仍保留。
  - 拖拽和按钮排序生效。
  - Markdown 预览跳转正常。
  - PDF 导出打开返回 URL。
  - 抽屉模式仍能展开、收起、进入全屏。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 B2：题目新增页迁移

- 任务名称：迁移 `/questions/new` 主内容区。
- 涉及文件：`frontend/src/pages/questions/QuestionCreatePage.tsx`。
- 对应 Mock：无。
- 必须保留的现有功能：
  - 单题手动表单录入。
  - 单题 JSON 录入。
  - 选择题选项和答案勾选。
  - 题干、答案、解析 Markdown/LaTeX 编辑和预览。
  - LaTeX 快捷插入。
  - 整套试卷 JSON 导入。
  - 绑定切片导入和题号匹配检查。
  - JSON 清洗和错误定位。
  - AI 提示词复制。
  - 导入后进入待入库确认。
- 不允许实现的 mock only 功能：
  - 不直接调用大模型。
  - 不伪造导入成功。
  - 不跳过 JSON 校验。
- 需要接入的前端 API 文件：
  - `questionBankApi`。
  - `pdfSlicerApi`。
- 主要 shadcn 组件：Card、Button、Badge、Input、Select、Textarea、Tabs、Dialog、Alert、Separator、Tooltip、ScrollArea。
- 视觉注意事项：
  - 表单工具栏紧凑，不做大 hero。
  - 题干/解析编辑和预览是视觉主角。
  - JSON 错误提示使用 amber/red 小面积 Alert。
- 技术风险：
  - `paperJsonStatus`、`slicePairStatus` 和 `canImportPaper` 逻辑不能因布局拆分而重复计算错误。
  - 从 URL query 自动切换模式的逻辑必须保留。
- 验收步骤：
  - `/questions/new` 可手动创建单题。
  - 单题 JSON 可创建。
  - 整套 JSON 可导入并返回 pendingBankUrl。
  - 绑定切片导入时题号冲突会阻止导入。
  - AI 提示词弹窗复制正常。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 B3：题目详情页迁移

- 任务名称：迁移 `/questions/:id` 主内容区。
- 涉及文件：`frontend/src/pages/questions/QuestionDetailPage.tsx`、`EditDialog.tsx`、`FigureDialogs.tsx`、`QuestionContent.tsx`。
- 对应 Mock：无直接 Mock，右侧编辑/预览结构可参考 `/mock/ocr-review`。
- 必须保留的现有功能：
  - 左侧元数据。
  - 中间题目内容和答案解析。
  - 编辑题目。
  - 重新 OCR 和分块 OCR。
  - OCR 进度状态轮询。
  - 加入试题篮。
  - 框选题图、更新题图、删除题图。
  - 删除题目。
- 不允许实现的 mock only 功能：
  - 假 OCR 成功。
  - 假框选保存。
  - 假标签选择器。
- 需要接入的前端 API 文件：
  - `questionBankApi`。
  - `ocrApi`。
  - `collectionsApi` via basket util。
- 主要 shadcn 组件：Card、Button、Badge、Dialog、Tabs、Textarea、Alert、Tooltip、Skeleton、Separator、ScrollArea。
- 视觉注意事项：
  - 题目内容和题图展示要居中成为主角。
  - 右侧操作栏要紧凑，危险操作独立分组。
  - 解题方法标签当前有 indigo 色，迁移时改 neutral。
- 技术风险：
  - Doc2X 单题重跑禁用逻辑不可丢。
  - OCR 轮询 interval 要清理。
  - 保存成功后必须 reload 或同步 state。
- 验收步骤：
  - 打开任一题详情。
  - 编辑并保存题干或标签。
  - 加入试题篮。
  - 有 sourceRunId 的题能触发重新 OCR 状态。
  - 框选题图弹窗能保存并刷新。
  - 删除需确认并跳回题库。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 B4：Markdown 预览页迁移

- 任务名称：迁移 Markdown/打印预览页。
- 涉及文件：`frontend/src/pages/questions/MarkdownPreviewPage.tsx`。
- 对应 Mock：无。
- 必须保留的现有功能：
  - 学生版/教师版切换。
  - Markdown 源码/渲染预览切换。
  - 打印/导出 A4 PDF。
  - 返回上一页。
  - print CSS。
- 不允许实现的 mock only 功能：
  - 不新增假 LaTeX/PDF 预览。
  - 不伪造下载。
- 需要接入的前端 API 文件：
  - `collectionsApi.exportCollection`。
- 主要 shadcn 组件：Card、Button、Tabs、Alert、Skeleton、ScrollArea、Tooltip。
- 视觉注意事项：
  - 渲染文章区域保持白底可打印。
  - 源码区域可使用 neutral 深色 code block，但不要影响 print。
- 技术风险：
  - print CSS 可能受 AppShell 样式影响，迁移后需实际打印预览。
  - query param `variant` 切换必须保留。
- 验收步骤：
  - 从试题篮进入 Markdown 预览。
  - 学生版/教师版请求不同内容。
  - 源码和渲染切换正常。
  - `window.print()` 打印区域不包含 AppShell。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 C1：题库管理页迁移

- 任务名称：迁移 `/questions` 为 Mock 对齐的题库管理主内容，但只实现真实功能。
- 涉及文件：`frontend/src/pages/questions/QuestionBankPage.tsx`、`WorkbenchQuestionCard.tsx`、`QuestionContent.tsx`、`EditDialog.tsx`、`FigureDialogs.tsx`。
- 对应 Mock：`/mock/question-bank`。
- 必须保留的现有功能：
  - 关键词搜索。
  - 学段、题型、难度、知识点、解题方法筛选。
  - 分页。
  - 题目卡片查看。
  - 编辑、删除、详情、加入试题篮、框选题图。
  - KaTeX/Markdown 和题图渲染。
  - Header 中的重置筛选、新增题目入口。
- 不允许实现的 mock only 功能：
  - 使用 `INITIAL_MOCK_QUESTIONS`。
  - 使用 `mock_question_basket` 或 localStorage 作为真实试题篮。
  - 批量打标签 alert。
  - 后端不存在的批量删除。
  - 假右侧预览数据。
- 需要接入的前端 API 文件：
  - `questionBankApi`。
  - `learningTagsApi`。
  - `collectionsApi` via basket util。
- 主要 shadcn 组件：Card、Button、Badge、Input、Select、Checkbox、Tabs、Table、Sheet、Dialog、DropdownMenu、Separator、ScrollArea、Skeleton、Tooltip、Alert。
- 视觉注意事项：
  - 可以迁移为左筛选、中列表、右预览，但右预览必须读取当前真实 item。
  - 卡片/表格双视图可以做纯前端展示切换。
  - 批量操作条只放真实可做的操作，如逐条加入试题篮；批量打标/删除暂不做。
- 技术风险：
  - `QuestionBankResponse` 当前分页来自 API，表格视图不能一次性假设全量数据。
  - 批量操作如逐条 addItem 需处理重复、失败和 loading。
  - AppPageHeader actions 已在 AppShell 中提供，不要新增第二套页面顶栏。
- 验收步骤：
  - `/questions` 搜索和各筛选项生效。
  - 卡片/表格视图展示同一数据。
  - 右侧预览点击不同题目更新。
  - 编辑、删除、详情、加入试题篮、框选题图全部可用。
  - 无后端批量接口的按钮不出现或明确禁用。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 C2：PDF 切分中心迁移

- 任务名称：迁移 `/tools/pdf-slicer` 主内容区。
- 涉及文件：`frontend/src/pages/pdf-slicer/PdfSlicerPage.tsx`、`RunCard.tsx`、`SliceReviewDialog.tsx`、`ReviewFigureEditor.tsx`、`frontend/src/components/pdf-slicer/**`。
- 对应 Mock：无完整页面 Mock；切题复核参考 `/mock/dialogs`。
- 必须保留的现有功能：
  - PDF/DOC/DOCX 上传。
  - LibreOffice 缺失时拦截 Word 文件。
  - 自动识别、讲义、试卷上传模式。
  - 分离原卷+解析上传。
  - 批次/运行列表。
  - 自动刷新活跃任务。
  - 启动切题、进入复核、进入 OCR、进入待入库。
  - 切题复核弹窗中的通过、合并、拆分、删除、题号修改、题图关联。
- 不允许实现的 mock only 功能：
  - 纯前端假拆分线。
  - React 内存假合并/删除。
  - SVG 假试题图片。
  - 假上传进度。
- 需要接入的前端 API 文件：
  - `pdfSlicerApi`。
  - `ocrApi`。
  - `settingsApi`。
- 主要 shadcn 组件：Card、Button、Badge、Input、Select、Tabs、Dialog、Table、Alert、Separator、ScrollArea、Skeleton、Tooltip。
- 视觉注意事项：
  - 上传区紧凑，避免营销式大 Dropzone。
  - 任务列表使用高密度信息卡或表格。
  - 状态色：running/queued 使用 amber/neutral，success 小范围 emerald，failed red。
- 技术风险：
  - 上传 FormData 字段 `files`、`fileRolesJson`、`materialType`、`fileRole` 不能改。
  - Word 拦截依赖 `fileListHasWord` 和 `sofficeAvailable`。
  - 当前 `PdfSlicerPage.tsx` 代码中存在一个多余的 `>` 标记，迁移前 build 会暴露该问题，修复需作为本任务内最小修复。
- 验收步骤：
  - 上传 PDF。
  - Word 文件在无 LibreOffice 时被拦截并显示提醒。
  - 分离原卷+解析上传 FormData 正确。
  - 活跃 run 自动刷新。
  - RunCard 操作入口仍可用。
  - 切题复核弹窗能读取真实切片。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 C3：OCR 队列迁移

- 任务名称：迁移 `/tools/pdf-slicer/ocr-jobs`。
- 涉及文件：`frontend/src/pages/ocr/OcrQueuePage.tsx`、`OcrJobCard.tsx`、`OcrHistoryRow.tsx`。
- 对应 Mock：无直接 Mock。
- 必须保留的现有功能：
  - summary 统计。
  - 当前运行任务。
  - 排队任务。
  - 历史任务表。
  - 进度条和 provider phase。
  - 启动 OCR、完全重跑、断点续跑、强制中断、删除任务。
  - 进入识别题目、进入待入库。
  - 定时刷新。
- 不允许实现的 mock only 功能：
  - 假进度。
  - 假日志。
  - 不调用 API 的重跑/中断状态切换。
- 需要接入的前端 API 文件：
  - `ocrApi`。
  - `pdfSlicerApi.deleteRun`。
- 主要 shadcn 组件：Card、Button、Badge、Table、Progress、Alert、DropdownMenu、Tooltip、Skeleton。
- 视觉注意事项：
  - 运行中任务可以突出，但不使用高饱和绿色动效。
  - 历史任务表要保持扫描效率。
- 技术风险：
  - 轮询 interval 清理。
  - 中断/删除是危险操作，确认和禁用态要明确。
  - Doc2X/GLM provider phase 文案不能丢。
- 验收步骤：
  - 打开 OCR 队列。
  - summary、运行中、排队、历史都能展示。
  - 运行中进度每 2-4 秒刷新。
  - 重跑/续跑/中断/删除调用真实 API。
  - 待入库和识别结果跳转正确。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 C4：待入库/OCR 复核页面迁移

- 任务名称：迁移 `/tools/pdf-slicer/runs/:runId/pending-bank`。
- 涉及文件：`frontend/src/pages/PendingBankPage.tsx`、`EditDialog.tsx`、`FigureDialogs.tsx`、`QuestionContent.tsx`。
- 对应 Mock：`/mock/ocr-review`，但只能作为布局参考。
- 必须保留的现有功能：
  - 批次概览和状态统计。
  - `all/ready/blocked/banked/skipped/ocr_failed/has_figures` 筛选。
  - 左侧待入库列表。
  - 右侧识别结果/原图 OCR 图块切换。
  - 题干、答案、解析、元数据展示。
  - 格式风险、题图风险、公式风险提示。
  - 疑似重复对比弹窗。
  - 单题确认入库、编辑、框选题图、重跑 OCR、跳过、删除。
  - 批量确认入库、批量跳过、批量删除。
  - 全部入库。
  - readOnly failure 手动补录。
- 不允许实现的 mock only 功能：
  - SVG 假原图。
  - 假保存并下一题 alert。
  - 假暂存本地缓存。
  - 假框选题图。
  - 不调用 API 的队列状态切换。
- 需要接入的前端 API 文件：
  - `pendingBankApi`。
  - `questionBankApi`。
- 主要 shadcn 组件：Card、Button、Badge、Checkbox、Tabs、Dialog、DropdownMenu、Textarea、Table、Alert、Separator、ScrollArea、Skeleton、Tooltip。
- 视觉注意事项：
  - 三栏工作区可以参考 Mock，但真实页面目前是左列表+右预览，迁移时不要牺牲可读性。
  - OCR 原图和识别文本是视觉主角。
  - 底部批量操作条紧凑，危险操作放 DropdownMenu。
- 技术风险：
  - 入库动作会改变真实数据库状态，必须保留确认流程。
  - 疑似重复和题图风险确认不能跳过。
  - `pendingBankReadOnly` 的手动候选创建逻辑不能丢。
- 验收步骤：
  - 打开一个待入库 run。
  - 每个筛选 tab 计数正确。
  - 单题确认、跳过、删除、重跑 OCR 调用真实 API。
  - 批量确认/跳过/删除可用。
  - 疑似重复时出现对比弹窗。
  - 有题图风险时出现确认。
  - 编辑保存后列表刷新。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 C5：批次识别结果页迁移

- 任务名称：迁移 `/tools/pdf-slicer/runs/:runId/questions`。
- 涉及文件：`frontend/src/pages/questions/RunQuestionsPage.tsx`、`WorkbenchQuestionCard.tsx`、`RunExportDialog.tsx`。
- 对应 Mock：无直接 Mock。
- 必须保留的现有功能：
  - 批次标题与 runId。
  - 数据分类。
  - 导出批次。
  - 返回、刷新。
  - 跳转待入库。
  - 搜索和标签筛选。
  - 题目列表，编辑、删除、加入试题篮。
- 不允许实现的 mock only 功能：
  - 假分类报告。
  - 假导出。
- 需要接入的前端 API 文件：
  - `questionBankApi.listRunQuestions/deleteItem`。
  - `pdfSlicerApi.classifyRunQuestions`。
  - `learningTagsApi.getQuestionBankTagLibraries`。
  - `exportRecordsApi.exportRunBatch` via `RunExportDialog`。
- 主要 shadcn 组件：Card、Button、Badge、Input、Select、Dialog、Table/List、Alert、Skeleton、Tooltip。
- 视觉注意事项：
  - 作为 OCR 后结果页，题目内容仍应主导。
  - 工具栏不要过高。
- 技术风险：
  - `localItems` 用于本地替换保存后的题目，迁移时不要破坏。
  - 分类操作有 loading 和 report 文案，需保留。
- 验收步骤：
  - 打开 run questions 页面。
  - 筛选和搜索生效。
  - 编辑题目后列表更新。
  - 数据分类成功后展示报告。
  - 导出批次弹窗可用。
  - 跳转待入库正确。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 C6：切题复核弹窗迁移

- 任务名称：迁移真实 `SliceReviewDialog`，只保留真实后端动作。
- 涉及文件：`frontend/src/pages/pdf-slicer/SliceReviewDialog.tsx`、`ReviewFigureEditor.tsx`。
- 对应 Mock：`/mock/dialogs` 中切题复核弹窗和框选题图弹窗。
- 必须保留的现有功能：
  - 读取真实切片列表。
  - 多选切片。
  - 合并切片。
  - 删除切片。
  - 拆分切片。
  - 修改题号。
  - 题图框选/关联。
  - 提交 quick review。
  - readonly 模式。
- 不允许实现的 mock only 功能：
  - React state 假合并/拆分。
  - SVG 假切片。
  - 假红线拖拽后只改前端数组。
  - 假截图保存。
- 需要接入的前端 API 文件：
  - `pdfSlicerApi.getSliceReviewItems/quickReview/deleteSliceReviewItem/mergeSliceReviewItems/splitSliceReviewItem/updateSliceReviewItem/updateSliceReviewItemFigures`。
- 主要 shadcn 组件：Dialog、Card、Button、Badge、Checkbox、Input、Select、Alert、Separator、ScrollArea、Tooltip。
- 视觉注意事项：
  - 弹窗内画布要给足空间，切片原图清晰展示。
  - 工具按钮用图标加 tooltip。
  - 不做过强遮罩或大阴影。
- 技术风险：
  - 合并/拆分/删除会改变真实切片结果，需要 loading、错误、reload。
  - bbox 坐标和 splitRatio 不可因缩放计算错误。
- 验收步骤：
  - 从工作台或 PDF 切分中心打开复核弹窗。
  - 切片图真实加载。
  - 修改题号、合并、拆分、删除后列表刷新。
  - 题图关联保存后可见。
  - 提交通过后能进入 OCR 或手动导入。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

### 任务卡 D1：Setup 页面后续迁移

- 任务名称：评估并迁移 `/setup`。
- 涉及文件：`frontend/src/pages/SetupPage.tsx`。
- 对应 Mock：无。
- 是否纳入本轮：不建议纳入本轮。它在 AppShell 之外，属于首次启动关键路径。
- 必须保留的现有功能：
  - 初始化配置。
  - 系统名称、标题、描述。
  - 导出模板、教学学段。
  - LibreOffice 健康检查。
  - 保存后设置 `setupCompleted: true` 并跳转 `/workbench`。
- 不允许实现的 mock only 功能：
  - 无。
- 需要接入的前端 API 文件：
  - `settingsApi.getHealth/updateSettings`。
- 主要 shadcn 组件：Card、Button、Input、Textarea、Checkbox、Alert、Separator。
- 视觉注意事项：
  - 这是设置向导，不是 landing page。
  - 不要新增 hero 或营销文案。
- 技术风险：
  - 首次启动阻塞整个 App，任何保存 bug 都会让用户进不了主界面。
- 验收步骤：
  - 清空或模拟 `setupCompleted=false`。
  - 打开 `/setup`。
  - 保存后进入 `/workbench`。
  - 刷新后不再强制进入 setup。
  - 运行 `npm run build:frontend` 和 `npx tsc -p frontend/tsconfig.json`。

## 五、推荐执行顺序

不要立刻执行。后续每次只取一个任务卡或一个小批次。

1. 前端 API 分组确认
   - 运行散点 API 扫描。
   - 确认 `frontend/src/api` 已覆盖本次任务需要的方法。
   - 不改后端路径，不新增 mock only API。

2. 工作台热力图接真实 API
   - 先完成 `dashboardApi.getActivityHeatmap` 在 `/workbench` 的接入。
   - 验收热力图真实数据、空数据和 loading。

3. A 组低风险页面迁移
   - A1 工作台首页。
   - A2 导出记录页，只做必要视觉收敛，不照搬 Mock。
   - A3 设置页，移除左侧二级设置导航，改为 Tabs 或纵向分组 Card。
   - A4 学习标签库，按子区域小步迁移。

4. B 组中风险页面迁移
   - B4 Markdown 预览页。
   - B1 试题篮页面模式，先不大改抽屉。
   - B2 题目新增页。
   - B3 题目详情页。

5. C 组高风险页面迁移
   - C5 批次识别结果页。
   - C3 OCR 队列。
   - C2 PDF 切分中心。
   - C6 切题复核弹窗。
   - C4 待入库/OCR 复核页。
   - C1 题库管理页最后迁移，因为 Mock 和真实能力差异最大。

6. 清理 Mock 和旧组件
   - 真实页面全量验收前，不删除 `/mock/*`。
   - 验收完成后再单独开任务删除 Mock 路由、Mock 数据、Mock 页面和不再使用的旧组件。

7. 全量验收
   - 执行全局构建、类型检查、后端编译或项目现有检查命令。
   - 完成端到端人工流程验收。

## 六、Codex 执行规则

后续把本文件交给 Codex 分任务执行时，必须写入每个执行回合：

- 每次只执行一个任务卡或一个小批次。
- 每次执行前先说明将改哪些文件。
- 每次执行后说明改了哪些文件。
- 每次执行后运行 `typecheck` / `build`。
- 如果无法运行检查，必须说明原因。
- 如果发现设计稿和现有功能冲突，先停止并列出冲突，不要擅自删除功能。
- 如果设计稿中有 mock only 功能，不要实现。
- 不要新增第二套 Sidebar、Topbar、AppShell。
- 不要自行发挥设计。
- 不要修改 `server` 目录。
- 不要修改数据库结构。
- 不要修改后端 API 路径。
- 不要修改 Sidebar。
- 不要修改 Topbar。
- 不要修改 AppShell。
- 不要把 API URL 继续散落在页面组件里。
- 不要删除现有真实功能入口。
- 旧 Mock 暂时保留到真实页面验收完成后再删除。

建议每次执行后的最小检查：

```bash
npx tsc -p frontend/tsconfig.json
npm run build:frontend
```

涉及高风险流程后再补：

```bash
npm run build:server
npm run test:routes
```

## 七、验收标准

### 7.1 全局命令验收

全量迁移完成后运行：

```bash
npm run build:frontend
npx tsc -p frontend/tsconfig.json
npm run build:server
```

如要做后端路由契约确认，再运行：

```bash
npm run test:routes
```

如果某条命令失败，必须记录：

- 失败命令。
- 失败原因。
- 是否与本次迁移相关。
- 后续修复任务卡。

### 7.2 全局功能验收

- 工作台可打开。
- 热力图显示真实 `GET /api/dashboard/activity-heatmap` 数据。
- 题库列表可搜索筛选。
- 题目详情可编辑并保存。
- 题目可加入试题篮。
- 试题篮可调整顺序、分值、标题、副标题、时长。
- 试题篮可导出 Markdown/PDF。
- PDF 切题流程可用。
- 切题复核弹窗可读取真实切片并提交。
- OCR 队列可用，进度可刷新。
- OCR 重跑、中断、续跑等操作调用真实 API。
- OCR 复核/待入库可保存并进入下一步流程。
- 待入库可批量确认。
- 待入库可批量跳过、批量删除。
- 单题 OCR 重跑可用。
- 导出记录可查看、打开、删除、恢复到试题篮。
- 设置可保存。
- 学习标签库可读取、新增、编辑、删除非默认库、自动保存。
- Markdown 预览可切换学生/教师版，源码/渲染切换正常。
- Setup 暂缓；若后续迁移，首次启动流程必须可用。

### 7.3 代码质量验收

- 不出现大量 `any`。
- 不出现大量非空断言 `!`。
- 页面中不再大量直接拼复杂 API URL。
- 新增 API 调用进入 `frontend/src/api` 对应业务文件。
- 不新增第二套 layout。
- 不新增第二套设计系统。
- 不把 Mock localStorage 流程带入真实路由。
- 不实现后端不存在的 mock only 功能。
- 旧 Mock 暂时保留到真实页面验收完成后再删除。

### 7.4 视觉验收

- 页面接近 shadcn/ui official Blocks。
- 主色为 neutral/zinc。
- 成功 emerald、警告 amber、危险 red 都是小面积状态色。
- 不使用 emoji。
- 不使用大渐变。
- 不使用玻璃拟态。
- 不使用高饱和蓝紫和亮绿色。
- 不使用大面积阴影。
- Card 为 `border rounded-xl shadow-sm`。
- 工具栏紧凑。
- 内容层级清晰。
- 题目内容、OCR 识别文本、PDF/切片原图是视觉主角。
- 移动端文字不溢出按钮、卡片和工具栏。

