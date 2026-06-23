# Question-Manager 后端 API 分层重构计划

## Summary

在不改变 API 路径、前端调用方式、SQLite schema 和主要返回结构的前提下，把 4 个重点 route 模块重构为“薄 HTTP 层 + service 业务层 + repository/db 数据层”。

本次重构采用等价搬迁优先策略：先把现有逻辑原样迁移到 service/repository，确保 TypeScript 编译和现有链路可用；之后只做必要去重和事务收敛，不重写核心算法、不改变状态机语义。

## Key Changes

### 1. 新增统一错误处理

新增公共错误模块，建议放在：

- `server/src/routes/errors.ts`

实现：

- `RouteError extends Error`
  - `status: number`
  - `message: string`
  - `details?: unknown`
- `sendRouteError(res, error)`
  - `RouteError`：返回 `error.status` 和 `{ error: error.message, details }`
  - 普通 `Error`：返回 `500` 和 `{ error: error.message }`
  - 非 Error：返回 `500` 和 `{ error: '服务器内部错误' }`

所有重构后的 route 使用统一 `try/catch`：

```ts
try {
  const result = await service.method(...)
  res.status(...).json(result)
} catch (error) {
  sendRouteError(res, error)
}
```

保留现有中文错误信息；原先 route 中的 `400/404/500` 判断改为在 service 中抛出 `RouteError`。

### 2. 题库题目模块重构

目标文件：

- `server/src/routes/question-bank/items.ts`

新增：

- `server/src/services/question-bank/items.service.ts`
- `server/src/repositories/question-bank/items.repo.ts`

迁移内容：

- 题库列表查询
- 题目新建
- JSON 导入
- 从切题结果导入
- 题目详情
- 题目更新
- 题目删除
- 题图相关操作
- 单题重新 OCR

分层规则：

- route 只读取 `req.params`、`req.query`、`req.body`、必要文件上传字段，然后调用 service。
- service 负责参数校验、业务判断、OCR/文件处理调用、返回结构组合。
- repository 负责 SQL 查询、SQL 更新、row 映射、事务。
- 可复用现有 `server/src/db/questions.ts`，避免重复实现已有 CRUD。
- 涉及“创建题目 + 图片/候选信息/来源关系更新”的操作使用 SQLite transaction。
- 单题重新 OCR 只搬迁现有流程，不改变 OCR 结果解析和状态写入规则。

### 3. 试题篮与集合模块重构

目标文件：

- `server/src/routes/question-bank/collections.ts`

新增：

- `server/src/services/question-bank/collections.service.ts`
- `server/src/repositories/question-bank/collections.repo.ts`
- `server/src/services/question-bank/export.service.ts`

迁移内容：

- 集合列表
- 创建集合
- 集合详情
- 更新集合
- 删除集合
- 加入题目
- 修改题目分值、分组、顺序
- 删除集合题目
- 清空集合
- 重排集合题目
- 导出集合

分层规则：

- collection route 保留原路径、HTTP method、状态码和响应结构。
- service 负责集合存在性判断、题目加入规则、排序规则、分值/分组校验、导出编排。
- repository 负责 collection、collection items、export records 的 SQL。
- 可复用：
  - `server/src/db/collections.ts`
  - `server/src/db/export-records.ts`
  - `server/src/services/question-bank/export.ts`
- 导出逻辑统一通过 `export.service.ts` 调用现有导出实现，route 不直接处理导出细节。
- 加入题目、删除题目、清空集合、重排集合题目等多 SQL 操作使用 transaction。

### 4. OCR 模块重构

目标文件：

- `server/src/routes/pdf-slicer/ocr.ts`

新增：

- `server/src/services/pdf-slicer/ocr-run.service.ts`
- `server/src/repositories/pdf-slicer/runs.repo.ts`

迁移内容：

- 批量 OCR
- OCR job 列表
- OCR 进度
- run 下题目列表
- 题目分类
- 启动 OCR
- 续跑 OCR
- 完成 OCR
- 强制重跑 OCR
- 强制中断 OCR

分层规则：

- route 只做 HTTP 参数读取和 service 调用。
- `ocr-run.service.ts` 集中管理 OCR 状态流转，避免 route 中直接写状态更新 SQL。
- `runs.repo.ts` 负责 run、slices、OCR jobs、分类结果等 SQL 查询和更新。
- 可复用：
  - `server/src/db/runs.ts`
  - `server/src/services/pdf-slicer/ocr.ts`
  - `server/src/services/pdf-slicer/review.ts`
- 强制重跑、续跑、中断、完成等接口保持现有状态语义；只把状态机逻辑搬到 service。
- 涉及 job 状态和 run 状态联动更新的地方使用 transaction。

### 5. 待入库模块重构

目标文件：

- `server/src/routes/pdf-slicer/pending-bank.ts`

新增：

- `server/src/services/pdf-slicer/pending-bank.service.ts`
- `server/src/repositories/pdf-slicer/pending-bank.repo.ts`

迁移内容：

- 待入库列表
- 手动候选题保存
- 单题重新 OCR
- 批量确认入库
- 批量跳过
- 批量删除

分层规则：

- route 保留原接口路径、method、query/body 结构和响应结构。
- service 负责候选题校验、批量操作判断、入库编排、OCR 调用。
- repository 负责 pending candidate、review、question-bank 写入相关 SQL。
- 可复用：
  - `server/src/db/questions.ts`
  - `server/src/db/review.ts`
  - `server/src/services/pdf-slicer/ocr.ts`
- 批量确认入库必须使用 transaction，保证“创建题库题目 + 更新候选题状态 + 写入关联状态”要么全部成功，要么全部回滚。
- 批量跳过、批量删除保持原有返回结构和错误提示。

## Implementation Order

1. 新增 `RouteError` 和 `sendRouteError`，先只接入新增/重构 route，不强制改全项目。
2. 重构 `question-bank/items.ts`：
   - 先创建 service/repo。
   - 逐个 endpoint 搬迁逻辑。
   - 每搬完一组接口运行 TypeScript 编译。
3. 重构 `question-bank/collections.ts`：
   - 先搬集合 CRUD。
   - 再搬集合题目操作。
   - 最后搬导出编排。
4. 重构 `pdf-slicer/ocr.ts`：
   - 先搬查询类接口。
   - 再搬启动/续跑/完成/强制重跑/强制中断等状态流转接口。
5. 重构 `pdf-slicer/pending-bank.ts`：
   - 先搬列表和手动保存。
   - 再搬单题 OCR。
   - 最后搬批量确认、跳过、删除。
6. 清理未使用 import、重复 SQL、重复状态流转逻辑。
7. 运行验证：
   - TypeScript 编译
   - 现有测试
   - 必要时手动走通上传资料、切题、复核、OCR、待入库、题库管理、试题篮、导出链路。

## Test Plan

必须通过：

- TypeScript 编译。
- 现有测试套件。
- route 文件无未使用 import。

重点接口回归：

- 题库题目：
  - 列表查询筛选/分页结果不变。
  - 新建、更新、删除题目返回结构不变。
  - JSON 导入和切题结果导入可用。
  - 题图相关接口可用。
  - 单题重新 OCR 可用。
- 集合：
  - 集合 CRUD 可用。
  - 加入题目、更新分值/分组/顺序、删除题目、清空、重排可用。
  - 导出集合可用，导出记录仍正常写入。
- OCR：
  - 批量 OCR、启动、续跑、完成、强制重跑、强制中断状态表现与重构前一致。
  - OCR job 列表、进度、run 下题目列表、题目分类返回结构不变。
- 待入库：
  - 待入库列表返回结构不变。
  - 手动候选题保存可用。
  - 单题重新 OCR 可用。
  - 批量确认入库、跳过、删除可用，并能正确处理部分非法输入。

## Assumptions

- 不新增或修改数据库表、字段、索引、迁移脚本。
- 不修改前端代码，除非 TypeScript 类型导入因后端重构路径变化产生局部修复需求。
- 不改变已有 API 路径、HTTP method、请求参数和主要响应结构。
- 不重写 OCR、导出、复核等核心算法；本轮只做等价搬迁和必要封装。
- 如果现有 db 层已经提供等价方法，优先复用；只有 route 中存在无法复用的大段 SQL 时才新增 repository 方法。
- 事务只用于已有逻辑中天然需要原子性的多 SQL 更新，不借重构机会改变业务成功/失败语义。
