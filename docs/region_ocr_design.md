# 候选题局部 OCR 设计

## 目标与边界

局部 OCR 用于修复整卷识别后少量异常题，不替代 GLM-OCR 或 Doc2X 的整卷理解。用户在候选题手动修正工作台选择题干、答案或解析范围，系统构造一份保留必要上下文的“小文档”，识别后展示新旧差异；只有用户确认的字段才写回候选题。

首版不直接引入第三个 OCR 模型。先复用现有 GLM/Doc2X，用真实失败样本验证“小文档识别”是否足够；专用区域模型只作为后续兜底。

## 用户流程

1. 用户选择要修复的字段：题干、答案或解析。
2. 在来源资料中框选一个或多个区域；跨页题可以按阅读顺序包含多个片段。
3. 系统显示实际发送范围，自动扩展上下文，但不改变用户保存的原始框。
4. 用户点击“重新识别此范围”。任务异步执行，原编辑内容保持不变。
5. 系统展示原内容和新结果的字段级差异、provider、耗时及警告。
6. 用户可选择全部采用、只采用指定字段或放弃结果。
7. 确认时校验候选题版本；版本冲突则保留识别结果并要求用户重新比较，不静默覆盖。

## 片段构建

### 坐标与裁剪

- 继续使用修正会话中的归一化坐标（0–1），实际裁剪前按渲染页尺寸换算像素。
- 推荐以 220–300 DPI 渲染；小字号或公式密集区域可提升到 300 DPI。
- 用户框四周自动增加边距：默认水平方向页面宽度的 3%，垂直方向页面高度的 2%；边距裁剪到页面边界内。
- 最小输出尺寸不足时只做留白补齐，不拉伸原图，避免改变公式比例。
- 记录用户框、扩展框、页码、DPI 和来源资料 ID，确保请求可复现。

### 上下文保留

局部 OCR 不应只截取一个公式或一行文字。片段尽量保留：

- 当前题号及字段标题（如“答案”“解析”）；
- 选区上下各一行邻近文字；
- 与文字存在引用关系的题图或表格；
- 题卷/解析卷角色和目标字段提示。

上下文仅帮助识别，不默认写回目标字段之外的内容。

### 跨页拼接

- 按 `sourceDocumentId → pageNo → y → x` 确定阅读顺序，用户可调整顺序。
- 同页多个片段纵向拼接，片段间插入白色分隔带与不参与结果的页码标记。
- GLM 首选高分辨率长图；超出 provider 限制时拆成多图，并在请求中明确顺序。
- Doc2X 将一个或多个片段写成临时 PDF，每个来源页片段单独占页，保持原始宽高比。
- 临时文件存入局部 OCR 任务目录，按数据保留策略清理，不写入正式题图资产。

## Provider 抽象

新增与整卷 OCR 解耦的 `RegionRecognitionProvider`。建议接口：

```ts
type RegionRecognitionRequest = {
  taskId: string
  candidateId: string
  candidateRevision: number
  target: 'stem' | 'answer' | 'analysis'
  artifactPath: string
  artifactKind: 'image' | 'pdf'
  context: {
    questionNo?: string
    sourceDocumentIds: string[]
    segments: Array<{ sourceDocumentId: string; pageNo: number; bbox: [number, number, number, number] }>
  }
}

type RegionRecognitionResult = {
  provider: string
  fields: { stemMarkdown?: string; answerText?: string; analysisMarkdown?: string }
  warnings: string[]
  rawResultPath: string
  metrics: { durationMs: number; inputPages: number }
}

interface RegionRecognitionProvider {
  id: string
  supports(input: RegionRecognitionRequest): boolean
  recognize(input: RegionRecognitionRequest): Promise<RegionRecognitionResult>
}
```

首批适配器：

- `GlmRegionRecognitionProvider`：接收带上下文图片/长图，要求只返回目标字段。
- `Doc2xRegionRecognitionProvider`：接收临时 PDF，复用在线文档解析与 normalizer；从结果中提取目标字段。

provider 返回的是建议结果，不能直接修改 `QuestionCandidate`。

## 结果约束与差异确认

- 保存原始 provider 响应、标准化结果和警告，便于诊断与复现。
- 对输出运行现有 Markdown/公式、题号和图片引用校验。
- 结果含多个题号、目标字段为空或明显截断时标记为低可信，不允许一键静默采用。
- diff 以字段为单位，支持行内变化提示；图片引用和公式块作为完整 token 比较，避免逐字符噪声。
- 用户可以逐字段采用；采用后写入一条审计记录，包括候选题修订号、provider、任务 ID、采用字段和时间。
- 确认写回必须是事务操作，并使用候选题 revision 做乐观锁。

## 失败与兜底

1. provider 超时或失败：保留原编辑内容和选区，允许原 provider 重试。
2. 结果低可信：建议扩大上下文或调整选区，不自动覆盖。
3. GLM 失败：若输入可封装为 PDF 且 Doc2X 已配置，可由用户明确选择 Doc2X 重试；反向同理。
4. 两者均失败：继续支持直接编辑 Markdown，不阻断“完成修正”。
5. 第三方专用区域 OCR 只有达到下面的引入门槛后才进入候选 provider。

## 新模型引入门槛

先建立 50–100 个脱敏的真实异常区域样本，覆盖小字号、公式、图文混排、跨页、题卷/解析卷分离和扫描件。GLM 与 Doc2X 的片段方案满足以下任一条件时，评估新模型：

- 目标字段完全可用率低于 85%；
- 公式结构正确率低于 90%；
- 超过 20% 的任务仍需用户重写一半以上内容；
- P95 端到端等待时间超过 45 秒且无法通过任务体验优化解决；
- 单次修正成本或失败率不适合日常批量使用。

新模型需在相同样本、相同裁剪输入上至少让“完全可用率”提升 10 个百分点，或让人工修改量降低 30%，并满足数据安全、成本、许可和离线/网络部署要求。否则不增加第三个 provider 的维护成本。

## 指标

- 完全采用率：用户无需编辑直接采用的任务比例。
- 字段采用率：至少采用一个建议字段的任务比例。
- 公式结构正确率：抽样检查 LaTeX/Markdown 公式可解析且语义正确的比例。
- 人工修改量：采用前后编辑距离及用户修改字符比例。
- 串题率：结果包含相邻题或错误字段内容的比例。
- 失败率与重试率：按 provider、资料类型和目标字段分组。
- P50/P95 延迟与单次成本。
- 相对整卷重跑节省的时间与费用。

指标事件只记录结构化统计和任务 ID，不上传原始题目内容；本地诊断可通过任务 ID 关联原始结果。

## 分期

### Phase 0：样本与基线

- 收集并标注真实失败区域；记录当前人工修正耗时。
- 用离线脚本分别验证 GLM 图片片段与 Doc2X 临时 PDF，不接产品写回。

### Phase 1：GLM 最小闭环

- 实现片段构建、异步任务、`GlmRegionRecognitionProvider`、字段 diff 与显式确认。
- 仅支持单来源、单字段；所有写回使用 revision 与事务。

### Phase 2：跨页与 Doc2X

- 支持多片段排序、跨页拼接和临时 PDF。
- 接入 `Doc2xRegionRecognitionProvider`，提供显式 provider 切换与失败重试。

### Phase 3：评估兜底模型

- 按门槛复盘数据；只有收益明确时接入专用区域 OCR。
- 增加 provider 路由策略，但始终保留用户确认步骤。

## 测试重点

- 坐标换算、边距裁剪、页边界和最小尺寸的纯函数测试。
- 跨页/多来源片段排序与临时文件生成测试。
- provider 超时、空结果、多题串入、版本冲突和重复确认测试。
- 浏览器端到端覆盖：框选 → 识别 → diff → 部分采用 → 自动保存 → 刷新恢复。
- 确保失败、取消或离开页面时原候选内容不会丢失。
