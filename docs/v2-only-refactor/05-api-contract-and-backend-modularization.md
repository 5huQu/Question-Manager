# WS-05：V2 API 契约与后端模块化

## 1. 目标

将当前集中在一个文件中的 V2 路由拆分为清晰模块，统一 API 命名空间，删除重复别名，并引入共享的运行时请求/响应校验。

## 2. 当前问题

`server/src/routes/import-flow-v2.ts` 同时挂载约 66 个端点，并维护多套等价路径：

- `/api/import-flow-v2/*`
- `/api/import-jobs/*`
- `/api/source-documents/*`
- `/api/ocr-documents/*`
- `/api/question-candidates/*`

前后端分别手写类型，大量 service 接收 `Record<string, unknown>` 并通过 `String()`、`Number()`、`as any` 规整。类型检查无法保证运行时输入，也容易产生契约漂移。

## 3. Canonical API

建议继续使用已经被主前端广泛采用的 `/api/import-flow-v2`，避免无收益改名。

目标资源结构：

```text
/api/import-flow-v2/jobs
/api/import-flow-v2/jobs/:jobId/documents
/api/import-flow-v2/jobs/:jobId/candidates
/api/import-flow-v2/jobs/:jobId/questions
/api/import-flow-v2/jobs/:jobId/exports
/api/import-flow-v2/source-documents
/api/import-flow-v2/source-documents/:sourceDocumentId/ocr-tasks
/api/import-flow-v2/ocr-documents
/api/import-flow-v2/candidates
/api/import-flow-v2/candidate-fix-sessions
/api/import-flow-v2/parser-config
/api/import-flow-v2/parser-presets
```

同一业务动作只保留一个 method/path。

## 4. Router 拆分

建议目录：

```text
server/src/routes/import-flow-v2/
  index.ts
  jobs.ts
  source-documents.ts
  ocr-documents.ts
  candidates.ts
  candidate-fix.ts
  parser-config.ts
  exports.ts
```

每个 router 只做参数读取、schema parse、service 调用和响应。Multer 配置、文件处理、SQL 和业务循环不得进入 router。

## 5. 契约方案

选择一个运行时 schema 方案，例如 Zod、TypeBox 或 JSON Schema/Ajv。不要只新增 TypeScript interface。

建议建立：

```text
shared/contracts/import-v2/
  jobs.ts
  source-documents.ts
  ocr.ts
  candidates.ts
  candidate-fix.ts
  common.ts
```

要求：

- Server 解析请求并验证响应关键结构。
- Frontend 从同一 schema 推导类型。
- 枚举值只定义一次。
- 校验错误返回统一 400 payload。
- 文件上传字段也需要 schema 化校验。

如暂不引入共享 package，至少先建立 server-side schema，并自动生成前端 `.d.ts`；不能继续双边手写。

## 6. 兼容别名退役

先扫描前端和脚本消费者。没有消费者的别名直接删除；仍有消费者的别名经历以下窗口：

1. Canonical API 可用。
2. 客户端迁移。
3. 别名返回 deprecation header 并记录调用次数。
4. 调用次数归零后删除。

本地桌面应用通常可以同版本更新前后端，因此兼容窗口不应长期存在。

## 7. Service/Repository 边界

在拆 route 时同步处理以下问题：

- `import-batch.service.ts` 中的列表 SQL 移入 repository。
- 统一 transaction helper，避免多个 service 各自手写 BEGIN/ROLLBACK。
- 不在 service 使用 Express 类型；上传文件映射为内部 DTO。
- Provider 错误转换为领域错误，不泄漏原始敏感 payload。
- 批量 commit 明确 all-or-nothing 或 partial-success 语义，并在契约中表达。

## 8. 文件所有权

本工作包拥有：

- `server/src/routes/import-flow-v2*`
- V2 contract/schema 目录
- `frontend/src/api/importV2.ts` 或拆分后的 V2 API clients
- route contract tests

WS-01 应先提供 candidate-fix service/API 契约；WS-06 通过 API client 消费，不直接拼 URL。

## 9. 测试计划

必须新增：

1. 每个 canonical route 的 method/path/状态码测试。
2. 非法枚举、缺失字段、错误 number/string 类型返回 400。
3. 响应满足共享 schema。
4. 重复别名删除后的 negative route test。
5. Multer/file size/type 错误返回 JSON，而不是 Express HTML。
6. 静态检查 route 不包含直接 SQL。

## 10. 完成标准

- V2 只有一套 canonical API。
- 巨型 route 文件被拆分。
- 前后端共享或生成 API 类型。
- Service 不再普遍接收未经验证的 `Record<string, unknown>`。
- route contract 同时验证必要端点存在和废弃端点不存在。
