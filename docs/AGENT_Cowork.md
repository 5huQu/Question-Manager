Agent 开发协作规范

本项目是一个本地优先的题库管理工具，技术栈为 Electron + React + Vite + TypeScript + Express + SQLite + Python。项目包含题库管理、PDF 切题、OCR 复核、待入库、试题篮、导出试卷等长流程功能。

所有 Agent 在新增功能、重构功能、修复问题时，必须遵守本规范。

一、核心原则

任何改动都应优先保持现有功能稳定。

不得在没有明确要求的情况下修改 API 路径、数据库结构、前端路由和核心业务流程。

新增功能应先明确数据流和业务边界，再写代码。不要把新功能直接堆进页面组件或 Express route 文件。


二、后端分层规则

后端必须按以下职责分层：

routes 层只负责 HTTP 入口。

routes 层允许做的事情：

* 读取 req.params、req.query、req.body
* 调用 service
* 设置 HTTP 状态码
* 返回 res.json
* 使用统一错误处理

routes 层不应承担：

* 大段 SQL
* 复杂业务判断
* 多步骤状态流转
* 文件处理细节
* OCR、导出、Python 调用细节
* 批量业务循环逻辑

services 层负责业务逻辑。

services 层负责：

* 参数规整
* 业务校验
* 状态流转
* 调用多个 repository 或 db 函数
* 调用 OCR、PDF、导出、Python、文件处理等服务
* 组合返回结果
* 保证关键副作用完整执行

repositories 或 db 层负责数据访问。

repositories/db 层负责：

* SQL 查询
* SQL 更新
* SQLite transaction
* row 映射
* 基础增删改查

涉及多个 SQL 更新的业务动作，应优先考虑 transaction。

三、前端分层规则

前端页面组件只负责展示、交互和页面状态，不应直接拼接复杂 API URL。

前端 API 调用应集中在 frontend/src/api 下，按业务分组：

* client.ts：底层 api() 封装
* health.ts：系统健康检查
* settings.ts：系统设置与 OCR 配置
* pdfSlicer.ts：上传、切题规则、资料组、切题 run、切题复核
* ocr.ts：OCR jobs、启动、续跑、进度、中断、重跑
* pendingBank.ts：待入库列表、批量入库、跳过、删除、单题重跑
* questionBank.ts：题库列表、新建、详情、编辑、删除、JSON 导入、题图
* collections.ts：试题篮、集合、加入题目、删除题目、清空、重排、导出集合
* exportRecords.ts：导出记录、删除记录、恢复到试题篮
* learningTags.ts：学习标签库

页面中应调用类似以下函数：

questionBankApi.listItems()
questionBankApi.updateItem(id, input)
collectionsApi.addItem(collectionId, questionId)
ocrApi.startOcr(runId)
pendingBankApi.bulkConfirm(runId, questionIds)

页面中不应大量出现：

api('/api/...')
fetch('/api/...')

如果必须新增 API 调用，应先加入对应业务 API 文件，再在页面中调用封装函数。

四、UI 设计与 Mock 流程

新增或重做重要页面时，应先做 Mock 页面，不要直接修改真实业务页面。

Mock 页面要求：

* 使用本地 mock 数据
* 不调用真实 API
* 不修改 server 目录
* 不影响现有页面和路由
* 用于验证视觉风格、布局结构和交互路径

推荐路径：

/mock/workbench
/mock/question-bank
/mock/ocr-review

Mock 确认后，再迁移到真实页面。

迁移要求：

* 保留真实 API 调用
* 保留现有业务逻辑
* 只替换布局和展示组件
* 不改变 API 路径
* 不改变返回数据结构
* 不改变核心操作流程

五、当前 UI 风格方向

本项目当前倾向于 shadcn/ui 官方 Blocks 风格。

设计关键词：

* 黑白灰主导
* 大面积白底
* 细边框卡片
* 左侧固定导航
* 顶部工具栏
* 强网格对齐
* 数据层级清楚
* 按钮尽量黑白灰
* 少量状态色
* 高信息密度但不拥挤

禁止方向：

* 大渐变
* 玻璃拟态
* 高饱和紫蓝色
* 营销型 SaaS 首页
* 过多彩色 Badge
* 大面积阴影
* 装饰性大于信息结构
* Codex 自行发挥视觉设计

工作台首页不应只围绕技术队列，例如待切题、待 OCR。更推荐以题库活动和最近工作为核心。

推荐工作台结构：

* 题库总量
* 本月新增
* 最近复核
* 最近导出
* 题库活动热力图
* 最近处理题目
* 最近导出记录
* 系统健康状态
* 快捷入口

六、新功能开发流程

新增功能必须遵循以下流程：

第一步：明确功能边界。

需要回答：

* 这个功能属于哪个业务模块
* 是否需要新增 API
* 是否需要新增数据库字段或表
* 是否影响现有流程
* 是否需要 Mock 页面
* 是否需要导出、OCR、题库、试题篮等副作用

第二步：设计 API。

如果需要后端 API，应先确定：

* API 路径
* HTTP 方法
* 请求参数
* 返回结构
* 错误信息
* 是否需要保持与旧接口兼容

不得随意修改已有 API 路径和返回字段。

第三步：实现后端分层。

顺序：

* repository/db
* service
* route

route 只做 HTTP 入口，业务逻辑放 service，SQL 放 repository/db。

第四步：实现前端 API 封装。

新增调用必须放入 frontend/src/api 对应文件。

第五步：实现 UI。

如果是新页面或大改页面，先做 Mock。
如果是已有页面小功能，可以在保持设计规范的前提下直接实现。

第六步：验收。

至少检查：

* TypeScript 编译
* 前端页面可打开
* API 路径未变化
* 返回结构未破坏
* 核心流程可用
* 没有明显重复路由
* 没有未使用 import
* 没有把 SQL 和复杂业务重新写回 route
* 没有把复杂 API URL 重新散落到页面中

七、重构规则

重构优先做等价搬迁，不要在同一步中同时重构结构、修改业务逻辑、重做 UI。

推荐顺序：

1. 搬迁逻辑
2. 保持行为不变
3. 编译通过
4. 手动验收
5. 再做小范围优化

大重构应按模块拆分提交，不要把后端分层、前端 API、UI 改版混在同一个巨大变更里。

八、重要副作用不得遗漏

涉及以下函数或行为时，必须确认没有遗漏：

* syncQuestionBankItemToOcrDraft
* refreshCollectionScore
* createExportRecord
* updateBatchWorkflow
* OCR 状态更新
* 导出记录写入
* 题目入库状态更新
* 题图文件清理
* run / batch 状态同步
* collection 总分刷新
* 格式校验与 blocked 状态处理

九、重复路由规则

新增 route 前必须搜索是否已有相同路径。

不允许在多个 route 文件中重复注册同一 API 路径。

batch 相关接口应放在 batch 模块。
run 相关接口应放在 run 模块。
question-bank items 相关接口应放在 items 模块。
collections 相关接口应放在 collections 模块。

十、Agent 执行要求

Agent 在开始编码前，应先说明将修改哪些文件。

Agent 在完成后，应输出：

* 修改了哪些模块
* 是否改变 API 路径
* 是否改变数据库结构
* 是否改变返回结构
* 是否新增前端 API 封装
* 是否新增 Mock 页面
* 已运行哪些检查
* 还有哪些风险点

如果没有运行检查，必须明确说明未运行，不得假装已经验证。

十一、给 Codex 的固定限制

当 Codex 参与前端任务时，必须遵守：

不要自行发挥前端设计。
不要重新设计视觉风格。
严格按照已确认的 Gemini 设计稿、Mock 页面或设计规范迁移。
只做工程实现、组件拆分、API 接入、功能保持、类型修复和编译修复。
不要把 UI 改成营销型 SaaS 风格。
不要引入未经确认的新组件库。

十二、推荐开发顺序

当前项目推荐顺序：

1. 后端 route 去重
2. 后端分层重构
3. 前端 API 分组
4. Gemini 设计 Mock
5. Codex 按 Mock 迁移真实页面
6. 组件整理
7. 功能增强
8. 打包和更新机制优化

任何新功能也应遵循这个思想：先确定边界，再分层实现，再接前端 API，最后做 UI。