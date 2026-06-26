import assert from 'node:assert/strict'
import { classifyQuestionDocumentLayout, defaultParserConfig, mergeQuestionCandidatesWithSolutions, parseQuestionCandidates, parseSolutionDocument } from '../dist/services/question-parser/index.js'

function block(markdown, content, pageNo, id, type = 'text', assetId = '') {
  const markdownStart = markdown.indexOf(content)
  assert.notEqual(markdownStart, -1, 'test block content must exist in markdown')
  return {
    id,
    pageNo,
    type,
    content,
    markdownStart,
    markdownEnd: markdownStart + content.length,
    ...(assetId ? { assetId } : {}),
  }
}

const markdown = [
  '<!-- DOC2X_PAGE:1 -->',
  '一、选择题',
  '1. 已知函数 $f(x)=x^2$，求 $f(2)$。',
  '<img src="figure-1.png">',
  '',
  '2、若 $a=3$，求 $a+1$。',
  '',
  '答案',
  '1. 4',
  '2. 4',
  '',
  '解析',
  '1. 代入 $2^2=4$。',
  '2. 由 $3+1=4$。',
].join('\n')

const ocrDocument = {
  id: 'ocr_parser_test',
  sourceDocumentId: 'src_parser_test',
  provider: 'doc2x',
  rawResultPath: '/tmp/doc2x/raw.json',
  markdown,
  pages: [
    {
      pageNo: 1,
      width: 800,
      height: 1100,
      blocks: [
        block(markdown, '1. 已知函数 $f(x)=x^2$，求 $f(2)$。', 1, 'b_q1'),
        block(markdown, '<img src="figure-1.png">', 1, 'b_fig1', 'image', 'asset_fig1'),
        block(markdown, '2、若 $a=3$，求 $a+1$。', 1, 'b_q2'),
      ],
    },
    {
      pageNo: 2,
      width: 800,
      height: 1100,
      blocks: [
        block(markdown, '1. 代入 $2^2=4$。', 2, 'b_a1'),
        block(markdown, '2. 由 $3+1=4$。', 2, 'b_a2'),
      ],
    },
  ],
  assets: [
    { id: 'asset_fig1', type: 'image', path: 'figure-1.png', pageNo: 1, sourceBlockId: 'b_fig1' },
  ],
  metadata: {},
  createdAt: '2026-06-24T00:00:00.000Z',
}

const candidates = parseQuestionCandidates(ocrDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(candidates.length, 2)
assert.equal(candidates[0].questionNo, '1')
assert.match(candidates[0].stemMarkdown, /已知函数/)
assert.equal(candidates[0].answerText, '4')
assert.match(candidates[0].analysisMarkdown, /代入/)
assert.equal(candidates[0].status, 'ready')
assert.equal(candidates[0].figures.length, 1)
assert.equal(candidates[0].sourceRefs.some((ref) => ref.kind === 'stem' && ref.blockIds.includes('b_q1')), true)
assert.equal(candidates[1].questionNo, '2')
assert.equal(candidates[1].answerText, '4')
assert.match(candidates[1].analysisMarkdown, /3\+1=4/)

const solutionWithoutHeadingDocument = {
  ...ocrDocument,
  id: 'ocr_solution_no_heading_test',
  markdown: [
    '1. 答案：A',
    '解析：由题意可得。',
    '',
    '2. 直接计算得到 4。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const noHeadingSolutions = parseSolutionDocument(solutionWithoutHeadingDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(noHeadingSolutions.size, 2)
assert.equal(noHeadingSolutions.get('1')?.answerText, 'A')
assert.match(noHeadingSolutions.get('1')?.analysisMarkdown || '', /由题意/)
assert.match(noHeadingSolutions.get('2')?.analysisMarkdown || '', /直接计算/)
assert.ok(noHeadingSolutions.get('2')?.analysisRange)

const inlineMarkedSolutionDocument = {
  ...ocrDocument,
  id: 'ocr_inline_marked_solution_document_test',
  markdown: [
    '# 参考答案',
    '1. 【答案】A',
    '【解析】第一题解析。',
    '',
    '2. 【答案】B',
    '【解析】第二题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const inlineMarkedSolutions = parseSolutionDocument(inlineMarkedSolutionDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(inlineMarkedSolutions.get('1')?.answerText, 'A')
assert.match(inlineMarkedSolutions.get('1')?.analysisMarkdown || '', /第一题解析/)
assert.equal(inlineMarkedSolutions.get('2')?.answerText, 'B')
assert.match(inlineMarkedSolutions.get('2')?.analysisMarkdown || '', /第二题解析/)

const looseMarkedSolutionDocument = {
  ...ocrDocument,
  id: 'ocr_loose_marked_solution_document_test',
  markdown: [
    '# 参考答案',
    '1·C',
    '【分析】第一题分析。',
    '【详解】第一题详解。',
    '',
    '2：D',
    '【分析】第二题分析。',
    '【详解】第二题详解。',
    '',
    '1 2 \\cdot \\frac{1+\\sqrt{5}}{2}',
    '【分析】第十二题分析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const looseMarkedSolutions = parseSolutionDocument(looseMarkedSolutionDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(looseMarkedSolutions.get('1')?.answerText, 'C')
assert.match(looseMarkedSolutions.get('1')?.analysisMarkdown || '', /第一题分析/)
assert.equal(looseMarkedSolutions.get('2')?.answerText, 'D')
assert.match(looseMarkedSolutions.get('2')?.analysisMarkdown || '', /第二题详解/)
assert.equal(looseMarkedSolutions.get('12')?.answerText, '\\frac{1+\\sqrt{5}}{2}')
assert.match(looseMarkedSolutions.get('12')?.analysisMarkdown || '', /第十二题分析/)

const analysisOnlyCandidateDocument = {
  ...ocrDocument,
  id: 'ocr_analysis_only_candidate_test',
  markdown: [
    '1. 已知函数，求单调区间。',
    '【解析】',
    '求导后讨论符号即可。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const analysisOnlyCandidates = parseQuestionCandidates(analysisOnlyCandidateDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(analysisOnlyCandidates.length, 1)
assert.equal(analysisOnlyCandidates[0].answerText, '')
assert.match(analysisOnlyCandidates[0].analysisMarkdown, /求导后讨论/)
assert.equal(analysisOnlyCandidates[0].issues.some((issue) => issue.code === 'missing_answer'), false)

const inlineAnalysisPaperWithNumberedNotesDocument = {
  ...ocrDocument,
  id: 'ocr_inline_analysis_numbered_notes_test',
  markdown: [
    '## 注意事项：',
    '1. 答卷前，请将姓名填写在答题卡上。',
    '2. 回答选择题时，请选出答案后填涂答题卡。',
    '3. 考试结束后，将答题卡交回。',
    '## 一、单选题：本题共3小题。',
    '1. 第一题题干。',
    '【答案】A',
    '【解析】第一题解析。',
    '2. 第二题题干。',
    '【答案】B',
    '【解析】第二题解析。',
    '3. 第三题题干。',
    '【答案】C',
    '【解析】第三题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const inlineAnalysisPaperWithNumberedNotes = parseQuestionCandidates(inlineAnalysisPaperWithNumberedNotesDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(inlineAnalysisPaperWithNumberedNotes.map((candidate) => candidate.questionNo), ['1', '2', '3'])
assert.deepEqual(inlineAnalysisPaperWithNumberedNotes.map((candidate) => candidate.answerText), ['A', 'B', 'C'])
assert.match(inlineAnalysisPaperWithNumberedNotes[1].analysisMarkdown, /第二题解析/)
assert.doesNotMatch(inlineAnalysisPaperWithNumberedNotes[0].stemMarkdown, /注意事项|单选题|答卷前/)

const inlineAnalysisWithNumberedStepsDocument = {
  ...ocrDocument,
  id: 'ocr_inline_analysis_numbered_steps_test',
  markdown: [
    '<!-- GLM_PAGE:1 -->',
    '# 2023年普通高等学校招生全国统一考试（新课标全国Ⅱ卷）',
    '## 一、选择题',
    '1. 在复平面内，复数 $z=3-i$ 对应的点位于（ ）',
    '【答案】A',
    '【解析】第一题解析。',
    '',
    '2. 设集合 $A=\\{1,2\\}$，则（ ）',
    '【答案】B',
    '【解析】第二题解析。',
    '',
    '22. （1）证明不等式；（2）求参数范围。',
    '【答案】证明见解析',
    '【解析】',
    '1. 当 $0<a^2\\leq 2$ 时，函数满足条件。',
    '2. 当 $a^2\\geq 2$ 时，继续讨论可得。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const inlineAnalysisWithNumberedStepsClassification = classifyQuestionDocumentLayout(inlineAnalysisWithNumberedStepsDocument.markdown)
assert.equal(inlineAnalysisWithNumberedStepsClassification.layout, 'inline_solution')
const inlineAnalysisWithNumberedStepsCandidates = parseQuestionCandidates(inlineAnalysisWithNumberedStepsDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(inlineAnalysisWithNumberedStepsCandidates.map((candidate) => candidate.questionNo), ['1', '2', '22'])
assert.equal(inlineAnalysisWithNumberedStepsCandidates.some((candidate) => candidate.issues.some((issue) => issue.code === 'duplicate_question_no')), false)
assert.match(inlineAnalysisWithNumberedStepsCandidates[2].analysisMarkdown, /1\. 当/)
assert.match(inlineAnalysisWithNumberedStepsCandidates[2].analysisMarkdown, /2\. 当/)

const appendixSolutionSameDocument = {
  ...ocrDocument,
  id: 'ocr_appendix_solution_same_document_test',
  markdown: [
    '<!-- GLM_PAGE:1 -->',
    '# 数学试卷',
    '## 一、选择题',
    '1. 第一题题干。',
    '',
    '2. 第二题题干。',
    '',
    '<!-- GLM_PAGE:3 -->',
    '# 参考答案',
    '1. 【答案】A',
    '【解析】第一题解析。',
    '',
    '2. 【答案】B',
    '【解析】第二题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const appendixSolutionSameDocumentClassification = classifyQuestionDocumentLayout(appendixSolutionSameDocument.markdown)
assert.equal(appendixSolutionSameDocumentClassification.layout, 'appendix_solution')
const appendixSolutionSameDocumentCandidates = parseQuestionCandidates(appendixSolutionSameDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(appendixSolutionSameDocumentCandidates.map((candidate) => candidate.questionNo), ['1', '2'])
assert.deepEqual(appendixSolutionSameDocumentCandidates.map((candidate) => candidate.answerText), ['A', 'B'])
assert.match(appendixSolutionSameDocumentCandidates[0].analysisMarkdown, /第一题解析/)
assert.match(appendixSolutionSameDocumentCandidates[1].analysisMarkdown, /第二题解析/)
assert.doesNotMatch(appendixSolutionSameDocumentCandidates[0].stemMarkdown, /参考答案|第一题解析/)

const appendixSolutionWithoutHeadingWithLeadAnswerDocument = {
  ...ocrDocument,
  id: 'ocr_appendix_solution_without_heading_with_lead_answer_test',
  markdown: [
    '<!-- GLM_PAGE:1 -->',
    '# 物理试卷',
    '## 一、单选题',
    '1. 第一题题干。',
    '',
    '2. 第二题题干。',
    '',
    '<!-- GLM_PAGE:2 -->',
    '1. A',
    '',
    '【解析】第一题解析。',
    '',
    '2. B',
    '',
    '【解析】第二题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const appendixSolutionWithoutHeadingWithLeadAnswerClassification = classifyQuestionDocumentLayout(appendixSolutionWithoutHeadingWithLeadAnswerDocument.markdown)
assert.equal(appendixSolutionWithoutHeadingWithLeadAnswerClassification.layout, 'appendix_solution')
assert.match(appendixSolutionWithoutHeadingWithLeadAnswerDocument.markdown.slice(appendixSolutionWithoutHeadingWithLeadAnswerClassification.solutionStart), /^1\. A/)
const appendixSolutionWithoutHeadingWithLeadAnswerCandidates = parseQuestionCandidates(appendixSolutionWithoutHeadingWithLeadAnswerDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(appendixSolutionWithoutHeadingWithLeadAnswerCandidates.map((candidate) => candidate.questionNo), ['1', '2'])
assert.deepEqual(appendixSolutionWithoutHeadingWithLeadAnswerCandidates.map((candidate) => candidate.answerText), ['A', 'B'])
assert.match(appendixSolutionWithoutHeadingWithLeadAnswerCandidates[0].analysisMarkdown, /第一题解析/)
assert.equal(appendixSolutionWithoutHeadingWithLeadAnswerCandidates.some((candidate) => candidate.issues.some((issue) => issue.code === 'duplicate_question_no')), false)
assert.doesNotMatch(appendixSolutionWithoutHeadingWithLeadAnswerCandidates[0].stemMarkdown, /^A$/)

const appendixSolutionWithLooseNumberMarkersDocument = {
  ...ocrDocument,
  id: 'ocr_appendix_solution_loose_number_markers_test',
  markdown: [
    '<!-- GLM_PAGE:1 -->',
    '# 数学试卷',
    '## 一、单选题',
    '1. 第一题题干。',
    '',
    '2. 第二题题干。',
    '',
    '7·第七题题干。',
    '',
    '14 · 第十四题题干。',
    '',
    '16·第十六题题干。',
    '',
    '18. 第十八题题干。',
    '',
    '19. 第十九题题干。',
    '',
    '<!-- GLM_PAGE:6 -->',
    '# 参考答案',
    '<table border="1"><tr><td>题号</td><td>1</td><td>7</td></tr><tr><td>答案</td><td>C</td><td>C</td></tr></table>',
    '1·C',
    '【分析】第一题分析。',
    '【详解】第一题详解。',
    '',
    '2：D',
    '【分析】第二题分析。',
    '【详解】第二题详解。',
    '',
    '7·C',
    '【分析】第七题分析。',
    '',
    '14·1',
    '【分析】第十四题分析。',
    '',
    '16·(1)证明见解析；(2) k>1',
    '【分析】第十六题分析。',
    '',
    '1 8 \\cdot (1) 0.5；(2) 证明见解析',
    '【分析】第十八题分析。',
    '',
    '19·(1)证明见解析；(2) 见详解',
    '【分析】第十九题分析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const appendixSolutionWithLooseNumberMarkersClassification = classifyQuestionDocumentLayout(appendixSolutionWithLooseNumberMarkersDocument.markdown)
assert.equal(appendixSolutionWithLooseNumberMarkersClassification.layout, 'appendix_solution')
const appendixSolutionWithLooseNumberMarkersCandidates = parseQuestionCandidates(appendixSolutionWithLooseNumberMarkersDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(appendixSolutionWithLooseNumberMarkersCandidates.map((candidate) => candidate.questionNo), ['1', '2', '7', '14', '16', '18', '19'])
assert.deepEqual(appendixSolutionWithLooseNumberMarkersCandidates.map((candidate) => candidate.answerText), ['C', 'D', 'C', '1', '(1)证明见解析；(2) k>1', '(1) 0.5；(2) 证明见解析', '(1)证明见解析；(2) 见详解'])
assert.match(appendixSolutionWithLooseNumberMarkersCandidates.find((candidate) => candidate.questionNo === '18')?.analysisMarkdown || '', /第十八题分析/)
assert.match(appendixSolutionWithLooseNumberMarkersCandidates.find((candidate) => candidate.questionNo === '19')?.analysisMarkdown || '', /第十九题分析/)
assert.doesNotMatch(appendixSolutionWithLooseNumberMarkersCandidates.find((candidate) => candidate.questionNo === '19')?.stemMarkdown || '', /参考答案|第一题分析/)

const appendixSolutionWithMissingSolutionNoDocument = {
  ...ocrDocument,
  id: 'ocr_appendix_solution_missing_solution_no_test',
  markdown: [
    '<!-- GLM_PAGE:1 -->',
    '# 数学试卷',
    '## 一、单选题',
    '3. 第三题题干。',
    '',
    '4. 第四题题干。',
    '',
    '5. 第五题题干。',
    '',
    '<!-- GLM_PAGE:2 -->',
    '# 参考答案',
    '<table border="1"><tr><td>题号</td><td>3</td><td>4</td><td>5</td></tr><tr><td>答案</td><td>D</td><td>B</td><td>A</td></tr></table>',
    '3·D',
    '【分析】第三题分析。',
    '【详解】第三题详解。',
    '故选：D.',
    '',
    '<!-- GLM_PAGE:3 -->',
    '【分析】第四题分析。',
    '【详解】第四题详解。',
    '故选：B.',
    '',
    '5·A',
    '【分析】第五题分析。',
    '【详解】第五题详解。',
    '故选：A.',
  ].join('\n'),
  pages: [],
  assets: [],
}
const appendixSolutionWithMissingSolutionNoCandidates = parseQuestionCandidates(appendixSolutionWithMissingSolutionNoDocument, { now: '2026-06-24T00:00:00.000Z' })
const inferredQ3 = appendixSolutionWithMissingSolutionNoCandidates.find((candidate) => candidate.questionNo === '3')
const inferredQ4 = appendixSolutionWithMissingSolutionNoCandidates.find((candidate) => candidate.questionNo === '4')
const inferredQ5 = appendixSolutionWithMissingSolutionNoCandidates.find((candidate) => candidate.questionNo === '5')
assert.equal(inferredQ3?.answerText, 'D')
assert.match(inferredQ3?.analysisMarkdown || '', /第三题分析/)
assert.doesNotMatch(inferredQ3?.analysisMarkdown || '', /第四题分析/)
assert.equal(inferredQ4?.answerText, 'B')
assert.match(inferredQ4?.analysisMarkdown || '', /第四题分析/)
assert.equal(inferredQ4?.issues.some((issue) => issue.code === 'manual_review_required' && /缺失题号/.test(issue.message)), true)
assert.equal(inferredQ4?.status, 'needs_review')
assert.equal(inferredQ5?.answerText, 'A')
assert.match(inferredQ5?.analysisMarkdown || '', /第五题分析/)

const notesBeforeSectionHeadingDocument = {
  ...ocrDocument,
  id: 'ocr_notes_before_section_heading_test',
  markdown: [
    '满分150分，考试用时120分钟',
    '## 注意事项：',
    '1. 答题前，务必将姓名、准考证号填写在答题卡规定的位置上。',
    '2、答选择题时，必须使用2B铅笔填涂答题卡。',
    '3. 答非选择题时、必须使用0.5毫米黑色签字笔书写。',
    '4. 所有题目必须在答题卡上作答。',
    '## 一、选择题：本题共3小题。',
    '1. 第一题题干。',
    '【答案】A',
    '【解析】第一题解析。',
    '2. 第二题题干。',
    '【答案】B',
    '【解析】第二题解析。',
    '3. 第三题题干。',
    '【答案】C',
    '【解析】第三题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const notesBeforeSectionHeadingCandidates = parseQuestionCandidates(notesBeforeSectionHeadingDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(notesBeforeSectionHeadingCandidates.map((candidate) => candidate.questionNo), ['1', '2', '3'])
assert.deepEqual(notesBeforeSectionHeadingCandidates.map((candidate) => candidate.answerText), ['A', 'B', 'C'])
assert.doesNotMatch(notesBeforeSectionHeadingCandidates[0].stemMarkdown, /注意事项|答选择题|所有题目必须/)

const numberedInstructionWithChoiceWordDocument = {
  ...ocrDocument,
  id: 'ocr_numbered_instruction_with_choice_word_test',
  markdown: [
    '## 注意事项：',
    '1. 答题前，考生先将自己的姓名、准考证号码填写清楚。',
    '2. 选择题必须使用2B铅笔填涂；非选择题必须使用0.5毫米黑色字迹签字笔书写。',
    '# 鼎尖教育',
    '3. 请按照题号顺序在答题卡各题目的答题区域内作答。',
    '4. 作图可先使用铅笔画出，确定后必须用黑色字迹的签字笔描黑。',
    '5. 保持卡面清洁，不要折叠，不要弄破、弄皱，不准使用涂改液。',
    '## 一、选择题：本题共2小题。',
    '1. 第一题题干。',
    '【答案】A',
    '【解析】第一题解析。',
    '2. 第二题题干。',
    '【答案】B',
    '【解析】第二题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const numberedInstructionWithChoiceWordCandidates = parseQuestionCandidates(numberedInstructionWithChoiceWordDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(numberedInstructionWithChoiceWordCandidates.map((candidate) => candidate.questionNo), ['1', '2'])
assert.equal(numberedInstructionWithChoiceWordCandidates.some((candidate) => candidate.issues.some((issue) => issue.code === 'duplicate_question_no')), false)
assert.doesNotMatch(numberedInstructionWithChoiceWordCandidates[0].stemMarkdown, /选择题必须|按照题号顺序|不准使用涂改液/)

const duplicateDocument = {
  ...ocrDocument,
  id: 'ocr_duplicate_test',
  markdown: '1. 第一题\n\n1. 重复题',
  pages: [],
  assets: [],
}
const duplicates = parseQuestionCandidates(duplicateDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(duplicates.length, 2)
assert.equal(duplicates.every((candidate) => candidate.issues.some((issue) => issue.code === 'duplicate_question_no')), true)
assert.equal(duplicates.every((candidate) => candidate.issues.some((issue) => issue.code === 'missing_answer')), true)
assert.equal(duplicates.every((candidate) => candidate.issues.some((issue) => issue.code === 'missing_analysis')), true)

const noNumberDocument = {
  ...ocrDocument,
  id: 'ocr_missing_no_test',
  markdown: '这是一段没有题号的 OCR 文本。',
  pages: [],
  assets: [],
}
const missingNo = parseQuestionCandidates(noNumberDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(missingNo.length, 1)
assert.equal(missingNo[0].issues.some((issue) => issue.code === 'missing_question_no'), true)

const mathPaperDocument = {
  ...ocrDocument,
  id: 'ocr_math_paper_test',
  markdown: [
    '注意事项：请在答题卡作答。',
    '参考公式：$a^2+b^2=c^2$',
    '一、选择题',
    '第 16 题 已知函数 $f(x)$。',
    '（1）求 $f(1)$；',
    '(2) 求 $f(2)$。',
    '二、填空题',
    '17. 求值。',
    '参考答案',
    '16. $f(1)=1$，$f(2)=2$',
    '17. 4',
    '解析',
    '16. 分别代入即可。',
    '17. 直接计算。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const mathCandidates = parseQuestionCandidates(mathPaperDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(mathCandidates.map((candidate) => candidate.questionNo), ['16', '17'])
assert.match(mathCandidates[0].stemMarkdown, /（1）/)
assert.match(mathCandidates[0].stemMarkdown, /\(2\)/)
assert.doesNotMatch(mathCandidates[0].stemMarkdown, /注意事项|参考公式|一、选择题|二、填空题/)
assert.match(mathCandidates[0].answerText, /f\(1\)/)
assert.match(mathCandidates[0].analysisMarkdown, /分别代入/)
assert.equal(mathCandidates.some((candidate) => candidate.issues.some((issue) => issue.code === 'duplicate_question_no')), false)

const customHeadingConfig = { ...defaultParserConfig, sectionHeadings: [...defaultParserConfig.sectionHeadings, '五、校本练习'] }
const customHeadingDocument = { ...ocrDocument, id: 'ocr_custom_heading_test', markdown: '五、校本练习\n1. 这是第一题。', pages: [], assets: [] }
const customHeadingCandidates = parseQuestionCandidates(customHeadingDocument, { config: customHeadingConfig, now: '2026-06-24T00:00:00.000Z' })
assert.equal(customHeadingCandidates.length, 1)
assert.doesNotMatch(customHeadingCandidates[0].stemMarkdown, /校本练习/)

const imageBetweenDocument = {
  ...ocrDocument,
  id: 'ocr_image_between_test',
  markdown: '1. 第一题题干。\n2. 第二题题干。',
  pages: [{ pageNo: 1, width: 800, height: 1100, blocks: [
    { id: 'b_q1_image', pageNo: 1, type: 'text', content: '1. 第一题题干。', markdownStart: 0, markdownEnd: 9, bbox: [10, 10, 300, 100] },
    { id: 'b_image_between', pageNo: 1, type: 'image', content: 'figure-between.png', bbox: [10, 110, 300, 200] },
    { id: 'b_q2_image', pageNo: 1, type: 'text', content: '2. 第二题题干。', markdownStart: 10, markdownEnd: 19, bbox: [10, 210, 300, 300] },
  ] }],
  assets: [],
}
const imageBetweenCandidates = parseQuestionCandidates(imageBetweenDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(imageBetweenCandidates[0].figures.some((figure) => figure.sourceBlockId === 'b_image_between'), true)

const unplacedImageDocument = { ...imageBetweenDocument, id: 'ocr_unplaced_image_test', pages: [{ pageNo: 2, width: 800, height: 1100, blocks: [{ id: 'b_unplaced', pageNo: 2, type: 'image', content: 'orphan.png' }] }] }
const unplacedImageCandidates = parseQuestionCandidates(unplacedImageDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(unplacedImageCandidates.some((candidate) => candidate.issues.some((issue) => issue.code === 'unplaced_figure')), true)

const inlineMarkdownImageDocument = {
  ...ocrDocument,
  id: 'ocr_inline_markdown_image_test',
  markdown: [
    '1. 如图求值。',
    '![题图](https://example.com/stem.png?x=1&y=2)',
    '【解析】',
    '![解析图](https://example.com/analysis.png?token=a$b)',
  ].join('\n'),
  pages: [],
  assets: [],
}
const inlineMarkdownImageCandidates = parseQuestionCandidates(inlineMarkdownImageDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(inlineMarkdownImageCandidates.length, 1)
assert.equal(inlineMarkdownImageCandidates[0].figures.some((figure) => figure.path === 'https://example.com/stem.png?x=1&y=2' && figure.usage === 'stem' && figure.inlineMarker), true)
assert.equal(inlineMarkdownImageCandidates[0].figures.some((figure) => figure.path === 'https://example.com/analysis.png?token=a$b' && figure.usage === 'analysis' && figure.inlineMarker), true)

const notesAndFormulaDocument = {
  ...ocrDocument,
  id: 'ocr_notes_and_formula_test',
  markdown: [
    '1. 答卷前，请将姓名填写在答题卡上。',
    '2. 作答选择题时，请使用 2B 铅笔。',
    '一、选择题',
    '1. 正常的第一题。',
    '19. 正常的第十九题。',
    '参考公式：',
    '1. 若 $0 < q < 1$，则 $q^n$ 收敛。',
    '2. $E(X+Y)=E(X)+E(Y)$。',
    '【答案】第十九题答案。',
    '【解析】第十九题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const notesAndFormulaCandidates = parseQuestionCandidates(notesAndFormulaDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(notesAndFormulaCandidates.map((candidate) => candidate.questionNo), ['1', '19'])
assert.doesNotMatch(notesAndFormulaCandidates[0].stemMarkdown, /答卷前|作答选择题时/)
assert.doesNotMatch(notesAndFormulaCandidates[1].stemMarkdown, /参考公式|q\^n|E\(X\+Y\)/)
assert.match(notesAndFormulaCandidates[1].answerText, /第十九题答案/)
assert.match(notesAndFormulaCandidates[1].analysisMarkdown, /第十九题解析/)

const numberedNotesAndHeadingNumbersDocument = {
  ...ocrDocument,
  id: 'ocr_numbered_notes_heading_numbers_test',
  markdown: [
    '注意事项：',
    '1. 答题前，考生务必将姓名填写清楚。',
    '2. 每小题选出答案后，用2B铅笔把答题卡上对应题目的答案标号涂黑。',
    '## 一、单选题',
    '1. 正常的第一题。',
    '## 四、解答题',
    '15. （本小题满分13分）',
    '第十五题题干。',
    '## 16. （本小题满分15分）',
    '第十六题题干。',
    '## 17. （本小题满分15分）',
    '第十七题题干。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const numberedNotesAndHeadingNumbersCandidates = parseQuestionCandidates(numberedNotesAndHeadingNumbersDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(numberedNotesAndHeadingNumbersCandidates.map((candidate) => candidate.questionNo), ['1', '15', '16', '17'])
assert.doesNotMatch(numberedNotesAndHeadingNumbersCandidates[0].stemMarkdown, /答题前|每小题选出答案/)
assert.match(numberedNotesAndHeadingNumbersCandidates[1].stemMarkdown, /第十五题题干/)
assert.doesNotMatch(numberedNotesAndHeadingNumbersCandidates[1].stemMarkdown, /第十六题题干|第十七题题干/)
assert.match(numberedNotesAndHeadingNumbersCandidates[2].stemMarkdown, /第十六题题干/)
assert.match(numberedNotesAndHeadingNumbersCandidates[3].stemMarkdown, /第十七题题干/)

const tableAnswersAndHeadingSolutionsDocument = {
  ...ocrDocument,
  id: 'ocr_table_answers_heading_solutions_test',
  markdown: [
    '# 数学参考答案',
    '<table border="1"><tr><td>题号</td><td>15</td><td>16</td><td>19</td></tr><tr><td>答案</td><td>A</td><td>B</td><td>C</td></tr></table>',
    '## 【解析】',
    '15. 第十五题解析。',
    '## 16. 第十六题解析。',
    '## 19. 第十九题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const tableAnswersAndHeadingSolutions = parseSolutionDocument(tableAnswersAndHeadingSolutionsDocument)
assert.equal(tableAnswersAndHeadingSolutions.get('15')?.answerText, 'A')
assert.match(tableAnswersAndHeadingSolutions.get('16')?.analysisMarkdown || '', /第十六题解析/)
assert.equal(tableAnswersAndHeadingSolutions.get('19')?.answerText, 'C')
assert.match(tableAnswersAndHeadingSolutions.get('19')?.analysisMarkdown || '', /第十九题解析/)

const presentationNoiseDocument = {
  ...ocrDocument,
  id: 'ocr_presentation_noise_test',
  markdown: [
    '1. 如图求值。',
    '<!-- Media -->',
    '<!-- DOC2X_FIGURE:fig_noise_stem -->',
    '<!-- Media -->',
    '<div align="center">',
    '图1',
    '</div>',
    '【解析】',
    '由图可得。',
    '<!-- Media -->',
    '<!-- DOC2X_FIGURE:fig_noise_analysis -->',
    '<!-- Media -->',
    '<div align="center">',
    '室2',
    '</div>',
    '## 四、解答题（本大题共5小题）',
  ].join('\n'),
  pages: [],
  assets: [
    { id: 'fig_noise_stem', type: 'image', path: 'stem-noise.png', pageNo: 1 },
    { id: 'fig_noise_analysis', type: 'image', path: 'analysis-noise.png', pageNo: 1 },
  ],
}
const presentationNoiseCandidates = parseQuestionCandidates(presentationNoiseDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(presentationNoiseCandidates.length, 1)
assert.match(presentationNoiseCandidates[0].stemMarkdown, /DOC2X_FIGURE:fig_noise_stem/)
assert.match(presentationNoiseCandidates[0].analysisMarkdown, /DOC2X_FIGURE:fig_noise_analysis/)
assert.doesNotMatch(presentationNoiseCandidates[0].stemMarkdown, /<div|<\/div>|图1|<!--\s*Media\s*-->/)
assert.doesNotMatch(presentationNoiseCandidates[0].analysisMarkdown, /<div|<\/div>|室2|四、解答题|<!--\s*Media\s*-->/)

const ocrSpacedFormulaDocument = {
  ...ocrDocument,
  id: 'ocr_spaced_formula_test',
  markdown: [
    '18. 先证明对数均值不等式： $ \\sqrt{a b}<\\frac{a-b}{\\ln a-\\ln b}<\\frac{a+b}{2} $ $ (a,b>0 $ ，且 $ a\\neq b $ )：',
    '$$',
    'x _ {1} + x _ {2} < 3 \\mathrm {e} ^ {a - 1} - 1',
    '$$',
  ].join('\n'),
  pages: [],
  assets: [],
}
const ocrSpacedFormulaCandidates = parseQuestionCandidates(ocrSpacedFormulaDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.match(ocrSpacedFormulaCandidates[0].stemMarkdown, /\$ \(a,b>0 \$ ，且 \$ a\\neq b \$ \)/)
assert.match(ocrSpacedFormulaCandidates[0].stemMarkdown, /x _ \{1\} \+ x _ \{2\} < 3 \\mathrm \{e\} \^ \{a - 1\} - 1/)

// Test D: candidate 中 DOC2X_FIGURE 能补出 figures
{
  const doc2xPlaceholderDocument = {
    ...ocrDocument,
    id: 'ocr_placeholder_test',
    markdown: '1. 第一题如图所示。\n\n<!-- DOC2X_FIGURE:placeholder_fig_1 -->',
    pages: [],
    assets: [
      { id: 'placeholder_fig_1', type: 'image', path: 'import-flow-v2/source-documents/src_parser_test/assets/fig.png', pageNo: 1 },
    ],
  }
  const parsedWithPlaceholders = parseQuestionCandidates(doc2xPlaceholderDocument, { now: '2026-06-24T00:00:00.000Z' })
  assert.equal(parsedWithPlaceholders.length, 1)
  assert.equal(parsedWithPlaceholders[0].figures.length, 1)
  assert.equal(parsedWithPlaceholders[0].figures[0].id, 'placeholder_fig_1')
  assert.equal(parsedWithPlaceholders[0].figures[0].blockId, 'placeholder_fig_1')
  assert.equal(parsedWithPlaceholders[0].figures[0].path, 'import-flow-v2/source-documents/src_parser_test/assets/fig.png')
}

// Test E: Doc2X parser keeps provider formula markdown unchanged while splitting fields
{
  const stemFormula = String.raw`\(\alpha _ {1} + \beta ^ {2}\)`
  const answerFormula = String.raw`\[ x = \frac {1}{2} \]`
  const analysisFormula = String.raw`$ \sqrt {a b} < \frac {a-b}{\ln a-\ln b} $`
  const doc2xFormulaDocument = {
    ...ocrDocument,
    id: 'ocr_doc2x_formula_preserve_test',
    provider: 'doc2x',
    markdown: [
      `1. 保留公式 ${stemFormula}`,
      `答案：${answerFormula}`,
      `解析：${analysisFormula}`,
    ].join('\n'),
    pages: [],
    assets: [],
  }
  const doc2xFormulaCandidates = parseQuestionCandidates(doc2xFormulaDocument, { now: '2026-06-24T00:00:00.000Z' })
  assert.equal(doc2xFormulaCandidates.length, 1)
  assert.equal(doc2xFormulaCandidates[0].stemMarkdown, `保留公式 ${stemFormula}`)
  assert.equal(doc2xFormulaCandidates[0].answerText, answerFormula)
  assert.equal(doc2xFormulaCandidates[0].analysisMarkdown, analysisFormula)
}

// Test F: Doc2X separated documents merge by question number without formula cleanup
{
  const stemFormula = String.raw`\(\theta _ {0} = \frac {\pi}{6}\)`
  const answerFormula = String.raw`\[ \sin \theta _ {0} = \frac {1}{2} \]`
  const analysisFormula = String.raw`由 \( \sin \frac {\pi}{6} = \frac {1}{2} \) 得。`
  const questionDocument = {
    ...ocrDocument,
    id: 'ocr_doc2x_separated_question_formula_test',
    provider: 'doc2x',
    markdown: `1. 求值 ${stemFormula}`,
    pages: [],
    assets: [],
  }
  const solutionDocument = {
    ...ocrDocument,
    id: 'ocr_doc2x_separated_solution_formula_test',
    provider: 'doc2x',
    markdown: [
      `1. 答案：${answerFormula}`,
      `解析：${analysisFormula}`,
    ].join('\n'),
    pages: [],
    assets: [],
  }
  const questionCandidates = parseQuestionCandidates(questionDocument, { now: '2026-06-24T00:00:00.000Z' })
  const solutionMatches = parseSolutionDocument(solutionDocument)
  const mergedCandidates = mergeQuestionCandidatesWithSolutions(questionCandidates, solutionMatches, solutionDocument)
  assert.equal(mergedCandidates.length, 1)
  assert.equal(mergedCandidates[0].stemMarkdown, `求值 ${stemFormula}`)
  assert.equal(mergedCandidates[0].answerText, answerFormula)
  assert.equal(mergedCandidates[0].analysisMarkdown, analysisFormula)
}

console.log('question parser ok')
