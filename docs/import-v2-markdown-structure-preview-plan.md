# 导入 v2 模型 Markdown 与结构预览落地方案

## 1. 背景

最新一批“深圳市高三年级第一次调研考试数学试题参考答案”的导入暴露出一个典型问题：资料本身不是坏数据，OCR Markdown 也包含关键内容，但答案解析匹配策略与资料版式不一致。

该批答案 PDF 的结构是：

```md
19.

【命题说明】

...

## 【参考答案】

解：
...
```

现有脚本更适配“参考答案标题下面继续出现题号”的结构，无法把 `## 【参考答案】` 后的内容自动挂回最近的 `19.`。用户在候选题页面只能看到“缺少解析”或“答案被识别成命题说明”，很难判断是 OCR 问题、正则问题，还是资料版式问题。

因此后续重点不应只是给某个批次打补丁，而是让用户能看到模型识别稿、理解当前规则如何切分，并在不同资料结构下自行切换或调整规则。

## 2. 目标与非目标

### 目标

- 提供一个“模型识别稿 / 结构预览”窗口，展示 OCR 模型产出的原始 Markdown。
- 在 Markdown 上叠加当前解析规则识别到的结构：题号、答案表、答案标题、说明块、候选题来源范围。
- 支持从候选题跳转到对应 Markdown 来源位置，解释“这段答案从哪里来，为什么没匹配到解析”。
- 支持用户切换有限的资料版式策略，并在不覆盖候选题的前提下试运行预览。
- 支持保存导入规则预设，让用户以后遇到同类资料可以复用。

### 非目标

- 第一阶段不让用户直接编辑 OCR Markdown。
- 第一阶段不做任意脚本规则或复杂可视化编排。
- 第一阶段不自动修复历史批次；用户确认后才重新生成候选题。
- 不把所有 OCR 质量问题都归因到解析规则。公式错识别、图片丢失仍应走 OCR/人工修正链路。

## 3. 产品形态

### 3.1 入口

在资料导入 v2 的候选题核对页增加入口：

- 页面级按钮：`查看模型识别稿`
- 候选题局部入口：点击“自动识别答案”“自动解析步骤”标题旁的来源图标，打开预览窗口并定位到该字段来源。
- 解析异常提示入口：例如 `未匹配到解析`、`答案疑似为命题说明` 旁增加 `查看原因`。

候选题页面仍是用户的主工作台；Markdown 预览窗口是诊断和规则试运行工具。

### 3.2 窗口布局

建议使用宽弹窗或右侧全高抽屉，不跳离当前候选题页面。

左侧：模型 Markdown

- 显示完整 OCR Markdown。
- 保留页码标记，例如 `<!-- GLM_PAGE:7 -->`。
- 显示行号。
- 支持搜索。
- 按结构类型高亮：
  - 一级题号
  - 小问编号
  - 答案表
  - 答案/解析标题
  - 命题说明/题源/课标要求
  - 当前候选题题干范围
  - 当前候选题答案范围
  - 当前候选题解析范围

右侧：结构与诊断

- 当前解析策略。
- 当前题候选的字段来源。
- 当前规则识别到的题号列表。
- 答案表识别结果。
- 未匹配、冲突、覆盖被阻止等诊断。
- 试运行后的候选字段摘要。

### 3.3 用户能看到的解释

针对这批资料，窗口应能展示类似解释：

```text
第 19 题：
- 当前答案来源：第 7 页，第 320-326 行，命题说明段。
- 检测到后续 `## 【参考答案】`，但当前策略要求参考答案标题后出现题号，因此未绑定到第 19 题。
- 建议切换策略：题号在参考答案标题之前。
```

这类解释比只显示 `missing_analysis` 更有行动价值。

## 4. 规则策略设计

### 4.1 新增资料版式策略

在现有导入识别规则基础上增加 `solutionBindingStrategy`：

```ts
type SolutionBindingStrategy =
  | 'heading_then_question'
  | 'question_then_heading'
  | 'auto'
```

语义：

- `heading_then_question`：参考答案标题后面会出现题号。对应当前主要逻辑。
- `question_then_heading`：题号先出现，后面依次是说明块、参考答案标题、解析正文。适配本批资料。
- `auto`：试运行时同时跑两种策略，根据诊断评分推荐一种；用户确认后再应用。

### 4.2 新增说明块策略

增加 `metadataBlockKeywords` 和 `metadataBlockPolicy`：

```ts
type MetadataBlockPolicy = 'ignore' | 'append_to_analysis' | 'store_as_note'
```

建议默认：

- 关键词：`命题说明`、`教材题源`、`高考题源`、`课标要求`
- 策略：`ignore`

第一期可以只做到“不进入答案/解析字段”，后续再考虑单独入库为备注或来源元数据。

### 4.3 新增答案表覆盖策略

增加 `answerTablePolicy`：

```ts
type AnswerTablePolicy =
  | 'fill_empty_only'
  | 'override_metadata_like_answer'
  | 'prefer_table_for_choice_questions'
```

语义：

- `fill_empty_only`：现有策略，只填空缺。
- `override_metadata_like_answer`：如果当前答案像命题说明/题源/课标要求，则允许答案表覆盖。
- `prefer_table_for_choice_questions`：选择题优先用答案表，大题仍按解析块。

本批资料的小题需要 `prefer_table_for_choice_questions` 或 `override_metadata_like_answer`。

### 4.4 规则预设

增加用户可保存的导入规则预设：

```ts
type ImportParserPreset = {
  id: string
  name: string
  description: string
  config: ImportFlowV2ParserConfig
  createdAt: string
  updatedAt: string
}
```

内置预设建议：

- `通用试卷答案表`
- `小题答案表 + 大题逐题解析`
- `题号在参考答案前`
- `题号在参考答案后`
- `题干答案混排`

预设 UI 面向用户，底层仍保存为 JSON 配置。

## 5. 后端设计

### 5.1 Markdown 读取 API

新增接口：

```text
GET /api/import-flow-v2/ocr-documents/:id/markdown-preview
```

返回：

```ts
type MarkdownPreviewResponse = {
  ocrDocumentId: string
  sourceDocumentId: string
  provider: string
  markdown: string
  lineOffsets: Array<{ lineNo: number; start: number; end: number }>
  pageMarkers: Array<{ pageNo: number; offset: number; lineNo: number }>
}
```

`lineOffsets` 由后端生成，便于前端按 offset 定位并高亮。

### 5.2 解析试运行 API

新增接口：

```text
POST /api/import-flow-v2/ocr-documents/:id/parser-preview
```

请求：

```ts
type ParserPreviewRequest = {
  config?: ImportFlowV2ParserConfig
  focusQuestionNo?: string
  candidateId?: string
}
```

返回：

```ts
type ParserPreviewResponse = {
  config: ImportFlowV2ParserConfig
  strategyRecommendation?: {
    strategy: SolutionBindingStrategy
    reason: string
    confidence: number
  }
  structures: MarkdownStructureToken[]
  candidatePreviews: CandidateParsePreview[]
  diagnostics: ParserDiagnostic[]
}
```

结构 token：

```ts
type MarkdownStructureToken = {
  id: string
  kind:
    | 'page_marker'
    | 'question_no'
    | 'sub_question_no'
    | 'answer_table'
    | 'solution_heading'
    | 'metadata_heading'
    | 'stem_range'
    | 'answer_range'
    | 'analysis_range'
  questionNo?: string
  start: number
  end: number
  lineStart: number
  lineEnd: number
  label: string
  severity?: 'info' | 'warning' | 'error'
}
```

诊断：

```ts
type ParserDiagnostic = {
  code:
    | 'solution_heading_without_following_question'
    | 'question_before_solution_heading'
    | 'metadata_used_as_answer'
    | 'table_answer_blocked_by_existing_answer'
    | 'missing_analysis'
    | 'unmatched_solution'
  severity: 'info' | 'warning' | 'error'
  questionNo?: string
  message: string
  start?: number
  end?: number
  suggestedConfigPatch?: Partial<ImportFlowV2ParserConfig>
}
```

候选预览：

```ts
type CandidateParsePreview = {
  questionNo: string
  stemPreview: string
  answerPreview: string
  analysisPreview: string
  sourceRanges: {
    stem?: MarkdownRange
    answer?: MarkdownRange
    analysis?: MarkdownRange
  }
  issues: ParserDiagnostic[]
}
```

### 5.3 重新生成候选题

现有 `POST /api/import-flow-v2/jobs/:id/parse-candidates` 可以保留，但需要支持传入规则快照：

```ts
type ParseCandidatesRequest = {
  configOverride?: ImportFlowV2ParserConfig
  presetId?: string
}
```

重新生成前应提示用户：

- 会覆盖当前未入库候选题的自动识别字段。
- 已手动编辑过的字段是否保留，需单独设计策略。

建议第一期只允许在“未手动修改字段”的候选上整体重新生成；手动修改保护可以后续细化。

### 5.4 后端改造点

相关文件：

- `server/src/services/question-parser/default-parser-config.ts`
- `server/src/services/question-parser/parser-config.ts`
- `server/src/services/question-parser/solution-document.parser.ts`
- `server/src/services/question-parser/solution-matcher.ts`
- `server/src/services/question-parser/question-solution-merge.ts`
- `server/src/routes/import-flow-v2.ts`
- `server/src/types/question-candidate.ts`
- `frontend/src/api/importV2.ts`

后端新增一个专门模块更清晰：

```text
server/src/services/question-parser/parser-preview.ts
```

职责：

- 读取 OCRDocument markdown。
- 运行题号、答案表、答案标题、说明块检测。
- 调用不同 binding strategy 生成候选预览。
- 生成结构 token 和诊断。
- 不写数据库。

## 6. 前端设计

### 6.1 新组件

建议新增：

```text
frontend/src/components/import-v2/MarkdownStructurePreviewDialog.tsx
frontend/src/components/import-v2/MarkdownStructureViewer.tsx
frontend/src/components/import-v2/ParserDiagnosticsPanel.tsx
frontend/src/components/import-v2/ParserStrategyControls.tsx
```

职责拆分：

- `MarkdownStructurePreviewDialog`：弹窗容器、数据加载、URL state。
- `MarkdownStructureViewer`：Markdown 行号、搜索、offset 高亮、滚动定位。
- `ParserDiagnosticsPanel`：结构摘要、问题说明、候选预览。
- `ParserStrategyControls`：策略切换、试运行、保存预设、应用重解析。

### 6.2 交互流程

普通查看：

1. 用户点击 `查看模型识别稿`。
2. 前端加载 `markdown-preview`。
3. 前端加载当前规则的 `parser-preview`。
4. 左侧显示 Markdown，右侧显示结构摘要。

从候选题定位：

1. 用户在第 19 题点“自动识别答案来源”。
2. 弹窗打开并传入 `candidateId` 或 `questionNo=19`。
3. 前端滚动到 answerRange 或诊断 range。
4. 右侧显示该题的诊断。

试运行：

1. 用户切换 `题号在参考答案前`。
2. 前端调用 `parser-preview`，不写数据库。
3. 高亮和候选预览更新。
4. 用户确认后点击 `用当前策略重新生成候选题`。

保存预设：

1. 用户在试运行后点击 `保存为预设`。
2. 输入名称，例如“深圳调研卷答案格式”。
3. 后续导入任务可直接选择该预设。

### 6.3 UI 约束

- 预览窗口不要做成营销式说明页，应是工具型界面。
- Markdown 区要密集、可扫描，字体使用等宽，行高稳定。
- 高亮颜色需区分结构类型，但避免过多饱和色。
- 右侧诊断优先显示 actionable 信息，不堆满内部算法细节。
- 第一阶段只读，不提供直接编辑 Markdown 的按钮。

## 7. 数据与状态

### 7.1 配置存储

当前导入规则已保存到：

```text
data/config/import-flow-v2-parser.json
```

可在该文件中扩展字段：

```json
{
  "version": 2,
  "solutionBindingStrategy": "heading_then_question",
  "metadataBlockKeywords": ["命题说明", "教材题源", "高考题源", "课标要求"],
  "metadataBlockPolicy": "ignore",
  "answerTablePolicy": "fill_empty_only"
}
```

预设可单独保存：

```text
data/config/import-flow-v2-parser-presets.json
```

避免把多个预设塞进当前单一配置文件。

### 7.2 候选题来源诊断

`question_candidates.issues_json` 可以继续保存用户面向的 warning/error，但预览诊断不一定都落库。

建议新增轻量字段，后续可选：

```sql
parse_diagnostics_json TEXT NOT NULL DEFAULT '[]'
parser_config_snapshot_json TEXT NOT NULL DEFAULT '{}'
```

第一阶段可以不迁移数据库，只在 `parser-preview` 临时生成诊断。等诊断文案稳定后再决定是否落库。

## 8. 分阶段实施计划

### 阶段 1：只读 Markdown 预览

目标：用户能看到模型识别稿，并从候选题跳转到来源。

任务：

- 后端新增 `markdown-preview` API。
- 前端新增预览弹窗和 Markdown viewer。
- 候选题详情页接入 `查看模型识别稿`。
- 支持按 `sourceRefs` 定位到题干、答案、解析来源范围。

验收：

- 能打开题目 PDF 和答案 PDF 的 OCR Markdown。
- 能看到页码、行号和搜索。
- 点击第 19 题答案来源能定位到第 7 页命题说明附近。

### 阶段 2：结构高亮与诊断

目标：用户能理解当前规则识别出了什么。

任务：

- 后端新增 `parser-preview` API。
- 输出题号、答案表、答案标题、说明块 token。
- 输出 `metadata_used_as_answer`、`solution_heading_without_following_question` 等诊断。
- 前端展示结构高亮和诊断面板。

验收：

- 本批资料能提示“命题说明被当作答案”。
- 本批资料能提示“参考答案标题未绑定到第 19 题”。
- 小题表格答案能显示为已识别结构。

### 阶段 3：规则策略试运行

目标：用户能切换资料版式策略，并预览结果。

任务：

- 扩展 parser config schema。
- 实现 `question_then_heading` 策略。
- 实现 `answerTablePolicy`。
- 预览窗口支持切换策略并重新试运行。

验收：

- 对本批资料切换到 `question_then_heading` 后，第 19 题 analysis 预览包含 `解：` 后内容。
- 小题答案可以从表格预览为 A/B/C/D，不再被命题说明占位。
- 试运行不修改数据库候选题。

### 阶段 4：应用策略与规则预设

目标：用户确认后能重新生成候选题，并保存可复用预设。

任务：

- `parse-candidates` 支持 `configOverride` 或 `presetId`。
- 设置页增加导入规则预设管理。
- 导入任务页面增加预设选择。
- 重新生成前展示影响范围和确认文案。

验收：

- 用户可保存“题号在参考答案前”预设。
- 新批次可选择该预设解析。
- 历史批次必须用户主动点击重解析才改变。

### 阶段 5：历史诊断与质量面板

目标：把结构诊断沉淀为批次质量报告。

任务：

- 候选题保存 parser config snapshot。
- 候选题保存稳定诊断。
- 批次页面展示：缺答案、缺解析、疑似说明块占位、未绑定答案块数量。
- 支持按诊断类型过滤候选题。

验收：

- 用户能快速筛出“疑似命题说明占答案”的题。
- 用户能看到本批次解析策略与规则版本。

## 9. 测试计划

### 单元测试

补充 `server/scripts/question-parser.test.mjs` 场景：

- 小题表格答案 + 命题说明 + 大题题号在参考答案前。
- 参考答案标题后无题号时，`heading_then_question` 不误挂。
- `question_then_heading` 能把参考答案挂回最近题号。
- 命题说明不进入 answerText。
- 表格答案能覆盖 metadata-like answer。

### API 测试

新增或扩展 route contract：

- `GET /api/import-flow-v2/ocr-documents/:id/markdown-preview`
- `POST /api/import-flow-v2/ocr-documents/:id/parser-preview`
- parser-preview 不写数据库。

### 前端验证

使用本批资料作为回归样本：

- 打开第 19 题。
- 点击自动答案来源。
- 弹窗定位到答案 PDF 第 7 页命题说明。
- 右侧给出策略建议。
- 切换策略后预览第 19 题解析内容。

## 10. 风险与取舍

- Markdown 很长时前端渲染可能卡顿。第一期可按行虚拟滚动或限制一次高亮 token 数。
- 结构高亮不能替代人工校对。页面文案应避免让用户误以为试运行就是最终正确答案。
- 规则策略过多会造成选择困难。UI 应优先提供预设和推荐，不把所有底层字段直接暴露。
- 重新生成候选题可能覆盖用户手工修改。必须先定义保护策略，第一期宁可保守。
- `auto` 策略需要评分模型，第一期可以只做“推荐提示”，不自动应用。

## 11. 建议优先级

最值得先做的是阶段 1 和阶段 2。

原因：

- 它们不改变现有解析结果，风险小。
- 立刻提升透明度，用户能自行判断资料结构。
- 后续策略试运行、预设、重解析都依赖这个预览入口。

当用户能看到“模型 Markdown 是什么”和“脚本当前怎么理解它”之后，再开放策略切换就会自然很多。
