# T6：ProseMirror 结构操作快速路径

## 目标

让分页符等编辑器内结构操作通过 ProseMirror transaction 立即生效，避免外层命令更新后再执行整篇 JSON 转换、比较和 `setContent()`。

## 第一阶段范围

优先迁移：

- 插入分页符。
- 删除分页符。
- 在当前光标后插入简单顶层块。

移动章节、复杂卡片替换和批量命令暂时保留现有外层命令，除非已有充分测试证明可安全迁移。

## 契约

- ProseMirror 是交互中的即时状态来源，TeachingDocumentV1 仍是保存和业务操作的数据来源。
- transaction 必须携带 change set，供 Layout Coordinator 确定 dirty range。
- 一个用户操作对应一个 undo 步骤。
- 同步到领域模型和自动保存可以延后，但离开页面、导出或执行下一个外部结构命令前必须 flush。
- 插入后保持合理光标与选区，不得通过整篇 `setContent()` 重置编辑状态。

## 验收

- 分页符在点击或快捷键后一个交互帧内可见。
- 插入、删除、undo、redo、保存和重新打开结果一致。
- 不发生双重插入、历史重复或外层模型覆盖未 flush 文字。
- 插入分页符只触发从目标位置开始的分页，不重测整篇。

## 实施结果（2026-08-05）

- 新增 ProseMirror transaction change set 扩展；文字和顶层结构变化都会携带 dirty block、首个 dirty 索引和结构变化标记。
- DocumentEditor 在 350ms 模型同步窗口内合并 change set，并随最新 `TeachingDocumentV1` 快照一次性传给布局请求。
- Layout Coordinator 在样式、资源和标题未发生全局变化时直接采用 transaction dirty range；否则回退到文档快照比较。
- 顶部/块间菜单插入分页符、段落、标题、分割线和留白时直接修改 ProseMirror，不再先改外层模型后整篇 `setContent()`。
- 删除顶层分页符走同一快速路径；只剩一个顶层块等不安全边界自动回退到原外层命令。
- 章节移动、复杂卡片、题目/图片、批量操作继续使用原命令链，未扩大第一阶段范围。

自动化验收覆盖：单事务插入与删除、一次 undo/redo、保存后重新构建编辑器、transaction dirty range、合并窗口内文字与结构变更合并，以及原有 A4 generation 回归。
