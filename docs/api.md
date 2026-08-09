# Question Manager API 指南

本文件说明本地 API 的访问方式、认证规则与接口分组。完整的机器可读接口目录在 [openapi.yaml](./openapi.yaml)，可直接导入 Swagger UI、Postman 或 Insomnia。

接口实现以 `server/src/routes/` 为准；前端调用与可复用的响应类型集中在 `frontend/src/api/`。新增、删除或修改路由时，必须同步更新本文件与 OpenAPI 描述。

## 基本约定

- 开发环境默认地址为 `http://127.0.0.1:8797`。Electron 打包版会通过 preload 提供实际的本机地址，前端不应硬编码端口。
- 除 `/livez` 及认证初始化接口外，路径均以 `/api` 开头，响应默认为 JSON。`GET /api/import-flow-v2/source-documents/:id/pages/:page` 返回页面图片，模型拆题的 `.../model-split/stream` 返回 Server-Sent Events。
- 路径参数必须 URL 编码；所有 JSON 写请求使用 `Content-Type: application/json`。上传接口使用 `multipart/form-data`，文件字段名为 `file`。
- API 当前没有 URL 版本号。若要改变已有请求或响应的不兼容字段，应优先新增路径或保持旧字段兼容。

## 认证与 CSRF

默认的 `QUESTION_AUTH_MODE=single-admin` 使用 Cookie 会话认证：

1. 首次安装时调用 `POST /api/auth/bootstrap` 创建管理员；已存在管理员时该接口返回 `409`。
2. 调用 `POST /api/auth/login`，服务会设置 HttpOnly 会话 Cookie，并在 JSON 响应中返回 `csrfToken`。
3. 读取 `GET /api/auth/state` 可获得当前会话的最新 `csrfToken`。
4. 对所有 `POST`、`PUT`、`PATCH`、`DELETE` 请求，同时发送该 Cookie、`Origin: <API origin>` 和 `X-QM-CSRF: <csrfToken>`。

`trusted-desktop` 与 `disabled` 模式不强制会话，但客户端仍可按上述方式工作。`/livez` 是唯一不泄露配置的匿名健康探针；`/api/health` 包含本机路径和工具状态，仍受认证保护。

认证接口中 `login`、`bootstrap` 也会校验 `Origin`，但没有可用的 CSRF token 时不需要 `X-QM-CSRF`。不要把密码、会话 Cookie、CSRF token 或 OCR 密钥写进脚本、文档或日志。

## 错误与并发控制

常见错误响应为：

```json
{ "error": "面向用户的中文错误信息", "code": "OPTIONAL_MACHINE_CODE", "details": {} }
```

常见状态码：`400` 请求或业务校验失败、`401` 未登录或会话过期、`403` Origin/CSRF 失败、`404` 资源不存在、`409` 状态或版本冲突、`422` 结构化内容校验失败、`429` 登录/初始化限流。个别旧接口只返回 `error`；调用方不应假定 `code` 或 `details` 总是存在。

教学文档与排版草稿均使用乐观并发控制：写入时携带当前 `expectedRevision` 或 `revision`。收到 `409 revision_conflict` 后，应重新读取资源并让用户处理冲突，不能用旧请求体强行重试。

## 接口分组

OpenAPI 文件列出每一个已挂载的 REST 路由；下表用于快速定位。路径中 `:id` 在 OpenAPI 中写为 `{id}`。

| 分组 | 路径前缀 | 主要用途 |
| --- | --- | --- |
| 存活与认证 | `/livez`、`/api/auth` | 匿名存活探针、管理员初始化、登录、会话与改密。 |
| 系统设置 | `/api/health`、`/api/settings` | 运行环境状态与 OCR/应用设置。 |
| 题库 | `/api/question-bank/items` | 题目检索、增改删、分类、JSON 导入、题图与 TikZ。 |
| 标签与快捷操作 | `/api/question-bank/tag-libraries`、`/api/learning-tags`、`/api/question-bank/*question*` | 标签库、每日一题、随机组卷与筛选元数据。 |
| 试题篮与导出 | `/api/question-bank/collections`、`/api/question-bank/export-records` | 试题篮、排序、导出、导出历史和恢复。 |
| 排版草稿 | `/api/question-bank/layout-drafts` | 试题篮排版、PDF 预览、内容回写和导出。 |
| 导入 V2 | `/api/import-flow-v2` | 源资料、OCR 中间件、解析配置、候选题和导入批次。 |
| 候选题人工修正 | `/api/import-flow-v2/candidate-fix-sessions` | 选区会话、校验、完成与重新打开。 |
| 教学文档 | `/api/teaching-documents`、`/api/teaching-document-templates` | 讲义/练习单/试卷文档、图片资产、TikZ 与打印模板。 |
| 数据看板 | `/api/dashboard` | 学习/维护活动的按日和按时段统计。 |

## 常用调用示例

下面示例仅展示协议结构；在启用单管理员认证时，变量应来自用户已授权的会话，且不能提交到仓库。

### 读取当前认证状态

```sh
curl --fail --cookie "$QUESTION_API_COOKIE_JAR" \
  "${QUESTION_API_BASE_URL:-http://127.0.0.1:8797}/api/auth/state"
```

### 检索题库

```http
GET /api/question-bank/items?q=%E5%AF%BC%E6%95%B0&page=1&pageSize=20
```

可用筛选条件包括 `q`、`stage`、`questionType`、`knowledgePoint`、`solutionMethod`、`difficulty`、`page` 和 `pageSize`。题目创建字段、入库约束与示例见 [question-bank-ingestion-standard.md](./question-bank-ingestion-standard.md)。

### 新建教学文档

```http
POST /api/teaching-documents
Content-Type: application/json

{ "title": "函数单调性", "documentType": "lecture" }
```

创建成功后先上传图片资产，再携带返回的 `revision` 调用 `PATCH /api/teaching-documents/{id}` 保存完整 `content`。更详细的结构与冲突处理见 [教学文档系统 API 参考](../skills/teaching-document-authoring/references/system-api.md) 和 [document-schema.md](../skills/teaching-document-authoring/references/document-schema.md)。

### 上传文件

导入 V2 的资料上传、Doc2X 包导入、候选题题图、题库题图和教学文档资产都是 `multipart/form-data` 请求。文件类型、大小上限与额外字段按路径不同而不同，均在 [openapi.yaml](./openapi.yaml) 对应操作中注明；上传后只使用服务端返回的资源 ID / `path` / `url`，不要构造本机绝对路径。

## OpenAPI 文件的使用范围

`docs/openapi.yaml` 是本项目的可导入接口目录：包含认证、题库、导入 V2、排版与教学文档的全部已挂载 API 路径，标明 HTTP 方法、路径/查询参数、上传媒体类型、成功状态码、认证要求和特殊响应媒体类型。

为保持文档与不断演进的本地数据模型兼容，动态 JSON 对象（例如题目完整字段、OCR 原始元数据、布局快照）在规范中使用开放对象 schema。需要编程时，请结合：

- `frontend/src/api/*.ts`：前端实际请求以及稳定的 TypeScript 响应类型；
- `server/src/contracts/`：导入 V2 的运行时请求/响应校验；
- `server/src/types/`：题库、候选题、OCR 文档与教学文档的领域类型；
- `server/src/routes/`：最终的路径、状态码和服务调用来源。

接口仅供本应用前端、Electron 客户端和受控本地集成使用；它不是公开的多租户云 API。外部调用不得绕过会话、CSRF、文件访问白名单或服务层校验，更不能直接写入 SQLite。
