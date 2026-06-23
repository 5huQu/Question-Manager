# Mock 页面与系统功能对齐规范 (Mock Pages & Features Alignment Specification)

本文件详述了当前 `Question Manager` 项目中所有 Mock 页面（路由为 `/mock/*`）的界面区域、对应的系统现有功能、API 支持状态、Mock Only 逻辑、未来后端支持需求，以及在 Codex 迁移/实现时**必须保留的功能入口**与**不能实现的假功能**。

---

## 目录
1. [Mock 工作台 (`/mock/workbench`)](#1-mock-工作台-mockworkbench)
2. [Mock 题库 (`/mock/question-bank`)](#2-mock-题库-mockquestion-bank)
3. [Mock OCR 复核 (`/mock/ocr-review`)](#3-mock-ocr-复核-mockocr-review)
4. [Mock 组卷工作台 (`/mock/basket`)](#4-mock-组卷工作台-mockbasket)
5. [Mock 导出记录 (`/mock/export-records`)](#5-mock-导出记录-mockexport-records)
6. [Mock 系统设置 (`/mock/settings`)](#6-mock-系统设置-mocksettings)
7. [Mock 弹窗组件 (`/mock/dialogs`)](#7-mock-弹窗组件-mockdialogs)

---

## 1. Mock 工作台 (`/mock/workbench`)

对应源文件：[MockWorkbenchPage.tsx](file:///Users/imshuqu/Question/frontend/src/pages/mock/MockWorkbenchPage.tsx)

### 功能对齐表

| 序号 | 页面区域 | 对应现有功能 | 已有 API 支持 | 是否 Mock Only | 未来需新增后端支持 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1.1** | **页面头部与动作栏** | 快捷检索入口 | 是 (`/api/question-bank/items`) | 否 | 无 |
| **1.2** | **统计卡片组** | 题库、切分与复核任务概览 | 是 (`/api/tools/pdf-slicer/dashboard`) | 否（同比指标等文本为 Mock Only） | 无 |
| **1.3** | **题库活动热力图** | 无（最近 6 个月数字化量看板） | **否** | **是**（动态生成随机正弦数据） | 需要活动审计日志或统计聚合接口 |
| **1.4** | **最近处理题目** | 题库最近更新试题列表 | 是 (`/api/question-bank/items`) | 否 | 无 |
| **1.5** | **最近导出记录** | 导出记录历史概览 | 是 (`/api/question-bank/export-records`) | 否 | 无 |
| **1.6** | **快捷工具入口** | 快捷跳转 OCR 复核、题库及手动录入 | 是（前端路由跳转） | 否 | 无 |
| **1.7** | **服务运行状态** | 系统诊断看板（检测 SQLite/KaTeX 引擎状态） | **否** | **是**（写死“连接正常”等状态描述） | 需要系统状态诊断/健康检查接口 |

### Codex 迁移指南

* **必须保留的功能入口**：
  * 指标统计卡片（题库总量、本月新增、今日复核、最近导出份数）。
  * “最近处理题目”列表及其快速加入试题篮的操作。
  * “最近导出记录”列表展示。
  * 快捷工具卡片（OCR 复核、检索题库、手动录入）。
  **需要实现的功能**
   * 热力图：已有API，接入后使用
* **不能实现的假功能（必须替换或剔除）**：
  * **静态指标同比**：指标卡片下方的“较上月 +8.4%”等文本不能硬编码，须从真实 Dashboard 统计中获取。
  * **假服务状态**：服务运行状态不可硬编码，须通过系统探测 API（如 `/api/system/status`）获取真实状态，在网页端不可用时应给出对应离线提示。

---

## 2. Mock 题库 (`/mock/question-bank`)

对应源文件：[MockQuestionBankPage.tsx](file:///Users/imshuqu/Question/frontend/src/pages/mock/MockQuestionBankPage.tsx)

### 功能对齐表

| 序号 | 页面区域 | 对应现有功能 | 已有 API 支持 | 是否 Mock Only | 未来需新增后端支持 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **2.1** | **左侧多维过滤器** | 按学段、题型、难度等多维分类筛选 | 是 (`/api/question-bank/items`) | 否 | 无 |
| **2.2** | **顶部工具与搜索栏** | 关键词检索、视图切换、试题篮计数 | 是（试题检索、试题篮数量） | 否 | 无 |
| **2.3** | **中部主列表流** | 卡片视图（带勾选框）与高密度表格（Table）视图 | 是 (`/api/question-bank/items`) | 否 | 无 |
| **2.4** | **右侧排版预览面板** | 选中试题的属性明细展示与 KaTeX 即时渲染 | 是 (`/api/question-bank/items/:id`) | 否 | 无 |
| **2.5** | **底部浮动批量操作栏** | 多选题目后的批量合并、标记或删除 | 仅支持单条删除和详情更新 | **是**（打标签与删除均无批量接口，采用 alert 模拟） | 需要批量更新标签与批量删除接口 |

### Codex 迁移指南

* **必须保留的功能入口**：
  * **三栏式交互布局**：左侧过滤器 + 中间主列表流 + 右侧即时预览面板。
  * **卡片/表格双视图切换**：提供 Grid 卡片排版与高密度 Table 排版。
  * **右侧即时公式渲染**：点击列表中的任何题目，右侧预览区必须自动加载并调用 KaTeX/Markdown 引擎渲染。
  * **底部浮动批量操作条**：勾选任意多条试题时，自底部滑出，并包含“加入试题篮”、“批量标记”、“删除”操作。
* **不能实现的假功能（必须替换或剔除）**：
  * **Local 试题篮保存**：禁止读写 `localStorage` 中的 `mock_question_basket`。必须请求 `/api/question-bank/collections` 接口，使用用户的活动集合（Active Collection）进行增删。
  * **批量打标签 Alert**：点击“标记”批量分配标签时，必须拉取真实的标签库 `/api/question-bank/tag-libraries` 供用户勾选，并发送 PATCH/POST 批量修改请求。
  * **静态试题数组**：禁止使用本地的 `INITIAL_MOCK_QUESTIONS` 作为数据源，必须绑定真实的后端分页检索。

---

## 3. Mock OCR 复核 (`/mock/ocr-review`)

对应源文件：[MockOcrReviewPage.tsx](file:///Users/imshuqu/Question/frontend/src/pages/mock/MockOcrReviewPage.tsx)

### 功能对齐表

| 序号 | 页面区域 | 对应现有功能 | 已有 API 支持 | 是否 Mock Only | 未来需新增后端支持 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **3.1** | **顶部任务 Toolbar** | 队列切换、重新 OCR、删除题目 | 是（队列切换、Rerun OCR 等） | 否（部分操作采用 alert 模拟） | 无 |
| **3.2** | **左侧待审切片列表** | 切片缩略列表与公式语法校验异常红标 | 是 (`/api/tools/pdf-slicer/runs/:runId/pending-bank`) | 否 | 无 |
| **3.3** | **中间切片画布区** | 原图切片展示与框选题图交互 | 是（展示切片原图，支持上传题图） | **是**（采用 SVG 模拟物理公式错配，框选为假截图） | 需要后端物理切图 API（根据 bbox 裁剪并保存为独立图片） |
| **3.4** | **右侧复核编辑面板** | 分 Tab 编辑题干、答案、解析、元数据及公式校验警示 | 是 (`/api/question-bank/items/:id`) | 否 | 无 |
| **3.5** | **右下排版预览区** | KaTeX 实时预览编辑器修改后的公式 | 是（前端本地渲染） | 否 | 无 |
| **3.6** | **底部固定动作栏** | 标记问题、暂存草稿、保存并下一题 | 是 (`/api/question-bank/items/:id`) | 否（动作采用 alert 模拟） | 无 |

### Codex 迁移指南

* **必须保留的功能入口**：
  * **切片复核主工作区布局**：左侧待审切片队列 + 中间大画布 + 右侧四 Tab 编辑与即时渲染区。
  * **公式平衡校验机制**：前端 `checkMathUnbalanced` 方法检测 `$` 闭合状态，若未闭合必须在右侧给出显眼的黄色“公式检测异常”警示条，闭合则显示绿色的“排版语法校验通过”。
  * **画布框选题图功能**：必须允许在原图上拉出红框选区，供用户关联为题干图、解析图或选项图。
  * **元数据标签关联**：自动关联教学学段、试卷题型、核心知识点，支持弹出选择。
* **不能实现的假功能（必须替换或剔除）**：
  * **SVG 假物理试题图片**：禁止使用 SVG 矢量文字和椭圆图形来伪造“公式错配”和“手写题目”，画布区必须渲染后端提供的切片原图（`/api/tools/pdf-slicer/runs/...` 下的图像资源）。
  * **假切图保存**：点击“确认切图”不能只弹出 alert，必须发送 bbox 坐标（如 `[x, y, width, height]`）到 `/api/question-bank/items/:id/figures` 接口，在服务器端物理裁剪生成真实的插图文件。
  * **假动作弹窗**：点击“暂存草稿”、“保存并下一题”不能显示 alert，必须向后端发送 Patch 更新请求，并将左侧切片状态置为“已复核”。

---

## 4. Mock 组卷工作台 (`/mock/basket`)

对应源文件：[MockBasketPage.tsx](file:///Users/imshuqu/Question/frontend/src/pages/mock/MockBasketPage.tsx)

### 功能对齐表

| 序号 | 页面区域 | 对应现有功能 | 已有 API 支持 | 是否 Mock Only | 未来需新增后端支持 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **4.1** | **左侧组卷大纲列表** | 试题分值设定、一键移除、清空列表 | 是 (`/api/question-bank/collections/:id`) | 否 | 无 |
| **4.2** | **大纲排序手柄** | 拖拽排序试题位置 | 是 (`/api/question-bank/collections/:id/reorder`) | 否（拖拽在前端模拟） | 无 |
| **4.3** | **右侧输出参数配置** | 配置主副标题、排版模式（教案/学案）、输出格式 | 是 (`/api/question-bank/collections/:id/export`) | 否 | 无 |
| **4.4** | **导出进度看板** | 进度条与状态刷新 | **否** | **是**（通过 setInterval 模拟定时进度） | 无（通常导出接口为同步或提供实时长连接进度，目前同步已足矣） |
| **4.5** | **生成成功弹窗** | 展示导出编码，提供下载及转到记录的入口 | 是 (`/api/question-bank/collections/:id/export` 返回下载流) | 否（下载部分由 alert 伪造） | 无 |

### Codex 迁移指南

* **必须保留的功能入口**：
  * **拖拽重排序交互**：试题卡片左侧包含 Grip 竖手柄，拖拽可自由调整出卷题目顺序。
  * **分值分配机制**：单题分配分值（如单选 5 分、解答 15 分），并自动累加显示在右侧的“估算总分”中。
  * **输出参数选项**：包括“答案及解析排版（不显示/附卷末/教案版）”下拉框与三种格式按钮组。
  * **质量审查看板**：显示题目数、估算总分、自动校验结果。
* **不能实现的假功能（必须替换或剔除）**：
  * **Local 大纲数据**：大纲数据不可加载自 local 试题篮，须使用真实 Active Collection 接口。
  * **假导出时间器**：导出时，不可在前端写死“正在分析排版布局...”、“正在渲染矢量图表”等步骤和延时，应当显示真实的 API Loading 或轮询真实编译日志。
  * **假下载 Alert**：点击“下载文件”必须真实下载后端返回的文件二进制流，严禁仅弹出提示。

---

## 5. Mock 导出记录 (`/mock/export-records`)

对应源文件：[MockExportRecordsPage.tsx](file:///Users/imshuqu/Question/frontend/src/pages/mock/MockExportRecordsPage.tsx)

### Codex 迁移指南

该页面请不要做任何迁移操作！维持当前系统源文件设计。

---

## 6. Mock 系统设置 (`/mock/settings`)

对应源文件：[MockSettingsPage.tsx](file:///Users/imshuqu/Question/frontend/src/pages/mock/MockSettingsPage.tsx)

### 功能对齐表

| 序号 | 页面区域 | 对应现有功能 | 已有 API 支持 | 是否 Mock Only | 未来需新增后端支持 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **6.1** | **基础设置** | 系统名称、学段及水印参数设置 | **部分支持**（部分参数暂无 API） | 否 | 需要在 API 中扩充系统基本元数据字段 |
| **6.2** | **外部集成工具** | Word 转 PDF 的 soffice.exe 路径配置 | 是 (`/api/tools/pdf-slicer/ocr-settings`) | 否（检测状态为硬编码） | 无 |
| **6.3** | **OCR 接口设置** | API Url/Key 密钥配置与置信度过滤滑块 | 是 (`/api/tools/pdf-slicer/ocr-settings`) | 否（连通性测试为 Mock） | 需要后端连通性测试 API |
| **6.4** | **自动属性分类** | 开启自动分类大模型并发及 API 参数 | 是 (`/api/tools/pdf-slicer/ocr-settings`) | 否 | 无 |
| **6.5** | **OCR 底层系统提示词** | 页面级别与分区识别的底层 Prompt 文本域 | 是 (`/api/tools/pdf-slicer/ocr-settings`) | 否 | 无 |
| **6.6** | **PDF 切题字典规则** | 6 大分类规则词表，支持添加/删除/启用切换 | 是 (`/api/tools/pdf-slicer/rules`) | 否（添加/删除为本地操作） | 无 |
| **6.7** | **右侧运行看板与更新** | Electron 在线检测更新、占用空间统计与日志面板 | **否** | **是**（检测更新、空间统计饼图全部写死） | 需要获取磁盘占用接口与 Electron 在线热更新接口 |

### Codex 迁移指南

* **必须保留的功能入口**：
  * **切题字典管理 Tab 切换交互**：6 大类别快速切换，支持以表格形式维护规则词条（启用/禁用、包含/精确、删除）。
  * **大模型 Prompt 模板维护区**：提供高亮文本框用于保存分类 Prompt 与 OCR Prompt。
  * **运行看板面板**：包含在线检查更新入口、存储占用统计。
* **不能实现的假功能（必须替换或剔除）**：
  * **本地字典修改**：添加、修改或删除字典规则时，不能仅修改本地的 `rules` 变量，必须使用真实 API（POST/DELETE `/api/tools/pdf-slicer/rules`）进行数据库持久化。
  * **假 LibreOffice/OCR 连接测试**：不能硬编码连接成功及延迟数值。连接测试必须调用后端连通性接口；soffice 检测标签必须调用后端探测接口。
  * **假在线升级**：当前请先链接到对应 GitHub 仓库，不要新增升级功能。

---

## 7. Mock 弹窗组件 (`/mock/dialogs`)

对应源文件：[MockDialogsPage.tsx](file:///Users/imshuqu/Question/frontend/src/pages/mock/MockDialogsPage.tsx)

### 功能对齐表

| 序号 | 页面区域 | 对应现有功能 | 已有 API 支持 | 是否 Mock Only | 未来需新增后端支持 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **7.1** | **控制台主页** | 两个独立弹窗的挂载触发菜单 | 否（本页仅为 Dialog 展厅） | 是 | 无 |
| **7.2** | **切题复核弹窗 - 列表** | 批次切片队列列表，支持多选、合并、丢弃 | 是 (`/api/tools/pdf-slicer/runs/...`) | 否（合并/丢弃由 React 数组操作模拟） | 无 |
| **7.3** | **切题复核弹窗 - 画布** | 切片图表展示与交互拆分定位线（Y 轴） | 是（展示切片图） | **是**（物理拆分线拖拽为假效果） | 需要后端物理图像 Y 轴切分服务 |
| **7.4** | **切题复核弹窗 - 属性** | 修剪映射题号及类型修改 | 是 (`/api/tools/pdf-slicer/runs/quick-review`) | 否 | 无 |
| **7.5** | **框选题图弹窗 - 画布** | 切片原图与可调整红色选区边框 | 是（仅图片展示） | **是**（红色红框拉伸为假截图） | 需要后端物理截图裁剪服务 |
| **7.6** | **框选题图弹窗 - 列表** | 题图用途关联与已截图列表清单 | 是 (`/api/question-bank/items/:id/figures`) | 否 | 无 |

### Codex 迁移指南

* **必须保留的功能入口**：
  * **批量人工复核控制台弹窗**：
    * 左侧多选框支持合并与丢弃。
    * 画布上可拖拽 Y 坐标红线（“拆分线 (Y=55%)”），定位后浮出拆分警告框。
    * 右侧题号映射修剪与通过提交逻辑。
  * **几何插图框选弹窗**：
    * 在原图上可以通过鼠标拖动拉出一个红框选区，并计算显示“选区 240 × 180”。
    * 支持在右侧下拉菜单中设定截图用途（题干、解析、选项A/B）。
    * 保存选区后录入右下角的关联图片清单，并支持一键删除。
* **不能实现的假功能（必须替换或剔除）**：
  * **React 内存假拆分与合并**：切片复核弹窗中的“合并”与“拆分”不能只操作 React state。拆分时，必须把 Y 轴像素高度坐标传给后端，执行物理拆分并新建两条题目数据；合并同理。这部分在原项目已经存在。
  * **假截图**：点击“确认截取选区”不能仅仅把假图片名称放入数组，必须调用后端真实裁剪服务，对指定 bbox 执行切图，然后上传为对应用途的 figure 资源。
