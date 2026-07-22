# WS-04：V1 生产运行时退役

## 1. 目标

在 V2 能力和数据迁移完成后，删除 V1 的生产写入口、执行代码、页面、测试契约和无用打包内容。历史数据如需保留，只通过 V2 迁移结果或明确的只读归档访问。

这是最终切换工作包，不应提前执行。

## 2. 前置门槛

开始前必须确认：

- WS-01：V2 手动修正不再依赖 annotation V1。
- WS-02：V2 OCR 有独立任务恢复。
- WS-03：历史来源、ImportJob 外键和迁移报告完成。
- WS-05：V2 API 命名空间已稳定。
- 已生成生产数据库备份和 V1 数据盘点报告。

## 3. 退役范围

### 3.1 前端

候选删除范围：

- `frontend/src/pages/pdf-slicer/`
- `frontend/src/pages/PendingBankPage.tsx`
- `frontend/src/pages/ocr/` 中只服务 V1 run 的页面
- `frontend/src/pages/questions/RunQuestionsPage.tsx` 的 V1 模式
- `frontend/src/api/pdfSlicer.ts`
- `frontend/src/api/pendingBank.ts`
- `frontend/src/api/ocr.ts` 中 V1 API
- `frontend/src/components/pdf-slicer/`
- `App.tsx` 中 `/tools/pdf-slicer/*` 路由和旧 run redirect

删除前使用 `rg` 验证没有 V2 消费者。

### 3.2 后端

候选删除范围：

- `server/src/routes/pdf-slicer/`
- `server/src/services/pdf-slicer/`
- `server/src/repositories/pdf-slicer/`
- `server/src/db/runs.ts`
- `server/src/db/review.ts`
- `server/src/db/solutions.ts`
- 只支持 V1 slice JSON 导入的 question-bank service
- `server/src/index.ts` 中全部 V1 route mount 和 `recoverInterruptedRuns()`

共享算法必须在删除前由 WS-01/03 提取到中立模块。禁止为了保留一个函数而继续保留整个 V1 service。

### 3.3 Python

优先删除或移出生产包：

- `server/python/src/cutter/`
- `server/python/src/lab/`
- `server/python/src/review/`
- `run_cut.py`
- `run_cut_for_question.py`
- `run_review.py`
- `run_review_v2.py`
- 旧 `run_doc2x_ocr.py`、`run_glm_ocr.py`、`run_ocr_trial.py` 和 manifest runner

保留前必须有 TypeScript 生产调用方或明确的维护命令。题库分类、PDF 页面渲染、裁剪等仍被 V2 使用的脚本应迁入清晰的 `runtime-tools` 目录。

### 3.4 依赖与打包

- 将 `package.json` 的 Python 打包规则从整个目录改为 allowlist。
- 删除 Flask 及其传递依赖，前提是没有生产 Flask 服务。
- 更新 Python runtime 验证脚本，只验证保留能力。
- 比较改造前后的安装包体积和启动时间。

## 4. 路由策略

生产系统不再挂载 `/api/tools/pdf-slicer/*` 写接口。

历史 URL 有两种处理方式：

- 已迁移到 ImportJob：前端执行只读 redirect 到 `/tools/import/jobs/:jobId`。
- 无法迁移：显示明确的“历史记录不可直接操作”页面和迁移报告 ID。

不要让旧 URL 重新调用 V1 service。

## 5. 数据表删除

V1 表删除必须由 WS-03 提供单独 destructive migration。至少包括：

- `pdf_slicer_batches`
- `pdf_slicer_runs`
- `pdf_slicer_review_items`
- `pdf_slicer_solution_items`
- `pdf_slicer_annotation_sessions`
- `pdf_slicer_annotation_regions`

删除前置检查：

- V2 service 已无 SQL 引用。
- V1 历史数据迁移计数通过。
- 所有 V1 文件有归档或删除策略。
- 备份恢复演练通过。

## 6. 测试调整

现有 route contract 将 V1 route 当作必备能力，应改为：

1. 验证 V2 canonical route 存在。
2. 验证 V1 写 route 不存在或返回 410。
3. 验证 V2 模块没有 V1 import，可用静态依赖测试。
4. 验证旧 URL redirect 只读且不会创建 run/batch。
5. 删除 V1 cutter/OCR 单测；保留已抽取纯算法的测试。

## 7. 文档更新

必须更新：

- `README.md`
- `AGENT.md`
- `AGENT_zhcn.md`
- `docs/capability_matrix.md`
- `docs/import_flow_v2.md`

历史任务文档可以保留，但应在顶部标注“历史设计，不代表当前生产架构”。

## 8. 完成标准

- UI 中没有 V1 入口。
- 生产 bundle 不包含 V1 页面和 API client。
- Server 不挂载 V1 写 route。
- V2 模块不引用 V1 service/table。
- Python runtime 不包含无调用方的旧 runner 和 Flask 服务。
- V1 数据表已在独立发布中安全删除，或明确处于只读归档期。
- 全量测试、桌面打包和历史数据迁移演练通过。
