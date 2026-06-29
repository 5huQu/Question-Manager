export type SolutionBindingStrategy = 'heading_then_question' | 'question_then_heading' | 'auto'

export type MetadataBlockPolicy = 'ignore' | 'append_to_analysis' | 'store_as_note'

export type AnswerTablePolicy =
  | 'fill_empty_only'
  | 'override_metadata_like_answer'
  | 'prefer_table_for_choice_questions'

export type ImportFlowV2ParserConfig = {
  version: number
  sectionHeadings: string[]
  documentNoteKeywords: string[]
  solutionSectionKeywords: string[]
  primaryQuestionPatterns: string[]
  subQuestionPatterns: string[]
  allowParenthesizedNumberAsPrimary: boolean
  figureKeywords: string[]
  solutionBindingStrategy: SolutionBindingStrategy
  metadataBlockKeywords: string[]
  metadataBlockPolicy: MetadataBlockPolicy
  answerTablePolicy: AnswerTablePolicy
}

export const defaultParserConfig: ImportFlowV2ParserConfig = {
  version: 2,
  sectionHeadings: ['一、选择题', '二、填空题', '三、解答题', '四、选做题', '选择题', '填空题', '解答题', '选做题', '单选题', '多选题', '单项选择题', '多项选择题', '非选择题'],
  documentNoteKeywords: ['注意事项', '参考公式', '本卷共', '考试时间', '满分', '请在答题卡', '请用黑色签字笔', '答案写在', '本试卷', '温馨提示', '答卷前', '答题前', '每小题选出答案', '作答选择题时', '回答选择题时', '回答非选择题时', '考试结束', '非选择题必须', '考生必须保持'],
  solutionSectionKeywords: ['参考答案', '答案', '解析', '答案与解析', '详解', '解答', '试题解析', '评分标准'],
  primaryQuestionPatterns: ['第\\s*([0-9０-９]{1,3})\\s*题', '^\\s*(?:#{1,6}\\s*)?([0-9０-９]{1,3})\\s*[.．、·•]'],
  subQuestionPatterns: ['[（(]\\s*([0-9０-９]{1,3})\\s*[)）]', '[①②③④⑤⑥⑦⑧⑨⑩]'],
  allowParenthesizedNumberAsPrimary: false,
  figureKeywords: ['如图', '下图', '图中', '示意图', '函数图象', '几何图形'],
  solutionBindingStrategy: 'heading_then_question',
  metadataBlockKeywords: ['命题说明', '教材题源', '高考题源', '课标要求', '评分说明'],
  metadataBlockPolicy: 'ignore',
  answerTablePolicy: 'fill_empty_only',
}
