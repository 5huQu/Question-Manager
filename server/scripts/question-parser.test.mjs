import assert from 'node:assert/strict'
import { buildParserPreview, classifyQuestionDocumentLayout, defaultParserConfig, extractInlineAnswerTableBlocks, mergeQuestionCandidatesWithSolutions, parseQuestionCandidates, parseSolutionDocument } from '../dist/services/question-parser/index.js'
import { refreshCandidateParseDiagnostics, validateQuestionCandidate } from '../dist/services/question-parser/candidate-validator.js'
import { cleanOcrPresentationMarkdown } from '../dist/services/question-parser/presentation-cleanup.js'

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

const recognizedCandidatePreview = buildParserPreview(ocrDocument, {}, undefined, [candidates[1]])
assert.deepEqual(recognizedCandidatePreview.candidatePreviews.map((item) => item.questionNo), ['2'])
assert.deepEqual(
  [...new Set(recognizedCandidatePreview.structures.filter((token) => token.kind === 'question_no').map((token) => token.questionNo))],
  ['2'],
)
assert.equal(recognizedCandidatePreview.structures.some((token) => token.kind === 'question_no' && token.questionNo === '1'), false)

const candidateWithoutSourceRefs = { ...candidates[1], sourceRefs: [] }
const textLocatedPreview = buildParserPreview(ocrDocument, {}, undefined, [candidateWithoutSourceRefs])
assert.equal(textLocatedPreview.candidatePreviews[0].sourceRanges.stem.start, markdown.indexOf(candidateWithoutSourceRefs.stemMarkdown))

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

const inlineFillBlankAnswerTableSolutionDocument = {
  ...ocrDocument,
  id: 'ocr_inline_fill_blank_answer_table_solution_test',
  markdown: [
    '# 参考答案',
    '12. $ \\underline{\\sqrt{6}} $ 13. $ \\underline{1 4} $ 14. $ \\underline{2 3} $',
    '【命题说明】：',
    '本段只是题目来源说明。',
    '',
    '15. 【答案】$5$',
    '【解析】第十五题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const inlineFillBlankAnswerTableSolutions = parseSolutionDocument(inlineFillBlankAnswerTableSolutionDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(inlineFillBlankAnswerTableSolutions.get('12')?.answerText, '$\\sqrt{6}$')
assert.equal(inlineFillBlankAnswerTableSolutions.get('13')?.answerText, '$14$')
assert.equal(inlineFillBlankAnswerTableSolutions.get('14')?.answerText, '$23$')
assert.ok(inlineFillBlankAnswerTableSolutions.get('12')?.answerRange)
assert.doesNotMatch(inlineFillBlankAnswerTableSolutions.get('12')?.analysisMarkdown || '', /13\.|14\.|命题说明/)
assert.equal(inlineFillBlankAnswerTableSolutions.get('15')?.answerText, '$5$')
assert.match(inlineFillBlankAnswerTableSolutions.get('15')?.analysisMarkdown || '', /第十五题解析/)

const compactNumericInlineAnswerTableSolutionDocument = {
  ...ocrDocument,
  id: 'ocr_compact_numeric_inline_answer_table_solution_test',
  markdown: [
    '# 参考答案',
    '12.112 13.0.58 14.[2$\\sqrt{3}$，$\\sqrt{21}$]',
  ].join('\n'),
  pages: [],
  assets: [],
}
const compactNumericInlineAnswerTableSolutions = parseSolutionDocument(compactNumericInlineAnswerTableSolutionDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(compactNumericInlineAnswerTableSolutions.get('12')?.answerText, '112')
assert.equal(compactNumericInlineAnswerTableSolutions.get('13')?.answerText, '0.58')
assert.equal(compactNumericInlineAnswerTableSolutions.get('14')?.answerText, '[2$\\sqrt{3}$，$\\sqrt{21}$]')
assert.equal(extractInlineAnswerTableBlocks('20.10, 20.10, 20.09, 20.08').length, 0)

const inlineAnswerWithDecimalAnalysisDocument = {
  ...ocrDocument,
  id: 'ocr_inline_answer_decimal_analysis_test',
  markdown: [
    '# 数学参考答案',
    '<table border="1"><tr><td>题号</td><td>9</td><td>10</td></tr><tr><td>答案</td><td>ACD</td><td>ABD</td></tr></table>',
    '9. ACD【解析】将20.10，20.10，20.09，20.08，20.10，20.11，20.12，20.08，20.09，20.09从小到大排列为20.08， 20.08，20.09，20.09，20.09，20.10，20.10，20.10，20.11，20.12，所以A正确；平均数为 $ 2 0. 0 8+\\frac{3\\times0. 0 1}{1 0} $ cm，所以C正确；因为 $ 1 0\\times6 0\\%=6 $ ，所以D正确.',
    '',
    '10. ABD【解析】第十题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const inlineAnswerWithDecimalAnalysisSolutions = parseSolutionDocument(inlineAnswerWithDecimalAnalysisDocument, {
  config: { ...defaultParserConfig, solutionBindingStrategy: 'heading_then_question' },
  now: '2026-06-24T00:00:00.000Z',
})
assert.equal(inlineAnswerWithDecimalAnalysisSolutions.get('9')?.answerText, 'ACD')
assert.match(inlineAnswerWithDecimalAnalysisSolutions.get('9')?.analysisMarkdown || '', /20\.10/)
assert.match(inlineAnswerWithDecimalAnalysisSolutions.get('9')?.analysisMarkdown || '', /D正确/)
assert.doesNotMatch(inlineAnswerWithDecimalAnalysisSolutions.get('9')?.analysisMarkdown || '', /第十题解析/)

const sectionedAnswerTableWithSpacedDecimalsSolutionDocument = {
  ...ocrDocument,
  id: 'ocr_sectioned_answer_table_spaced_decimals_test',
  markdown: [
    '# 数学参考答案',
    '',
    '一、单选题：本大题共8小题。',
    '<table border="1"><tr><td>题号</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td></tr><tr><td>答案</td><td>A</td><td>C</td><td>B</td><td>D</td><td>B</td><td>D</td><td>A</td><td>B</td></tr></table>',
    '',
    '【解析】',
    '',
    '1. 第一题解析，故选A.',
    '2. 第二题解析，故选C.',
    '3. 第三题解析，故选B.',
    '4. 第四题解析，故选D.',
    '5. 第五题解析，故选B.',
    '6. 依题意，设 $ 5^{1 0 0 0}=a \\times1 0^{n} $ ，因为 $ 1 0 0 0 \\times 0. 6 9 8 9 7=6 9 8. 9 7=6 9 8+0. 9 7 $ ，所以最高位为9，故选D.',
    '7. 第七题解析，故选A.',
    '',
    '<!-- GLM_PAGE:2 -->',
    '8. 第八题解析，故选B.',
    '',
    '## 二、选择题：本大题共3小题。',
    '<table border="1"><tr><td>题号</td><td>9</td><td>10</td><td>11</td></tr><tr><td>答案</td><td>AB</td><td>ABD</td><td>AC</td></tr></table>',
    '',
    '## 【解析】',
    '',
    '9. 第九题解析，故选AB.',
    '10. 第十题解析，故选ABD.',
    '',
    '<!-- GLM_PAGE:3 -->',
    '11. 第十一题解析，故选AC.',
  ].join('\n'),
  pages: [],
  assets: [],
}
const sectionedAnswerTableWithSpacedDecimalsSolutions = parseSolutionDocument(sectionedAnswerTableWithSpacedDecimalsSolutionDocument, {
  config: { ...defaultParserConfig, solutionBindingStrategy: 'heading_then_question' },
  now: '2026-06-24T00:00:00.000Z',
})
assert.equal(sectionedAnswerTableWithSpacedDecimalsSolutions.get('5')?.answerText, 'B')
assert.match(sectionedAnswerTableWithSpacedDecimalsSolutions.get('5')?.analysisMarkdown || '', /第五题解析/)
assert.equal(sectionedAnswerTableWithSpacedDecimalsSolutions.get('6')?.answerText, 'D')
assert.match(sectionedAnswerTableWithSpacedDecimalsSolutions.get('6')?.analysisMarkdown || '', /最高位为9/)
assert.equal(sectionedAnswerTableWithSpacedDecimalsSolutions.get('8')?.answerText, 'B')
assert.match(sectionedAnswerTableWithSpacedDecimalsSolutions.get('8')?.analysisMarkdown || '', /第八题解析/)
assert.equal(sectionedAnswerTableWithSpacedDecimalsSolutions.get('11')?.answerText, 'AC')
assert.match(sectionedAnswerTableWithSpacedDecimalsSolutions.get('11')?.analysisMarkdown || '', /第十一题解析/)
const sectionedAnswerTableWithSpacedDecimalsPreview = buildParserPreview(sectionedAnswerTableWithSpacedDecimalsSolutionDocument, {
  config: { ...defaultParserConfig, solutionBindingStrategy: 'heading_then_question' },
  focusQuestionNo: '6',
})
assert.equal(sectionedAnswerTableWithSpacedDecimalsPreview.diagnostics.some((diagnostic) => diagnostic.code === 'solution_heading_without_following_question'), false)
assert.equal(sectionedAnswerTableWithSpacedDecimalsPreview.diagnostics.some((diagnostic) => diagnostic.code === 'question_before_solution_heading' && ['8', '11'].includes(diagnostic.questionNo)), false)

const decimalHeavySolutionDocument = {
  ...ocrDocument,
  id: 'ocr_decimal_heavy_solution_test',
  markdown: [
    '# 数学参考答案',
    '## 【解析】',
    '16. （本小题满分15分）',
    '',
    '(1) 证明：甲工厂合格件数为 0.85m，乙工厂合格件数为 0.95n，混合后合格率为 0.89(m+n)=0.85m+0.95n，（4分）解得 0.06n=0.04m，即 2m=3n。（5分）',
    '',
    '（2）解：由（1）可知 m:n=3:2，故 X 的可能取值为 0，1，2。',
    '所以 $ P(X=0)=\\frac{1}{10} $，$ P(X=1)=\\frac{3}{5} $，$ P(X=2)=\\frac{3}{10} $。',
    '所以 X 的分布列为：',
    '<table border="1"><tr><td>X</td><td>0</td><td>1</td><td>2</td></tr><tr><td>P</td><td>$\\frac{1}{10}$</td><td>$\\frac{3}{5}$</td><td>$\\frac{3}{10}$</td></tr></table>',
    '因此 $ E(X)=0\\times\\frac{1}{10}+1\\times\\frac{3}{5}+2\\times\\frac{3}{10}=\\frac{6}{5} $。',
    '',
    '17. 第十七题解析。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const decimalHeavySolutions = parseSolutionDocument(decimalHeavySolutionDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.equal(decimalHeavySolutions.has('0'), false)
assert.match(decimalHeavySolutions.get('16')?.analysisMarkdown || '', /0\.85m/)
assert.match(decimalHeavySolutions.get('16')?.analysisMarkdown || '', /E\(X\)/)
assert.doesNotMatch(decimalHeavySolutions.get('16')?.analysisMarkdown || '', /第十七题解析/)

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

const ocrContinuationAndFigureCaptionDocument = {
  ...ocrDocument,
  id: 'ocr_duplicate_marker_continuation_and_caption_test',
  markdown: [
    '9. 如图，该几何体由高均为1的圆锥与圆柱组成，若该',
    '',
    '9. 如图，该几何体底面半径为1，则',
    '',
    'A. 圆锥的母线长为 $\\sqrt{2}$',
    '',
    'B. 圆锥与圆柱的体积比为1:3',
    '',
    '<!-- DOC2X_FIGURE:fig_q9 -->',
    '',
    '第9题图',
    '',
    '10. 下一题题干。',
  ].join('\n'),
  pages: [],
  assets: [
    { id: 'fig_q9', type: 'image', path: 'q9.png', pageNo: 1 },
  ],
}
const continuationAndCaptionCandidates = parseQuestionCandidates(ocrContinuationAndFigureCaptionDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(continuationAndCaptionCandidates.map((candidate) => candidate.questionNo), ['9', '10'])
assert.match(continuationAndCaptionCandidates[0].stemMarkdown, /圆柱组成/)
assert.match(continuationAndCaptionCandidates[0].stemMarkdown, /底面半径为1/)
assert.doesNotMatch(continuationAndCaptionCandidates[0].stemMarkdown, /第9题图|^9\./m)
assert.equal(continuationAndCaptionCandidates[0].figures.some((figure) => figure.id === 'fig_q9'), true)
assert.equal(continuationAndCaptionCandidates.some((candidate) => candidate.issues.some((issue) => issue.code === 'duplicate_question_no')), false)

const decimalDataLineInStemDocument = {
  ...ocrDocument,
  id: 'ocr_decimal_data_line_in_stem_test',
  markdown: [
    '9. 10 根圆钢的直径数据如下：',
    '',
    '20.10, 20.10, 20.09, 20.08, 20.10, 20.11, 20.12, 20.08, 20.09, 20.09（单位：cm），则这批圆钢直径的',
    '',
    'A. 极差为 0.04 cm',
    '',
    'B. 众数为 20.09 cm',
    '',
    'C. 平均数为 20.096 cm',
    '',
    'D. 60%分位数为 20.10 cm',
    '',
    '10. 若 $ f(x)=3\\sin x+1 $，则',
    '',
    '11. 在数阵中求值。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const decimalDataLineInStemCandidates = parseQuestionCandidates(decimalDataLineInStemDocument, { now: '2026-06-24T00:00:00.000Z' })
assert.deepEqual(decimalDataLineInStemCandidates.map((candidate) => candidate.questionNo), ['9', '10', '11'])
assert.match(decimalDataLineInStemCandidates[0].stemMarkdown, /20\.10, 20\.10/)
assert.equal(decimalDataLineInStemCandidates.some((candidate) => candidate.questionNo === '20'), false)

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
const unplacedImageIssue = unplacedImageCandidates.flatMap((candidate) => candidate.issues).find((issue) => issue.code === 'unplaced_figure')
assert.equal(unplacedImageIssue.relatedBlockIds[0], 'b_unplaced')
assert.equal(unplacedImageIssue.relatedFigures[0].path, 'orphan.png')
assert.equal(unplacedImageIssue.relatedFigures[0].pageNo, 2)
const resolvedUnplacedCandidate = {
  ...unplacedImageCandidates[unplacedImageCandidates.length - 1],
  issues: [],
  parseDiagnostics: [{ code: 'unplaced_figure', severity: 'warning', message: unplacedImageIssue.message }],
}
assert.equal(refreshCandidateParseDiagnostics(resolvedUnplacedCandidate, []).some((diagnostic) => diagnostic.code === 'unplaced_figure'), false)

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

const scoringInstructionsBeforeAnswerTableDocument = {
  ...ocrDocument,
  id: 'ocr_scoring_instructions_before_answer_table_test',
  markdown: [
    '<!-- GLM_PAGE:1 -->',
    '# 2026届广州市高三年级调研测试数学试题参考答案及评分标准',
    '',
    '评分说明：',
    '',
    '1. 本解答给出了一种或几种解法供参考，如果考生的解法与本解答不同，可根据试题的主要考查内容比照评分参考制订相应的评分细则.',
    '',
    '2. 对计算题，当考生的解答在某一步出现错误时，可视影响的程度决定后继部分的给分.',
    '',
    '3. 解答右端所注分数，表示考生正确做到这一步应得的累加分数.',
    '',
    '4. 只给整数分数. 选择题不给中间分.',
    '',
    '## 一、选择题：本题共8小题，每小题5分，共40分。',
    '',
    '<table border="1"><tr><td>题号</td><td>1</td><td>2</td><td>3</td><td>4</td></tr><tr><td>答案</td><td>C</td><td>B</td><td>C</td><td>B</td></tr></table>',
    '',
    '二、选择题：本题共3小题，每小题6分，共18分。',
    '',
    '9. AC 10. ABD 11. ABD',
    '',
    '三、填空题：本题共3小题，每小题5分，共15分。',
    '',
    '12. $ \\frac{1}{2} $ 13. $ \\frac{2}{7} $ 14. $ \\frac{2}{3} $',
    '',
    '## 四、解答题：共77分。',
    '',
    '15. （13分）',
    '',
    '（1）解法1：由余弦定理可得结论。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const scoringInstructionsSolutions = parseSolutionDocument(scoringInstructionsBeforeAnswerTableDocument)
assert.equal(scoringInstructionsSolutions.get('1')?.answerText, 'C')
assert.equal(scoringInstructionsSolutions.get('1')?.analysisMarkdown || '', '')
assert.equal(scoringInstructionsSolutions.get('2')?.analysisMarkdown || '', '')
assert.equal(scoringInstructionsSolutions.get('9')?.answerText, 'AC')
assert.equal(scoringInstructionsSolutions.get('10')?.answerText, 'ABD')
assert.equal(scoringInstructionsSolutions.get('12')?.answerText, '$\\frac{1}{2}$')
assert.equal(scoringInstructionsSolutions.get('14')?.answerText, '$\\frac{2}{3}$')
assert.match(scoringInstructionsSolutions.get('15')?.analysisMarkdown || '', /余弦定理/)
assert.doesNotMatch(scoringInstructionsSolutions.get('15')?.analysisMarkdown || '', /本解答给出|只给整数分数/)
const scoringInstructionsPreview = buildParserPreview(scoringInstructionsBeforeAnswerTableDocument, { config: defaultParserConfig })
assert.equal(scoringInstructionsPreview.structures.filter((token) => token.kind === 'question_no').some((token) => ['1', '2', '3', '4'].includes(token.questionNo || '')), false)
assert.equal(scoringInstructionsPreview.structures.some((token) => token.kind === 'metadata_heading' && token.label === '评分说明'), true)

const questionThenHeadingSolutionDocument = {
  ...ocrDocument,
  id: 'ocr_question_then_heading_solution_preview_test',
  markdown: [
    '<!-- GLM_PAGE:7 -->',
    '19.',
    '',
    '【命题说明】',
    '考查函数与导数综合应用。',
    '',
    '## 【参考答案】',
    '解：设函数 $f(x)=x^2$。',
    '由题意可得结论。',
  ].join('\n'),
  pages: [],
  assets: [],
}
const questionThenHeadingDefaultPreview = buildParserPreview(questionThenHeadingSolutionDocument, {
  config: { ...defaultParserConfig, solutionBindingStrategy: 'heading_then_question' },
  focusQuestionNo: '19',
})
assert.equal(questionThenHeadingDefaultPreview.diagnostics.some((diagnostic) => diagnostic.code === 'solution_heading_without_following_question'), true)
const questionThenHeadingPreview = buildParserPreview(questionThenHeadingSolutionDocument, {
  config: { ...defaultParserConfig, solutionBindingStrategy: 'question_then_heading' },
  focusQuestionNo: '19',
})
assert.match(questionThenHeadingPreview.candidatePreviews.find((preview) => preview.questionNo === '19')?.analysisPreview || '', /解：设函数/)
assert.equal(questionThenHeadingPreview.diagnostics.some((diagnostic) => diagnostic.code === 'question_before_solution_heading'), false)
const questionThenHeadingSolutions = parseSolutionDocument(questionThenHeadingSolutionDocument, {
  config: { ...defaultParserConfig, solutionBindingStrategy: 'question_then_heading' },
})
assert.match(questionThenHeadingSolutions.get('19')?.analysisMarkdown || '', /解：设函数/)
const questionThenHeadingAutoPreview = buildParserPreview(questionThenHeadingSolutionDocument, {
  config: { ...defaultParserConfig, solutionBindingStrategy: 'auto' },
  focusQuestionNo: '19',
})
assert.equal(questionThenHeadingAutoPreview.strategyRecommendation?.strategy, 'question_then_heading')

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

const realPaperPresentationNoise = cleanOcrPresentationMarkdown([
  '推导得到输电线损耗功率',
  '第1页，共7页 \\( {\\Delta P} = I^2R \\)；因此损耗减小。',
  '## 第II卷 (共 60 分)',
  '## 三、计算题（第 13 题 10 分，共 40 分）',
  '## 在答题卡上作答，画在试卷上无效】',
  '糖视图',
].join('\n'))
assert.doesNotMatch(realPaperPresentationNoise, /第1页|第II卷|三、计算题|答题卡上作答/)
assert.match(realPaperPresentationNoise, /\\Delta P/)
assert.match(realPaperPresentationNoise, /糖视图/)

const truncatedCandidateIssues = validateQuestionCandidate({
  id: 'candidate_truncated_presentation_test',
  sourceDocumentId: 'source_truncated_presentation_test',
  questionNo: '12',
  stemMarkdown: '若电源电动势变小，需要将滑动变阻器调',
  answerText: '增大',
  analysisMarkdown: '根据分压关系判断。',
  figures: [],
  sourceRefs: [],
  status: 'ready',
  issues: [],
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
}, new Set())
assert.equal(truncatedCandidateIssues.some((issue) => issue.code === 'possible_cross_page'), true)

const trailingLabelImageChoiceDocument = {
  ...ocrDocument,
  id: 'ocr_trailing_label_image_choice_test',
  markdown: [
    '1. 观察示意图，选择正确的图像。',
    '<!-- DOC2X_FIGURE:fig_stem -->',
    '<!-- figureText: 选项图 A -->',
    '<!-- DOC2X_FIGURE:fig_option_a -->',
    'A',
    '<!-- figureText: 选项图 B -->',
    '<!-- DOC2X_FIGURE:fig_option_b -->',
    'B',
    '<!-- figureText: 选项图 C -->',
    '<!-- DOC2X_FIGURE:fig_option_c -->',
    'C',
    '<!-- figureText: 选项图 D -->',
    '<!-- DOC2X_FIGURE:fig_option_d -->',
    'D',
  ].join('\n\n'),
  pages: [],
  assets: [
    { id: 'fig_stem', type: 'image', path: 'stem.png', pageNo: 1 },
    { id: 'fig_option_a', type: 'image', path: 'a.png', pageNo: 1 },
    { id: 'fig_option_b', type: 'image', path: 'b.png', pageNo: 1 },
    { id: 'fig_option_c', type: 'image', path: 'c.png', pageNo: 1 },
    { id: 'fig_option_d', type: 'image', path: 'd.png', pageNo: 1 },
  ],
}
const trailingLabelImageChoiceCandidates = parseQuestionCandidates(trailingLabelImageChoiceDocument, { now: '2026-07-19T00:00:00.000Z' })
assert.equal(trailingLabelImageChoiceCandidates.length, 1)
const trailingLabelImageChoice = trailingLabelImageChoiceCandidates[0]
assert.equal(trailingLabelImageChoice.questionType, '单选题')
assert.match(trailingLabelImageChoice.stemMarkdown, /A\.\s*\n\s*<!-- DOC2X_FIGURE:fig_option_a -->/)
assert.match(trailingLabelImageChoice.stemMarkdown, /D\.\s*\n\s*<!-- DOC2X_FIGURE:fig_option_d -->/)
assert.equal(trailingLabelImageChoice.figures.find((figure) => figure.id === 'fig_stem')?.usage, 'stem')
assert.deepEqual(
  trailingLabelImageChoice.figures.filter((figure) => figure.usage === 'options').map((figure) => figure.optionLabel),
  ['A', 'B', 'C', 'D'],
)

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

// Test D2: answer 中 DOC2X_FIGURE 也要补出解析区 figures，供教师版导出使用
{
  const answerPlaceholderDocument = {
    ...ocrDocument,
    id: 'ocr_answer_placeholder_test',
    markdown: [
      '1. 第一题如图所示。',
      '',
      '答案：见图。',
      '',
      '<!-- DOC2X_FIGURE:answer_fig_1 -->',
    ].join('\n'),
    pages: [],
    assets: [
      { id: 'answer_fig_1', type: 'image', path: 'import-flow-v2/source-documents/src_parser_test/assets/answer.png', pageNo: 2 },
    ],
  }
  const parsedWithAnswerPlaceholder = parseQuestionCandidates(answerPlaceholderDocument, { now: '2026-06-24T00:00:00.000Z' })
  assert.equal(parsedWithAnswerPlaceholder.length, 1)
  assert.equal(parsedWithAnswerPlaceholder[0].figures.length, 1)
  assert.equal(parsedWithAnswerPlaceholder[0].figures[0].id, 'answer_fig_1')
  assert.equal(parsedWithAnswerPlaceholder[0].figures[0].usage, 'analysis')
  assert.equal(parsedWithAnswerPlaceholder[0].figures[0].path, 'import-flow-v2/source-documents/src_parser_test/assets/answer.png')
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

// Test G: separated answers refine the provisional choice-question type
{
  const questionDocument = {
    ...ocrDocument,
    id: 'ocr_separated_choice_questions_test',
    markdown: [
      '1. 下列说法正确的是',
      'A. 甲 B. 乙 C. 丙 D. 丁',
      '',
      '2. 下列结论成立的是',
      'A. 子 B. 丑 C. 寅 D. 卯',
    ].join('\n'),
    pages: [],
    assets: [],
  }
  const solutionDocument = {
    ...ocrDocument,
    id: 'ocr_separated_choice_solutions_test',
    markdown: [
      '1. 答案：AC',
      '解析：甲、丙正确。',
      '',
      '2. 答案：B',
      '解析：乙正确。',
    ].join('\n'),
    pages: [],
    assets: [],
  }
  const questionCandidates = parseQuestionCandidates(questionDocument, { now: '2026-07-11T00:00:00.000Z' })
  assert.deepEqual(questionCandidates.map((candidate) => candidate.questionType), ['单选题', '单选题'])

  const mergedCandidates = mergeQuestionCandidatesWithSolutions(
    questionCandidates,
    parseSolutionDocument(solutionDocument),
    solutionDocument,
  )
  assert.deepEqual(mergedCandidates.map((candidate) => candidate.questionType), ['多选题', '单选题'])
}

{
  const lectureDocument = {
    ...ocrDocument,
    id: 'ocr_lecture_numbered_notes_test',
    markdown: [
      '## 题型 01 函数单调性',
      '## 点方法技巧',
      '1. 先求导函数。',
      '2. 再判断导数符号。',
      '1. （2026 高三・广州）函数 $f(x)=x^2$ 的单调区间是（ ）',
      'A. $(-\\infty,0)$ B. $(0,+\\infty)$',
      '【答案】B',
      '【解析】由导函数判断。',
      '## 题型 02 函数最值',
      '## 知识总结',
      '1. 比较端点与极值点。',
      '2. 注意定义域。',
      '1. （2026 高三・深圳）函数 $g(x)=x^2$ 的最小值为___。',
    ].join('\n'),
    pages: [],
    assets: [],
  }
  const lectureCandidates = parseQuestionCandidates(lectureDocument, {
    now: '2026-07-17T00:00:00.000Z',
    paperKind: 'lecture',
  })
  assert.deepEqual(lectureCandidates.map((candidate) => candidate.questionNo), ['1', '2'])
  assert.equal(lectureCandidates.some((candidate) => candidate.issues.some((issue) => ['missing_question_no', 'duplicate_question_no'].includes(issue.code))), false)
  assert.equal(lectureCandidates[1].issues.some((issue) => issue.code === 'missing_answer'), true)
  assert.doesNotMatch(lectureCandidates.map((candidate) => candidate.stemMarkdown).join('\n'), /先求导函数|比较端点与极值点/)

  const notesOnlyLecture = parseQuestionCandidates({
    ...lectureDocument,
    id: 'ocr_lecture_notes_only_test',
    markdown: '## 方法技巧\n1. 先求导。\n2. 再判断符号。',
  }, { paperKind: 'lecture' })
  assert.deepEqual(notesOnlyLecture, [])
}

// “题干答案混排 · 无答案表” must bypass answer-table detection completely.
// Doc2X commonly emits LaTeX multiplication such as `2 \cdot`, which the
// permissive inline-table detector can otherwise mistake for “题号 2 + 答案”.
{
  const mixedInlineWithoutAnswerTableDocument = {
    ...ocrDocument,
    id: 'ocr_mixed_inline_without_answer_table_test',
    markdown: [
      '1. 第一题',
      '【答案】A',
      '【解析】第一题解析。',
      '',
      '2. 第二题',
      '【答案】C',
      '【解析】第二题解析。',
      '',
      '19. 第十九题',
      '【答案】略',
      '【解析】',
      String.raw`不妨设 \( S = 2 \cdot \left(\frac{1}{3}\right) + 4 \cdot \left(\frac{2}{3}\right) \)`,
    ].join('\n'),
    pages: [],
    assets: [],
  }
  const enabledConfig = {
    ...defaultParserConfig,
    solutionBindingStrategy: 'auto',
    answerTablePolicy: 'fill_empty_only',
  }
  const disabledConfig = {
    ...enabledConfig,
    answerTablePolicy: 'disabled',
  }
  const enabledPreview = buildParserPreview(mixedInlineWithoutAnswerTableDocument, { config: enabledConfig })
  assert.equal(enabledPreview.diagnostics.some((diagnostic) => diagnostic.code === 'table_answer_blocked_by_existing_answer'), true)

  const disabledPreview = buildParserPreview(mixedInlineWithoutAnswerTableDocument, { config: disabledConfig })
  assert.equal(disabledPreview.diagnostics.some((diagnostic) => diagnostic.code.startsWith('table_answer_')), false)
  assert.equal(disabledPreview.structures.some((token) => token.kind === 'answer_table'), false)

  const disabledSolutions = parseSolutionDocument(mixedInlineWithoutAnswerTableDocument, { config: disabledConfig })
  assert.equal(disabledSolutions.get('1')?.answerText, 'A')
  assert.equal(disabledSolutions.get('2')?.answerText, 'C')
  assert.match(disabledSolutions.get('19')?.analysisMarkdown || '', /2 \\cdot/)
}

console.log('question parser ok')
