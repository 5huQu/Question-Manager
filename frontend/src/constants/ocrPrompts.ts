const questionJsonShape = String.raw`{
  "question_no": "",
  "question_type": "",
  "problem_text": "",
  "answer": "",
  "analysis": "",
  "knowledge_points": [],
  "solution_methods": [],
  "difficulty_score_10": 0,
  "difficulty_label": "",
  "total_score": 0,
  "scoring_rubric": [],
  "needs_human_review": false
}`

const questionFieldGuide = String.raw`字段说明：
- question_no：只保留真实题号编号，例如 "1"、"10"、"18"、"1-2"。无法确认时填空字符串；不要写入“典例”“例题”“变式”“即学即练”“限时训练”“课后训练”等讲义分组标签。
- question_type：只能填“单选题”“多选题”“填空题”“解答题”。可由题干结构判断；无法可靠判断时填空字符串，由题库后续识别。
- problem_text：只保留题干正文、条件、问题、选项和图表说明。选择题按原顺序完整写出 A、B、C、D 等选项；不要放入答案、解析、来源或页眉页脚。
- answer：只保留原文中明确出现的答案；没有则填空字符串。
- analysis：只保留原文中明确出现的解析、详解或解题过程；没有则填空字符串。
- knowledge_points：字符串数组，填写 0–8 个知识点名称；只根据题目考查内容归类，不确定时输出 []。
- solution_methods：字符串数组，填写 0–8 个主要解法/思想；只根据题目可直接判断，不确定时输出 []。
- difficulty_score_10：0–10 的整数。0 表示无法可靠判断；1–3 为基础，4–6 为中等，7–8 为较难，9–10 为压轴。
- difficulty_label：与 difficulty_score_10 严格对应，分别为“基础”“中等”“较难”“压轴”；difficulty_score_10 为 0 时填空字符串。
- total_score：题目原文明确标注的总分，使用数字；未标注时填 0，不要估算。
- scoring_rubric：评分细则数组。每项必须为 {"label":"","score":0,"text":""}；仅在原文明确给出分步评分要求时填写，否则输出 []。
- needs_human_review：仅在转写内容本身存在看不清、缺失、题号/公式/表格/图形结构无法确认、疑似串题或原文矛盾时为 true。知识点、难度等归类不确定本身不应触发此字段。

题库会在导入页面统一设置试卷名称和学段；不要输出 source_title、stage、图片路径、数据库 ID、bank_status 或其他未列字段。`

const transcriptionRules = String.raw`转写规则：
1. 你是“忠实转写 + 题库字段标注”助手，不是解题器、校对器或编辑器。不得根据数学常识、答案、解析或上下文补全、修正或改写题干、选项、答案、解析中的数字、符号、变量、条件、题号、选项顺序或公式。
2. 原文疑似有错、缺字、公式不完整、选项缺失或答案与题干矛盾时，保留可见原样，并将 needs_human_review 设为 true。
3. 仅可进行必要的 OCR 格式转换：清晰可见的 Word 公式对象可转为等价 LaTeX；换行可整理为可读 Markdown；表格可转为 Markdown 表格或可读纯文本。无法确认结构时不要猜测，并将 needs_human_review 设为 true。
4. 题干开头的“【典例1】”“例题 2”“变式 1-2”“即学即练3”等讲义结构标签不得写入 problem_text；可识别的编号写入 question_no。
5. 页眉、页脚、页码、水印、版权信息、广告及下一题内容不得写入任何题目字段。
6. 数学公式可使用 Markdown/LaTeX，例如 $...$、$$...$$、\\(...\\)、\\[...\\]；不必为了格式美化而改变数学内容。必要时换行或分段，避免将多个公式混杂在同一行。

JSON 规范：
1. 只输出一个 json 代码块，代码块内必须是可被 JSON.parse 直接解析的合法 JSON；字段名和字符串均使用英文双引号，不要尾随逗号或附加解释。
2. JSON 字符串中的换行必须写为 \\n；LaTeX 反斜杠必须按 JSON 规则转义，例如 \\frac 在 JSON 字符串中写为 \\\\frac。
3. 返回前自检：字段齐全、数组/数字/布尔值类型正确、JSON 可解析。`

export const singleQuestionOcrPrompt = String.raw`请把输入材料中的一道数学题忠实转写为可直接导入题库的 JSON。只输出一个 json 代码块，代码块内部必须是合法 JSON，不要解释。

输出格式必须为：

${questionJsonShape}

${questionFieldGuide}

${transcriptionRules}`

export const fullPaperOcrPrompt = String.raw`请把输入材料中的所有数学题忠实转写为可直接导入题库的 JSON。只输出一个 json 代码块，代码块内部必须是合法 JSON，不要解释。

输出格式必须为：

{
  "questions": [
    ${questionJsonShape}
  ]
}

每个 questions 元素都必须使用以上完整字段结构；不要漏题、不要合并不同题。同一道题跨页时合并为同一个对象。

${questionFieldGuide}

${transcriptionRules}`

export function buildFullPaperOcrPrompt() {
  return `${fullPaperOcrPrompt}

输出长度要求：
每次最多输出 10 题。如果整份材料超过 10 题，请只输出前 10 题，并在下一轮继续输出后续题目。`
}
