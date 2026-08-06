# T4：统一 Layout Coordinator

## 目标

将页面编辑与打印预览的分页生命周期合并为一个文档级协调器，统一 generation、取消、资源状态、测量结果和分页快照。

## 建议接口

```ts
type LayoutRequestReason = 'typing' | 'structure' | 'view' | 'variant' | 'export'

interface LayoutSnapshot {
  key: string
  documentRevision: string
  variant: 'student' | 'teacher'
  pagination: PaginationResult
  readiness: RenderReadinessResult
  status: 'stale' | 'measuring' | 'settled' | 'failed'
}

interface LayoutCoordinator {
  request(input: LayoutRequest): LayoutSnapshot | null
  subscribe(listener: (snapshot: LayoutSnapshot) => void): () => void
  cancelBefore(generation: number): void
}
```

最终接口可以调整，但必须明确表达 revision、variant、状态和是否可导出。

## 工作范围

- 抽取 `usePagination` 与 `A4PaginationPreview` 的共同生命周期。
- 只保留一个隐藏测量 surface 或受控测量 surface 池。
- 页面编辑和打印预览订阅同一份 snapshot。
- 保留最近完成快照和当前计算快照，禁止混合。
- generation、AbortController 和 readiness 统一管理。
- choice layout 探测结果进入协调器缓存，不因组件卸载无条件清空。

## 迁移策略

1. 先让现有两个消费者通过适配器读取协调器，保持页面表现不变。
2. 用对照测试确认新旧分页结果一致。
3. 删除重复生命周期前，记录所有 readiness 与导出调用方。

## 验收

- 同一布局 key 同时被页面编辑和打印预览请求时只发生一次测量。
- 切换组件挂载状态不会丢失可复用快照。
- 过期 generation 永远不能覆盖当前 snapshot。
- 导出继续校验当前 revision、资源 readiness 和分页诊断。

## 实施结果

状态：`completed`（2026-08-05）

### 文档级协调器

新增 `TeachingDocumentLayoutCoordinator`，统一管理：

- 单调递增的 generation 与 `AbortController`；新 key 或 warm-cache 请求都会使旧 generation 失效。
- 同一 `paginationSignature` 的 in-flight Promise；编辑分页和 A4 预览同时请求时共享一次 readiness、DOM 测量和分页。
- 最多 4 份稳定分页快照，以及最多 8 份按 `resourceRevision` 保存的 readiness。
- settled/failed/measuring 事件订阅、消费者引用计数和卸载释放。
- choice-layout `retry` 只回传布局覆盖，不写入稳定快照；下一轮真实完成后才缓存。

页面级编辑器只创建一个稳定协调器，并同时传给 `TeachingDocumentCanvas` 和 `A4PaginationPreview`。独立组件仍自动创建本地协调器，现有调用方和测试无需迁移。两个组件暂时保留各自的隐藏 DOM 根作为受控测量 surface 池，但只有协调器选中的当前 generation 能执行测量；相同 key 不会在两个 surface 重复运行。

测试注入的 geometry adapter 身份作为附加执行 key；生产默认 adapter 仍直接使用 T3 的 `paginationSignature`。因此更换测试/平台测量实现会可靠失效，但不会污染文档签名。

### 展示与导出语义

- 真正的 cache miss 仍立即向 A4 父层发布 `pagination: null + preparing readiness`，导出继续被当前 generation 阻塞。
- 重排期间继续展示上一对“文档 + 分页”快照，不混用新文档和旧分页。
- warm cache 直接发布 settled snapshot，不发布 preparing/null，也不进入重排状态。
- readiness reject 生成稳定 failed snapshot，但失败结果不进入 warm 分页缓存；后续请求可以重试。
- 性能 trace 继续记录 `cacheHit`、`resourceCacheHit`、variant、revision 和分页 key。

## 验证记录

自动化覆盖：

- 协调器同 key 并发请求只调用一次执行器；消费者释放后仍可 warm 命中。
- 编辑分页和 A4 预览同时请求同一 key 时，readiness 与 geometry 各只执行一次，两边得到同一页数。
- 旧 generation 完成后不能发布或缓存旧 snapshot。
- choice-layout retry 不缓存半成品；第二次 settled 后才可 warm 命中。
- A4 真正 miss 继续发布 preparing/null，warm student/teacher 切换直接恢复稳定快照。
- readiness reject 继续发布 `timedOut + pagination: null`，导出保持阻塞。

真实 87 题文档：

| 场景 | 结果 |
| --- | --- |
| 学生版冷排版 | 27 页，稳定，无重排状态残留 |
| 教师版冷排版 | 81 页，答案/解析内容存在，稳定 |
| warm 学生版 | 直接恢复 27 页，无重排状态 |
| warm 教师版 | 直接恢复 81 页，无重排状态 |
| 页面编辑 | 27 页，分页状态稳定 |
| 连续流 | 1 / 1 页，编辑标题与内容保持 |

全量前端测试为 90 个文件、637 项通过；frontend typecheck、production build 与 `git diff --check` 通过。

推荐下一步按既定顺序执行 T5：在协调器的 snapshot/change-set 边界上加入按块测量缓存与 dirty range 局部分页。
