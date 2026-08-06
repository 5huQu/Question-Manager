# T5：按块增量测量与局部分页

## 目标

局部内容变化时只重测受影响块，并从第一个 dirty block 开始重新分页；未受影响区域复用已确认的测量和页面结果。

## 块测量缓存

建议缓存键至少包含：

```text
blockId + blockContentSignature + layoutStyleSignature + variant + resourceRevision
```

缓存值包含块整体高度、段落行、题目区域、卡片子块、诊断和 measurement version。

## 变更范围

文档命令和编辑器同步应产出结构化 change set：

- `dirtyBlockIds`
- `firstDirtyTopLevelIndex`
- `structureChanged`
- `paperOrGlobalStyleChanged`
- `resourceIdsChanged`

全局字体、内容宽度或纸张变化允许全量失效；普通文字修改、题图尺寸和分页符变化不得默认全量失效。

## 局部分页

- 保留第一个 dirty block 之前的页面和剩余高度状态。
- 从 dirty block 向后重新分配页面。
- 当新的页面边界、累计高度和 measurement version 与旧快照重新一致时停止传播。
- 插入分页符不触发块测量，只从该索引重新分配页面。

## 缓存边界

- 使用容量限制或 LRU，避免学生/教师版、不同纸张和历史 revision 无限增长。
- 文档关闭时释放 DOM 相关资源；纯数据测量缓存可按容量保留。
- 不缓存不稳定或 timed-out 的测量为 settled 结果。

## 验收

- 修改一段文字时，测量调用数量与受影响块数量相符。
- 插入分页符时块测量数量为零或仅包含确有变化的相邻装饰。
- 全量算法与增量算法在 fixture 上得到相同 PaginationResult。
- Undo/redo、资源加载完成和全局样式变化均正确失效。

## 实施结果（2026-08-05）

- 文档级 `TeachingDocumentLayoutCoordinator` 持有最多 512 项的块测量缓存，编辑画布与打印预览共享同一份缓存。
- 缓存键包含块 ID/重复序号、块内容签名、布局样式、variant、资源 revision 和选项布局；geometry 实现变化也会隔离缓存。
- 测量入口支持按 `sourceIndex` 过滤，缓存结果可在插入/删除后重映射 source path；分页符不进入 DOM 块测量。
- change set 已包含 dirty block、首个 dirty 索引、结构变化、全局样式变化和资源变化信息。
- 局部分页从 dirty block 前驱所在页保守重排；分页符插入可直接复用之前的完整页面，尾部追加、删除和全局失效均与全量分页一致。
- 仅在资源 readiness 稳定且未超时时写入块缓存；undo/redo 可直接命中已结算的布局快照。
- 性能记录新增重测块数、测量缓存命中数、首个 dirty 索引、是否增量分页和复用页数。

自动化验收覆盖：单块编辑仅 1 次块测量、插入分页符 0 次块测量、undo/redo 暖命中、资源/样式全量失效，以及增量与全量 `PaginationResult` 一致性。
