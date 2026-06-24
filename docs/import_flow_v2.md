Question Manager 导入流程 v2 重构规划书

一、重构背景

当前项目已经具备 PDF 切题、OCR、人工复核、题库维护、组卷、导出等能力。现有 README 中的项目定位是本地优先的数学题库桌面工具，技术栈为 Electron、React、Express、SQLite 和 Python，支持 macOS 与 Windows。

随着 Doc2X 和 GLM-OCR 的能力确认，原先“先切题，再 OCR”的默认流程需要调整。Doc2X 和 GLM-OCR 都可以承担整卷文档解析任务，尤其 GLM-OCR 已明确支持 PDF、图片输入，并能输出 Markdown、图片链接、布局信息和结构化结果。因此，默认流程不应再强制用户进入人工或自动切题流程。

新的产品主线应调整为：

资料导入 → 整卷 OCR → 题号切分 → 题目候选 → 待入库确认 → 异常题目手动修正 → 正式入库

本次重构目标不是重写整个项目，而是重构导入主流程和模块边界，使现有切题、人工标注、题图框选能力转为异常修正能力。

二、重构目标

本次重构命名为“导入流程 v2 重构”。

核心目标：

1. 将默认入口从“PDF 切分中心”调整为“资料导入”。
2. 将默认流程从“先切题再 OCR”调整为“先整卷 OCR，再按题号切分”。
3. 新增统一中间结构 OCRDocument，承接 Doc2X、GLM-OCR、未来其他 OCR 提供方的返回结果。
4. 新增 QuestionCandidate 结构，作为待入库题目的统一来源。
5. 将人工切题、手动标注、BBoxCanvas、题图框选保留为异常题目的修正入口。
6. 保留现有题库、标签、试题篮、导出、更新、设置等成熟功能。
7. 降低后续维护成本，避免 OCR 提供方、切题逻辑、待入库页面、题库入库逻辑互相缠绕。

三、不做事项

本次重构不做以下事情：

1. 不重写整个项目。
2. 不删除现有题库数据结构。
3. 不删除现有手动标注工作台。
4. 不重写导出、标签、试题篮模块。
5. 不在第一阶段追求完整 UI 改版。
6. 不把 Doc2X 或 GLM-OCR 的原始返回直接写死为题库结构。
7. 不把所有异常处理一次性做完。

四、现有可保留资产

以下模块应保留并逐步接入新流程：

1. 题库模块
    question_bank_items、question_bank_collections、question_bank_collection_items、question_bank_export_records 应继续保留。
2. 待入库确认模块
    PendingBank 继续作为入库前确认页面，但后续数据来源应从“切题 OCR 结果”扩展为 QuestionCandidate。
3. 人工标注模块
    annotation_sessions 和 annotation_regions 已支持 question、solution、shared_answer_key 三种区域类型，适合保留为异常修正能力。
4. BBoxCanvas 与题图框选
    当前已经支持画框、移动、缩放、删除和键盘微调，可作为题图补充、题干范围修正、解析范围修正的底层组件。
5. OCR 设置与后台任务能力
    已存在 OCR provider 配置、后台任务状态、进度和结果导入机制，应保留并逐步调整为 OCRDocument 产物。
6. 桌面应用数据目录策略
    当前桌面版数据写入用户数据目录，Windows 安装器配置了卸载不删除 AppData，应继续保持，避免升级丢数据。

五、新核心概念

1. SourceDocument

SourceDocument 表示用户上传的一份原始资料。

它只回答一个问题：这份资料是什么，原始文件在哪里，解析状态如何。

建议字段：

type SourceDocument = {
  id: string
  title: string
  originalFileName: string
  filePath: string
  fileType: 'pdf' | 'image' | 'markdown' | 'json'
  pageCount?: number
  provider?: 'doc2x' | 'glm' | 'manual' | 'json'
  status: 'uploaded' | 'ocr_running' | 'ocr_succeeded' | 'ocr_failed' | 'parsed' | 'partially_parsed'
  createdAt: string
  updatedAt: string
}

2. OCRDocument

OCRDocument 是统一的 OCR 中间结构。

Doc2X、GLM-OCR 的原始返回都先转成 OCRDocument，再交给题目解析器处理。

建议字段：

type OCRDocument = {
  id: string
  sourceDocumentId: string
  provider: 'doc2x' | 'glm'
  rawResultPath: string
  markdown: string
  pages: OCRPage[]
  assets: OCRAsset[]
  metadata: Record<string, unknown>
  createdAt: string
}
type OCRPage = {
  pageNo: number
  width: number
  height: number
  blocks: OCRBlock[]
}
type OCRBlock = {
  id: string
  pageNo: number
  type: 'text' | 'formula' | 'image' | 'table' | 'unknown'
  content: string
  bbox?: [number, number, number, number]
  markdownStart?: number
  markdownEnd?: number
  assetId?: string
  confidence?: number
}
type OCRAsset = {
  id: string
  type: 'image' | 'table_image' | 'page_image' | 'crop'
  path: string
  pageNo?: number
  bbox?: [number, number, number, number]
  sourceBlockId?: string
}

设计要求：

1. OCRDocument 必须保留原始 OCR 返回路径。
2. OCRDocument 必须保留 Markdown。
3. OCRDocument 应尽量保留页面、块、坐标、图片资源。
4. OCRDocument 不直接等于题库题目。

3. QuestionCandidate

QuestionCandidate 是待入库题目的统一结构。

它可以来自 Doc2X、GLM-OCR、手动框选、JSON 导入，后续 PendingBank 只面对 QuestionCandidate。

建议字段：

type QuestionCandidate = {
  id: string
  sourceDocumentId: string
  ocrDocumentId?: string
  questionNo: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  questionType?: string
  difficultyScore10?: number
  difficultyLabel?: string
  knowledgePoints: string[]
  solutionMethods: string[]
  figures: CandidateFigure[]
  sourceRefs: CandidateSourceRef[]
  status: 'ready' | 'needs_review' | 'needs_manual_fix' | 'blocked'
  issues: CandidateIssue[]
  createdAt: string
  updatedAt: string
}
type CandidateFigure = {
  id: string
  usage: 'stem' | 'analysis' | 'option' | 'unknown'
  path: string
  sourceBlockId?: string
  pageNo?: number
  bbox?: [number, number, number, number]
  inlineMarker?: string
}
type CandidateSourceRef = {
  pageNo: number
  blockIds: string[]
  bbox?: [number, number, number, number]
  kind: 'stem' | 'answer' | 'analysis' | 'figure' | 'unknown'
}
type CandidateIssue = {
  code:
    | 'missing_question_no'
    | 'duplicate_question_no'
    | 'missing_stem'
    | 'missing_answer'
    | 'missing_analysis'
    | 'unmatched_solution'
    | 'unplaced_figure'
    | 'possible_cross_page'
    | 'formula_parse_error'
    | 'markdown_render_error'
    | 'manual_review_required'
  severity: 'warning' | 'error'
  message: string
  relatedBlockIds?: string[]
}

六、新模块划分

1. source-documents

职责：

1. 上传 PDF 或图片。
2. 保存原始文件。
3. 创建 SourceDocument。
4. 查询资料列表、资料详情、处理状态。

建议路径：

server/src/routes/source-documents.ts
server/src/services/source-documents/
server/src/repositories/source-documents.repo.ts

2. ocr-providers

职责：

1. 统一 Doc2X、GLM-OCR 的调用。
2. 保存原始 OCR 返回。
3. 将不同 provider 的返回转成 OCRDocument。

建议路径：

server/src/services/ocr-providers/doc2x.provider.ts
server/src/services/ocr-providers/glm.provider.ts
server/src/services/ocr-providers/ocr-document.normalizer.ts
server/src/types/ocr-document.ts

3. question-parser

职责：

1. 从 OCRDocument.markdown 中识别题号。
2. 按题号切分题目候选。
3. 尝试识别题干、选项、答案、解析。
4. 关联 OCRBlock、图片、公式、表格。
5. 输出 QuestionCandidate[]。

建议路径：

server/src/services/question-parser/
server/src/services/question-parser/question-number-detector.ts
server/src/services/question-parser/markdown-question-splitter.ts
server/src/services/question-parser/solution-matcher.ts
server/src/services/question-parser/figure-linker.ts
server/src/types/question-candidate.ts

4. candidate-validator

职责：

1. 检查题号是否连续。
2. 检查题干是否为空。
3. 检查答案和解析是否缺失。
4. 检查图片是否被放入题干或解析。
5. 检查 Markdown 和公式是否可渲染。
6. 决定 candidate 状态。

建议路径：

server/src/services/candidate-validator/

5. pending-bank v2

职责：

1. 显示 QuestionCandidate。
2. 支持确认入库。
3. 支持编辑题干、答案、解析、标签、题图。
4. 支持进入手动修正。
5. 支持单题重新 OCR。

要求：

PendingBank 不应只理解 pdf_slicer_review_items。它应该理解 QuestionCandidate，并且只在需要时回溯 SourceDocument / OCRDocument / manual annotation。

6. manual-annotation

职责：

1. 保留现有人工标注工作台。
2. 改为从 candidate 的异常操作进入。
3. 支持修正题干范围、解析范围、公共答案区、题图。
4. 修正完成后生成或更新 QuestionCandidate，而不是直接改变默认导入流程。

七、数据库迁移建议

第一阶段不建议删除旧表。新增表即可。

建议新增：

CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  original_file_name TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  file_type TEXT NOT NULL DEFAULT 'pdf',
  page_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ocr_documents (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  raw_result_path TEXT NOT NULL DEFAULT '',
  markdown_path TEXT NOT NULL DEFAULT '',
  blocks_json_path TEXT NOT NULL DEFAULT '',
  assets_json_path TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS question_candidates (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL,
  ocr_document_id TEXT NOT NULL DEFAULT '',
  question_no TEXT NOT NULL DEFAULT '',
  stem_markdown TEXT NOT NULL DEFAULT '',
  answer_text TEXT NOT NULL DEFAULT '',
  analysis_markdown TEXT NOT NULL DEFAULT '',
  question_type TEXT NOT NULL DEFAULT '',
  difficulty_score_10 INTEGER NOT NULL DEFAULT 0,
  difficulty_label TEXT NOT NULL DEFAULT '',
  knowledge_points_json TEXT NOT NULL DEFAULT '[]',
  solution_methods_json TEXT NOT NULL DEFAULT '[]',
  figures_json TEXT NOT NULL DEFAULT '[]',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'needs_review',
  issues_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE CASCADE
);

保留旧表：

pdf_slicer_batches
pdf_slicer_runs
pdf_slicer_review_items
pdf_slicer_solution_items
pdf_slicer_annotation_sessions
pdf_slicer_annotation_regions
question_bank_items
question_bank_collections
question_bank_export_records

旧表用途：

1. 继续兼容旧流程。
2. 暂时支撑人工标注。
3. 避免一次性迁移造成数据丢失。
4. 后续稳定后再考虑合并或废弃部分旧表。

八、API 设计

1. 资料上传

POST /api/source-documents

返回：

{
  "sourceDocument": {}
}

2. 启动 OCR

POST /api/source-documents/:id/ocr

请求：

{
  "provider": "glm"
}

返回：

{
  "jobId": "...",
  "sourceDocumentId": "...",
  "status": "ocr_running"
}

3. 查询 OCR 状态

GET /api/source-documents/:id/ocr-status

返回：

{
  "status": "ocr_succeeded",
  "progress": 1,
  "ocrDocumentId": "..."
}

4. 生成题目候选

POST /api/ocr-documents/:id/parse-candidates

返回：

{
  "candidateCount": 18,
  "readyCount": 13,
  "needsReviewCount": 4,
  "blockedCount": 1
}

5. 查询题目候选

GET /api/source-documents/:id/candidates

6. 更新题目候选

PATCH /api/question-candidates/:id

7. 确认入库

POST /api/question-candidates/:id/commit

或批量：

POST /api/question-candidates/commit

8. 进入手动修正

POST /api/question-candidates/:id/manual-fix-session

返回：

{
  "sessionId": "...",
  "url": "/tools/import/candidates/.../manual-fix"
}

九、前端页面调整

1. 新主入口

将“PDF 切分中心”在导航中调整为“资料导入”。

页面结构：

资料导入
├─ 上传资料
├─ OCR 识别中
├─ 待确认题目
├─ 异常题目
└─ 历史导入

2. 资料导入页面

页面需要显示：

1. 上传区域。
2. OCR 提供方选择：Doc2X / GLM-OCR。
3. 识别进度。
4. 识别完成后的题目候选概览。
5. 进入待确认按钮。

3. 待确认题目页面

每张题目卡片显示：

1. 题号。
2. 题干。
3. 选项。
4. 答案。
5. 解析。
6. 题图。
7. 来源页码。
8. 异常提示。
9. 操作按钮：确认入库、编辑、修正范围、补充题图、重新识别。

4. 手动修正页面

复用现有 AnnotationWorkbench 和 BBoxCanvas。

入口文案应改为：

修正题目范围
修正解析范围
补充题图
修正公共答案区

避免让普通用户感知“切题”这个内部技术动作。

十、重构阶段安排

第 0 阶段：冻结与备份

目标：

1. 从 main 创建分支：import-flow-v2。
2. 保留当前 main 可用版本。
3. 不在 main 上继续堆导入链路功能。
4. 记录当前可运行命令和测试命令。

验收：

npm run build
npm run test:smoke
npm run test:math-render

能运行则进入下一阶段。

第 1 阶段：新增类型与数据表

目标：

1. 新增 SourceDocument、OCRDocument、QuestionCandidate 类型。
2. 新增三张表。
3. 新增 repository 基础增删改查。
4. 不改旧流程。

验收：

1. 应用能启动。
2. 旧 PDF 切分中心能正常进入。
3. 题库页面能正常进入。
4. 新表能自动创建。
5. 空数据下 smoke test 通过。

第 2 阶段：OCRDocument normalizer

目标：

1. 新增 GLM-OCR normalizer。
2. 新增 Doc2X normalizer。
3. 两者统一输出 OCRDocument。
4. 原始返回必须完整保存。

验收：

1. 给定一份模拟 GLM-OCR 返回，能生成 markdown、pages、blocks、assets。
2. 给定一份模拟 Doc2X 返回，能生成同样结构。
3. normalizer 单元测试通过。
4. 不要求立刻接真实 API。

第 3 阶段：QuestionCandidate parser

目标：

1. 从 OCRDocument.markdown 按题号切分。
2. 生成 QuestionCandidate。
3. 根据 layout blocks 建立 sourceRefs。
4. 初步关联图片、公式、表格。
5. 暂不追求复杂卷面全部完美。

题号识别先支持：

1.
1、
（1）
第1题
一、选择题 下的 1.

验收：

1. 输入一份模拟数学试卷 Markdown。
2. 能生成多道 candidate。
3. 每道 candidate 有 questionNo、stemMarkdown。
4. 答案解析能匹配则填入，不能匹配则生成 issue。
5. 题号重复、题号缺失、空题干能生成 issue。

第 4 阶段：PendingBank v2 最小闭环

目标：

1. 新增或改造待入库页面，使其可以显示 QuestionCandidate。
2. 支持单题确认入库。
3. 入库后写入现有 question_bank_items。
4. 保留旧 PendingBank 能力，暂时兼容旧来源。

验收：

1. 上传或导入模拟 OCRDocument。
2. 生成 candidates。
3. 页面显示候选题。
4. 点击确认入库后，题目出现在题库页面。
5. 题干、答案、解析、题图字段不丢失。

第 5 阶段：真实 OCR 接入

目标：

1. 将 GLM-OCR 接入 SourceDocument OCR 流程。
2. 将 Doc2X 接入 SourceDocument OCR 流程。
3. OCR 完成后自动创建 OCRDocument。
4. OCRDocument 创建后可手动触发 parse-candidates。

验收：

1. 一份真实 PDF 可以通过 GLM-OCR 生成 OCRDocument。
2. 一份真实 PDF 可以通过 Doc2X 生成 OCRDocument。
3. 两者都能进入题目候选页面。
4. 错误状态能显示具体原因。
5. 原始 OCR 返回文件可在本地数据目录找到。

第 6 阶段：手动修正接回

目标：

1. 从 QuestionCandidate 的异常操作进入手动修正。
2. 复用现有 AnnotationWorkbench。
3. 框选完成后更新当前 candidate 或生成新的 candidate。
4. 不再要求用户默认先手动切题。

验收：

1. 对某一道异常题点击“修正题目范围”。
2. 页面能定位到来源 PDF 或页面图。
3. 框选并保存后，该 candidate 的 stemMarkdown、sourceRefs 或 figures 得到更新。
4. 可以重新确认入库。

第 7 阶段：清理旧入口与文案

目标：

1. 导航主入口改为“资料导入”。
2. “PDF 切分中心”降级为高级工具或旧流程入口。
3. README 更新为导入流程 v2。
4. 页面术语统一。

建议术语：

资料导入
自动识别
待确认题目
异常题目
修正题目范围
补充题图
确认入库

避免高频展示：

切题
切分
BBox
OCR run
review item

十一、Codex 执行方式

不要一次给 Codex 全部任务。每次只给一个阶段。

Codex 任务 1

请在不改动现有 PDF 切分、题库、导出功能的前提下，新增导入流程 v2 的基础类型和数据库表。
要求：
1. 新增 SourceDocument、OCRDocument、QuestionCandidate 相关 TypeScript 类型。
2. 在 schema ensureSchema 中新增 source_documents、ocr_documents、question_candidates 三张表。
3. 新增 repository 层，支持基本 create/get/list/update。
4. 不接前端。
5. 不删除旧表。
6. 保证 npm run build 通过。

Codex 任务 2

请实现 OCRDocument normalizer，不接真实 API。
要求：
1. 新增 glm normalizer，输入模拟 GLM-OCR layout_parsing 返回，输出统一 OCRDocument。
2. 新增 doc2x normalizer，输入模拟 Doc2X JSON，输出统一 OCRDocument。
3. OCRDocument 至少包含 markdown、pages、blocks、assets、metadata。
4. 原始返回路径字段必须保留。
5. 添加最小测试或脚本，验证 normalizer 输出结构。

Codex 任务 3

请实现 QuestionCandidate parser。
要求：
1. 输入 OCRDocument。
2. 按常见题号格式切分 Markdown。
3. 输出 QuestionCandidate[]。
4. 识别题干、答案、解析。
5. 生成 issues，包括题号缺失、题号重复、题干为空、答案缺失、解析缺失。
6. 不接 UI。
7. 保证 npm run build 通过。

Codex 任务 4

请实现导入流程 v2 的最小后端 API。
要求：
1. 新增 source document 创建与查询接口。
2. 新增从 OCRDocument 生成 candidates 的接口。
3. 新增 candidates 查询、更新、确认入库接口。
4. 确认入库时写入现有 question_bank_items。
5. 不改旧 PendingBank 页面。
6. 保证旧功能不受影响。

Codex 任务 5

请实现最小前端页面“资料导入 v2”。
要求：
1. 新增页面 /tools/import。
2. 页面先支持选择本地模拟 OCRDocument JSON 或后端已有 OCRDocument。
3. 能触发生成 QuestionCandidate。
4. 能显示候选题列表。
5. 能确认入库。
6. 不重做整体 UI。
7. 不删除现有 PDF 切分中心。

十二、Gemini 设计任务

在后端最小闭环跑通后，再让 Gemini 做 UI 设计。

任务描述：

请基于 Question Manager 当前 shadcn 风格，为“资料导入 v2”设计页面。
目标用户是教培老师，电脑水平有限。
页面包括：
1. 上传资料
2. 选择 OCR 提供方
3. 自动识别进度
4. 待确认题目列表
5. 异常题目提示
6. 单题确认入库
7. 修正题目范围
8. 补充题图
设计原则：
1. 默认不展示“切题”概念。
2. 把“手动框选”作为异常修正功能。
3. 页面文案要面向普通老师。
4. 保留现有 Sidebar 和整体黑白灰风格。
5. 不使用绿色主色。

十三、风险控制

1. 最大风险

最大风险是 Codex 直接大面积修改旧流程，导致原有 PDF 切分、OCR、题库入库、导出一起坏掉。

控制方式：

1. 新增 v2，不替换旧流程。
2. 先后端，后前端。
3. 先模拟数据，后真实 OCR。
4. 每阶段 build。
5. 每阶段 commit。

2. 数据风险

不要迁移用户题库数据。新增表即可。

旧数据继续留在：

question_bank_items
pdf_slicer_runs
pdf_slicer_review_items

新流程稳定后，再考虑迁移旧导入记录。

3. 产品风险

不要让用户直接面对 OCRDocument、layout blocks、BBox、run、candidate 等技术词。

前台只展示：

资料
题目
答案
解析
题图
异常
确认入库
修正范围

4. 技术债风险

新增模块必须有清晰边界。

禁止：

1. provider 直接写 question_bank_items。
2. parser 直接调用 OCR API。
3. PendingBank 直接解析 Doc2X 或 GLM 原始返回。
4. manual annotation 直接替代默认导入流程。
5. 前端页面自行拼装题库字段绕过后端 service。

十四、验收标准

最终 v2 最小闭环应满足：

1. 用户上传一份 PDF。
2. 系统调用 Doc2X 或 GLM-OCR 整卷识别。
3. 系统保存原始 OCR 返回。
4. 系统生成 OCRDocument。
5. 系统按题号生成 QuestionCandidate。
6. 用户在待确认题目页面查看题干、答案、解析、题图。
7. 正常题目可以直接确认入库。
8. 异常题目可以进入手动修正。
9. 入库后的题目能在题库页检索、筛选、加入试题篮、导出。
10. 旧流程仍可使用，旧题库数据不丢失。

十五、重构后的项目定位

重构后，项目不再是“PDF 切题工具”。

新的定位是：

面向数学教师的本地优先资料入库与题库管理工具。系统默认通过 Doc2X 或 GLM-OCR 对整份资料进行识别，自动生成待确认题目；当题号、解析、题图或跨页内容出现异常时，教师可以通过手动修正工具校准题目范围和图片归属，最终形成可检索、可组卷、可导出的数学题库。