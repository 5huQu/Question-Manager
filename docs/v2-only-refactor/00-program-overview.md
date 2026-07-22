# V2-only 工程改造总纲

> 实施状态（2026-07-22）：WS-01 至 WS-07 的生产运行时改造已完成并通过整合、构建和桌面打包验证。V1 数据表尚未删除；历史数据删除门槛及恢复项见 [`08-execution-status.md`](./08-execution-status.md)。

## 1. 背景与目标

产品事实已经确定：V1 导入链路退役，后续导入完全采用 V2。

当前仓库虽然已经以 ImportJob、SourceDocument、OCRDocument 和 QuestionCandidate 为主线，但 V2 仍复用 V1 的标注表、标注 API、部分来源字段、兼容路由和 Python runtime。数据库升级、任务恢复、删除语义、前端类型门禁和模块边界也需要同步治理。

本计划的最终目标不是简单隐藏 V1 菜单，而是让生产系统满足以下条件：

1. 新导入只能通过 V2 完成。
2. V2 运行时不依赖 `pdf-slicer` route、service、repository 或数据表。
3. 历史 V1 数据完成迁移、归档或明确删除，不再驱动生产逻辑。
4. ImportJob 成为导入来源、状态、导出和追溯的唯一批次模型。
5. 数据库升级可审计、可测试、可恢复。
6. 关键后台任务在应用重启后可以恢复或安全失败。
7. 前后端具备稳定的类型、测试和质量门禁。

## 2. 非目标

本轮不同时重做题目解析算法、OCR 模型效果、题库编辑器、试卷排版算法或整体视觉设计。除非某项改动是解除 V1 依赖的必要条件，否则应保持现有业务行为。

## 3. 工作包

| 编号 | 文档 | 主要交付物 | 前置依赖 |
| --- | --- | --- | --- |
| WS-01 | [`01-v2-manual-fix-domain.md`](./01-v2-manual-fix-domain.md) | V2 原生候选题手动修正域 | WS-03 迁移框架 |
| WS-02 | [`02-v2-ocr-task-lifecycle.md`](./02-v2-ocr-task-lifecycle.md) | 持久化 OCR 任务、重启恢复 | WS-03 迁移框架 |
| WS-03 | [`03-database-migrations-and-import-identity.md`](./03-database-migrations-and-import-identity.md) | 版本化迁移、ImportJob 外键、删除语义 | 无 |
| WS-04 | [`04-v1-runtime-retirement.md`](./04-v1-runtime-retirement.md) | 移除 V1 生产入口、代码和打包内容 | WS-01、02、03、05 |
| WS-05 | [`05-api-contract-and-backend-modularization.md`](./05-api-contract-and-backend-modularization.md) | 单一 V2 API、拆分 router、运行时校验 | WS-01 接口稳定 |
| WS-06 | [`06-frontend-import-refactor.md`](./06-frontend-import-refactor.md) | 拆分 ImportV2Page、统一查询和轮询 | 可先独立进行 |
| WS-07 | [`07-engineering-quality-performance-security.md`](./07-engineering-quality-performance-security.md) | CI、类型、上传安全、性能和桌面安全 | 可先独立进行 |

## 4. 推荐执行波次

### Wave 0：基础设施

- 执行 WS-03 的版本化迁移框架部分。
- 在此阶段冻结新的 `ensureColumn()` 和启动时数据回填。
- 确定历史数据备份位置、迁移审计表和回滚策略。

### Wave 1：V2 能力补齐，可并行

- Agent A：WS-01，V2 手动修正域。
- Agent B：WS-02，OCR 任务生命周期。
- Agent C：WS-06，前端导入页面拆分。
- Agent D：WS-07 中不依赖 API 变更的质量门禁与上传限制。

### Wave 2：数据与接口收敛

- 完成 WS-03 的 ImportJob 来源外键、删除语义和历史数据迁移。
- 执行 WS-05，统一 API 命名空间并拆分 router。
- WS-06 根据稳定后的 API 完成最终适配。

### Wave 3：V1 切换与删除

- 执行 WS-04。
- 删除 V1 写入口前先运行迁移核对和只读兼容验证。
- 删除代码后再精简 Python runtime、依赖和安装包内容。

### Wave 4：整体验收

- 全量构建、测试、打包和数据迁移演练。
- 更新 README、Agent Guide、能力矩阵和运维说明。

## 5. 全局架构约束

所有工作包必须遵守以下约束：

1. Route 只负责 HTTP 参数、调用 service 和响应。
2. Service 负责业务校验、状态机和跨 repository 编排。
3. Repository 负责 SQL 和 row 映射；事务边界由明确的应用服务控制。
4. 生产代码不得新增从 `import-flow-v2` 到 `pdf-slicer` 的依赖。
5. 新数据库结构只能通过版本化 migration 创建，不能继续扩展 `ensureSchema()`。
6. 文件系统副作用必须设计失败恢复，不能假设数据库事务能够回滚文件删除。
7. 兼容代码必须有删除条件、测试和截止版本，不能变成永久分支。
8. 不得在重构过程中更改题目内容语义或静默丢弃历史数据。

## 6. 文件所有权与冲突控制

以下高冲突文件在同一时间只允许一个工作包修改：

| 文件 | 默认所有者 | 说明 |
| --- | --- | --- |
| `server/src/db/schema.ts` | WS-03 | 迁移框架落地后应尽量不再修改 |
| `server/src/index.ts` | WS-02，之后 WS-04 | 先接入任务恢复，最后删除 V1 route mount |
| `server/src/routes/import-flow-v2.ts` | WS-05 | WS-01 先新增独立 router，避免继续扩大该文件 |
| `frontend/src/App.tsx` | WS-06，之后 WS-04 | 先完成 V2 路由拆分，最后删除 V1 路由 |
| `frontend/src/api/importV2.ts` | WS-05 | WS-06 只消费既有方法或通过小型适配层工作 |
| `package.json` | WS-07，之后 WS-04 | 先加门禁，最后删 V1 runtime/依赖 |
| `.github/workflows/quality.yml` | WS-07 | 其他工作包不得自行改变 CI 顺序 |

如确需跨所有权修改，执行 Agent 应在提交说明中单独列出，并让文件所有者工作包在合并前复核。

## 7. 数据迁移总原则

1. 迁移前创建 SQLite 备份并记录源数据库哈希。
2. 每个迁移必须写入 `schema_migrations`，重复执行不得重复修改数据。
3. 历史 V1 数据迁移必须生成计数报告：批次、资料、OCR 文档、候选题、题库题目、题图和导出记录。
4. 无法自动迁移的数据进入明确的 exception report，不得静默跳过。
5. 删除 V1 表必须是单独的最后阶段 migration，不与数据转换混在同一次发布中。

## 8. 统一完成标准

整个项目达到以下条件才算 V2-only 改造完成：

- `server/src/services/import-flow-v2/` 中不存在对 `services/pdf-slicer/` 的 import。
- 生产前端不再 import `api/pdfSlicer.ts`、`api/pendingBank.ts` 或旧 OCR API。
- 生产后端不再挂载 `/api/tools/pdf-slicer/*` 写接口。
- V2 手动修正不读写 `pdf_slicer_annotation_*`。
- 新入库题目通过正式 `import_job_id` 关联 ImportJob。
- OCR 中途退出后重启，不会永久停留在 `ocr_running`。
- 删除 ImportJob 不会误删共享资料或留下数据库/磁盘半删除状态。
- 前后端类型检查、单元测试、服务测试、Python 测试和 smoke test 全部通过。
- 桌面包中不包含无生产调用方的 V1 runner 和 Flask 服务。
- README 和 Agent Guide 不再要求保留 V1 工作流。

## 9. 每个 Agent 的交付格式

每个工作包的最终交付应包含：

1. 修改摘要和明确的未完成项。
2. 数据库、文件系统、API 和 UI 行为变化。
3. 新增/删除的兼容逻辑及删除条件。
4. 执行过的测试命令和结果。
5. 需要下游工作包关注的接口或迁移说明。
6. 对现有用户数据的影响和恢复方法。
