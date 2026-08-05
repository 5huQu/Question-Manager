# T3：签名拆分与学生/教师版缓存

## 目标

让资源就绪、块布局和打印版本拥有独立、可解释的失效键，避免使用整篇 `JSON.stringify(document.content)` 触发无关工作。

## 签名模型

- `documentRevision`：文档内容的逻辑 revision。
- `resourceRevision`：题目、图片、字体等资源是否变化。
- `layoutStyleSignature`：纸张、边距、字体、页眉页脚和宽度。
- `blockContentSignature`：单块内容与局部显示设置。
- `variant`：`student | teacher`，只表达答案与解析可见策略。

签名必须由稳定字段生成；不得依赖 React 对象引用，也不得在每次 render 中 stringify 整篇文档。

## 版本表达

- 源文档保持不变，学生版/教师版作为 renderer context 或 layout policy 传递。
- 题号和文档内容仍只有一个事实来源。
- 为两个 variant 分别缓存分页快照。
- 空闲时可预热另一个 variant；任何用户输入都应中断预热。

## 资源缓存

- 已加载并解码的图片、已解析题目和已加载字体在签名未变时不重复等待。
- 资源缓存只保存状态和版本，不持久化浏览器 DOM 引用。
- 缺失或失败资源的状态也需要稳定缓存，避免每次切换重复超时。

## 验收

- 学生版/教师版切换不再被误判为所有资源变化。
- 暖缓存往返切换达到 T0 确认的预算。
- 两个版本的答案、解析、页数和分页位置正确。
- 资源更新后相关缓存可靠失效，没有旧图片或旧题目内容。

## 实施结果

状态：`completed`（2026-08-05）

### 稳定签名

新增独立布局签名工具，输出：

- `documentRevision`：块内容与布局样式的逻辑 revision。
- `resourceRevision`：题目版本、文档素材、图片路径、字体和 raw Markdown 资源。
- `layoutStyleSignature`：文档样式、纸张、页眉页脚、字体变量和单双栏。
- `blockContentSignature`：标题、章节选项和逐块内容签名。
- `geometrySignature` / `paginationSignature`：组合内容、资源、样式和打印版本。

签名直接遍历稳定字段并计算哈希，不再使用 `JSON.stringify(document.content)`。块内容与块资源分别用 `WeakMap` 按不可变块对象复用；普通正文增删改不会改变 `resourceRevision`，因此仍会重新测量几何，但不会重复等待字体、图片和题目。

### 双版本快照

- 编辑页向 A4 预览传递原始文档和 `student | teacher` 策略，不再在页面 render 中重建整篇变体文档。
- 变体投影按“源文档对象 + variant”弱引用缓存，且不修改源文档。
- A4 预览按 `paginationSignature` 缓存最多 4 份成对快照：变体文档、分页结果、readiness、段落行数和选项布局。
- 暖缓存命中时同步恢复整套快照，不发布 preparing/null，不进入资源等待、选项探测、DOM 测量或分页。
- 资源 readiness 按 `resourceRevision` 缓存最多 8 份；missing、失败图片和超时结果随 revision 保留。执行器 Promise 直接 reject 的基础设施故障不缓存，后续仍可重试。
- 显式性能 trace 增加 `variant`、`resourceRevision`、`paginationSignature`、`cacheHit` 和 `resourceCacheHit`。

文档素材的 URL、大小和创建时间已加入编辑页 `renderVersion`。题目内容 revision、图片引用、字体或素材变化都会生成新 key 并可靠失效；只切换答案/解析可见策略不会使资源 key 变化。

## 验证记录

自动化覆盖：

- 结构相同的克隆文档签名一致，且测试确认没有调用整篇 `JSON.stringify`。
- 正文/答案可见性/variant 变化不污染资源 revision；题目版本、图片和样式分别使对应 key 失效。
- 学生版 → 教师版 → 学生版暖切时，第三步的几何适配器调用数保持不变。
- `renderVersion` 变化后资源等待和 DOM 测量重新执行。
- 学生版不显示答案，教师版显示答案与解析；源文档保持不变。

真实 87 题文档：

| 状态 | 页数 | generation | 结果 |
| --- | ---: | ---: | --- |
| 学生版首次 | 27 | g2 | 首次选项探测后稳定 |
| 教师版首次 | 81 | g4 | 首次选项探测后稳定 |
| 暖切学生版 | 27 | g5 | 单 generation 命中缓存，无重排状态 |
| 暖切教师版 | 81 | g6 | 单 generation 命中缓存，无重排状态 |

教师版检测到 104 个答案标记、91 个解析/分析标记；两版均无溢出页。暖切仍需 React 提交对应页树，最终可见节点数量带来的成本留给 T7 窗口化处理。

推荐下一步按既定顺序执行 T4，统一编辑器与预览的 Layout Coordinator；现有签名和缓存 key 将作为 coordinator 的失效契约。
