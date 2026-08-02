# 讲义编辑器（/teaching-documents）问题分析与优化计划

> 状态：评审完成，分块实施中。本文档记录问题根因、修正方案与分块实施计划，实施进度随代码更新。
> 实施记录：P0 / P1a / P1b / P2b / P2a（第一批）已完成；单选约束、对齐一致性、卡片正文面板合并（第二批）已完成；方案 A + 光标处插入（第三批）已完成；P1c 性能项与 P3 收敛项（第四批）已完成；测量合并与顶层多选（第五批）已完成；拖拽手柄、面板拆分、rawMarkdown 收敛、schema 统一可落地部分（第六批）已完成；公式键盘（第七批）已完成，剩余待做项见文末。

## 范围

`frontend/src/pages/teaching-documents/` 与 `frontend/src/components/teaching-document/` 下的编辑器链路：

- `TeachingDocumentEditorPage.tsx`（1164 行）：状态协调 + 布局骨架
- `useTeachingDocumentEditor.ts`：文档加载 / history / autosave / 编辑器注册
- `editor/DocumentEditor.tsx`：文档级 Tiptap（单一实例覆盖整篇文档）
- `editor/NodeViews.tsx`（1235 行）：全部块级 NodeView（含 BoxNodeView）
- `editor/PaginatedCanvas.tsx` / `pages/teaching-documents/components/EditorCanvas.tsx`：可编辑画布（页面编辑 / 连续流）
- `editor/usePagination.ts` / `useDeferredPaginationDocument.ts`：分页测量管线
- `editor/paginationDecorations.ts`：页隙 decoration
- `editor/serialization.ts`、`editor/schema.ts`：序列化与扩展集
- `pages/teaching-documents/components/useBlockDragReorder.ts`：顶层块拖拽排序
- `BlockInlineEditor/`、`editor/BoxTextEditor.tsx`：行内 / 卡片正文编辑器
- `A4PaginationPreview.tsx`：A4 打印预览（教师/学生版切换）

## 一、拖拽事件（P0，最优先）

### 事件链路

编辑器里共三层拖拽来源，全部挂在同一块画布 DOM 上：

| 层 | 来源 | 触发方式 |
|---|---|---|
| 自定义排序 | `useBlockDragReorder.ts`（EditorCanvas.tsx:123 / PaginatedCanvas.tsx:339 根 div） | `onPointerDownCapture` 标记 `draggable=true` → 原生 HTML5 DnD |
| PM 节点拖拽 | `schema.ts` 全部 atom 节点 `draggable: true` | PM 给 NodeView 包裹元素挂原生 draggable |
| 元素默认拖拽 | `img`、`a[href]` 等浏览器默认行为 | 无干预 |

### 三个真凶

1. **`useBlockDragReorder.ts:63-67` 无差别标记 + 永不释放**
   - 排除名单只有 `button,input,select,textarea`，没有 `[contenteditable]` / `.ProseMirror` / `[role="textbox"]` / `img` / `a`；
   - 卡片内 `BoxTextEditor` 是 contentEditable，`blockFromTarget` 向上找到顶层 `[data-block-id]` 即卡片本体 → 在卡片文字上按下，卡片即被标记可拖；
   - capture 阶段先于子元素任何 `stopPropagation`（NodeViews.tsx:920 拦不住）；
   - `draggable` 永不复位（`onDragEndCapture` 只移除 class）→ 点过一次后永久可拖，跨行多选必中招；
   - 附带 bug：未判断 `event.button`，右键按下也会标记。

2. **schema atom 节点 `draggable: true`**（schema.ts:109-360）：卡片空白处拖拽同时走 PM 节点拖拽与自定义排序，两条路打架。

3. **按下即标记、无位移阈值**：拖拽（意图）与文本选择（意图）无法在事件层区分，必须靠"位移阈值 + 目标是否可编辑"判定。

### 修正方案

**方案 A（选定）：`useBlockDragReorder` 重写为 Pointer Events 自定义拖拽**

```
pointerdown(capture) → 只记录 { block, startX/Y, editable }，绝不碰 draggable
pointermove(capture) → 位移 > 6px 且 !editable 且 button===0 → 进入拖拽模式：
                       setPointerCapture + 根加 user-select:none + td-block-dragging
dragstart(capture)   → 拖拽模式中 preventDefault + stopPropagation（压掉 PM/img 原生拖拽）
pointerup(capture)   → elementFromPoint 取 drop 目标 → onReorder / onMoveSection → 释放
```

- 普通按下/移动从不 preventDefault、从不设 draggable → 文本选择完全走原生路径；
- 复用现有资产：`td-block-drop-before/after`、`.td-block-dragging`、`previousLayoutRef` 位移动画；
- 附带修复：右键不触发、拖拽结束/取消清理状态、Escape 取消、拖拽自动滚动。

**配套清理：`schema.ts` 全部 atom 节点 `draggable: false`**，顶层块移动统一交给自定义排序。

**验收**：卡片内跨行多选正常；长段落拖选文字正常；卡片空白/标题拖 6px+ 出指示线并排序；卡片内图片拖动不拖走整卡；排序动画正常；触摸设备可拖。

**可选增强**：hover 顶层块显示左侧拖拽手柄（Word 段落手柄同款）。

## 二、性能：加载慢、编辑卡、教师/学生切换久（P1）

### 根因链（每次输入停顿后全走一遍）

1. 全量序列化环：卡片内打字 → `BoxNodeView.updateAttributes` → `DocumentEditor` onUpdate → `getJSON()` 全量 → 反序列化全量 → `renumberAutomaticQuestionNumbers` 全量扫描 → `setHistory` → 页面级重渲染；
2. 校验重复跑：`validation` useMemo 随每次 `history` 变化全量 `validateTeachingDocument`（useTeachingDocumentEditor.ts:257）+ autosave 保存时再跑一次（:51）；
3. 测量管线重：700ms 空闲后重建隐藏测量树 → 300ms 防抖 → `waitForRenderReadiness`（8s 上限）→ 5 次独立全量 DOM 测量（usePagination.ts:147-179）→ paginate → `setPaginationLayout`；
4. `paginationDecorations` 每个页隙 anchor 一次全量 `doc.descendants`（P 页 = P 次全树遍历）；
5. 图片双倍加载：隐藏测量树 `eagerImages` + 可见编辑器 lazy → 最多 2 倍请求；
6. `JSON.stringify(document.content)` 每次变更两次签名比较（DocumentEditor.ts:179-188）；
7. 滚动视口探测对全部 `[data-block-id]` 每帧 getBoundingClientRect（TeachingDocumentEditorPage.tsx:526-563）。

### 教师/学生切换专项

- 变体只改 question 块 `showAnswer/showAnalysis`（printVariant.ts、questionRegions.ts:526），却触发全量重测；
- `A4PaginationPreview` 每轮 generation 直接 `setPagination(null)`（A4PaginationPreview.ts:141）→ 白屏重绘；`usePagination` 的"保留旧分页"机制未沿用；
- `selectPrintVariant` 强制 `setCanvasMode('a4')` → 卸载 Tiptap 编辑器（光标/撤销链丢失）；
- `previewDocument` useMemo 在所有模式下随文档变更重算，continuous/paginated 用不上。

### 计划实施项

- **P1a 变体切换**：A4PaginationPreview 保留旧分页；内容签名未变（仅变体变化）时跳过 `waitForReadiness`；页面级 `previewDocument` 仅 a4 模式计算。
- **P1b decorations 单次遍历**：一次 `doc.descendants` 解析全部锚点位置。
- **P1b 页面虚拟化**：A4 预览每页 `content-visibility: auto`（先例 `td-document-editor-virtualized`）。
- **P1c 测量合并（待做）**：5 次独立 DOM 测量合并为一次 walk；需配合 measure 系列测试，风险高，单独安排。
- **P1c 校验/重编号增量（待做）**：`renumberAutomaticQuestionNumbers` 加结构签名短路；validation 延迟到保存/开大纲。

## 三、选中体验（P2/P3）

### 根因

1. 两套选择系统：顶层文本块走 ProseMirror selection；卡片子块走 `window` CustomEvent（`BOX_CHILD_SELECT_EVENT`）+ React state；hover 锚点、浮动工具栏、属性面板、插入点各自取数；
2. `selectedId` 扁平无层级；`findSelected` 每次全文档线性扫描（TeachingDocumentEditorPage.tsx:93-102）；
3. 无层级导航：无面包屑、无 Esc 上浮父级、hover 无 outline 反馈；
4. 画布无多选：`deleteBoxChildren`/`mergeBoxParagraphs` 的 childIds 数组只有 PropertiesSheet 勾选来源（PropertiesSheet.tsx:384）。

### 计划实施项

- **P2a 轻量**：`findSelected` 改为 id → 块的缓存 Map。
- **P3（待做）**：统一选择 store（blockId + 父路径 + 来源通道）；面包屑 + Esc 上浮；hover outline；画布 Shift/Cmd 多选。

## 四、卡片内容繁琐 / 类 Word 文本框体验（P2b）

### 根因

1. 卡片 = `children` 数组 + 每子块独立插槽 + 子块间"+"插入点（NodeViews.tsx:976-987）；
2. 三种编辑器并存：文档级 Tiptap、卡片 `BoxTextEditor`（只合并段落）、表格 `BlockInlineEditor`、其余只读 `BlockRenderer`；
3. 类型负担重：`CARD_CHILD_TYPES` 9 种 + `rawMarkdown` 3 种 reason + `unknown` + 隐藏的"段落合并为混合内容"交互；
4. 嵌套编辑器全量回传：子块修改 → `updateAttributes` → 文档级全量序列化（编辑卡主因）。

### 计划实施项

- **P2b 卡片单一连续编辑流**：扩展 `BoxTextEditor` 覆盖全部子块类型（figure/question/blockMath/table 等作为流内嵌入对象），Enter 直接续段，删除块间插入点；复用文档级 schema/NodeView。
- **P3（待做）**：卡片与文档共用同一 schema，box 退化为样式容器；`rawMarkdown` UI 隐藏；属性面板按类型拆分。

## 五、额外观察

1. `EditorCanvas` / `PaginatedCanvas` 高度重复（173 vs 422 行），可收敛为单组件 + 模式参数；
2. 三模式切换销毁编辑器（paginated → a4 卸载 Tiptap）；建议单一编辑器常驻，打印预览只读叠加；
3. `EditorCanvas.tsx:55` 死代码 `const [, setSelectedBlockId] = useState('')`；
4. 可沿用基础：`useDeferredPaginationDocument` 回显/测量解耦、`usePagination` 保留旧分页、katexCache、NodeView 稳定 context；
5. `useTeachingDocumentEditor` 中 `documentRef`/`recordRef` 与 `setHistory` 函数式更新并存，新增命令时易漏同步；
6. 导出链路已受 readiness 阻塞（exportReadiness.ts），性能问题不污染导出正确性。

## 六、优先级路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 拖拽重写（方案 A）+ schema `draggable: false` | 已完成 |
| P1a | 变体切换：保留旧分页 + 跳过 readiness + 仅 a4 计算 previewDocument | 已完成 |
| P1b | decorations 单次遍历 + A4 页面 content-visibility | 已完成 |
| P2b | 卡片单一文本框（BoxFlowEditor 覆盖全部子块类型） | 已完成 |
| P2a | findSelected 缓存为 Map + EditorCanvas 死代码清理 | 已完成 |
| P1c | 重编号/校验短路 + 签名缓存 + 测量编排器（单次块查询） | 已完成 |
| P3 | 画布收敛 + 持久编辑器 + 层级导航 + 卡片内多选 + 顶层多选 | 已完成 |

### 实施记录

**P0 拖拽（2026-08-01）**
- `useBlockDragReorder.ts` 重写为 Pointer Events 自定义拖拽：位移阈值 6px + 非可编辑区 + 左键才进入拖拽模式；`setPointerCapture` 接管事件流；Escape 取消；拖拽中自动滚动；`td-block-dragging-root` 期间禁止文本选择（teaching-document.css 新增）。
- 移除按下即 `draggable=true` 且永不释放的原实现；右键不再触发。
- hover 锚点逻辑收敛进 hook，两个画布的重复 `handleBlockHover` 删除（EditorCanvas 死状态 `setSelectedBlockId` 一并清理）。
- `schema.ts` 全部 atom 节点 `draggable: false`，消除 PM 节点拖拽层与自定义排序的冲突。
- 效果：卡片内跨行多选、长段落拖选文字完全走浏览器原生路径，不再被劫持。

**P1a 变体切换**
- `A4PaginationPreview`：重测期间保留上一对（文档，分页）快照渲染，消除教师/学生切换白屏；`onPaginationState` 仍按契约发布 preparing/null（导出阻塞不变，a4-generation 测试原样通过）。
- 资源签名（content + fontVars + renderVersion）未变化时跳过 `waitForReadiness`，切变体不再等待字体/图片稳定。
- 页面级 `previewDocument` 仅 a4 模式计算，其他模式不再做整篇变体变换。

**P1b**
- `paginationDecorations.decorationSet` 单次 `doc.descendants` 解析全部页隙锚点（原每锚点一次全树遍历）。
- A4 预览 A3 双栏与单页页面加 `content-visibility: auto`，多页文档只渲染视口附近页面。

**P2b 卡片单一文本框**
- 新增 `BoxFlowEditor`（替换 `BoxTextEditor`）：整卡一个 Tiptap 编辑流，段落直接编辑，figure/question/blockMath/table 等作为流内嵌入对象（复用文档级 NodeView 与序列化 `blockToEditorNode`/`editorNodeToBlock`，往返无损）；Enter 续段；块间插入点移除，插入改由页面级悬停"+"（hover 锚点）驱动。
- 修复衍生 bug：PM `split()` 复制原文本块 attrs 导致 Enter 分段后新段落与原段落共享 blockId（文档级与卡片级均存在）；`DocumentSelectionSafety` 增加重复 id 去重。
- **修复：流内图片无法选中/改对齐**（2026-08-01 追加）：卡片 mousedown 拦截（保护外层编辑器）会挡住 PM 建立 NodeSelection，导致图片对齐/缩放工具栏不出现、改对齐无反应。改为在 `BoxFlowEditor` 的 mousedown 拦截中按 blockId 手动 `NodeSelection`（段落是 `p[data-block-id]`，其余带 data-block-id 的节点视图均为原子块），对齐修改即可回写 children；回归测试覆盖"点击图片 → 选中上报 → 点居中 → layoutPreset 回写"。
- **修复：点击图片不弹属性面板**（2026-08-01 追加）：属性面板的打开依赖 `selectionUpdate → emitBoxChildSelect` 链路，但重复点击已选中的图片时 selection 无变化，`selectionUpdate` 不触发，面板不再打开。改为 mousedown 拦截中**直接上报** `onActiveChildChange`（等价于旧实现指针事件里无条件 `emitBoxChildSelect`），每次点击必弹面板；新增页面级回归测试 `TeachingDocumentEditorPage.figure-select.test.tsx` 覆盖"点击图片 → 面板显示图片 → 重复点击仍保持"。
- 卡片分页片段路径（boxFragments）保持不变。

**P2a**
- `findSelected` 改为 id → SelectedLocation 的 Map 索引，随文档 memo 重建，消除每次选择/定位的全文档线性扫描。

### 第二批实施记录（2026-08-01）

**全文档单选（问题一）**
- 根因：文档级编辑器与每张卡片的流编辑器各自持有独立选区，点击卡片 B 不会清除卡片 A 的选中环。
- `selection.ts` 新增 `DOCUMENT_SELECTION_CHANGED_EVENT` 广播与 `clearEditorSelectionToFirstTextBlock()` 助手；任一编辑器选区变化即广播，其他编辑器（文档级 + 各卡片流）收到"非本编辑器块"的选中信号后把选区落到首个文本块段首（程序化清理期间抑制上报，避免清理→上报→清理乒乓）。
- `EditorCanvas`/`PaginatedCanvas`：选区变化广播；收到卡片子块选中时清除文档级编辑器的 NodeSelection（卡片本身/其他对象不再同时高亮）。
- 回归测试：`TeachingDocumentEditorPage.figure-select.test.tsx` 新增"点击第二张卡片的图片后第一张卡片的选中环消失"。

**图片/TikZ 对齐不生效（问题三）**
- 根因：`resolveFigureLayout` 以 `layoutPreset` 优先，但属性面板"对齐"只写 `alignment`、图内工具栏只写 `layoutPreset`，二者不同步 → 改对齐无反应、面板显示值与渲染不一致。
- `FigureNodeView` 工具栏按钮：设置 preset 时同步 `alignment`（取 preset 定义值）。
- `PropertiesSheet` 图片与 TikZ 的"对齐"：修改 alignment 时同时清除 `layoutPreset`。
- 回归测试：`PropertiesSheet.test.tsx` 覆盖图片/TikZ 对齐修改同时清除 preset。

**卡片正文面板合并（问题二）**
- 设计结论：Enter = 新段落（内部对象，Word 同理）、Shift+Enter = 段内软换行——数据模型保持；Word 体验的差距在面板把每个段落暴露成独立对象。
- `PropertiesSheet` 卡片内容列表：连续段落合并为一项"正文段落（×N）"，非文本子块仍逐项列出；勾选/批量删除/合并操作仍按真实子块 id 工作。
- 回归测试：`PropertiesSheet.test.tsx` 覆盖段落合并与图片打断分组。

### 第三批实施记录（2026-08-01）：方案 A（卡片 = 文本框对象）+ 光标处插入

**呈现收口（类 Word 文本框）**
- 面板：选中卡片内段落时不再显示"文本内容"对象页，回到**卡片对象页**（标题/模板/内容列表），面板标题同步为"知识卡片"；卡片内容区文案改为"正文在画布中直接编辑，回车续段、Shift+回车换行"。
- 选中环：`createDocumentEditorExtensions({ textBlockSelectionRing })` 增加开关，卡片流编辑器关闭段落级 `td-text-block-active` 环（段落是流里的行，不是对象）。
- 浮动工具栏：卡片子块隐藏"段落层级"下拉（卡片文字无章节概念）；行内格式工具栏接到**活跃卡片流编辑器**（注册表）而非文档级编辑器，卡片内格式真正生效。
- 插入点：卡片内"＋"仅在卡片活跃时显示（点击进卡片后），不再随悬停逐段弹出。

**光标处插入（Word：光标在哪，对象落哪）**
- 新增 `cardEditorRegistry.ts`：聚焦的卡片流编辑器注册表（focus/blur 登记，全文唯一）+ `insertCardBlockAtCaret`（PM `insertContent`，光标在段落内时自动拆段、文字环绕对象）。
- 顶栏"插入"菜单：卡片流编辑器聚焦且类型属于 `CARD_CHILD_TYPES` 时路由到光标处插入；章节/换页/嵌套卡片仍走顶层插入。
- `handlePickerPick` 改为按**选中时刻** `findSelected` 解析 boxId——光标处插入的题目在挑选时可能尚未回写 children，避免 updateBlock 误伤。
- 回归测试：光标处插入（段首落对象、段中自动拆段且原段落 id 保留、新段落 id 唯一）、面板卡片页、标题同步。

### 第四批实施记录（2026-08-01）：P1c 性能项 + P3 收敛项

**P1c 性能**
- `renumberAutomaticQuestionNumbers` 短路：新增 `questionSequenceSignature`（题目出现顺序 + 自动编号标记的廉价签名），普通文本回显不再每次全量克隆题目块重编号（useTeachingDocumentEditor.handleEditorChange）。
- 校验延迟化：新增 `structuralDocumentSignature`（剔除正文的逐块签名 + WeakMap 缓存，O(变更块)），`validation` 改为结构签名驱动的 effect 计算——文本回显不再每次跑全量 `validateTeachingDocument`；autosave 前的致命校验保留。
- 签名缓存：`serialization.cachedJsonSignature`（WeakMap 按数组引用缓存 JSON.stringify），接入 DocumentEditor 外部同步 effect 与 BoxFlowEditor children 对比。

**P3 画布收敛 + 持久编辑器**
- 合并 `EditorCanvas` + `PaginatedCanvas` 为单一 `TeachingDocumentCanvas`（mode: continuous | paginated），两种模式共用同一棵组件树与**同一个 DocumentEditor 实例**——切换模式不销毁编辑器；连续流复用分页态的纸张容器/页眉页脚 chrome。
- 页面重构：a4 打印预览变为**常驻挂载的只读叠加层**（`A4PaginationPreview` 新增 `active` 门控，隐藏期间不跑测量管线），编辑画布在 a4 期间保持挂载（隐藏）——**光标与撤销历史不再因预览/切模式丢失**。
- 滚动视口探测跳过隐藏画布（rect.height > 0 过滤）。

**P3 层级导航**
- Esc：选中卡片内子块时上浮选中父卡片（对话框打开时不劫持）。
- 属性面板新增面包屑"卡片 › 子块"，点击卡片名上浮选中。

**P3 卡片内多选**
- `BOX_CHILD_MULTI_SELECT_EVENT` 广播：Shift+点击卡片内对象切换多选集合，普通点击清空；
- `BoxFlowEditor` 新增 `boxId` prop + 多选环 decoration（`td-block-multi-selected`，空事务刷新装饰）；
- 页面级批量操作条：显示选中项类型标签，提供"删除 N 项 / 合并为混合内容 / 取消"，复用既有 deleteBoxChildren/mergeBoxParagraphs。

### 第五批实施记录（2026-08-01）：测量合并 + 顶层多选

**P1c 测量合并**
- 新增 `layout/measureAll.ts` 编排器 `measureTeachingDocumentAll`：单次块元素查询（allBlocks → 顶层/段落子集过滤器），把元素列表分发给 paragraphs/boxes/questions/boxChildQuestions（各函数新增末尾可选参数，默认自查询路径不变，独立调用与既有测试不受影响）——每轮测量从 6 次 querySelectorAll 降为 2 次。
- `usePagination` 与 `A4PaginationPreview` 改用编排器；`QuestionResolutionLike` 导出。

**P3 顶层对象多选**
- 新增 `deleteBlocks` 命令（editorState）：一次事务删除多个顶层块，进入撤销历史。
- `TOP_LEVEL_MULTI_SELECT_EVENT`：Ctrl/Cmd+点击顶层对象切换集合（Word 风格；段落/标题保留文本语义不被劫持——Shift+点击选范围、Ctrl+点击选句），由拖拽钩子的指针捕获层拦截（jsdom 测试需补 isPrimary）。
- `TopLevelMultiSelectDecoration`（模块级存储 `setTopLevelMultiSelectIds`）：文档级编辑器的多选环，集合变化后画布派发空事务刷新装饰。
- 页面批量操作条：显示选中项类型标签 + "删除 N 项 / 取消"；任何普通单选变化自动清空集合。
- 顺带修复：a4 预览隐藏期间不再渲染测量树 DOM（避免重复 data-block-id 干扰页面查询与滚动视口探测）。

### 第六批实施记录（2026-08-01）：拖拽手柄 + 面板拆分 + 类型收敛 + schema 统一

**拖拽手柄（Word 风格）**
- 新增 `BlockGripHandle`：悬停顶层块时在左侧显示 grip 图标（渲染在画布内容容器内，绝对定位跟随块中心，滚动自动跟随，ResizeObserver 处理布局变化）。
- 拖拽钩子拦截 `[data-block-grip]` 按下：**无位移阈值直接进入拖拽模式**；只对顶层块显示（卡片内部对象走多选/光标插入）。
- 顺带加固：`elementAtPoint` 守卫（jsdom 等环境缺失 `elementFromPoint` 时安全降级，拖拽清理不中断）。

**属性面板按类型拆分**
- `PropertiesSheet.tsx`（946 行 → 约 470 行）的 SheetBody 大型设置组件拆到 `components/settings/`：`boxSettings` / `questionSettings` / `figureSettings` / `tikzSettings` / `rawMarkdownSettings`，共享控件（Field / ActionButton / fieldClass / inlineContentOf）收进 `settings/common.tsx`。
- 行为与 props 完全不变（JSX 展开透传），5 个 PropertiesSheet 测试原样通过。

**类型收敛**
- `rawMarkdown`（迁移兜底类型）从 `INSERTABLE_TYPES` 与 `CARD_CHILD_TYPES` 移除——不再出现在顶部插入菜单与卡片添加菜单；已有块的渲染、面板编辑与"合并为混合内容"入口保留。

**schema 统一（可落地部分）**
- 编辑器层已共用单一扩展工厂 `createDocumentEditorExtensions`（文档编辑器与卡片流编辑器同一 schema/NodeView/序列化）。
- 新增全类型奇偶测试：9 种子块类型（paragraph/blockMath/table/figure/tikz/question/divider/spacer/rawMarkdown）在卡片流内渲染并经过一次编辑后**无损往返**（规范化字段如 lockAspectRatio/breakBehavior 补齐）。
- 存储层统一（box children → 文档流区域、begin/end 标记）属于数据迁移 + 分页管线重写级项目，单独立项，不在本批次。

### 第七批实施记录（2026-08-01）：公式键盘

- 新增 `BlockInlineEditor/FormulaKeyboard.tsx`：`FormulaKeyboardButton` + `FORMULA_KEYBOARD_GROUPS`（希腊字母 / 运算符 / 结构模板 / 求和与极限 / 三角函数，共 47 项）+ `insertInlineFormula`。
- 点击面板项在光标处插入 `inlineMath` 节点（与 Sigma 对话框同一节点类型，插入后点公式仍可精修）；支持连续插入，点击外部或 Esc 关闭。
- 接入共享的 `InlineFormattingControls`（Sigma 按钮旁），**不依赖 onFormula**——文档正文浮动操作条（FloatingBlockToolbar）、卡片正文操作条（BoxFlowEditor）、属性面板文字编辑器三处自动获得；顺带补上了文档正文此前缺失的公式插入入口。
- 回归测试：卡片正文操作条开键盘 → 点 α → 段落内产生 `{ type: 'inlineMath', latex: '\\alpha' }`。

### 剩余待做

- 卡片存储层与文档流统一（box 退化为样式容器）——数据迁移 + 分页管线重写，独立立项。
- 属性面板"懒加载"（按类型 React.lazy）——文件已拆分，懒加载收益有限且增加测试风险，视包体积需求再启。
