# WS-06：V2 导入前端拆分与状态管理

## 1. 目标

在不改变现有 V2 用户流程的前提下，拆分超大的 ImportV2Page，明确页面路由职责、服务端数据状态、编辑草稿状态和后台任务轮询。

## 2. 当前问题

`ImportV2Page.tsx` 超过 3000 行，包含约 50 个 React hooks 和 60 个局部函数，同时承担：

- ImportJob 和资料导航。
- 单/双文档上传。
- OCR 启动与轮询。
- 候选题解析和重解析。
- 候选题筛选、批量操作和详情编辑。
- Markdown/parser preview。
- 元数据编辑和各种兼容 URL。

结果是状态互相触发、effect 依赖复杂、局部失败难以测试，继续追加功能的回归风险很高。

## 3. 目标页面结构

建议按路由职责拆分：

```text
pages/import-v2/
  ImportJobsListPage.tsx
  ImportUploadPage.tsx
  ImportJobLayout.tsx
  ImportJobOverviewPage.tsx
  ImportJobDocumentPage.tsx
  CandidateReviewPage.tsx
  CandidateDetailPage.tsx
  CandidateFixWorkbenchPage.tsx
  ImportJobQuestionsPage.tsx
```

`ImportJobLayout` 负责加载共享 Job 上下文和渲染 Outlet。子页面不应各自重复解析 jobId/sourceDocumentId 和兼容跳转。

## 4. 状态分层

### 4.1 服务端状态

统一封装查询：

- `useImportJob(jobId)`
- `useImportJobDocuments(jobId)`
- `useSourceDocumentOcrTask(sourceDocumentId)`
- `useCandidates(jobId, filters)`
- `useImportJobQuestions(jobId)`

可选择 TanStack Query 等成熟库，也可基于现有 `useAsync` 建立小型 cache，但必须具备：取消过期请求、去重、invalidate 和明确 loading/error 状态。

### 4.2 UI 状态

Tab、筛选、展开项、当前 candidate 等可放 URL query 或局部 component state。不要与服务端对象复制状态混合。

### 4.3 编辑草稿

元数据、候选题内容和手动修正草稿使用独立 hook，具备 dirty、saving、conflict、recovered 状态。统一使用 optimistic revision。

## 5. OCR 轮询

当前列表每 4 秒刷新所有 Job，详情每 3 秒并发轮询资料。目标行为：

- 只轮询 active task。
- 页面隐藏时降低频率或暂停。
- 请求未完成时不启动下一轮。
- 组件卸载时取消请求。
- task 完成后只 invalidate 相关 Job/Document，不全量重载。
- WS-07/后续可替换为 SSE，但本工作包不强制引入实时协议。

## 6. 兼容 URL

将旧 document/candidate URL 解析集中在一个 redirect 模块。业务页面只接收 canonical `jobId` 路由。

兼容 redirect 必须：

- 只解析和跳转，不创建或修改业务数据。
- 有删除版本或由 WS-04 最终移除。
- 对无法解析的历史地址显示明确错误。

## 7. 组件边界

优先提取有独立业务意义的组件：

- JobHeader / JobStatusSummary
- DocumentList / DocumentStatusRow
- OcrTaskPanel
- CandidateFilterBar
- CandidateList / CandidateDetail
- CandidateBulkActions
- ParserPreviewLauncher

不要仅按行数把组件拆成无语义碎片，也不要建立一个包含全部状态的巨型 Context。

## 8. API 使用规则

- 页面只能调用 `frontend/src/api/` 或共享 query hooks。
- 不新增裸 `fetch('/api/...')`。
- WS-05 完成前可使用适配器，但最终只保留 canonical API。
- 错误展示使用统一 ApiError，不依赖字符串匹配。

## 9. 文件所有权

本工作包拥有：

- `frontend/src/pages/import-v2/`
- 新的 import-v2 hooks/components
- `frontend/src/App.tsx` 中 V2 路由结构
- 前端导入相关测试

`frontend/src/api/importV2.ts` 的最终结构由 WS-05 拥有；本工作包如需新增方法，先通过小范围接口约定避免冲突。

## 10. 实施顺序

1. 为现有页面关键状态转换补 characterization tests。
2. 提取纯适配函数和 URL builder。
3. 建立 ImportJobLayout 和共享加载 hook。
4. 拆 Document/OCR 页面。
5. 拆 Candidate review/detail 页面。
6. 收敛轮询和 invalidate。
7. 删除旧 page 内已迁移代码。
8. WS-05 合并后迁移到 canonical API。

每一步保持路由可打开，避免一次提交重写 3000 行。

## 11. 测试计划

必须覆盖：

1. Job/document/candidate canonical route 导航。
2. OCR running -> succeeded/failed UI 状态。
3. 离开页面后停止轮询。
4. 过期请求不会覆盖新选择的数据。
5. 候选题筛选和批量选择。
6. revision conflict 展示和恢复。
7. 历史 URL redirect。
8. 上传单文档和双文档的请求 payload。

## 12. 完成标准

- 不再存在承担整个导入工作流的单个 3000 行页面。
- 每个 route 有明确数据加载边界。
- OCR 轮询只针对 active task，且可取消。
- 页面不直接拼 API URL。
- 前端严格类型检查通过。
- V2 工作流操作路径与改造前一致。
