# WS-03：版本化迁移、ImportJob 来源与删除语义

## 1. 目标

建立正式的数据库迁移机制，规范 V2 导入关系，并修复 ImportJob/SourceDocument 删除可能导致的数据损坏问题。

本工作包是其他包含新表任务的前置基础设施。

## 2. 当前问题

1. `ensureSchema()` 同时承担建表、加列、数据回填和兼容升级。
2. 启动逻辑包含条件性 `DROP TABLE`，缺少迁移版本和审计记录。
3. `question_bank_items.import_source_id` 混用 Job ID、`ifv2-job:{id}` 和 SourceDocument ID。
4. `import_job_documents` 没有明确表达资料是独占还是共享。
5. 删除 ImportJob 会先删除磁盘资料，再删除数据库记录，无法原子回滚。
6. 多个高频 V2 查询缺少 `import_job_id` 外键和索引。

## 3. 第一阶段：迁移框架

### 3.1 目录与表

新增建议：

- `server/src/db/migrations/`
- `server/src/db/migrator.ts`
- `schema_migrations(version, name, checksum, applied_at)`

Migration 可以采用 TypeScript 模块或 SQL 文件，但必须支持：

- 有序执行。
- checksum 校验。
- 单 migration 事务。
- 重复启动幂等。
- dry-run/list/status 命令。
- 测试数据库从空库和历史 fixture 升级。

### 3.2 迁移 `ensureSchema()`

将现有建表作为 baseline migration；将 `ensureColumn()`、回填、索引创建拆成按版本执行的 migration。

迁移完成后：

- `ensureSchema()` 只负责调用 migrator，或被 `migrateDatabase()` 替代。
- 禁止新增启动时无版本 UPDATE/DELETE/DROP。
- destructive migration 必须显式标记并在执行前备份。

### 3.3 备份

桌面生产数据库执行 destructive migration 前：

1. 使用 SQLite backup API 或安全复制生成备份。
2. 记录文件大小、SHA-256、schema version。
3. 保留最近若干份备份。
4. 迁移失败时保持原数据库可恢复。

## 4. 第二阶段：规范 ImportJob 来源

### 4.1 目标关系

建议在 `question_bank_items` 新增 nullable `import_job_id`，正式外键到 `import_jobs.id`。

迁移规则：

- `import_source_id = jobId`：直接映射。
- `import_source_id = ifv2-job:{jobId}`：去前缀映射。
- `import_source_id = sourceDocumentId`：通过 `import_job_documents` 找到唯一 Job。
- 无法唯一映射：写入 exception report，不猜测。

迁移完成后，新代码只写 `import_job_id`。`import_source_id` 在兼容窗口只读，最终删除或改为普通来源描述字段。

### 4.2 索引与约束

至少考虑：

- `question_bank_items(import_job_id, bank_status, created_at)`
- `import_job_documents(job_id, role)` 唯一性或明确的业务约束
- `import_job_documents(source_document_id)`
- `question_candidates(ocr_document_id)` 的外键完整性
- `question_candidates(committed_question_id)` 的可空外键
- `question_bank_export_records(import_job_id)` 的可空外键

不要继续用空字符串代替所有 nullable foreign key。新 migration 应逐步改为真正的 NULL；如 SQLite 重建表风险过高，可分阶段完成。

## 5. 第三阶段：ImportJob/SourceDocument 所有权

推荐采用“一个 SourceDocument 归一个 ImportJob 独占”的模型，因为当前上传流程会为任务创建自己的资料，且删除行为已经按独占实现。

需要：

- 对 `import_job_documents.source_document_id` 增加唯一约束。
- 添加资料到 Job 时检查已有所有者并返回 409。
- 提供显式 move/transfer，而不是隐式共享。
- 迁移前扫描现有共享记录并生成报告。

如果产品明确需要资料复用，则改用共享模型：删除 Job 只删除 join row，资料引用数为零后才能回收。实施前必须由产品确认，不能同时支持两种不明确语义。

## 6. 删除协议

删除 ImportJob 建议采用两阶段流程：

1. 数据库事务内将 Job 标记 `deleting`，记录待删除文件清单。
2. 将文件移动到 `trash/import-jobs/{jobId}`，不立即不可恢复删除。
3. 数据库事务删除或软删除关联记录。
4. 后台 cleanup 在保留期后清空 trash。

任何阶段失败都必须能够重试。API 返回前应明确删除是否完成，不能记录错误后继续返回 success。

同时明确已入库题目的策略：删除 ImportJob 是否保留题库题目和来源快照。推荐保留题目，将 `import_job_id` 设为 NULL 或引用软删除 Job；不应因删除导入记录而删除用户题库资产。

## 7. V1 数据迁移

为 WS-04 提供可重复运行的迁移命令，至少处理：

- V1 batch/run 到 ImportJob/SourceDocument 的映射。
- V1 已入库题目的 `import_job_id`。
- V1 导出记录来源。
- WS-01 提供的 candidate fix session 转换规则。
- 题图和来源文件路径的存在性校验。

迁移输出 JSON/Markdown 报告，包含转换数量、跳过数量、异常 ID 和磁盘缺失文件。

## 8. 文件所有权

本工作包拥有：

- `server/src/db/schema.ts`
- 新 migrations/migrator
- ImportJob/SourceDocument 所有权约束
- ImportJob 删除编排
- 数据迁移和审计脚本
- 迁移测试 fixture

其他 Agent 如需新表，应提交字段契约，本工作包统一创建 migration，避免并发修改 schema。

## 9. 测试计划

必须覆盖：

1. 空数据库完整初始化。
2. 当前生产 schema 升级。
3. 至少一个旧 schema fixture 升级。
4. migration 重复运行不产生变化。
5. checksum 变化被拒绝。
6. migration 失败保持事务回滚。
7. 所有三种 `import_source_id` 格式正确回填。
8. 模糊 SourceDocument 映射进入异常报告。
9. 删除 ImportJob 的数据库失败、文件移动失败和重试。
10. 删除 Job 不删除已入库题目。

## 10. 完成标准

- 所有新 schema 变化通过 versioned migration。
- 启动路径不再包含未版本化的 destructive SQL。
- 新题目只写正式 `import_job_id`。
- ImportJob 删除语义明确、可恢复并有失败测试。
- WS-01/02 可以通过独立 migration 增加新表。
