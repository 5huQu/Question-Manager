# 题库管理系统 UI 设计规范 (shadcn/ui 风格)

本规范整理自已确认的 Mock 页面，定义了系统的视觉设计语言、通用组件规范以及状态交互标准。本规范旨在作为后续页面迁移、重构以及 AI 编程助手 (Codex) 开发时的唯一视觉与代码迁移准则。

---

## 0. 基础架构边界 (Architectural Boundaries)

> [!IMPORTANT]
> **外壳固定隔离原则**：系统的整体框架已经固定，后续任何页面开发和重构**禁止改动**以下核心组件：
> 1. **系统侧边栏 (AppSidebar)**：左侧主导航栏已固定，仅允许追加配置好的 Mock 路由链接。
> 2. **系统顶栏 (Topbar / AppPageHeader)**：包含面包屑、重置筛选、新增题目等全局操作按钮区域已固定。
> 3. **系统外壳 (AppShell / SidebarInset)**：主窗口的 Padding 及整体 flex 排版高度已固定。
> 
> **后续所有页面设计与编码，必须且仅能作用于主内容区 (Main Content Area)。**

---

## 1. 核心设计原则与禁用元素 (Core Principles & Exclusions)

为了保持 shadcn/ui 官方 Blocks 的极致专业感与高密度信息展示，以下设计限制为硬性指标：
* **色彩基调**：普通状态以 **黑白灰** 纯色扁平风格为主，通过边框和极浅的灰色背景做网格化分割。
* **绿色使用限制**：**翡翠绿 (emerald)** 仅作为系统小范围内的“正常/完成/成功/正常在线”状态标记，严禁大面积使用或作为主色。
* **四大绝对禁用**：
  * ❌ **无 Emoji**：界面中一律不使用任何 Emoji 图标（统一使用 Lucide 矢量图标）。
  * ❌ **无高饱和颜色**：严禁使用任何高饱和度的营销/消费级色彩（如高亮的纯蓝、纯红等）。
  * ❌ **无大渐变**：严禁使用任何大面积或醒目的渐变色背景。
  * ❌ **无玻璃拟态**：严禁使用任何玻璃拟态或毛玻璃效果背景（除下拉菜单/弹窗等极少数绝对定位的微模糊浮层外）。

---

## 2. 视觉规范细节 (Visual Specifications)

### 2.1 颜色系统 (Color System)
采用单色黑白灰架构，状态色仅作点缀且均采用低饱和度前景色配浅背景色。

| 类别 | 浅色模式 (Light Mode) | 深色模式 (Dark Mode) | 常用 Tailwind 类 | 备注说明 |
| :--- | :--- | :--- | :--- | :--- |
| **主背景** | `bg-white` 或 `bg-zinc-50/30` | `bg-zinc-950` | `bg-zinc-50/30` / `dark:bg-zinc-950` | 纸质般素雅基底 |
| **卡片背景** | `bg-white` | `bg-zinc-950` | `bg-white` / `dark:bg-zinc-950` | 容器卡片底色 |
| **边框颜色** | `border-zinc-200` | `border-zinc-800` | `border-zinc-200` / `dark:border-zinc-800` | 1px 细线，结构分割用 |
| **文字主色** | `text-zinc-900` | `text-zinc-55` | `text-zinc-900` / `dark:text-zinc-50` | 标题与高对比正文 |
| **文字次色** | `text-zinc-500` | `text-zinc-400` | `text-zinc-500` / `dark:text-zinc-400` | 表单 Label 及说明文字 |
| **正常/成功态** | `bg-emerald-50 text-emerald-700` | `bg-emerald-950/20 text-emerald-400` | `bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400` | 仅限小范围系统状态正常或成功时使用 |
| **警示状态** | `bg-amber-50 text-amber-700` | `bg-amber-950/20 text-amber-400` | `bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400` | 用于有置信度警告或更新提示 |
| **错误/危险态** | `bg-red-50 text-red-700` | `bg-red-950/20 text-red-400` | `bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400` | 用于异常、删除或不可逆操作 |

### 2.2 字体与排版 (Typography)
中文使用系统默认无衬线字体族，确保排版紧凑严谨。

* **字体声明**：
  ```css
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, BlinkMacSystemFont, sans-serif !important;
  ```
* **字号与字重层级**：
  1. **页面主标题**：`24px semibold` -> `text-2xl font-semibold tracking-tight`
  2. **模块/区块标题**：`16px semibold` -> `text-base font-semibold tracking-tight`
  3. **表单标签 (Label)**：`13px medium muted` -> `text-[13px] font-medium text-zinc-500`
  4. **正文/字段说明**：`13px muted` -> `text-[13px] text-zinc-500`
  5. **输入框/选择器文本**：`14px` -> `text-sm`

### 2.3 间距与布局网格 (Spacing & Grid)
* **主容器内边距**：主内容区统一使用 `p-6` (24px) 边距。
* **元素间距 (Space)**：
  * 大区块/卡片之间：`space-y-6` 或 `gap-6`。
  * 卡片内部表单项之间：`space-y-4`。
  * 标签与输入框之间：`space-y-1.5`。
* **强网格布局**：
  * 配置面板：优先采用 12 栏响应式网格 (`grid grid-cols-1 md:grid-cols-12 gap-6`)，例如：表单区域占 `md:col-span-8`，诊断预览占 `md:col-span-4`。

---

## 3. 组件级设计规范 (Component Specifications)

### 3.1 卡片 (Card)
用于包裹独立的配置或信息模块。
* **结构规范**：
  * **容器外壳**：`rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 shadow-sm`
  * **CardHeader**：`p-5 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/10`
  * **CardContent**：`p-5 space-y-4`
  * **CardFooter**：`px-5 py-3 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50/10 dark:bg-zinc-900/5`
* **Codex 组件范例**：
  ```tsx
  <Card className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
    <CardHeader className="p-5 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/10">
      <CardTitle className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">配置标题</CardTitle>
      <CardDescription className="text-[13px] text-zinc-500">这里是区块的配置说明信息。</CardDescription>
    </CardHeader>
    <CardContent className="p-5 space-y-4">
      {/* 内容表单项 */}
    </CardContent>
    <CardFooter className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50/10 dark:bg-zinc-900/5 flex justify-end">
      {/* 按钮 */}
    </CardFooter>
  </Card>
  ```

### 3.2 按钮 (Button)
* **主按钮 (Primary)**：黑色底白色字，高密度字重。
  * `bg-zinc-900 text-zinc-50 hover:bg-zinc-900/90 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90 rounded-md text-sm font-medium h-9 px-4 py-2`
* **次要/边框按钮 (Outline)**：白底细灰框。
  * `border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 rounded-md text-sm h-9 px-4 py-2`
* **幽灵按钮 (Ghost / Icon)**：无边框无背景，仅悬浮时变灰。
  * `hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-850 dark:hover:text-zinc-50 text-zinc-500 rounded-md p-2`
* **危险按钮 (Destructive)**：
  * `border border-red-200 bg-red-50/20 text-red-700 hover:bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/30 rounded-md text-sm h-9 px-4 py-2`

### 3.3 徽标 (Badge)
限制高度 20px，字体超小且居中。
* **样式类**：`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide transition-colors border`
* **类型映射**：
  * **Default/普通**：`bg-zinc-100 text-zinc-800 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700`
  * **Success/成功**：`bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50`
  * **Warning/警告**：`bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50`
  * **Error/错误**：`bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50`

### 3.4 表格 (Table)
紧凑的高密度表格布局。
* **Table头部 (Header)**：`bg-zinc-50/70 dark:bg-zinc-900/40 text-[12px] font-semibold text-zinc-500 border-b border-zinc-200 dark:border-zinc-800`
* **Table行 (Row)**：高度紧凑，悬停时加深底色。
  * `hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors border-b border-zinc-150 dark:border-zinc-900`
* **代码结构**：
  ```tsx
  <Table>
    <TableHeader className="bg-zinc-50/70 dark:bg-zinc-900/40">
      <TableRow className="border-b border-zinc-200 dark:border-zinc-800">
        <TableHead className="h-10 text-[12px] font-semibold text-zinc-500">试题名称</TableHead>
        <TableHead className="h-10 text-[12px] font-semibold text-zinc-500">状态</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow className="border-b border-zinc-150 dark:border-zinc-900 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30">
        <TableCell className="py-3 text-sm">高考理综物理题</TableCell>
        <TableCell className="py-3">
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">正常</Badge>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
  ```

### 3.5 标签页 (Tabs)
紧凑的背景块式切换栏。
* **外层包裹**：`bg-zinc-100/80 dark:bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-200/50 dark:border-zinc-800/50`
* **选中态**：`bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 shadow-xs border border-zinc-200/20`
* **非选中态**：`text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300`

### 3.6 抽屉 (Sheet)
用于高频局部弹窗及试题篮操作。
* **面板底色**：`bg-white/95 dark:bg-zinc-950/95 border-l border-zinc-200 dark:border-zinc-800 shadow-xl`
* **背景遮罩 (Overlay)**：`bg-black/40 backdrop-blur-sm transition-opacity`

### 3.7 复选框 (Checkbox)
* **大区块复选卡片 (Checkbox Cards)**：在表单和筛选中，优先使用包含型卡片复选样式，而不是简单的原生小框。
  * **普通态**：`border border-zinc-200 bg-white hover:bg-zinc-50/50 rounded-lg p-3 cursor-pointer`
  * **选中态**：`border-zinc-900 bg-zinc-50/30 dark:border-zinc-100 dark:bg-zinc-900/30`
* **标准复选框 (Checkbox)**：`h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900`

---

## 4. 状态交互标准 (Interactive States)

### 4.1 选中态 (Selected State)
* 适用于表格行、选择卡片或列表条目：
  * 边框由 `border-zinc-200` 升级为 `border-zinc-900`（深色模式下为 `border-zinc-100`）。
  * 背景微调为 `bg-zinc-50/40`（深色模式下为 `bg-zinc-900/40`）。

### 4.2 空状态 (Empty State)
* 适用于列表、表格或队列无数据时的标准展现。
* **视觉结构**：
  * **容器**：`flex flex-col items-center justify-center p-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/10`
  * **图标**：`Inbox` 或 `HelpCircle` 矢量图，`size-8 text-zinc-300 dark:text-zinc-700`
  * **文本**：`text-xs text-zinc-400 dark:text-zinc-500`
* **代码结构**：
  ```tsx
  <div className="flex flex-col items-center justify-center p-12 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-50/10">
    <Inbox className="size-8 text-zinc-300 dark:text-zinc-700 mb-3" />
    <p className="text-xs text-zinc-400 dark:text-zinc-500">暂无待入库数据，可从 OCR 识别队列导入</p>
  </div>
  ```

### 4.3 错误状态 (Error State)
* 适用于操作异常、接口测试失败的通告 Banner。
* **视觉结构**：
  * **容器**：`flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/30 p-3 text-red-800 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400`
  * **图标**：`AlertTriangle` 矢量图，`size-4 text-red-600 dark:text-red-400 mt-0.5`
  * **文本**：`text-xs`，带有排版紧凑的报错细节。

### 4.4 粘性底部操作栏 (Sticky Bottom Action Bar)
* 适用于多模块页面的全局保存和操作控制。
* **视觉结构**：
  * **定位**：`sticky bottom-0 z-50`，跨浏览器下边沿对齐。
  * **背景与投影**：`bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]`
  * **布局**：一侧放置状态与当前配置的灰色简述字，另一侧右对齐操作主副按钮。
* **代码结构**：
  ```tsx
  <div className="sticky bottom-0 z-50 w-full border-t border-zinc-200 bg-white/80 py-4 px-6 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 flex items-center justify-between shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
    <span className="text-xs text-zinc-400">已修改配置，点击“保存”以应用切题规则与模板设置。</span>
    <div className="flex items-center gap-2">
      <Button variant="outline">重置</Button>
      <Button>保存配置</Button>
    </div>
  </div>
  ```
