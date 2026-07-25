# LaTeX 结构化题目入库标准

本文规定把已编译讲义的 LaTeX 源码中的题目，录入 Question Manager 题库的最小数据标准。适用对象是 `question_bank_items`，通过 `POST /api/question-bank/items` 创建；不走 OCR，也不依赖 PDF 页码。

## 1. 入库边界

- **一题一记录**：顶层 `\item`、`example` 或项目自定义题目环境各自是一条题目；其中的 `(1)`、`(2)` 是同一道题的小问，保留在同一个 `stemMarkdown` 中。
- **学生版和教师版去重**：同一题面只入库一次。优先读取包含 `\TeacherSolution{...}` 的源码，以获得答案和解析；题面以学生版为准。
- **不录入讲解性文字**：章节知识梳理、通法表、答案页、目录和仅作排版的 `enumerate` 不单独入库。
- **不猜答案**：LaTeX 源码没有明确答案、或解析只是通法而不能唯一对应本题时，题目可以保存为待复核，但不得把推导猜测写成原题答案。

## 2. 来源规则（必须执行）

对于形如下面的题目：

```tex
\item （2026高三·广东广州·阶段检测）函数 $f(x)=\cdots$
```

题号后的首个全角括号内容就是**题目来源**。导入时：

1. 从题干中移除该括号及其内容，避免组卷和检索时重复展示来源；
2. 原样保存到 `sourceTitle`，如 `2026高三·广东广州·阶段检测`；
3. 尽可能拆分到 `examYear`、`stage`、`province`、`city`、`batchName`、`paperKind` 和 `sourceOrg`；不能可靠判断的字段留空或用 `unknown`，原文始终以 `sourceTitle` 为准；
4. 在 `importSourceId` 中保存稳定的 LaTeX 定位符：`latex:<相对源码路径>#<章节标题>:<章节内题号>`；
5. 题号本身只保存题号，例如 `1`、`2`，不拼入来源文字。章节间允许同号，`importSourceId` 负责消歧。

### 来源拆分约定

| 来源片段 | 目标字段 | 示例 |
| --- | --- | --- |
| `2026`、`2025-2026学年` | `examYear` | 单年直接取该年；学年取结束年份 `2026` |
| `高三` | `stage` | `高三` |
| `广东广州`、`四川成都市` | `province`、`city` | `广东` / `广州`；`四川` / `成都` |
| `重庆市九龙坡区` | `province`、`city`、`sourceOrg` | `重庆` / `九龙坡区` / `重庆市九龙坡区` |
| `期中`、`期末`、`阶段检测` | `paperKind`、`batchName` | `school_exam`，并保留原词 |
| `模拟预测` | `paperKind`、`batchName` | `mock` / `模拟预测` |
| `课堂例题`、`一轮复习`、`专题练习` | `paperKind`、`batchName` | `lecture`，保留原词 |
| `课后作业`、`定时练习` | `paperKind`、`batchName` | `daily_practice`，保留原词 |

`paperTitle` 仅在来源文本确实给出了完整试卷/测评名称时填写；否则留空，不用讲义章节名冒充试卷名。

## 3. 字段映射

| 题库字段 | 录入规则 |
| --- | --- |
| `id`、`serialNo` | 不在导入 JSON 中指定，由系统生成。 |
| `questionNo` | 当前章节内的顶层题号；去除 `第`、`题`、标点和来源。 |
| `stage`、`subject` | 从来源解析；本批资料默认 `高三`、`数学`。 |
| `questionType` | 四个连续 `A.`–`D.` 选项为 `单选题`（题干或答案明确多选时为 `多选题`）；含 `\blank` 的单空题为 `填空题`；证明、求解、多问题为 `解答题`。 |
| `chapter` | 最近的 `\chapter` / `\section` 标题，例如 `三次函数的图象和性质`。 |
| `knowledgePoints`、`solutionMethods` | 使用仓库标签库中的规范中文名称；未复核时可为空，不根据题干批量臆测。 |
| `difficultyScore10`、`difficultyLabel` | 未经人工或既有标注复核时为 `0` / 空字符串（系统显示为空），不得以题型代替难度。 |
| `stemMarkdown` | 去掉题号、来源前缀和 `\blank[... ]` 排版命令后转为 Markdown；行内公式用 `$...$`，独立公式用 `$$...$$`。选项必须连续写为 `A.` 至 `D.`。 |
| `answerText` | 仅保存最终答案（选择题保存 `A`、`B` 等；填空/解答按 LaTeX 转 Markdown）。 |
| `analysisMarkdown` | 从与该题绑定的 `\TeacherSolution` 中提取；仅保留数学推理，删除题源行和答案/分析标题；将 `\par` 转为 Markdown 段落。若同时有“分析”和“详解”，只保留完整的“详解”，避免重复。没有可核对解析时留空。 |
| `figures` | 题干、选项或解析含 TikZ/外部图片时，保留可移植图片资产并标注 `usage: stem`、`options` 或 `analysis`；没有图时 `[]`。 |
| `bankStatus` | 题面、答案、公式和来源均复核通过为 `ready`；任一项不完整或有公式/图形转换疑点为 `blocked`。 |
| `importSourceId` | 必填；使用第 2 节的 LaTeX 定位符。 |

Markdown 中的填空统一用 `______`，不保留 `\blank[3cm]`。题干中不保留 `\TeacherSolution`、`\textcolor`、`\smallskip` 等排版宏。

### 解析清洗规则

`answerText` 与 `analysisMarkdown` 必须职责分离：前者只保存最终答案，后者只保存解题过程。解析清洗时删除下列内容，不以任何形式带入 `analysisMarkdown`：

- `解析来源：...`、`题源：...`、`来源：...` 及其所在整行；
- `【答案】` 与答案内容（答案已单独写入 `answerText`）；
- `【分析】`、`【详解】`、`解：`、`解析：` 等仅作标题或排版的前缀；
- `\noindent`、`\textcolor{...}{...}`、`\scriptsize`、`\smallskip`、`\begingroup`、`\endgroup`、`\par` 等 LaTeX 排版命令。

删除命令本身不等于删除段落：每个 `\par` 必须改为一个 Markdown 段落分隔（两个换行）。同一份教师解答同时出现 `【分析】` 和 `【详解】` 时，丢弃概述性的“分析”段，只保留“详解”的分步推导。

公式清洗应先移除 `\!` 等间距命令，再规范化相邻控制词；例如 `\ln\!x` 必须写为 `\ln x`，`\in\!Z` 必须写为 `\in \mathbb{Z}`。入库前应按前端同一套 `$...$` 定界规则逐个交给 KaTeX 校验。

例如截图中的“`题源：下载资料：专题 02《利用导数研究曲线的切线问题 18 种常见考法归类》（解析版）第 34 题。`”必须删除；解析应直接从“设切点为 $T(t,t^3-t)$ ……”开始。题目来源只取题号后的来源括号并写入题目元数据，不从教师解析的题源行回填。

## 4. 入库流程

1. 从最终参与编译的 `.tex` 入口递归解析 `\input` / `\include`，建立源文件清单；排除 `build/`、`tmp/` 与重复的教师入口。
2. 识别章节、题目环境、顶层题号、题面、选项、答案和教师解析；生成每题的 `importSourceId`。
3. 从题号后的来源括号解析元数据，并将其从 `stemMarkdown` 移除。
4. 转换 LaTeX 为题库 Markdown，检查 `$` 配对、选项顺序、空格/换行、图片引用和题型一致性。
5. 对每条题目做来源、答案、解析、公式和图形复核；可确认的设为 `ready`，其余设为 `blocked` 并写明复核原因。
6. 入库前按 `stemMarkdown` 进行近重复检查；相同题面保留一条，补齐缺失的答案、解析或来源元数据。
7. 经 `POST /api/question-bank/items` 写入；写入后抽样确认 Markdown 公式渲染、选项编辑和搜索字段正常。

## 5. 拟录入示例

以下示例来自 `/Users/imshuqu/一轮资料/高中数学一轮讲义/derivative-practice-native.tex` 的“`三次函数的图象和性质`”章节。示例展示目标 API 的字段，而非已写入数据。

### 示例 1：选择题，答案未在源码中唯一给出，先阻塞复核

```json
{
  "questionNo": "1",
  "stage": "高三",
  "subject": "数学",
  "questionType": "单选题",
  "chapter": "三次函数的图象和性质",
  "knowledgePoints": ["利用导数研究函数单调性"],
  "sourceTitle": "2026高三·广东广州·阶段检测",
  "province": "广东",
  "city": "广州",
  "batchName": "阶段检测",
  "paperKind": "school_exam",
  "examYear": 2026,
  "importSourceId": "latex:高中数学一轮讲义/derivative-practice-native.tex#三次函数的图象和性质:1",
  "stemMarkdown": "函数 $y=2x-\\dfrac{2}{3}x^3$ 的单调递增区间为（ ）\n\nA. $(-1,1)$\nB. $(-\\infty,-1)$\nC. $(1,+\\infty)$\nD. $(0,+\\infty)$",
  "answerText": "",
  "analysisMarkdown": "源码中的教师内容是三次函数单调性的通法，未明确给出本题最终选项；需人工核对后补充答案。",
  "difficultyScore10": 0,
  "difficultyLabel": "",
  "figures": [],
  "bankStatus": "blocked",
  "needsFormatReview": true,
  "formatIssue": {
    "field": "answerText",
    "code": "missing_answer",
    "message": "教师解析未给出可直接核对的最终选项，禁止自动推断入库。",
    "snippet": ""
  }
}
```

### 示例 2：填空题，答案与解析齐全，可入库

```json
{
  "questionNo": "2",
  "stage": "高三",
  "subject": "数学",
  "questionType": "填空题",
  "chapter": "三次函数的图象和性质",
  "knowledgePoints": ["函数的极值、最值及其应用"],
  "solutionMethods": ["求导法"],
  "sourceTitle": "重庆市九龙坡区2025-2026学年高三学期期末学业质量测评数学试题",
  "province": "重庆",
  "city": "九龙坡区",
  "sourceOrg": "重庆市九龙坡区",
  "paperTitle": "重庆市九龙坡区2025-2026学年高三学期期末学业质量测评数学试题",
  "batchName": "期末",
  "paperKind": "school_exam",
  "examYear": 2026,
  "importSourceId": "latex:高中数学一轮讲义/derivative-practice-native.tex#三次函数的图象和性质:2",
  "stemMarkdown": "函数 $f(x)=\\dfrac{1}{3}x^3+\\dfrac{1}{2}x^2-6x+1$ 的所有极值点之和为 ______。",
  "answerText": "$-1$",
  "analysisMarkdown": "$f'(x)=x^2+x-6=(x+3)(x-2)$。令 $f'(x)=0$，得极值点横坐标为 $-3,2$，故其和为 $-1$。",
  "difficultyScore10": 0,
  "difficultyLabel": "",
  "figures": [],
  "bankStatus": "ready"
}
```

### 示例 3：填空题，来源为定时练习

```json
{
  "questionNo": "3",
  "stage": "高三",
  "subject": "数学",
  "questionType": "填空题",
  "chapter": "三次函数的图象和性质",
  "knowledgePoints": ["函数的极值、最值及其应用"],
  "solutionMethods": ["求导法"],
  "sourceTitle": "四川成都市2025-2026学年高三学期定时练习数学试题",
  "province": "四川",
  "city": "成都",
  "paperTitle": "四川成都市2025-2026学年高三学期定时练习数学试题",
  "batchName": "定时练习",
  "paperKind": "daily_practice",
  "examYear": 2026,
  "importSourceId": "latex:高中数学一轮讲义/derivative-practice-native.tex#三次函数的图象和性质:3",
  "stemMarkdown": "函数 $f(x)=x^3-3x\\;(0\\le x\\le2)$ 的最小值为 ______。",
  "answerText": "$-2$",
  "analysisMarkdown": "$f'(x)=3x^2-3$。在 $[0,1]$ 上递减、在 $[1,2]$ 上递增，故最小值为 $f(1)=-2$。",
  "difficultyScore10": 0,
  "difficultyLabel": "",
  "figures": [],
  "bankStatus": "ready"
}
```

## 6. 验收清单

- 题干不含顶层题号、来源括号、`\blank` 或教师版排版宏；来源仍可由 `sourceTitle` 与 `importSourceId` 完整追溯。
- 每个选择题都有连续的 `A.`、`B.`、`C.`、`D.`，且最终答案与选项一致。
- 每个 `ready` 题目都有非空题干、答案、来源和可渲染公式；解析缺失时可为空，但需在导入记录中说明。
- `blocked` 题目保留原题面和来源，不进入组卷候选范围，待人工补齐后再转为 `ready`。
- 同一题不因学生/教师入口或多个 `\input` 路径重复入库。
