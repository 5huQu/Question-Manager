# Question Manager

Question Manager 是一个本地优先的数学题库桌面工具，用于完成 PDF 切题、OCR 识别、人工复核、题库管理和试卷导出。项目基于 Electron、React、Express 与 Python，支持 macOS 和 Windows。

开源仓库不包含示例试卷、真实题目、SQLite 数据库、OCR 响应、API 密钥或其他运行产物。

## 主要功能

- **PDF 切题**：上传试卷或讲义，按页面和题目区域切分，支持人工调整题目边界与图片。
- **OCR 识别**：调用兼容接口识别题干、选项、答案与解析，并在进入题库前集中复核。
- **题库管理**：按学段、年级、题型、难度和知识标签管理题目，支持新建、编辑、检索与题图维护。
- **试题篮与组卷**：将题目加入试题篮，调整顺序、分值和答题空间，生成练习单、试卷或讲义。
- **多格式导出**：支持 Markdown、LaTeX 和 PDF 导出，可选择内置模板或 Examch 模板。
- **学习标签**：维护知识点与方法标签，供题目录入、筛选和后续统计使用。
- **导出记录**：查看历史导出任务和生成文件。
- **本地数据存储**：数据库、题图、OCR 配置和导出文件默认保存在当前用户的数据目录，不写入应用安装目录。

## 桌面版使用方式

### 首次启动

桌面应用内置 Python 运行时，普通用户不需要单独安装 Python，也不需要配置 `PATH`。

首次打开应用时会进入初始化页面。完成以下基础设置后才能进入主界面：

1. 设置系统名称和网页标题。
2. 选择需要使用的教学学段。
3. 选择试卷导出模板。
4. 设置练习单、试卷和讲义水印。
5. 保存设置并进入工作台。

这些内容之后仍可在“系统设置”中修改。

### 配置 OCR

进入“系统设置”，填写 OCR 服务的 API 地址、API Key 和模型名称。密钥只保存在本机用户数据目录中，接口只向前端返回是否已经配置，不会回传完整密钥。

项目不绑定特定 OCR 服务，只要接口与当前配置格式兼容即可。仓库中的 [`.env.example`](.env.example) 仅作为字段参考，不包含可用密钥。

### 可选外部工具

- **XeLaTeX**：用于编译 LaTeX/PDF 导出文件。
- **LibreOffice**：用于部分 DOCX 转 PDF 流程。

应用会自动探测常见安装位置，也可以通过 `XELATEX_PATH` 或 `SOFFICE_PATH` 指定可执行文件。可在系统健康状态中查看这些工具是否可用。

## 从源码运行

### 环境要求

- Node.js 24 或更高版本
- Python 3.11 或更高版本，仅源码开发需要
- 可选：XeLaTeX
- 可选：LibreOffice

安装依赖：

```sh
npm install
python3 -m pip install -r server/python/requirements.txt
```

启动开发环境：

```sh
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5174`
- API：`http://127.0.0.1:8797`

Vite 开发服务器会把 `/api` 请求代理到本地 API。

## 本地桌面打包

准备内置 Python 运行时并启动 Electron：

```sh
npm run desktop
```

生成并校验当前平台的未压缩桌面包：

```sh
npm run pack:desktop
```

打包流程会下载固定版本的 CPython，按 `server/python/runtime-requirements.txt` 安装依赖，并验证安装包内的 Python 能够独立完成一次 PDF 处理。最终用户无需安装 Python。

### Windows 打包

在 Windows 上解压源码包后，双击：

```text
build-and-install-windows.cmd
```

脚本会检查 Node.js、安装 npm 依赖、准备 Python 运行时、验证包内切题流程，并生成和启动 NSIS 安装向导。安装完成后，Question Manager 会出现在 Windows“设置 → 应用”中，并提供标准卸载入口。更详细的排错说明见 [`WINDOWS_BUILD.md`](WINDOWS_BUILD.md)。

### GitHub Actions 跨平台打包

仓库提供 `Desktop Build` 工作流，在 GitHub 仓库的 Actions 页面中手动运行后，会分别使用 macOS 和 Windows runner：

1. 安装锁定的 npm 依赖。
2. 运行数学渲染测试和 API smoke test。
3. 下载并校验对应平台的内置 Python。
4. 生成桌面应用并执行包内 Python 切题验证。
5. 上传 macOS ZIP 和 Windows NSIS 安装器 artifact。

推送形如 `v0.1.1` 的版本标签也会自动触发同一套构建。当前产物未进行 Apple 或 Windows 代码签名，系统首次打开时可能显示安全提醒。

## 数据目录与环境变量

桌面版把运行数据写入操作系统分配给 Question Manager 的用户数据目录。源码开发时默认使用仓库目录，也可以通过以下变量覆盖：

- `QUESTION_DATA_DIR`：SQLite、上传文件、题图、OCR 产物和导出文件的根目录。
- `PYTHON_PATH`：源码开发使用的 Python 可执行文件。
- `XELATEX_PATH`：XeLaTeX 可执行文件路径。
- `SOFFICE_PATH`：LibreOffice `soffice` 可执行文件路径。
- `OCR_API_BASE_URL`：OCR 接口地址。
- `OCR_API_KEY`：OCR 接口密钥。
- `OCR_MODEL`：OCR 模型名称。
- `OCR_PROVIDER`：`doc2x`（整份 PDF 的 Doc2X v3 识别）或 `glm`（GLM-OCR）。
- `DOC2X_API_BASE_URL`、`DOC2X_API_KEY`、`DOC2X_MODEL`：Doc2X 配置；Doc2X 结果会立即下载 JSON 与题图，首版支持整批完全重跑，不支持单题重新 OCR。
- `GLM_OCR_API_BASE_URL`、`GLM_OCR_API_KEY`、`GLM_OCR_MODEL`：GLM-OCR 配置；整卷结果按切题复核后的题号与区域映射，跨页题可重新 OCR 为多页 PDF。

不要提交 `config/`、`data/`、`output/`、OCR 草稿、上传的 PDF 或任何真实密钥。

## 开发验证

提交代码前建议运行：

```sh
npm run build
npm run test:math-render
npm run test:smoke
npm run verify:python-runtime
```

其中 smoke test 会使用临时数据目录启动 API、初始化空数据库并访问 `/api/health`。

## 开源许可

Question Manager 采用 [GNU Affero General Public License v3.0](LICENSE)（`AGPL-3.0-only`）发布。桌面包包含 PyMuPDF，并按其 AGPL 许可路径分发；第三方组件说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

如果你修改本项目并通过网络向用户提供服务，需要按照 AGPL v3 的要求向这些用户提供对应源代码。
