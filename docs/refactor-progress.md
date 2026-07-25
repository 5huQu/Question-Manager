# 大文件拆分任务跟踪

> 基于 2026-07-25 结构分析，按优先级排序。每完成一项在状态列标记。

## 第一批：高影响、风险可控

| # | 文件 | 行数 | 拆分目标 | 状态 |
|---|------|------|---------|------|
| 1 | `frontend/src/pages/import-v2/ImportV2Page.tsx` | 2753→127 | hook(1345) + 3 子组件(115+381+523) | ✅ 已完成 |
| 2 | `server/src/utils/figure-helpers.ts` | 819→55(barrel) | → `utils/figures/` 8 模块(image-basics, pil-operations, cut-results, review-bbox, figure-belonging, imported-ocr-figures, inline-binding, explicit-attachments) + index.ts | ✅ 已完成 |
| 3 | `server/src/services/question-bank/export.ts` | 990→14(barrel) | → `export/` 8 模块(types, collection-helpers, question-validation, error-notebook, collection-markdown, collection-latex, worksheet-latex, worksheet-pdf) + index.ts | ✅ 已完成 |

## 第二批：中等复杂度

| # | 文件 | 行数 | 拆分目标 | 状态 |
|---|------|------|---------|------|
| 4 | `server/src/services/question-parser/question-candidate.parser.ts` | 988→110(编排器) | → 4 模块(structural-detection, chunk-processing, figure-extraction, solution-extraction, candidate-builder) | ✅ 已完成 |
| 5 | `server/src/services/import-flow-v2/candidate.service.ts` | 818→1(barrel) | → `candidate-service/` 7 模块(helpers, source-metadata, figure-operations, parse-operations, update-operations, move-operations, commit-operations) + index.ts | ✅ 已完成 |
| 6 | `frontend/src/components/questions/WorkbenchQuestionCard.tsx` | 1132→2(barrel) | → `workbench/` 4 组件(WorkbenchQuestionCard, QuestionBankDraftCard, BankFilterSidebar, BankPagination) + BankTab 编排器 | ✅ 已完成 |
| 7 | `frontend/src/components/QuestionBasket.tsx` | 1153→5(barrel) | → `basket/` 5 模块(constants, useBasketState, BasketPageView, BasketDrawerView, QuestionBasket 编排器) | ✅ 已完成 |

## 第三批：相对独立

| # | 文件 | 行数 | 拆分目标 | 状态 |
|---|------|------|---------|------|
| 8 | `frontend/src/components/dialogs/QuickActionDialog.tsx` | 1438→1(barrel) | → `quick-action/` 6 模块(constants, CustomCheckbox, useQuickAction, TagTreeSelector, ResultPanels, QuickActionDialog 编排器) | ✅ 已完成 |
| 9 | `frontend/src/components/questions/EditDialog.tsx` | 1319→2(barrel) | → `edit-dialog/` 4 模块(utils, form-fields, ai-clean-panel, EditDialog 编排器) | ✅ 已完成 |
| 10 | `frontend/src/pages/questions/LayoutWorkbenchPage.tsx` | 1341→2(barrel) | → `layout-workbench/` 5 模块(useLayoutWorkbench, OutlinePanel, PropertiesPanel, Toolbar, LayoutWorkbenchPage 编排器) | ✅ 已完成 |
| 11 | `server/src/services/question-parser/parser-preview.ts` | 809→1(barrel) | → `preview/` 6 模块(types, markdown-utils, section-detection, match-extraction, diagnostics, preview-builder) + index.ts | ✅ 已完成 |
| 12 | `frontend/src/pages/LearningTagsPage.tsx` | 973→1(barrel) | → `learning-tags/` 5 模块(utils, useLearningTags, LibraryListPanel, LibraryEditor, AddLibraryDialog) + 编排器 | ✅ 已完成 |
| 13 | `frontend/src/pages/import-v2/ImportUploadPage.tsx` | 890→1(barrel) | → `import-upload/` 4 模块(constants, useImportUpload, MetadataFormPanel, FileUploadPanel) + 编排器 | ✅ 已完成 |
| 14 | `frontend/src/pages/SettingsPage.tsx` | 822→1(barrel) | → `settings/` 4 模块(types, useSettingsState, components, SettingsPage 编排器) | ✅ 已完成 |

## 跨文件去重（随拆分顺带完成）

- [ ] `simpleChoiceAnswer` 统一到 parser/answer-table
- [ ] `CHINESE_SECTION_PREFIX_RE` 统一到 parser/structural-detection
- [ ] `DOC2X_FIGURE_MARKER_RE` 统一到 figures/inline-binding
- [ ] `figureAbsolutePath` 仅保留 figures/image-basics
- [ ] KP/SM 树选择器提取共享 HierarchicalTagTree 组件

## 验证规则

- 前端拆分：`npm run build:frontend` 通过
- 后端拆分：`npm run build:server` + `npm run test:question-parser` + `npm run test:routes`
- 涉及启动/Schema：追加 `npm run test:smoke`
- 每次拆分后公共 API 路径不变，通过 barrel re-export

## 约束

- 不改动 AppSidebar / AppPageHeader / App.tsx shell
- 不改变 HTTP 路由路径和响应结构
- 不删除 V1 兼容适配器
- 后端原路径保留 index.ts re-export
