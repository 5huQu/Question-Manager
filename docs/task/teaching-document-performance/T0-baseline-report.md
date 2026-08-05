# T0 性能基线报告

## 结论

当前主要成本不在纯分页算法，而在资源/渲染稳定等待与整篇 DOM 几何测量：

- M（100 块）生产构建冷挂载中位数为 179.3ms，资源稳定后的精确布局中位数为 40.4ms，其中 DOM 测量为 39.4ms，纯分页仅 0.5ms。
- L（300 块）生产构建冷挂载中位数为 511.6ms；第一次真正冷载达到 1049.1ms。资源稳定后的精确布局中位数为 135.7ms，其中 DOM 测量为 133.1ms，纯分页仅 1.3ms。
- choice layout 探测本身低于 2ms，但首次探测会改变选项布局并触发第二个 generation；两代之间的 React 提交和调度间隔是冷挂载总耗时的重要组成部分。
- 推荐顺序不调整：T1 先消除不分场景的等待与旧快照空窗，T2 再优化段落 DOM 测量热路径。现阶段没有依据提前重写纯分页算法。

## 环境与口径

- 日期：2026-08-05
- 机器：Apple M5，16GB，arm64
- 系统：macOS 26.4.1（25E253）
- Node.js：v24.15.0
- 基线提交：`d839119`
- 浏览器：Codex 内置浏览器
- fixture：M 100 个顶层块；L 300 个顶层块；资源均为仓库内固定资源
- 每组连续执行 3 轮。样本量较小，因此表中 p95 是三轮最大值，后续优化对比必须沿用同一口径。
- “冷挂载总跨度”从 A4 预览第一个 generation 开始，到最终 settled generation 结束；包含资源等待、choice retry、代际提交间隔、DOM 测量和分页，不包含点击到首个 effect 开始的 React 提交时间。
- “稳定布局”取 retry 后的 settled generation；资源签名已稳定，可用于观察 DOM 测量和分页本身。

## 基线结果

单位均为毫秒。

| 构建 | fixture | 冷挂载总跨度（3 轮） | 中位数 / p95 | 资源等待中位数 / p95 | 稳定布局中位数 / p95 | DOM 测量中位数 / p95 | 纯分页中位数 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vite 开发 | M | 209.3 / 208.4 / 210.3 | 209.3 / 210.3 | 85.2 / 85.4 | 40.9 / 41.6 | 40.0 / 40.8 | 0.3 / 0.4 |
| Vite 开发 | L | 550.0 / 596.6 / 580.4 | 580.4 / 596.6 | 197.6 / 202.2 | 118.8 / 121.2 | 113.8 / 118.5 | 1.4 / 4.5 |
| 生产构建 | M | 186.3 / 166.4 / 179.3 | 179.3 / 186.3 | 67.1 / 72.9 | 40.4 / 44.0 | 39.4 / 42.2 | 0.5 / 1.2 |
| 生产构建 | L | 1049.1 / 437.9 / 511.6 | 511.6 / 1049.1 | 188.3 / 255.3 | 135.7 / 365.5 | 133.1 / 358.4 | 1.3 / 4.2 |

生产 L 第一轮是本次生产 bundle、字体与页面资源的第一次真实加载；其稳定布局 DOM 测量为 358.4ms，后两轮为 109.7ms 和 133.1ms。该波动可重复解释为冷资源与 JIT/样式初始化影响，不能从报告中删除，也不应与稳定缓存路径混为一个承诺值。

## 时间线与主导阶段

典型 M 开发构建：

```text
generation 1: resource wait 85.2ms -> choice probe -> retry
                                      |
                                      v
generation 2: resource wait ~0ms -> DOM measure 40.0ms -> paginate 0.3ms -> settled
operation span median: 209.3ms
```

典型 L 生产构建：

```text
generation 1: resource wait 188.3ms -> choice probe -> retry
                                        |
                                        v
generation 2: resource wait ~0ms -> DOM measure 133.1ms -> paginate 1.3ms -> settled
operation span median: 511.6ms
```

页面与 trace 面板截图：[baseline-production-l.jpg](./baseline-production-l.jpg)。

## 预算校准

- M 后台精确分页 p95 小于 500ms：当前生产构建冷挂载 186.3ms，已满足；仍需优化感知等待和重复全量测量。
- L 没有绝对预算：以本报告生产构建 p95 1049.1ms 为首轮基线，T1～T5 的阶段目标仍为至少降低 50%。
- 单个主线程任务目标小于 100ms：M 已接近目标；L DOM 测量中位数 133.1ms、最差 358.4ms，不满足，T2 必须直接处理该热路径。
- 操作到首帧反馈与可见页面 commit 尚不能由当前内部布局 trace 单独计算；T1 的交互调度验收必须补充这两个外层时间点，不得拿 settled 内部耗时替代。

## 复现

开发构建：

```sh
QUESTION_AUTH_MODE=disabled QUESTION_SERVER_PORT=8798 npm run dev
```

打开 `http://127.0.0.1:5175/mock/teaching-document?layoutPerf=1`，选择性能 M/L 和 A4 分页。默认端口被占用时，以 Vite 输出端口为准。

生产构建：

```sh
VITE_TEACHING_DOCUMENT_PERF=1 npm run build:frontend
QUESTION_AUTH_MODE=disabled PORT=8799 node server/dist/index.js
```

打开 `http://127.0.0.1:8799/mock/teaching-document?layoutPerf=1`。`VITE_TEACHING_DOCUMENT_PERF` 仅显式加入只读性能路由；普通生产构建不会包含该入口。trace 同时写入 User Timing、页面“性能追踪”面板和 `window.__QUESTION_MANAGER_LAYOUT_TRACES__`。

## T0 产物与限制

- 已建立 30/100/300 块 S/M/L 合成 fixture 及确定性测试。
- 已在编辑器与独立预览管线记录 schedule/resource/choice/DOM measurement/pagination/total。
- 埋点默认关闭，仅 `?layoutPerf=1` 或显式全局开关启用。
- 当前基线聚焦 A4 预览内部布局管线；学生/教师版、三视图、分页符命令的外层操作时间点将在 T1 调度改造中按同一 trace 约定补齐。
- T0 不改变分页、API、数据库或持久化文档行为。
