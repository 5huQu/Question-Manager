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
