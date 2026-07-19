# 全项目统一题目文本编辑器

> 状态：已完成（2026-07-13）。本文是题目内容编辑能力的唯一实施任务；排版任务只负责调用该能力。

## 1. 决策与边界

- [x] 首轮覆盖题目详情、新建题目、待入库、候选修正和排版工作台。
- [x] 默认使用可视化编辑，保留 Markdown/LaTeX 高级入口。
- [x] Markdown 继续作为数据库、搜索、OCR 同步与导出的唯一事实内容。
- [x] Tiptap/ProseMirror 负责编辑状态，MathLive 负责公式输入，KaTeX 负责公式展示。
- [x] PDF 仍是排版工作台的唯一成品预览，不增加 HTML 成品排版。
- [x] 首轮保留现有图片查看、裁剪和绑定流程，不在编辑器内新增图片管理。
- [x] 不修改 AppSidebar、AppPageHeader 或 AppShell。

## 2. 编辑器内核

- [x] 定义版本化 `EditorDocumentV1`。
- [x] 支持段落、文本、换行、行内公式、块公式、选择题、表格和 `rawMarkdown`。
- [x] 完成 Markdown 与编辑节点的双向转换。
- [x] 无法无损转换的内容保留为 `rawMarkdown`，禁止静默丢失。
- [x] 清理危险 HTML、事件属性和不支持的样式。
- [x] 完成 `QuestionContentEditor`、工具栏、公式节点、公式编辑浮层和源码模式。
- [x] 正文工具栏与结构化选项可直接打开公式键盘，并将公式插入当前编辑位置。
- [x] 支持中文输入法、撤销/重做、快捷键、dirty 状态、离开确认和本地恢复。
- [x] 增加仅开发环境可访问的 `/mock/question-editor` 并按 UI 规范验收。

## 3. 保存与并发

- [x] 正式题和候选题增加 `contentRevision`。
- [x] 现有 PATCH 接口支持 `expectedContentRevision`，旧调用保持兼容。
- [x] 内容冲突统一返回 409 和服务端当前内容。
- [x] 已入库候选题禁止继续修改候选内容。
- [x] 正式题保存继续完成格式诊断、搜索索引和 OCR 草稿同步。
- [x] 排版草稿增加版本化内容覆盖；预览和最终导出读取相同有效内容。
- [x] 排版内编辑默认只改当前试卷。
- [x] 显式同步题库时检查草稿与题库版本并原子提交。
- [x] 刷新题库内容时保留排版覆盖并报告冲突。

## 4. 页面接入

- [x] 题目详情复用统一编辑器，保留元数据、JSON、AI 清洗、评分和题图。
- [x] 新建题目只替换手工单题录入，保持 JSON 和整卷导入路径。
- [x] 待入库保留普通题更新、只读占位题新建及批量动作。
- [x] 候选修正保留 PDF、区域、题图、显式文本保存和区域自动保存。
- [x] 排版工作台提供当前试卷编辑、差异确认和同步题库，保存后重新生成 PDF。

## 5. UI 验收

- [x] 仅使用 zinc 黑白灰主体，emerald/amber/red 只表示状态。
- [x] 不使用 Emoji、高饱和主色、大渐变或玻璃拟态。
- [x] Dialog、Sheet、Popover、工具栏和 sticky 操作栏符合 `docs/ui_design_specification.md`。
- [x] 浅色、深色、1440px、1280px、窄窗口和 200% 缩放可用。
- [x] 键盘导航、焦点恢复、ARIA、中文 IME 和 reduced motion 可用。

## 6. 测试与发布门槛

- [x] Markdown/公式/选项/表格/未知内容往返测试通过。
- [x] 编辑器组件、保存失败、本地恢复和冲突测试通过。
- [x] 五个入口的既有业务流程不回归。
- [x] 排版仅当前试卷、同步题库、刷新覆盖和 PDF 一致性测试通过。
- [x] `npm run build`。
- [x] `npm run test:frontend`（12 个测试文件，47 项测试）。
- [x] `npm run test:routes`（168 条路由契约及服务集成测试）。
- [x] `npm run test:math-render`。
- [x] `npm run test:layout-drafts`。
- [x] `npm run test:layout-pdf-e2e`（学生版 7 页、教师版 3 页）。
- [x] `npm run test:smoke`。
- [x] `git diff --check`。
