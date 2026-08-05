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
