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
