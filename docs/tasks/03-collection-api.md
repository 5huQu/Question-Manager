# 阶段 3：后端 Collection API 改造

目标：把固定返回默认试题篮的 collection API 改成真正支持多试卷、多题目项更新和排序的接口。

## 进度

- [x] `GET /api/question-bank/collections` 返回所有 collection 摘要
- [x] `POST /api/question-bank/collections` 创建新试卷草稿
- [x] `GET /api/question-bank/collections/:id` 返回指定 collection 详情
- [x] `PATCH /api/question-bank/collections/:id` 更新元数据
- [x] `DELETE /api/question-bank/collections/:id` 删除非默认 collection
- [x] `POST /api/question-bank/collections/:id/items` 添加题目
- [x] `PATCH /api/question-bank/collections/:id/items/:relationId` 更新题目项分值、排序、分组
- [x] `DELETE /api/question-bank/collections/:id/items/:relationId` 移除题目项
- [x] `PATCH /api/question-bank/collections/:id/reorder` 批量重排
- [x] 保持旧的 `PATCH /collections/basket` 添加题目方式兼容
- [x] 通过后端 TypeScript 构建验证

## 验收标准

- 题库列表仍能拿到默认试题篮信息。
- 多份试卷草稿可以通过 API 创建、读取、更新、删除。
- 试卷内题目可以添加、移除、改分、排序。
