# WS-02：V2 OCR 任务生命周期与重启恢复

## 1. 目标

将 SourceDocument OCR 从进程内 Promise 管理升级为持久化任务模型，使应用退出、服务崩溃或机器重启后，任务能够明确恢复、重试或失败，不会永久停留在 `ocr_running`。

## 2. 当前问题

当前实现使用 `activeSourceDocumentOcrTasks: Map<string, Promise<void>>`。SourceDocument 状态和 `ocr-task.json` 会写入磁盘，但服务启动时没有对应的 V2 恢复逻辑。

风险包括：

- 重启后内存 Map 为空，但 SourceDocument 仍为 `ocr_running`。
- 再次启动 OCR 会因为状态冲突返回 409。
- 无法区分远端 provider 仍在运行、已完成或本地进程中断。
- 没有 lease、attempt、last heartbeat 和结构化失败原因。

## 3. 目标模型

建议新增 `source_document_ocr_tasks`：

- `id`
- `source_document_id`
- `provider`
- `status`：`queued | running | succeeded | failed | interrupted | cancelled`
- `attempt`
- `provider_task_id`
- `provider_phase`
- `provider_progress`
- `started_at`
- `finished_at`
- `heartbeat_at`
- `lease_owner`
- `lease_expires_at`
- `ocr_document_id`
- `error_code`
- `error_message`
- `metadata_json`
- `created_at`
- `updated_at`

DDL 由 WS-03 migration 创建。本工作包定义状态机和 repository 契约。

## 4. 状态机

允许的核心转换：

```text
queued -> running
running -> succeeded
running -> failed
running -> interrupted
queued/running -> cancelled
failed/interrupted -> queued (new attempt)
```

禁止直接覆盖 succeeded task。强制重跑应创建新的 task attempt，并保留旧任务供审计。

## 5. 实施任务

### 5.1 Repository

新增：

- `server/src/repositories/source-document-ocr-tasks.repo.ts`

提供创建任务、claim lease、heartbeat、完成、失败、标记过期任务和按 SourceDocument 查询最新任务的方法。

### 5.2 Service 重构

重构 `server/src/services/import-flow-v2/ocr-task.service.ts`：

1. API 请求只创建/领取任务，不把内存 Map 当作事实来源。
2. provider 调用前写入 running 和 lease。
3. provider polling 期间更新 heartbeat/progress。
4. OCRDocument、SourceDocument 和 task 完成状态尽量在同一事务中提交。
5. 原始响应和大文件仍写磁盘，但路径和哈希写入 task metadata。
6. 失败时保存结构化 provider error，不返回密钥或完整敏感响应。

### 5.3 启动恢复

新增 `recoverInterruptedSourceDocumentOcrTasks()` 并在应用启动时执行：

- lease 未过期：保留，避免重复执行。
- lease 已过期且 provider 可继续查询：重新 claim 并继续 polling。
- 无法恢复的本地任务：标记 `interrupted`，同步 SourceDocument 为 `ocr_failed` 或新的 `ocr_interrupted`。
- 已存在 OCRDocument 但 task 未完成：修复为 succeeded。

恢复函数必须幂等。

### 5.4 并发控制

以数据库唯一约束或事务保证同一 SourceDocument 同时最多一个 active task。内存 Map 可以保留为本进程优化，但不得承担一致性职责。

### 5.5 API 响应

`getSourceDocumentOcrStatus()` 应从数据库任务返回稳定结构。兼容期可以继续返回 `task` 字段，但内容来源必须是 persisted task。

### 5.6 关闭流程

服务收到 SIGTERM/SIGINT 时：

- 停止领取新任务。
- 尝试刷新 heartbeat/中断状态。
- 设置有限的优雅退出时间。
- 不应简单依赖父 Electron 进程直接 kill 后自然恢复。

## 6. 文件所有权

本工作包主要拥有：

- `server/src/services/import-flow-v2/ocr-task.service.ts`
- 新 OCR task repository
- 启动恢复模块
- `server/src/index.ts` 中 V2 OCR recovery 接入
- OCR task 测试

不要修改 V1 `recoverInterruptedRuns()` 的语义；WS-04 最终会删除它。

## 7. 测试计划

必须新增：

1. 同一 SourceDocument 并发启动只成功一次。
2. running task 在模拟重启后被标记 interrupted 或继续执行。
3. 已完成 OCRDocument 修复为 succeeded。
4. provider 超时和业务错误分别记录。
5. force 重跑创建新 attempt，不覆盖历史 task。
6. 已 committed candidate 时禁止 force 重跑。
7. task 成功但 SourceDocument 更新失败时事务回滚。
8. recovery 重复执行结果一致。

建议命令：

```sh
npm run build:server
npm run test:routes
npm run test:ocr-normalizer
npm run test:smoke
```

## 8. 完成标准

- 服务重启后不存在无法重试的永久 `ocr_running` 状态。
- OCR task 的事实来源是 SQLite，不是进程内 Map 或单个 JSON 文件。
- 任务状态转换有测试覆盖和结构化错误信息。
- WS-04 删除 V1 run recovery 后，V2 仍能独立恢复。
