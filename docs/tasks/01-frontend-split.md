# 阶段 1：前端大拆分

目标：把当前集中在 `frontend/src/App.tsx` 的基础类型、API、通用 hooks、渲染器和页面组件逐步拆到独立目录，降低后续试题篮功能的维护成本。

## 进度

- [x] 建立 `frontend/src/types`、`frontend/src/api`、`frontend/src/hooks`、`frontend/src/components`、`frontend/src/pages`、`frontend/src/utils` 目录
- [x] 抽出共享 TypeScript 类型
- [x] 抽出 API 请求工具和 JSON headers
- [x] 抽出 `useAsync` 等通用 hooks
- [x] 抽出 Markdown / KaTeX 渲染相关组件与工具
- [x] 抽出通用 UI 组件
- [ ] 抽出题库页和题目详情页
- [ ] 抽出 PDF 切分页和 OCR 队列页
- [x] 保持原有路由和主要交互不变
- [x] 通过前端构建验证

## 验收标准

- `App.tsx` 不再承担类型定义、API 工具、Markdown 渲染工具等基础职责。
- 页面组件能从清晰的模块路径导入共享能力。
- `npm run build:frontend` 能通过。
