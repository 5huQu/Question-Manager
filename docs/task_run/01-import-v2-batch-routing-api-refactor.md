# Import V2 批次路由与 API 长期改造任务规划

## 一句话目标

将导入流程 V2 从 V1 `pdf-slicer/runs` 链路中彻底拆出，建立以 `import_jobs` 为核心的 V2 原生批次体系。V2 的题目核对、已入库题目查看、导出、导出记录、统计和后续维护都走 V2 路由与 API；V1 `pdf_slicer_runs` 仅保留给旧 PDF 切题链路。

## 背景

当前项目存在两套导入/识别链路：

1. V1：`PDF 切分 -> 切题复核 -> OCR -> 待入库 -> 题库`
2. V2：`资料导入 -> 整卷 OCR -> 候选题解析 -> 题目核对 -> 确认入题库`

产品方向已经明确：V1 导收批次后续废用，V2 作为主线。现阶段 V2 的前半段已经成型，但后半段仍借用了 V1 的批次结果页和导出接口，导致“导出时批次不存在”等问题。

典型问题：

- V2 入库完成后跳转到 `/tools/pdf-slicer/runs/ifv2:xxx/questions`。
- `runQuestions()` 对 `ifv2:` 做了临时兼容，所以页面能打开。
- `export-batch` 仍只查 `pdf_slicer_runs`，不认识 `ifv2:`，因此导出报“批次不存在”。
- V2 已确认入库的题目通常是 `bank_status = 'ready'`，而 V1 批次导出只导出 `bank_status = 'banked'`，语义不一致。

本任务不做短期兼容补丁，而是直接按长期方向规划和实施。

## 现状排查

### 前端路由现状

V2 已有导入路由：

```text
/tools/import
/tools/import/documents/:sourceDocumentId
/tools/import/documents/:sourceDocumentId/candidates
/tools/import/documents/:sourceDocumentId/candidates/:candidateId
/tools/import/documents/:sourceDocumentId/candidates/:candidateId/manual-fix
```

V2 仍借用 V1 的结果页：

```text
/tools/pdf-slicer/runs/:runId/questions
/tools/pdf-slicer/runs/:runId/pending-bank
```

当前 V2 入口中存在这类跳转：

```ts
navigate(`/tools/pdf-slicer/runs/${encodeURIComponent(`ifv2:${selectedDoc.id}`)}/questions`)
```

相关文件：

- `frontend/src/App.tsx`
- `frontend/src/pages/import-v2/ImportV2Page.tsx`
- `frontend/src/pages/questions/RunQuestionsPage.tsx`
- `frontend/src/components/pdf-slicer/RunExportDialog.tsx`
- `frontend/src/api/questionBank.ts`
- `frontend/src/api/exportRecords.ts`

### 前端 API 现状

V2 API client 已有：

```text
/api/source-documents
/api/source-documents/upload
/api/source-documents/:id/ocr
/api/source-documents/:id/ocr-status
/api/source-documents/:id/candidates
/api/import-jobs
/api/import-jobs/:id
/api/import-jobs/:id/documents
/api/import-jobs/:id/parse-candidates
/api/question-candidates/:id
/api/question-candidates/:id/commit
/api/question-candidates/commit
```

但 V2 入库后的查看和导出仍调用 V1 API：

```text
GET  /api/tools/pdf-slicer/runs/:runId/questions
GET  /api/tools/pdf-slicer/runs/:runId/export-records
POST /api/tools/pdf-slicer/runs/:runId/export-batch
```

相关文件：

- `frontend/src/api/importV2.ts`
- `frontend/src/api/questionBank.ts`
- `frontend/src/api/exportRecords.ts`
- `frontend/src/api/pendingBank.ts`

### 后端路由现状

V2 route mount：

```ts
mountImportFlowV2Routes(app)
```

位于：

- `server/src/routes/import-flow-v2.ts`

V1 run route mount：

```ts
mountRunRoutes(app)
mountOcrRoutes(app)
mountPendingBankRoutes(app)
mountExportRecordsRoutes(app)
```

位于：

- `server/src/routes/pdf-slicer/runs.ts`
- `server/src/routes/pdf-slicer/ocr.ts`
- `server/src/routes/pdf-slicer/pending-bank.ts`
- `server/src/routes/question-bank/export-records.ts`

目前只有 `runQuestions()` 兼容了 `ifv2:`：

```ts
if (runId.startsWith('ifv2:')) {
  const sourceDocumentId = runId.slice('ifv2:'.length)
  ...
}
```

但以下接口仍只认识 V1 `pdf_slicer_runs`：

```text
GET  /api/tools/pdf-slicer/runs/:runId
POST /api/tools/pdf-slicer/runs/:runId/classify
GET  /api/tools/pdf-slicer/runs/:runId/ocr-progress
POST /api/tools/pdf-slicer/runs/:runId/start-ocr
GET  /api/tools/pdf-slicer/runs/:runId/pending-bank
POST /api/tools/pdf-slicer/runs/:runId/export-batch
GET  /api/tools/pdf-slicer/runs/:runId/export-records
```

### 数据模型现状

V1 主要表：

```text
pdf_slicer_batches
pdf_slicer_runs
pdf_slicer_review_items
pdf_slicer_solution_items
question_bank_items
```

V2 主要表：

```text
source_documents
import_jobs
import_job_documents
ocr_documents
question_candidates
question_bank_items
```

V2 候选题确认入库时写入：

```text
question_bank_items.import_source_id = ifv2-job:{jobId} 或 sourceDocumentId
question_bank_items.source_run_id    = ifv2-job:{jobId} 或 ifv2:{sourceDocumentId}
question_bank_items.bank_status      = ready
```

V1 待入库确认完成时写入：

```text
question_bank_items.source_run_id = {pdf_slicer_run_id}
question_bank_items.bank_status   = banked
```

这说明：

- V1 的 `banked` 表示“从待入库确认页确认完成”。
- V2 的 `ready` 已经表示“正式在题库中可用”。
- 不能用 V1 的 `bank_status = 'banked'` 作为 V2 导出条件。

## 目标架构

### 核心原则

1. V2 不再伪装成 V1 run。
2. `import_job` 是 V2 的批次主模型。
3. `source_document` 是批次中的原始资料文件。
4. `question_candidate` 是入库前核对对象。
5. `question_bank_item` 是已确认入题库的正式题目。
6. V2 导出面向一组正式题目，不依赖 `pdf_slicer_runs`。
7. V1 旧接口保留，但不再承载 V2 新功能。

### V2 批次模型

V2 统一以 `import_jobs.id` 作为批次 ID。

单文档导入：

```text
import_job
  mode = single_document
  documents:
    full -> source_document
```

双文档导入：

```text
import_job
  mode = separated_documents
  documents:
    questions -> source_document
    solutions -> source_document
```

### V2 题目来源标识

建议统一：

```text
question_bank_items.import_source_id = ifv2-job:{jobId}
```

`source_run_id` 后续只作为兼容字段保留：

```text
question_bank_items.source_run_id = ifv2-job:{jobId}
```

长期查询 V2 批次题目时，应以 `import_source_id` 为主，`source_run_id` 只作兼容 fallback。

## 路由规划

### 前端新增路由

新增 V2 原生路由：

```text
/tools/import/jobs/:jobId
/tools/import/jobs/:jobId/documents/:sourceDocumentId
/tools/import/jobs/:jobId/candidates
/tools/import/jobs/:jobId/candidates/:candidateId
/tools/import/jobs/:jobId/candidates/:candidateId/manual-fix
/tools/import/jobs/:jobId/questions
/tools/import/jobs/:jobId/exports
```

页面职责：

| 路由 | 页面 | 职责 |
| --- | --- | --- |
| `/tools/import/jobs/:jobId` | ImportV2Page | 批次工作流、资料列表、OCR 状态 |
| `/tools/import/jobs/:jobId/candidates` | ImportV2Page | 候选题核对区 |
| `/tools/import/jobs/:jobId/candidates/:candidateId` | ImportV2Page | 候选题详情核对 |
| `/tools/import/jobs/:jobId/candidates/:candidateId/manual-fix` | CandidateFixWorkbenchPage | 候选题手动修正 |
| `/tools/import/jobs/:jobId/questions` | ImportJobQuestionsPage | 已入库题目查看、筛选、导出 |
| `/tools/import/jobs/:jobId/exports` | ExportRecordsPage 或新页 | V2 批次导出记录 |

### 前端旧路由处理

保留并逐步重定向：

```text
/tools/import/documents/:sourceDocumentId
```

处理方式：

1. 查找该 source document 所属的 import job。
2. 如果找到，redirect 到 `/tools/import/jobs/:jobId/documents/:sourceDocumentId`。
3. 如果没有，创建或提示迁移单文档 job。

V2 旧结果页：

```text
/tools/pdf-slicer/runs/ifv2:xxx/questions
```

处理方式：

1. 解析 `ifv2:` 或 `ifv2-job:`。
2. 找到 jobId。
3. redirect 到 `/tools/import/jobs/:jobId/questions`。

V1 路由继续保留：

```text
/tools/pdf-slicer
/tools/pdf-slicer/runs/:runId/questions
/tools/pdf-slicer/runs/:runId/pending-bank
/tools/pdf-slicer/batches/:batchId/annotate
```

## API 规划

### V2 jobs API

新增：

```text
GET    /api/import-flow-v2/jobs
POST   /api/import-flow-v2/jobs
GET    /api/import-flow-v2/jobs/:jobId
PATCH  /api/import-flow-v2/jobs/:jobId
DELETE /api/import-flow-v2/jobs/:jobId
```

返回建议：

```ts
type ImportJobDetailResponse = {
  importJob: ImportJob
  documents: Array<ImportJobDocument & { sourceDocument: SourceDocument }>
  stats: {
    sourceDocumentCount: number
    ocrSucceededCount: number
    candidateCount: number
    committedCandidateCount: number
    questionCount: number
    needsReviewCount: number
    blockedCount: number
  }
}
```

### V2 documents API

新增 namespaced 路由，逐步替代顶层 `/api/source-documents`：

```text
GET    /api/import-flow-v2/source-documents
POST   /api/import-flow-v2/source-documents/upload
GET    /api/import-flow-v2/source-documents/:sourceDocumentId
PATCH  /api/import-flow-v2/source-documents/:sourceDocumentId
DELETE /api/import-flow-v2/source-documents/:sourceDocumentId
POST   /api/import-flow-v2/source-documents/:sourceDocumentId/ocr
GET    /api/import-flow-v2/source-documents/:sourceDocumentId/ocr-status
GET    /api/import-flow-v2/source-documents/:sourceDocumentId/pages/:page
```

旧路由暂时保留为别名：

```text
/api/source-documents
/api/source-documents/upload
/api/source-documents/:id/ocr
```

### V2 job documents API

新增：

```text
GET  /api/import-flow-v2/jobs/:jobId/documents
POST /api/import-flow-v2/jobs/:jobId/documents
```

上传并自动挂载文档的组合接口：

```text
POST /api/import-flow-v2/jobs/:jobId/documents/upload
```

请求：

```ts
{
  file: File
  role: 'full' | 'questions' | 'solutions'
  metadata?: Partial<SourceDocument>
}
```

### V2 OCR 和解析 API

新增：

```text
POST /api/import-flow-v2/jobs/:jobId/start-ocr
POST /api/import-flow-v2/jobs/:jobId/reidentify
POST /api/import-flow-v2/jobs/:jobId/parse-candidates
```

说明：

- `start-ocr`：对 job 下尚未 OCR 的文档启动 OCR。
- `reidentify`：强制重识别，可按文档或整批执行。
- `parse-candidates`：生成或重新生成候选题。

`reidentify` 请求建议：

```ts
{
  sourceDocumentIds?: string[]
  clearUncommittedCandidates?: boolean
}
```

### V2 candidates API

新增：

```text
GET    /api/import-flow-v2/jobs/:jobId/candidates
POST   /api/import-flow-v2/jobs/:jobId/candidates/commit
GET    /api/import-flow-v2/candidates/:candidateId
PATCH  /api/import-flow-v2/candidates/:candidateId
DELETE /api/import-flow-v2/candidates/:candidateId
POST   /api/import-flow-v2/candidates/:candidateId/commit
POST   /api/import-flow-v2/candidates/:candidateId/manual-fix-session
```

旧路由暂时保留为别名：

```text
/api/question-candidates/:id
/api/question-candidates/:id/commit
/api/question-candidates/commit
```

### V2 已入库题目 API

新增：

```text
GET /api/import-flow-v2/jobs/:jobId/questions
```

查询逻辑：

```sql
SELECT *
FROM question_bank_items
WHERE import_source_id = 'ifv2-job:' || :jobId
   OR source_run_id = 'ifv2-job:' || :jobId
ORDER BY serial_no ASC, created_at ASC
```

兼容旧单文档：

```sql
OR source_run_id IN ('ifv2:' || sourceDocumentId)
OR import_source_id IN (sourceDocumentId)
```

返回建议：

```ts
type ImportJobQuestionsResponse = {
  importJob: ImportJob
  documents: Array<ImportJobDocument & { sourceDocument: SourceDocument }>
  items: QuestionItem[]
  stats: {
    totalItems: number
    readyCount: number
    blockedCount: number
  }
}
```

### V2 导出 API

新增：

```text
GET  /api/import-flow-v2/jobs/:jobId/export-records
POST /api/import-flow-v2/jobs/:jobId/export
```

请求：

```ts
{
  title?: string
  template?: 'exam' | 'worksheet'
  variant?: 'student' | 'teacher'
  format?: 'pdf' | 'latex'
}
```

导出逻辑：

1. 使用 `jobId` 查询正式题目。
2. 不要求 `bank_status = 'banked'`。
3. 排除 `bank_status = 'skipped'`。
4. 默认允许 `ready` 题导出。
5. 对 `blocked` 题根据策略处理：
   - 第一版：阻止导出并提示题号。
   - 后续：允许用户勾选“包含待修正题”。

导出记录：

```text
question_bank_export_records.source_type = 'import_job'
question_bank_export_records.run_id = ''
question_bank_export_records.import_job_id = jobId  // 需要新增字段
```

如果暂不改表结构，也可以过渡：

```text
source_type = 'run'
run_id = 'ifv2-job:{jobId}'
```

但长期建议扩展 `source_type`：

```ts
type ExportRecordSourceType = 'collection' | 'run' | 'import_job'
```

## 服务层规划

### 新增 import-batch service

新增文件：

```text
server/src/services/import-flow-v2/import-batch.service.ts
```

职责：

1. `listImportJobsWithStats()`
2. `getImportJobDetail(jobId)`
3. `resolveImportJobForSourceDocument(sourceDocumentId)`
4. `ensureSingleDocumentImportJob(sourceDocumentId)`
5. `listImportJobCandidates(jobId)`
6. `listImportJobQuestions(jobId)`
7. `importJobQuestionRows(jobId)`
8. `deleteImportJob(jobId)`

### 新增 question-set export service

新增文件：

```text
server/src/services/question-bank/question-set-export.service.ts
```

职责：

1. 输入一组 `QuestionRow` 和导出元数据。
2. 复用现有 PDF/LaTeX 模板。
3. 不依赖 `getRun(runId)`。
4. V1 run 导出和 V2 job 导出都调用它。

建议新增核心函数：

```ts
export function exportQuestionSetPdf(input: {
  id: string
  title: string
  materialType?: 'exam' | 'lecture' | 'unknown'
  rows: QuestionRow[]
  template: 'exam' | 'worksheet'
  variant: 'student' | 'teacher'
})
```

然后 V1 的：

```ts
exportRunWorksheetPdf(runId)
exportRunExamPdf(runId)
```

改成：

1. 查 V1 run。
2. 查 V1 已确认题目。
3. 调用 `exportQuestionSetPdf()`。

V2 的：

```ts
exportImportJobPdf(jobId)
```

做：

1. 查 import job。
2. 查 job 下正式题目。
3. 调用 `exportQuestionSetPdf()`。

## 数据迁移规划

新增脚本：

```text
scripts/migrate-import-v2-jobs.mjs
```

任务：

1. 查找没有 import job 的单文档 V2 source document。
2. 为每个 source document 创建 import job。
3. 插入 import_job_documents，role = `full`。
4. 修正已入库题目的来源字段：
   - `import_source_id = ifv2-job:{jobId}`
   - `source_run_id = ifv2-job:{jobId}`
5. 保留原始 source document 和 candidate 数据。

需要覆盖的旧数据形态：

```text
source_run_id = ifv2:{sourceDocumentId}
import_source_id = {sourceDocumentId}
```

迁移后：

```text
source_run_id = ifv2-job:{jobId}
import_source_id = ifv2-job:{jobId}
```

### 表结构调整

建议新增 export record 字段：

```sql
ALTER TABLE question_bank_export_records
ADD COLUMN import_job_id TEXT NOT NULL DEFAULT '';
```

同时允许：

```text
source_type = import_job
```

如果想减少第一阶段改动，可以先不加字段，过渡使用：

```text
source_type = run
run_id = ifv2-job:{jobId}
```

但这只是过渡方案，后续仍应改为 `import_job`。

## 前端组件规划

### 新增 ImportJobQuestionsPage

新增文件：

```text
frontend/src/pages/import-v2/ImportJobQuestionsPage.tsx
```

职责：

1. 展示 V2 批次已入库题目。
2. 支持筛选、搜索、题型/知识点/方法筛选。
3. 支持导出。
4. 支持返回导入批次。
5. 不展示 V1 待入库入口。

可复用：

- `WorkbenchQuestionCard`
- `RunExportDialog` 的 UI 结构
- `QuestionBasket` 相关能力

但命名应调整为 V2：

```text
RunExportDialog -> QuestionSetExportDialog 或 ImportJobExportDialog
```

### 新增 importJob API client

可在 `frontend/src/api/importV2.ts` 中扩展：

```ts
getImportJobDetail(jobId)
listImportJobCandidates(jobId)
listImportJobQuestions(jobId)
exportImportJob(jobId, payload)
listImportJobExportRecords(jobId)
```

### 路由替换点

替换：

```ts
navigate(`/tools/pdf-slicer/runs/${encodeURIComponent(`ifv2:${selectedDoc.id}`)}/questions`)
```

为：

```ts
navigate(`/tools/import/jobs/${encodeURIComponent(jobId)}/questions`)
```

## V1 保留边界

以下模块短期保留，不在本任务中删除：

```text
frontend/src/pages/pdf-slicer/*
frontend/src/pages/ocr/*
frontend/src/pages/PendingBankPage.tsx
server/src/routes/pdf-slicer/*
server/src/services/pdf-slicer/*
pdf_slicer_batches
pdf_slicer_runs
pdf_slicer_review_items
pdf_slicer_solution_items
```

保留原因：

1. 避免破坏已有数据。
2. 旧链路可能还有历史用户数据。
3. 部分人工标注能力仍被 V2 手动修正复用。

但 V2 新功能不得再新增对 V1 run API 的依赖。

## 实施阶段

### 阶段 1：建立 V2 job 作为单一批次入口

任务：

1. 单文档上传时自动创建 `import_job`。
2. 双文档上传继续创建 `import_job`。
3. `ImportV2Page` 改为优先持有 `activeImportJob.id`。
4. 老的 document route 能解析到 job 并重定向。

验收：

- 新上传单文档后 URL 包含 `/tools/import/jobs/:jobId`。
- 新上传双文档后 URL 包含同一个 jobId。
- 刷新页面后 job 上下文不丢失。

### 阶段 2：新增 V2 questions API 和页面

任务：

1. 新增 `GET /api/import-flow-v2/jobs/:jobId/questions`。
2. 新增 `ImportJobQuestionsPage`。
3. 从 V2 入库完成入口跳转到 `/tools/import/jobs/:jobId/questions`。
4. 旧 `ifv2:` 结果页 redirect 到新页面。

验收：

- V2 已入库题目可以在新页面查看。
- 页面不再调用 `/api/tools/pdf-slicer/runs/:runId/questions`。
- 页面不再出现 `ifv2:` run 伪装逻辑。

### 阶段 3：新增 V2 导出 API

任务：

1. 抽出 question set 导出服务。
2. 新增 `POST /api/import-flow-v2/jobs/:jobId/export`。
3. 新增 `GET /api/import-flow-v2/jobs/:jobId/export-records`。
4. 前端导出弹窗调用新 API。

验收：

- V2 批次导出不再报“批次不存在”。
- V2 导出不依赖 `pdf_slicer_runs`。
- V2 导出不要求 `bank_status = 'banked'`。
- 导出记录能在导出记录页展示来源为“导入批次”。

### 阶段 4：迁移历史 V2 数据

任务：

1. 新增迁移脚本。
2. 为历史单文档 V2 创建 job。
3. 修正历史 V2 题目的 `import_source_id` 和 `source_run_id`。
4. 兼容旧 URL redirect。

验收：

- 老的 `ifv2:sourceDocumentId` 页面能跳到新 job 页面。
- 历史 V2 批次可以导出。
- 历史 V2 题目仍在题库中可搜索、可编辑。

### 阶段 5：清理 V2 对 V1 的依赖

任务：

1. 删除或隔离 `RunQuestionsPage` 中的 `ifv2:` 判断。
2. 删除 V2 入口到 `/tools/pdf-slicer/runs` 的跳转。
3. 将 V2 导出、题目查看、导出记录全部切到 `/api/import-flow-v2/jobs`。
4. 给旧 V2 API 别名加 deprecated 注释。

验收：

- `rg "ifv2:" frontend/src/pages/questions frontend/src/api/questionBank.ts` 不再出现 V2 主流程依赖。
- V2 页面不再调用 `pdfSlicerApi`、`pendingBankApi` 的 run 相关接口。
- V1 页面仍可正常查看历史 V1 run。

## 风险与处理

### 风险 1：已有 V2 单文档没有 job

处理：

- 迁移脚本自动补 job。
- `resolveImportJobForSourceDocument()` 兜底创建或提示。

### 风险 2：导出服务大量依赖 getRun

处理：

- 不直接改现有 `exportRunExamPdf()`。
- 先抽 `exportQuestionSetPdf()`。
- V1/V2 各自查数据后调用通用导出函数。

### 风险 3：bank_status 语义混乱

处理：

- V2 批次导出查询不使用 `bank_status = 'banked'`。
- V2 正式题目页面默认展示 `ready` 和 `blocked`。
- 第一版导出阻止 `blocked`，提示用户修正。

### 风险 4：手动修正仍复用 pdf_slicer_annotation 表

处理：

- 允许继续复用底层 annotation 表。
- 对外 API 和页面命名保持 V2。
- 后续如有必要再迁移为 `import_annotation_sessions`。

### 风险 5：导出记录兼容

处理：

- 第一阶段可用 `run_id = ifv2-job:{jobId}` 过渡。
- 长期新增 `import_job_id` 和 `source_type = import_job`。

## 测试计划

### 后端测试

新增或扩展：

```text
server/scripts/import-job.service.test.mjs
server/scripts/import-flow-v2-export.test.mjs
server/scripts/route-contract.test.mjs
```

覆盖：

1. 单文档上传自动创建 job。
2. 双文档 job 查询返回 documents。
3. job candidates 列表正确。
4. candidate commit 后写入 `import_source_id = ifv2-job:{jobId}`。
5. job questions 能查到已入库题目。
6. job export 能生成 PDF。
7. job export 不依赖 `pdf_slicer_runs`。
8. 历史 `ifv2:sourceDocumentId` 能 resolve 到 job。

### 前端验证

覆盖：

1. 新上传单文档，URL 进入 `/tools/import/jobs/:jobId`。
2. 识别、生成候选、核对入库全流程正常。
3. 入库完成后进入 `/tools/import/jobs/:jobId/questions`。
4. 在 questions 页面点击导出成功。
5. 老 URL `/tools/pdf-slicer/runs/ifv2:xxx/questions` 自动跳转。
6. V1 `/tools/pdf-slicer/runs/:runId/questions` 不受影响。

### 构建命令

```bash
npm run build:server
npm run build:frontend
npm run test:routes
```

## 推荐落地顺序

建议按以下 PR 或任务批次推进：

1. `import-job-routing-foundation`
   - 单文档 job 化
   - 新 routes
   - 前端 URL 迁移

2. `import-job-questions-page`
   - 新 V2 questions API
   - 新 V2 questions 页面
   - 旧 ifv2 result redirect

3. `question-set-export-service`
   - 抽通用导出服务
   - V1 export 保持兼容
   - V2 export 新增

4. `import-v2-history-migration`
   - 迁移脚本
   - 修复历史数据来源字段
   - 回归历史 V2 批次

5. `cleanup-v2-run-coupling`
   - 清理 `ifv2:` 在 V1 页面中的特殊逻辑
   - deprecated 旧顶层 V2 API
   - 更新文档

## 最终完成标准

完成后应满足：

1. V2 主流程不再跳转到 `/tools/pdf-slicer/runs/...`。
2. V2 导出不再调用 `/api/tools/pdf-slicer/runs/:runId/export-batch`。
3. V2 批次以 `import_jobs.id` 为唯一稳定 ID。
4. 新 V2 单文档和双文档都能查询、核对、入库、查看、导出。
5. 历史 V2 数据可迁移，旧 URL 可重定向。
6. V1 老链路仍能查看历史 run，但不再承载 V2 新功能。
7. 导出记录能区分 `collection`、`run`、`import_job` 来源。

