# T7：页面窗口化与集成验收

## 目标

在计算管线稳定后减少打印预览中不可见页面的 React/DOM 成本，并完成性能、正确性和发布审核。

## 页面窗口化

- 打印预览只挂载当前可见页及前后缓冲页。
- 未挂载页使用已知纸张高度占位，保持滚动长度和页码定位稳定。
- 跳页、诊断定位、选中高亮和打印版本切换可以让目标页进入窗口。
- A3 双栏按物理 sheet 窗口化，不能拆开同一张 sheet 的左右逻辑页。
- 打印与 PDF 导出不得使用窗口化 DOM，必须消费完整 settled snapshot。

页面编辑基于单一 ProseMirror DOM，首轮只保留现有 `content-visibility` 策略；未经选区、IME 和撤销专项验证，不做节点卸载式虚拟化。

## 集成矩阵

- 三种视图 × 学生版/教师版。
- A4/A3、纵向/横向、自定义边距。
- 30/100/300 块 fixture。
- 图片加载中、加载成功、加载失败。
- 普通段落、长题、选项、卡片、表格、公式和分页符。
- 快速连续切换、连续输入、undo/redo、保存、重载和导出。

## 必跑验证

- `npm run typecheck`
- `npm run test:frontend`
- `npm run build:frontend`
- `npm run test:math-render`
- `npm run test:routes`（如任何服务端契约或导出路径受影响）
- 性能基准脚本与 T0 同机对比
- `git diff --check`

## 完成定义

- 达到 T0 校准后的交互和 settled 性能预算。
- 新旧分页结果在固定 fixture 上一致。
- 编辑、预览和 PDF 导出保持页数与内容一致。
- 无过期 generation、明显滚动跳动、选区丢失或导出误解锁。
- 报告 API 路径、数据库结构、响应形状和 frontend API wrapper 是否变化。
- 所有已知风险都有负责人、复现方式和后续任务编号。

## 实施结果

状态：`completed`

- 新增 `usePreviewPageWindow`，超过 8 个预览单位后启用窗口化；默认挂载可见单位及前后各 2 个缓冲单位。
- A4 以逻辑页为窗口单位，A3 横向双栏以完整物理 sheet 为窗口单位。同一张 A3 的左右逻辑页始终一起挂载或一起卸载。
- 所有页都保留固定宽高的轻量包装层和 `data-teaching-page-anchor`，未挂载页不会改变总滚动高度。页码统计和滚动位置不再依赖实际 `PaperPageView` 是否存在。
- 当前页码跳转、选中块所在页和诊断定位页均作为显式窗口目标，并连同缓冲页强制挂载。
- 小于等于 8 个单位的短文档继续完整渲染，避免为常见短文档增加观察器和切换成本。
- 页面编辑器仍是单一 ProseMirror DOM，只保留既有 `content-visibility`；本任务没有卸载编辑节点。
- 编辑器导出按钮继续消费完整 `A4PaginationState.pagination`。实际打印/PDF 路由 `TeachingDocumentPrintPage` 独立测量并遍历完整 `pagination.pages`，不读取窗口化预览 DOM。

## 自动化验收

- 12 页 A4 fixture：保留 12 个页锚点，初始只挂载 3 个 `PaperPageView`；`onPaginationState` 仍返回完整 12 页快照。
- 远端页码、远端选中块及远端诊断目标均会挂载目标页及缓冲页。
- 20 个逻辑页的 A3 fixture：保留 10 个物理 sheet 占位，窗口只挂载部分 sheet，已挂载 sheet 均同时包含 2 个逻辑页。
- 模拟 `IntersectionObserver` 进入/离开事件后，挂载窗口会从初始页迁移到新可见页，且缓冲范围保持确定。
- 94 个前端测试文件、667 项测试通过；分页 fixture、增量/全量一致性、undo/redo、版本缓存和打印页测试均保持通过。
- `npm run typecheck`、`npm run build:frontend`、`npm run test:math-render`、`git diff --check` 通过。
- 本任务未修改服务端或导出契约，因此未运行 `npm run test:routes`。

## 集成结论与限制

- T4 已在真实 87 题文档验证：学生版 27 页、教师版 81 页，双向 warm 切换直接恢复稳定快照；页面编辑为 27 页，连续视图为 1 页。本任务未改变这些分页或调度数据结构。
- 当前运行环境没有可调用的浏览器自动化工具，无法重新采集 T0 同口径的浏览器 trace，也未重复执行全部纸张、方向和图片状态人工矩阵。窗口化收益以确定性 DOM 挂载测试覆盖；布局阶段预算继续沿用 T2-T6 的测量与缓存结果。
- 已知既有问题：窄视口打开右侧属性栏时会遮挡学生版/教师版切换按钮。复现方式为缩窄编辑器窗口后打开任意非文本对象属性；该问题不是本轮性能改动引入，后续应作为独立响应式布局任务处理。
- API 路径、数据库结构、响应形状均未变化；未新增 frontend API wrapper。
