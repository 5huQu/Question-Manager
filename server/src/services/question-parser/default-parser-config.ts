export type ImportFlowV2ParserConfig = {
  version: number
  sectionHeadings: string[]
  documentNoteKeywords: string[]
  solutionSectionKeywords: string[]
  primaryQuestionPatterns: string[]
  subQuestionPatterns: string[]
  allowParenthesizedNumberAsPrimary: boolean
  figureKeywords: string[]
}

export const defaultParserConfig: ImportFlowV2ParserConfig = {
  version: 1,
  sectionHeadings: ['一、选择题', '二、填空题', '三、解答题', '四、选做题', '选择题', '填空题', '解答题', '单项选择题', '多项选择题', '非选择题'],
  documentNoteKeywords: ['注意事项', '参考公式', '本卷共', '考试时间', '满分', '请在答题卡', '请用黑色签字笔', '答案写在', '本试卷', '温馨提示'],
  solutionSectionKeywords: ['参考答案', '答案', '解析', '答案与解析', '详解', '解答', '试题解析', '评分标准'],
  primaryQuestionPatterns: ['第\\s*([0-9０-９]{1,3})\\s*题', '^\\s*([0-9０-９]{1,3})\\s*[.．、]'],
  subQuestionPatterns: ['[（(]\\s*([0-9０-９]{1,3})\\s*[)）]', '[①②③④⑤⑥⑦⑧⑨⑩]'],
  allowParenthesizedNumberAsPrimary: false,
  figureKeywords: ['如图', '下图', '图中', '示意图', '函数图象', '几何图形'],
}
