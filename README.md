# Question Manager

Question Manager 是一个本地优先的数学题库桌面工具，覆盖从 PDF 切题、OCR、人工复核到题库维护、组卷和导出的完整流程。

项目以 Electron、React、Express、SQLite 和 Python 构建，支持 macOS 与 Windows。真实试卷、题图、SQLite 数据库、OCR 响应与 API 密钥均不包含在开源仓库中。

## 适合处理的资料

- 单份试卷或讲义
- 题干与答案/解析在同一 PDF 中的混合资料
- 原卷与解析分开的配套 PDF
- 跨页大题、含几何图、函数图、选项图或解析图的数学资料

## 核心能力

- **PDF 切题与复核**：自动检测题号和页面区域，支持跨页题，并可在 OCR 前人工调整边界。
- **混合资料拆分**：同一 PDF 中的题干和解析会作为独立分段处理，再按题号合并为一题。
- **GLM-OCR 区域归属**：GLM-OCR 可识别整份 PDF；系统根据已复核的题干/解析区域回收文本，避免相邻题或解析内容串入当前题。
- **题图管理**：可在题干切片、解析裁图或 OCR 分块中框图、上传、调整和删除。已匹配的 GLM 图仅作识别诊断，不会重复显示为第二张题图。
- **图片位置绑定**：OCR 返回图片标签或独立图注（例如“图1”）时，系统按阅读顺序绑定本地复核图；图数不一致时会明确提示“缺少可绑定图片”。
- **待入库确认**：集中检查 OCR 文本、公式、题图、答案与解析，再确认进入题库。
- **题库与组卷**：支持标签、难度、题型、检索、题图维护、试题篮和练习单/试卷/讲义编排。
- **多格式导出**：支持 Markdown、LaTeX 与 PDF，可使用内置模板或 Examch 模板。

## 推荐工作流

### 1. 上传并切题

在“PDF 切分中心”上传资料，等待自动切题完成后进入复核。

- 检查每题的起止区域、题号和跨页顺序。
- 对含图题目，在“框选题图”中选择正确来源：`题干切片`、`解析裁图` 或 OCR 分块。
- 将图保存为题干图、解析图或选项图。

### 2. OCR 与图文绑定

复核通过后进入 OCR 队列并启动识别。

对于题干与解析混合的资料：

1. GLM-OCR 识别整份 PDF 的版面和文本。
2. 系统按复核后的题干区、解析区分别取回文本。
3. 题干与解析按题号合并。
4. 复核框选的图片保持绑定到各自原始切片；GLM 返回的同图仅用于匹配诊断，不重复渲染。

重新 OCR 会清理该批次的 OCR 文本和生成产物，但保留切题复核与解析侧已确认的图框，随后重新生成题库候选。

### 3. 待入库确认

在“入库确认”中检查：

- 题干、答案、解析是否归属正确；
- 公式是否可正常渲染；
- 题图是否出现在正确位置；
- 是否出现“需要确认题图”或“缺少可绑定图片”提示。

若提示图片引用与已框图片数量不一致，请先在“框选题图”中补齐、删除或调整图片，再保存。图片编辑后会立即重新尝试绑定，无需重新 OCR。

### 4. 入库、组卷与导出

确认无误后入库；随后可在题库中补充标签、难度和知识点，并加入试题篮完成组卷和导出。

## OCR 提供方

在“系统设置”中选择并配置 OCR 提供方。密钥写入本机数据目录的配置文件，前端只显示“是否已配置”，不会返回完整密钥。

| 提供方 | 适用情况 | 说明 |
| --- | --- | --- |
| `GLM-OCR` <br> [点击获取GLM免费2000万Token](https://www.bigmodel.cn/invite?icode=xv%2BcI4bIrZk%2BhZnL8f9veH3uFJ1nZ0jLLgipQkYjpcA%3D)| 推荐用于混合题干/解析资料、跨页题和需要区域归属的资料 | 成本较低，注册即有赠送额度。整卷识别后按已复核区域回收文本；支持单题重新 OCR。 |
| `Doc2X` <br> [点击注册Doc2X](https://doc2x.noedgeai.com?inviteCode=Y2J9Y0)| 已有稳定整份 PDF 识别结果的批量场景 | 成本相对高，准确率高，会下载识别 JSON 与图片；适合整批跑。 |



OCR 失败时，优先检查：API Key、模型名称、原始 PDF 是否仍存在、切题复核是否已提交，以及 OCR 队列中的失败详情。

## 桌面版使用

桌面应用内置 Python 运行时，普通使用者无需另行安装 Python 或配置 `PATH`。

首次启动需要完成基础设置：

1. 设置系统名称和网页标题。
2. 选择教学学段。
3. 选择试卷导出模板。
4. 设置练习单、试卷和讲义水印。
5. 在“系统设置”配置至少一个 OCR 提供方。

这些设置都可在之后修改。

### 可选外部工具

- **XeLaTeX**：导出 LaTeX/PDF 时需要。
- **LibreOffice**：部分 DOCX 转 PDF 流程需要。

应用会自动探测常见路径，也可通过 `XELATEX_PATH` 与 `SOFFICE_PATH` 指定。系统健康状态会显示探测结果。

## 从源码运行

### 环境要求

- Node.js 24 或更高版本
- Python 3.11 或更高版本（仅源码开发需要）
- 可选：XeLaTeX、LibreOffice

安装依赖：

```sh
npm install
python3 -m pip install -r server/python/requirements.txt
```

推荐在应用启动后通过“系统设置”配置 OCR。源码开发也可以通过 shell 环境变量传入，例如：

```sh
export OCR_PROVIDER=glm
export GLM_OCR_API_KEY='your-secret-key'
npm run dev
```

[`.env.example`](.env.example) 仅列出字段参考；开发服务器不会自动加载 `.env.local`。不要提交任何含真实密钥的环境文件。

启动开发环境：

```sh
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5174`
- API：`http://127.0.0.1:8797`

Vite 会将 `/api` 请求代理到本地 API。

## 桌面打包

启动 Electron 桌面版：

```sh
npm run desktop
```

生成并校验当前平台的未压缩桌面包：

```sh
npm run pack:desktop
```

打包流程会准备固定版本的 CPython，安装 `server/python/runtime-requirements.txt` 中的依赖，并验证包内 Python 可以独立处理 PDF。

### Windows

在 Windows 中解压源码包后运行：

```text
build-and-install-windows.cmd
```

脚本会检查 Node.js、安装依赖、准备 Python 运行时、验证切题流程，并生成和启动 NSIS 安装向导。详细排错说明见 [WINDOWS_BUILD.md](WINDOWS_BUILD.md)。

## 数据、配置与安全

桌面版将数据写入操作系统分配给 Question Manager 的用户数据目录；源码开发默认写入仓库目录，也可设置 `QUESTION_DATA_DIR` 覆盖根目录。

常用环境变量如下：

| 变量 | 作用 |
| --- | --- |
| `QUESTION_DATA_DIR` | SQLite、上传文件、题图、OCR 草稿和导出文件的根目录。 |
| `PYTHON_PATH` | 源码开发使用的 Python 可执行文件。 |
| `XELATEX_PATH` / `SOFFICE_PATH` | 外部导出工具路径。 |
| `OCR_PROVIDER` | `glm` 或 `doc2x`。 |
| `GLM_OCR_API_BASE_URL` / `GLM_OCR_API_KEY` / `GLM_OCR_MODEL` | GLM-OCR 配置。 |
| `DOC2X_API_BASE_URL` / `DOC2X_API_KEY` / `DOC2X_MODEL` | Doc2X 配置。 |
| `OCR_CLEANUP_*` | 可选的文本清理与分类模型配置。 |

请勿提交 `config/`、`data/`、`python/ocr_drafts/`、`experiments/`、上传的 PDF、导出文件或任何密钥。

## 开发验证

提交前建议执行：

```sh
npm run build
npm run test:math-render
npm run test:smoke
npm run verify:python-runtime
```

`test:smoke` 会使用临时数据目录启动 API、初始化空数据库并检查健康接口；不会读取你的本地题库数据。

## 开源许可

Question Manager 采用 [GNU Affero General Public License v3.0](LICENSE)（`AGPL-3.0-only`）发布。桌面包包含 PyMuPDF，并按其 AGPL 许可路径分发；第三方组件说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

如果你修改本项目并通过网络向用户提供服务，需要按 AGPL v3 向这些用户提供对应源代码。
