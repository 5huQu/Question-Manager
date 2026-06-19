# 阶段 2：升级试题篮数据模型

目标：把现有 `question_bank_collections` 从单一默认试题篮升级为支持多份试卷草稿的试题篮模型，同时继续沿用现有字段体系，不引入结构化标签表。

## 进度

- [x] 扩展 `question_bank_collections` 字段
- [x] 扩展 `question_bank_collection_items` 字段
- [x] 保留默认 `basket` 集合作为当前试题篮
- [x] 支持 collection 类型区分：`basket` / `paper`
- [x] 支持试卷元数据：副标题、说明、总分、时长、状态、导出格式
- [x] 支持题目项元数据：分值、分组、大题名、排序
- [x] 兼容已有数据和空库启动
- [x] 通过后端 TypeScript 构建验证

## 验收标准

- 老数据启动时自动补齐新字段。
- 默认 `basket` 集合仍然存在。
- 每份试卷草稿可以独立保存题目、分值和排序信息。
