# WS-07：工程质量、性能与运行时安全

## 1. 目标

补齐当前 CI 没有覆盖的类型和静态质量问题，治理 V2 列表查询性能、文件上传内存风险、错误处理和 Electron 安全基线。

本工作包应分成小提交，避免把质量门禁、性能 SQL 和 Electron 改动混为一次不可审阅的大改。

## 2. 前端类型与 CI

### 当前状态

Vitest 可以通过，但 `npx tsc -p frontend/tsconfig.json` 当前失败。Vite build 只转译，不承担完整类型检查，因此 CI 绿灯不能证明前端类型正确。

### 任务

新增脚本：

```json
"typecheck:frontend": "tsc -p frontend/tsconfig.json",
"typecheck:server": "tsc -p server/tsconfig.json --noEmit",
"typecheck": "npm run typecheck:server && npm run typecheck:frontend"
```

修复当前所有前端错误，并在 `.github/workflows/quality.yml` 中把 typecheck 放在测试前。

## 3. Lint 与格式

选择 ESLint + Prettier 或 Biome，至少检查：

- 未使用 import/变量。
- 不安全 `any` 和 `@ts-ignore`。
- React hooks dependencies。
- Promise 未处理。
- 一致的格式和导入顺序。

首次接入应先修复基线，不建议用大范围 disable。对于难以一次清理的规则，记录明确的后续计数上限。

## 4. 测试入口

建立统一脚本：

- `test:unit`
- `test:integration`
- `test:python`
- `test:all`
- `check`：typecheck + lint + tests

减少每个 server test 重复执行 build 的成本，可先 build 一次后运行多个测试文件。

新增 V2-only 架构约束测试：

- V2 service 不得 import `pdf-slicer`。
- 生产前端不得 import V1 API client。
- V1 写 route 在 WS-04 后不得存在。
- Python package allowlist 中每个脚本都有调用方或明确维护用途。

## 5. ImportJob 列表性能

当前 `listImportJobsWithStats()` 对每个 Job、Document 逐个查询统计，前端在 OCR 运行时每 4 秒调用一次。

改造为聚合查询：

- 一次查询 jobs 分页。
- 一次查询 job documents + source documents。
- 一次按 job/source 聚合 OCR、candidate 和 question status。
- Repository 返回已组装的行或聚合 map。

增加查询计划/性能测试。建议 fixture 至少包含 200 Jobs、400 Documents 和数千 Candidates，并设定合理耗时上限。

## 6. 上传安全与资源限制

普通上传当前使用无大小上限的 `multer.memoryStorage()`。

需要：

- 为 PDF、图片、题图和 Doc2X package 分别设置文件大小上限。
- 限制 files/fields/parts 数量。
- 大 PDF/package 使用临时磁盘或流式写入，避免完整 Buffer 常驻内存。
- 校验扩展名、MIME 和必要的文件签名。
- 文件名只用于显示，存储路径使用生成 ID。
- MulterError 通过统一 JSON error middleware 返回。
- 临时文件在成功、失败和重启后都能清理。

具体上限写入配置和 README，不要散落魔法数字。

## 7. Express 错误处理与日志

当前多数 route 重复 try/catch，并可能将普通 Error message 原样返回给前端。Multer 等 middleware 错误也没有统一 JSON handler。

建议：

- async route wrapper 或 Express 统一 error middleware。
- RouteError/validation/provider/internal error 使用稳定 error code。
- 500 响应不直接暴露底层路径、命令或 provider payload。
- 使用结构化日志，至少包含 request ID、job ID、source document ID、task ID 和 elapsed time。
- OCR/导出/迁移任务记录开始、完成和失败事件。

本地桌面应用不需要复杂远端遥测，但应有可导出的本地诊断日志和轮转策略。

## 8. Electron 安全基线

保持 `contextIsolation: true` 和 `nodeIntegration: false`，并补充：

- 明确 renderer sandbox 配置。
- Content-Security-Policy。
- `will-navigate` 限制，只允许本地应用 origin。
- `setWindowOpenHandler`，外部链接通过 `shell.openExternal` 白名单处理。
- IPC 入参运行时校验。
- API 继续绑定 `127.0.0.1`，评估增加每次启动随机 token 防止本机其他页面/进程调用写 API。

同时将 UI 显示版本改为 Electron/package 真实版本，不要硬编码 `v2.0.0`。

## 9. Python runtime 精简支持

配合 WS-04：

- 建立 TypeScript -> Python script 调用清单测试。
- runtime verification 验证 PyMuPDF、Pillow 和实际保留脚本。
- 删除 Flask 后同步删除传递依赖。
- 记录精简前后 runtime 和安装包大小。

## 10. 文件所有权

本工作包主要拥有：

- `package.json` 中质量脚本
- `.github/workflows/quality.yml`
- lint/format 配置
- `server/src/config.ts` 上传配置
- Express 全局错误处理中间件
- ImportJob 列表查询性能改造
- Electron 安全设置
- 对应测试和文档

WS-04 最终会再次修改 `package.json` 删除 V1 内容，因此两者必须按顺序合并。

## 11. 验收命令

至少执行：

```sh
npm run typecheck
npm run lint
npm run test:frontend
npm run test:routes
npm run test:question-parser
npm run test:ocr-normalizer
npm run test:math-render
npm run test:smoke
PYTHONPATH=server/python python3 -m unittest discover -s server/python/tests -p 'test_*.py' -v
```

涉及 Electron 或打包时还需执行 Python runtime verification 和桌面包 smoke test。

## 12. 完成标准

- CI 会阻止前端类型错误进入主分支。
- Lint 和格式检查有稳定基线。
- ImportJob 列表不存在按 Job/Document 成倍增长的 N+1 查询。
- 上传大小和内存使用有明确上限。
- Middleware 错误统一返回 JSON。
- Electron 具备 CSP、导航和窗口打开限制。
- 质量门禁可以验证 V2-only 架构约束。
