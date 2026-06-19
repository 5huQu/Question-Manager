import type { TagLibraries } from '@/types'

export const singleQuestionOcrPrompt = String.raw`请识别输入材料中的一道数学题。输入材料可能是图片、PDF、Word 文档、Word 公式对象、表格或混合排版内容。请忠实转写为轻量 Markdown JSON，并只输出一个 json 代码块，代码块内部必须是合法 JSON，不要解释。

输出格式必须为：

{
  "question_no": "",
  "problem_text": "",
  "answer": "",
  "analysis": "",
  "needs_human_review": false
}

字段说明：
- question_no：只保留真实题号编号，例如 "1"、"10"、"18"、"1-2"。如果题号无法确认，填空字符串。
- problem_text：题干全文，包括题干、条件、问题、选项、图表说明。选择题请把 A、B、C、D 等选项按原顺序写在题干中。
- answer：只放原文中明确出现的答案。没有答案或无法确认时填空字符串。
- analysis：只放原文中明确出现的解析、详解或解题过程。没有解析或无法确认时填空字符串。
- needs_human_review：只要存在看不清、内容缺失、题号不确定、公式无法确认、表格/图形结构无法确认、疑似串题等情况，就输出 true；否则输出 false。

重要限制：
1. 你是 OCR 转写器，不是解题器、校对器或编辑器。
2. 必须忠实转写原文，不得根据数学常识、答案、解析或上下文自动修正题目。
3. 不要求你强制修正 LaTeX 格式；请尽量保留模型原生可读的 Markdown/LaTeX 表达。
4. 如果材料中存在 Word 公式对象，请尽量转换为等价 LaTeX；不得根据数学含义重写公式。
5. 如果原文疑似有错、缺字、公式不完整、选项缺失、答案与题干矛盾，也必须保留原样，并将 needs_human_review 设为 true。
6. 页眉、页脚、页码、水印、版权信息、广告、下一题内容不要放入题目字段。
7. 题号字段只保留真实题号编号；不要把“典例”“例题”“变式”“即学即练”“限时训练”“课后训练”等讲义分组标签写入 question_no。
8. 如果题干开头出现“【典例1】”“变式 2”“即学即练3”“课后训练”等结构标签，请删除该标签，只保留后面的真实题干正文；从标签中可识别出的编号写入 question_no。
9. 表格可以用 Markdown 表格转写；如果结构无法确认，请用可读的纯文本尽量保留，并将 needs_human_review 设为 true。
10. 请进行适当排版，必要时换行或分段展示公式，不要把多个公式杂糅在同一行或同一段里。

JSON 规范：
1. 输出必须是一个 json 代码块；代码块内部必须是可被 JSON.parse 直接解析的 JSON：字段名与字符串都使用英文双引号，不要尾随逗号。
2. JSON 字符串中的换行请使用 \n；LaTeX 反斜杠按合法 JSON 字符串方式转义。
3. 返回前请自检：JSON 可解析、字段齐全、没有解释性文字。

只输出一个 json 代码块，代码块内部是合法 JSON，不要解释。`

export const fullPaperOcrPrompt = String.raw`请识别输入材料中的所有数学题。输入材料可能是图片、PDF、Word 文档、Word 公式对象、表格或混合排版内容。请忠实转写为轻量 Markdown JSON，并只输出一个 json 代码块，代码块内部必须是合法 JSON，不要解释。

输出格式必须为：

{
  "questions": [
    {
	      "question_no": "",
	      "problem_text": "",
	      "answer": "",
	      "analysis": "",
	      "knowledge_points": [],
	      "solution_methods": [],
	      "difficulty_score_10": 0,
	      "difficulty_label": "",
	      "needs_human_review": false
	    }
	  ]
}

字段说明：
- question_no：题号，例如 "1"、"2"、"16"。如果题号无法确认，填空字符串。
- problem_text：题干全文。选择题必须包含完整选项，例如 A、B、C、D；填空题、解答题必须保留所有小问、条件、图表说明和公式。
- answer：答案全文。没有答案或无法确认时填空字符串。
- analysis：解析全文。没有解析或无法确认时填空字符串。
- knowledge_points：本题涉及的知识点，数组，返回 1-6 个中文标签。必须优先从 allowed_knowledge_points 中选择，使用完整名称。
- solution_methods：本题使用的解题方法，数组，返回 1-6 个中文标签。必须优先从 allowed_solution_methods 中选择，使用完整名称。
- difficulty_score_10：按高考/高三统考语境给 1-10 的整数难度分；无法判断时填 0。
- difficulty_label：按难度分输出“基础”“中等”“较难”“压轴”之一。1-3 基础，4-6 中等，7-8 较难，9-10 压轴；difficulty_score_10 为 0 时填空字符串。
- needs_human_review：只要该题存在看不清、疑似印刷错误、内容不完整、选项缺失、答案缺失、解析缺失、题干/答案/解析矛盾、公式无法确认、图片/图表/表格/Word 公式对象/排版结构无法确认、题号不确定、内容疑似串题等情况，就输出 true；否则输出 false。

重要限制：
1. 你是 OCR 转写器，不是解题器、校对器或编辑器。
2. 必须忠实转写文档原文，不得根据数学常识、答案、解析或上下文自动修正题目。
3. 不得改写题干、选项、答案、解析中的数字、符号、变量、条件、题号、选项顺序或公式。
4. 不得把你认为“更合理”的表达替换原文。
5. 如果原文疑似有错、缺字、公式不完整、选项不合理、答案与题干矛盾，也必须保留原样，并将该题的 needs_human_review 设为 true。
6. 对无法确认的字符或公式，不要猜测补全；在原位置保留你能看清的内容，并将 needs_human_review 设为 true。
7. 如果文档中存在 Word 公式对象，请尽量转换为等价 LaTeX；不得根据数学含义重写公式。
8. 只允许进行必要的 OCR/文档转写格式转换：例如把清晰可见的数学公式转成 LaTeX，把换行整理成可读 Markdown，把表格转成 Markdown 表格或可读纯文本。不得改变数学含义。
9. 不要求你强制修正 LaTeX 格式；请尽量保留模型原生可读的 Markdown/LaTeX 表达。
10. 请进行适当排版，必要时换行或分段展示公式，不要把多个公式杂糅在同一行或同一段里。
11. 分类与难度评估只能基于题干、答案、解析中已经转写出的内容；不要为了分类而补写题目中没有出现的答案或解析。
12. 标签要具体，例如“函数零点”“导数与单调性”“分类讨论”“数形结合”，不要输出“高中数学”“综合能力”等泛标签。

识别规则：
1. 按文档中的题号顺序输出所有题，不要漏题，不要合并不同题。
2. 每一道题只输出一个对象。
3. 题干、答案、解析要尽量完整保留原文含义。
4. 选择题的 A、B、C、D 选项必须放在 problem_text 中，不能放到 answer 或 analysis 中。
5. 如果同一道题跨页，必须合并为同一个题目。
6. 页眉、页脚、页码、水印、版权信息不要放入题目内容。
7. 数学公式可以使用模型原生 Markdown/LaTeX 表达，例如 $...$、$$...$$、\(...\)、\[...\]，不要为了格式修正而改写数学内容。
8. 如果无法判断某段文字属于哪一道题，把相关题目的 needs_human_review 设为 true。
9. 如果某题只识别到题干但没有答案或解析，也必须输出该题，并将缺失字段填空字符串，同时 needs_human_review 设为 true。
10. 如果题目包含表格，请用 Markdown 表格或可读纯文本保留表格结构；如果表格结构无法确认，将 needs_human_review 设为 true。
11. question_no 只保留真实题号编号，例如 "1"、"10"、"1-2"；不要写成“典例1”“变式2”“即学即练3”。
12. 如果题干开头出现“【典例1】”“例题 2”“变式 1-2”“即学即练3”“限时训练”“课后训练”等讲义结构标签，请删除该标签，不要放入 problem_text；从标签中可识别出的编号写入 question_no。

JSON 规范：
1. 输出必须是一个 json 代码块；代码块内部必须是可被 JSON.parse 直接解析的 JSON：字段名与字符串都使用英文双引号，不要尾随逗号。
2. JSON 字符串中的换行请使用 \n；LaTeX 反斜杠按合法 JSON 字符串方式转义。
3. 返回前请自检：JSON 可解析、字段齐全、没有解释性文字。

只输出一个 json 代码块，代码块内部是合法 JSON，不要解释。`

function promptList(values?: string[]) {
  if (!values) return '- 标签库正在加载，请稍候再复制提示词。'
  const unique = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
  return unique.length ? unique.map((value) => `- ${value}`).join('\n') : '- 暂无可用标签；请输出最具体的中文短标签。'
}

export function buildFullPaperOcrPrompt(tagLibraries?: TagLibraries) {
  return `${fullPaperOcrPrompt}

允许使用的知识点标签 allowed_knowledge_points：
${promptList(tagLibraries?.knowledgePoints)}

允许使用的解题方法标签 allowed_solution_methods：
${promptList(tagLibraries?.solutionMethods)}

分类要求：
1. knowledge_points 和 solution_methods 必须优先从上方 allowed 列表中选择，使用完整名称。
2. 如果确实没有合适标签，可以输出少量具体中文短标签，但不要泛泛写“数学”“综合题”“解题技巧”。
3. 每题 knowledge_points 输出 1-6 个，solution_methods 输出 1-6 个。

输出长度要求：
每次最多输出 10 题。如果整份材料超过 10 题，请只输出前 10 题，并在下一轮继续输出后续题目。`
}
