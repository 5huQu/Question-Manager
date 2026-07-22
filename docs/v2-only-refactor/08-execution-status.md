# V2-only 改造执行状态

## 1. 当前结论

截至 2026-07-22，生产导入运行时已经切换为 V2-only：前后端不再挂载或调用 V1 `pdf-slicer` 写链路，V2 手动修正、OCR 任务、ImportJob 来源、导出、前端导航和桌面打包均使用 V2 模型。

V1 数据表尚未删除。30 个缺失 PNG 所属的误导入任务已由用户确认整体废除，其 18 道题、archive ImportJob、provenance 和异常记录已在备份后事务删除。最新数据迁移审计已经通过；37 个 annotation session 仍需依赖原表追溯，因此 annotation 表的 destructive migration 仍需单独评估。

## 2. 工作包状态

| 工作包 | 状态 | 主要结果 |
| --- | --- | --- |
| WS-01 | 完成 | V2 原生 candidate-fix 表、repository、service、router 和前端 hook；不再依赖 V1 annotation runtime |
| WS-02 | 完成 | SQLite OCR task、lease、attempt、恢复、幂等与优雅中断 |
| WS-03 | 完成，删表 gate 阻塞 | checksummed migration、备份、来源映射、删除协议、V1 audit/migrate CLI、archive provenance |
| WS-04 | 生产运行时完成，删表延期 | 删除 V1 UI/API/runtime/Python runner；保留历史只读 adapter 和 V1 表 |
| WS-05 | 完成 | canonical V2 API、模块化 router、运行时校验、旧 alias 404 |
| WS-06 | 第一阶段完成 | route builders、可见性感知串行 polling、页面 model/组件拆分 |
| WS-07 | 核心项完成 | 类型/CI、上传限制、列表性能、Electron CSP/navigation/window 安全 |

## 3. 真实数据迁移结果

已执行带自动 SQLite 备份的非破坏性迁移，未删除 V1 表、记录或文件。

- Batch：7/7 已映射。
- Run：8/8 已映射。
- Question：281/281 已关联 canonical `import_job_id`。
- Export：28/28 已关联 canonical `import_job_id`。
- Migration exception：0。
- 缺失 source 文件：0。
- 缺失 figure：0；此前 30 个缺失 PNG 所属误导入任务已整体删除。
- Annotation session：37 个仍依赖 V1 原表追溯。

最近备份：

`data/database-backups/v1-import/2026-07-22T00-19-53-021Z-before-v0.sqlite`

误导入任务删除前备份：

`data/database-backups/manual-retirement/2026-07-22T00-53-34-443Z-before-v0.sqlite`

最近审计报告：

`data/migration-reports/2026-07-22T00-53-41-338Z-v1audit_20260722005341_bda25f.md`

最新审计 gate 为 PASS。删除 annotation 相关表前仍应先为 37 个历史 annotation session 建立可独立恢复的归档或明确处置记录。

## 4. 明确保留的历史兼容层

以下内容不参与生产写链路，但在数据 gate 通过前必须保留：

- `server/src/db/runs.ts`
- `server/src/db/review.ts`
- `server/src/services/question-bank/import.ts`
- `server/src/services/import-flow-v2/v1-data-migration.service.ts`
- `server/src/utils/figure-helpers.ts` 中的历史图像回溯 adapter
- `server/src/utils/exam-zh.ts` 中的历史 run 只读导出函数
- V1 mapping、archive provenance、migration report、backup 和 checksum reconciliation 结构
- `pdf_slicer_*` 数据表及 schema 兼容定义

历史 `/tools/pdf-slicer/*` 前端 URL 只显示退役信息；可识别的 `ifv2:`/`ifv2-job:` 来源只读跳转到 canonical ImportJob 页面，不会创建 V1 run 或 batch。

## 5. 验证结果

以下验证均已通过：

- `npm run typecheck`
- `npm run test:frontend`：18 files / 68 tests
- `npm run test:integration`：106 canonical route contracts 及全部 service integration
- `npm run test:python`
- `npm run test:math-render`
- `npm run test:electron-security`
- `npm run test:smoke`
- `npm run verify:python-runtime`
- `npm run build`
- `npm run pack:desktop`
- packaged Python V2 PDF render/crop smoke
- `git diff --check`

静态扫描确认：生产代码除上述明确保留的历史只读 adapter 外，不再引用 `services/pdf-slicer`、`routes/pdf-slicer`、`repositories/pdf-slicer` 或 `/api/tools/pdf-slicer`。

## 6. 后续工作

1. 将 37 个 annotation session 导出为可独立恢复的归档包，并验证恢复。
2. 在单独发布中执行 destructive migration；不要与应用代码删除同批执行。
4. 继续拆分 `ImportV2Page` 的 document/candidate review 页面，并引入统一 query cache。
5. 为 parser/export/candidate 的深层 payload 补齐完整运行时 schema。
6. 后续引入 lint/format 基线和大文件磁盘流式上传。
7. 处理打包警告：应用签名、正式图标，以及评估启用 ASAR。
