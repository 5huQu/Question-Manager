# WS-01：V2 原生候选题手动修正域

## 1. 目标

让 QuestionCandidate 的手动修正完全由 V2 数据模型、API 和服务实现，解除以下依赖：

- `pdf_slicer_annotation_sessions`
- `pdf_slicer_annotation_regions`
- `/api/tools/pdf-slicer/annotation-sessions/*`
- `services/pdf-slicer/annotations.service.ts`

完成后，候选题区域编辑、题图裁剪、保存草稿、恢复草稿和最终写回仍保持现有用户行为。

## 2. 当前问题

当前 V2 手动修正服务直接操作 V1 标注表，前端 finalize 也直接请求旧 API。`candidate.service.ts` 和 `import-job.service.ts` 还从旧 annotation service 导入候选题重校验函数。

这会导致：

1. V1 route/service 无法删除。
2. 字段仍使用 `batch_id`、`source_run_id` 等错误语义。
3. 标注表缺少到 QuestionCandidate、SourceDocument 的正式外键。
4. V2 与 V1 finalize 行为混在一个超大 service 中。

## 3. 目标模型

建议新增以下 V2 表，具体 DDL 由 WS-03 通过 migration 实现。

### `candidate_fix_sessions`

建议字段：

- `id`
- `candidate_id`，外键到 `question_candidates.id`
- `revision`
- `status`：`draft | finalized | superseded`
- `source_profiles_json`
- `base_content_revision`
- `created_at`
- `updated_at`
- `finalized_at`

约束：每个 candidate 同时最多存在一个 draft session；session 必须使用 optimistic concurrency。

### `candidate_fix_regions`

建议字段：

- `id`
- `session_id`，外键到 `candidate_fix_sessions.id`
- `source_document_id`，外键到 `source_documents.id`
- `kind`
- `question_key`
- `question_label`
- `question_keys_json`
- `segments_json`
- `sort_order`
- `note`
- `created_at`
- `updated_at`

禁止继续使用 `source_run_id` 表示 SourceDocument。

## 4. 目标 API

统一使用 V2 命名空间：

- `POST /api/import-flow-v2/candidates/:candidateId/fix-session`
- `GET /api/import-flow-v2/candidate-fix-sessions/:sessionId`
- `PUT /api/import-flow-v2/candidate-fix-sessions/:sessionId/regions`
- `POST /api/import-flow-v2/candidate-fix-sessions/:sessionId/validate`
- `POST /api/import-flow-v2/candidate-fix-sessions/:sessionId/finalize`
- `POST /api/import-flow-v2/candidate-fix-sessions/:sessionId/reopen`

请求和响应应使用 V2 术语：`candidateId`、`sourceDocumentId`、`regions`、`contentRevision`。

## 5. 实施任务

### 5.1 提取中立算法

从 `services/pdf-slicer/annotations.service.ts` 中识别并提取真正可复用的纯逻辑：

- 区域坐标规范化和校验。
- 页面区域排序和分组。
- 题干、答案、解析区域到 CandidateSourceRef 的转换。
- 候选题图裁剪计划生成。
- 候选题内容和诊断重校验。

目标位置建议为：

- `server/src/services/candidate-fix/region-validation.ts`
- `server/src/services/candidate-fix/region-mapping.ts`
- `server/src/services/candidate-fix/candidate-fix.service.ts`

纯逻辑不得依赖 Express、SQLite row 或 V1 类型。

### 5.2 新增 repository

新增：

- `server/src/repositories/candidate-fix-sessions.repo.ts`

负责 session/region CRUD、revision 更新和事务内读取。Service 不应继续内联 SQL。

### 5.3 实现 V2 service

Service 需要覆盖：

1. 创建或恢复 draft。
2. 从 CandidateSourceRef 初始化 regions。
3. 保存 regions，并检查 session revision。
4. 校验 page、bbox、source document 所有权和 candidate 状态。
5. finalize 时裁剪题图、更新 candidate sourceRefs/figures/status。
6. 候选题已经 committed 时拒绝写入。
7. 文件裁剪失败时不提交 Candidate 更新。

### 5.4 文件副作用

裁剪文件先写入 session staging 目录；数据库事务成功后再提升为正式 candidate asset。失败时清理 staging，不能留下 candidate 已更新但文件缺失的状态。

### 5.5 前端迁移

修改：

- `frontend/src/hooks/useCandidateFixSession.ts`
- `frontend/src/pages/import-v2/CandidateFixWorkbenchPage.tsx`
- `frontend/src/components/import-v2/manual-fix/*`
- `frontend/src/api/importV2.ts`，由 WS-05 或在其合并前通过独立 `candidateFixApi.ts` 适配

前端不得再直接 `fetch('/api/tools/pdf-slicer/...')`。

### 5.6 历史草稿迁移

WS-03 负责数据 migration，本工作包负责提供转换规则：

- 只迁移 `sess_candidate_*` session。
- `batch_id` 映射为 candidate ID。
- region 的 `source_run_id` 映射为 SourceDocument ID。
- 无法找到 candidate/source document 的记录进入 exception report。
- 已 finalized session 是否迁移由产品追溯需求决定，但 draft 必须迁移。

## 6. 文件所有权

本工作包主要拥有：

- `server/src/services/candidate-fix/`
- `server/src/repositories/candidate-fix-sessions.repo.ts`
- 新的 candidate-fix router
- V2 手动修正前端组件和 hook
- 对应测试

本工作包不直接修改：

- `server/src/db/schema.ts`
- V1 route mount
- V1 表删除逻辑
- `frontend/src/App.tsx`

## 7. 测试计划

必须新增：

1. 创建、恢复、reopen session。
2. revision 冲突返回 409。
3. 无效 bbox、页码和 SourceDocument 被拒绝。
4. 双文档 questions/solutions 区域正确保存。
5. finalize 正确更新 stem、answer、analysis、figures 和 sourceRefs。
6. 裁剪失败时 Candidate 和 session 不被部分提交。
7. committed Candidate 不允许再修改。
8. 历史 `sess_candidate_*` 迁移测试。
9. 前端保存草稿、刷新恢复、离开提示和 finalize 测试。

建议命令：

```sh
npm run build:server
npm run test:routes
npm run test:frontend
npx tsc -p frontend/tsconfig.json
```

## 8. 完成标准

- V2 手动修正链路不 import `pdf-slicer` 模块。
- V2 手动修正不读写 `pdf_slicer_annotation_*`。
- 前端不再调用旧 annotation API。
- 现有手动修正用户流程和数据恢复能力不退化。
- WS-04 可以安全删除 V1 annotation route/service。
