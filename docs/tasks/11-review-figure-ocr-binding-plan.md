# 切题复核中的题干图、选项图与解析图标注及 OCR 入库方案

## 1. 背景

当前切题人工复核页允许在题块预览图上拖拽一个矩形，并以 `stem`、`options`、`analysis` 写入 `figures_json`。这已经能保存“图框”，但尚不是一条完整的图片处理链路：

- 用户不知道当前框是在标记“这是一张题干图”，还是在定义“题干 OCR 应读取的区域”。
- 人工框出的图片通常只在复核记录中保留 bbox；OCR 任务未获得一份稳定、可引用的图片附件及其字段归属。
- OCR 完成后，题库导入不能可靠决定图片应插入题干、选项还是解析，也无法保证重跑 OCR 时得到相同的图。
- 对“原卷 + 答案/解析”分离文件，解析图还必须从答案侧裁取，并以 `analysis` 身份附到原卷题目，而不能误放到题干。

本方案将人工框选的图升级为**人工确认的 OCR 图片附件**。它既是导入后题库的正式图片来源，也是 OCR 任务的显式输入，贯通“复核标注 -> OCR -> 结果校验 -> 入库/导出”。

## 2. 目标与非目标

### 目标

- 用户可在题块复核中分别框选题干图、选项图、解析图。
- 每个框选图都有明确来源、用途、稳定图片资产、坐标和 OCR 绑定状态。
- OCR 任务可以看见图片本身和图片所属字段，并在返回结果中引用它。
- 导入题库后，题干图进入 `stemMarkdown`，选项图进入相应选项，解析图进入 `analysisMarkdown`；不依赖模型猜测图片位置。
- 支持原卷/解析分离文件、跨页题、同题多图、OCR 重跑和人工修改后的重新识别。

### 非目标

- 本期不要求图像内容识别为结构化几何对象、函数图像或表格数据。
- 不让模型自动决定人工框选图的最终归属；人工标注优先。
- 不重写现有 OCR provider 的整体调用方式，只扩展 OCR manifest 与导入绑定逻辑。

## 3. 核心原则

1. **图框不是图片资产**：bbox 只是从某张题块图裁出附件的规则；提交 OCR 前必须物化为稳定的实际图片文件。
2. **用途由人工决定**：`stem`、`options`、`analysis` 是业务归属，不由 OCR 自动覆盖。
3. **OCR 显式看图和引用图**：每个图片附件有稳定 ID，模型以 ID 在输出中引用，而不是依赖文段位置猜测。
4. **OCR 重跑可复现**：同一题块版本、同一图片附件版本应生成相同 manifest；修改图框后形成新的附件版本。
5. **原卷与解析独立裁切、题号汇合**：解析图从解析题块裁取，但最终以 `analysis` 归属进入对应原卷题目。

## 4. 用户链路

```mermaid
flowchart LR
  A["题块人工复核"] --> B["选择题干/选项/解析图片模式"]
  B --> C["在相应题块图上拖拽框选"]
  C --> D["生成 OCR 图片附件"]
  D --> E["确认题块并创建 OCR manifest"]
  E --> F["OCR 返回字段文本 + 图片引用 ID"]
  F --> G["入库绑定与人工兜底复核"]
  G --> H["题库、练习与导出"]
```

### 4.1 复核台交互

现有 `题干图 / 解析图` 预览页签保留，但将顶部“用途”下拉改为更明确的动作：

| 当前预览来源 | 可创建的附件 | 默认归属 |
| --- | --- | --- |
| 原卷题块 | `标注题干图`、`标注选项图` | `stem` 或指定选项 |
| 解析题块 | `标注解析图` | `analysis` |
| 无解析题块 | 解析图按钮禁用，并提示“请先为本题补充解析裁图” |

用户操作：

1. 选中某题，在原卷预览点击“标注题干图”，拖拽框出图形。
2. 如图仅属于某个选项，切换为“标注选项图”，选择 A-D，再框选。
3. 切到解析预览，点击“标注解析图”，框选证明图、步骤图、表格或其他解析辅助图。
4. 保存后，右侧或底部展示附件卡：缩略图、`题干图/选项 B 图/解析图`、来源页、删除和重新裁切按钮。
5. 每题显示 `题干图 n`、`选项图 n`、`解析图 n` 计数；OCR 前提示未绑定的图。

“图框编辑”与“题块拆分”保持不同模式，避免用户误以为框图会切出新的题目。

### 4.2 原卷与解析分离

- 原卷题块的图框写入题目 review item。
- 解析题块的图框写入对应 solution item。
- 复核页按题号把两侧附件汇总展示，但不把答案文件的坐标伪装成原卷坐标。
- OCR 前构建原卷题目的统一附件列表；其中解析附件标记为 `source: solution`、`usage: analysis`。

## 5. 数据模型

继续兼容 `figures_json`，但统一为以下逻辑字段；不新增一张必须查询的图表，避免破坏既有导出和图框编辑。

```json
{
  "id": "fig_review_001",
  "origin": "review_manual",
  "usage": "stem",
  "category": "question",
  "optionLabel": "",
  "source": "question",
  "sourceRunId": "run_questions",
  "sourceItemId": "CUT_0011",
  "pageNumber": 3,
  "reviewBBox": { "x": 0.72, "y": 0.18, "width": 0.21, "height": 0.30 },
  "assetPath": "data/review_figures/run_x/CUT_0011/fig_review_001.png",
  "assetHash": "sha256:...",
  "assetVersion": 1,
  "ocrBinding": {
    "enabled": true,
    "attachmentId": "F1",
    "targetField": "stem",
    "status": "ready"
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

字段约束：

- `source` 为 `question` 或 `solution`，由当前预览来源决定，不能由前端随意伪造。
- `usage=stem` 对应 `targetField=stem`；`usage=analysis` 对应 `analysis`；`usage=options` 必须有 `optionLabel`。
- `assetPath` 在 OCR 开始前必须存在；bbox 变动、来源图变化或用途变化时递增 `assetVersion`。
- 解析附件存放在 solution item 的 `figures_json`，合并到题目时保持 `usage=analysis`。

## 6. 物化图片资产

### 6.1 保存图框时

保存图框只写元数据，界面立即展示原题块中的覆盖框；同时将附件状态设为 `pending_render`。这样拖拽编辑保持流畅。

### 6.2 提交 OCR 前

在“提交复核并开始 OCR”之前执行附件物化：

1. 读取题干题块图或解析题块图。
2. 按 `reviewBBox` 裁图，增加统一 4-8 px 安全边距。
3. 以 `run / item / figure ID / asset version` 写入稳定 PNG 文件。
4. 计算哈希，写回 `assetPath`、`assetHash`、`ocrBinding.status=ready`。
5. 裁切失败时阻断 OCR，定位到具体题号和附件；不能静默丢图。

裁图使用当前的本地图片裁切能力；不依赖 OCR provider 生成的临时图片，因此可以离线复现。

## 7. OCR manifest 与提示词

### 7.1 Manifest 扩展

每道题在现有 OCR record 中增加 `attachments`。题干、选项和解析图都以真实路径加入：

```json
{
  "id": "CUT_0011",
  "reviewed_image_path": ".../question_11.png",
  "attachments": [
    {
      "id": "F1",
      "path": ".../fig_review_001.png",
      "usage": "stem",
      "targetField": "stem",
      "source": "question"
    },
    {
      "id": "A1",
      "path": ".../fig_review_solution_001.png",
      "usage": "analysis",
      "targetField": "analysis",
      "source": "solution"
    }
  ]
}
```

每张附件同时随 OCR 请求上传或合成为 provider 可访问的图像输入。不能只在 JSON 内写路径而不让模型看到对应图片。

### 7.2 提示词约束

向模型增加稳定规则：

1. 题目主图中可能含多种图片；人工提供的附件是已确认的重点图片。
2. 将附件以 `{{figure:F1}}`、`{{figure:A1}}` 引用到正确字段：
   - `stem`：题干图；
   - `options.A-D`：选项图；
   - `analysis`：解析图。
3. 不要重新生成或改写图片内容，不要把解析图放到题干。
4. 附件不能从上下文确定插入位置时，保留在 `unplaced_attachments`，由导入页提示人工选择，不丢失。

模型自动检测到的图片与人工附件重叠时，人工附件优先；自动图片仅作为补充候选。

## 8. OCR 结果导入与题库绑定

### 8.1 导入规则

- `stem` 中的 `{{figure:F1}}` 替换为题干图 Markdown/富文本引用。
- 选项字段中的图片绑定到对应选项，而不是混入题干末尾。
- `analysis` 中的 `{{figure:A1}}` 替换为解析图引用。
- 附件同时写入 `question_bank_items.figures_json`，保留 `usage`、来源、哈希和裁切元数据。
- 未被模型引用的人工附件不删除：写入题目的“待定位图片”诊断，入库页提供“插入题干 / 插入选项 / 插入解析 / 忽略”操作。

### 8.2 分离解析合并

若解析来自答案 run：

1. OCR 先解析原卷题干及其附件。
2. 解析附件作为同一题的 `analysis` 输入或解析 record 输入。
3. 按题号合并时，解析附件一起并入最终题目，且强制标记 `usage=analysis`。
4. 任何题号未匹配都保留解析附件和诊断，不把图错误附到相邻题。

## 9. 状态、重跑与审计

| 状态 | 含义 |
| --- | --- |
| `pending_render` | 图框已保存，尚未生成附件图片。 |
| `ready` | 附件资产存在，可进入 OCR manifest。 |
| `failed` | 裁图失败，阻断 OCR。 |
| `bound` | OCR 输出已引用到目标字段。 |
| `unplaced` | OCR 未给出可用位置，等待人工处理。 |
| `superseded` | 图框或题块变更后旧附件，仅供审计。 |

OCR 重跑必须读取同一 `assetVersion`；用户修改框选后，旧资产不覆盖，生成新版本并使对应 OCR 结果标记为过期。

## 10. API 与实现边界

建议新增或扩展以下能力：

| 能力 | 说明 |
| --- | --- |
| 图框保存接口 | 校验用途、来源题块和 optionLabel；写入带 `source` 的 figure metadata。 |
| `POST /runs/:runId/review-figures/materialize` | 复核提交时裁切并校验所有人工附件。 |
| OCR manifest 构建 | 在现有 `exportRunForMigratedOcr()` 中加入附件路径、用途和字段归属。 |
| OCR 导入绑定 | 解析 `{{figure:ID}}`，保留未绑定附件并生成诊断。 |
| 待入库图片定位 | 对 `unplaced` 附件提供拖拽或按钮式目标字段选择。 |

不要让前端直接把本地绝对路径提交给后端；后端根据 run、item、figure ID 解析并签发内部资产路径。

## 11. 实施分期

### 第一阶段：复核标注语义清晰化

- 将“图框用途”改为明确的题干图、选项图、解析图动作。
- 保存 `source`、`usage`、`targetField`、optionLabel 和稳定 figure ID。
- 在列表显示各类图片计数与来源。

### 第二阶段：OCR 前物化与 manifest

- 实现复核图框到实际 PNG 资产的批量裁切。
- 提交 OCR 前校验资产存在性。
- 为 OCR record 增加 `attachments`，并更新 provider 输入和提示词。

### 第三阶段：入库绑定与人工兜底

- 解析 OCR 图引用，写入对应 Markdown/选项字段与 `figures_json`。
- 提供未定位图片的待入库处理。
- 接通分离答案的解析图合并。

### 第四阶段：效率增强

- 模型建议附件用途与可能插入点，用户确认即可。
- 检测与现有手工附件重叠的自动图，降低重复。
- 支持表格、坐标系、几何图的辅助描述与无障碍 alt 文本。

## 12. 验收标准

以截图中的第 11 题函数曲线图为例：

1. 用户在原卷题块中框选“图 2”，标记为题干图。
2. 保存后可看到独立缩略图和稳定附件 ID，OCR 前附件实际 PNG 已生成。
3. OCR manifest 同时包含题块主图和 `F1` 附件；模型结果在题干中引用 `F1`。
4. 入库后，题干文本与“图 2”在题干字段中一起展示；不进入解析。
5. 在答案版框选证明/示意图后，它以 `analysis` 进入解析字段。
6. 修改图框并重跑 OCR 后，新旧附件和 OCR 结果可追溯，旧结果不被静默覆盖。
7. OCR 未引用的手工图会出现在待入库页面，允许人工定位，绝不丢失。

