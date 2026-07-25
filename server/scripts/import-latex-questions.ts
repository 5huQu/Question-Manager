import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDatabase, db } from '../src/db/connection.js'
import { createQuestion } from '../src/db/questions.js'
import { ensureSchema } from '../src/db/schema.js'
import { nowIso } from '../src/utils/ids.js'
import { buildSearchText } from '../src/utils/search.js'
import { formatReviewPayload, validateQuestionMarkdown } from '../src/utils/validation.js'

type PaperKind = 'gaokao_real' | 'local_real' | 'mock' | 'school_exam' | 'lecture' | 'daily_practice' | 'unknown'

type ParsedQuestion = {
  questionNo: string
  chapter: string
  sourceTitle: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  questionType: string
  metadata: {
    stage: string
    subject: string
    province: string
    city: string
    paperTitle: string
    batchName: string
    paperKind: PaperKind
    examYear: number
    sourceOrg: string
  }
  importSourceId: string
  issues: Array<{ field: string; code: string; message: string; snippet: string }>
}

const sourceFile = '/Users/imshuqu/一轮资料/高中数学一轮讲义/derivative-practice-native.tex'
const sourceRoot = '/Users/imshuqu/一轮资料'
const sourcePrefix = 'latex:'

const provinces = [
  '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东',
  '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '内蒙古', '广西', '西藏', '宁夏', '新疆',
]

function cleanInlineTex(value: string) {
  return value
    .replace(/%.*$/gm, '')
    .replace(/\\left\s*/g, '')
    .replace(/\\right\s*/g, '')
    .replace(/\\dfrac/g, '\\frac')
    .replace(/\\!\s*/g, '')
    // Some source formulas omit the separator after a control word, e.g.
    // `\\ln\\!x_1` and `\\in\\!Z`. KaTeX reads the compacted form as an
    // unknown command, so strip spacing commands before inserting a separator.
    .replace(/\\inZ\b/g, '\\in \\mathbb{Z}')
    .replace(/\\(ln|sin|cos|tan|cot|sec|csc)(?=[A-Za-z])/g, '\\$1 ')
    .replace(/\s+/g, ' ')
    .replace(/（\s*\\quad\s*）/g, '（ ）')
    .trim()
}

function cleanAnswer(value: string) {
  return cleanInlineTex(value)
    .replace(/^[：:：\s]+/, '')
    .replace(/[。．；;]\s*$/, '')
    .trim()
}

function cleanAnalysis(value: string) {
  // When a teacher solution has both a short “analysis” summary and a full
  // derivation, the full derivation is the useful bank content. Keeping both
  // makes the rendered answer repetitive and needlessly dense.
  const detailedStart = value.indexOf('【详解】')
  const selected = detailedStart >= 0 ? value.slice(detailedStart + '【详解】'.length) : value
  const withoutSource = selected
    .split('\n')
    .filter((line) => !/(?:解析来源|题源|来源)\s*[：:]/.test(line))
    .filter((line) => !/\\(?:begingroup|endgroup|small|smallskip|noindent)\b/.test(line))
    .join('\n')

  const normalized = withoutSource
    .replace(/【答案】[\s\S]*?(?:\\par|$)/g, '')
    .replace(/【(?:分析|详解)】/g, '')
    .replace(/(?:^|\n)\s*(?:解|解析)\s*[：:]/g, '\n')
    .replace(/\\par\s*/g, '\n\n')
    .replace(/\\textcolor\{[^{}]*\}\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:scriptsize|smallskip|small)\b/g, '')
  return cleanStemMarkdown(normalized)
}

function roman(value: number) {
  return ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][value] || String(value)
}

function convertNestedLists(value: string) {
  const lines = value.split('\n')
  const lists: Array<{ type: 'parts' | 'enumerate'; index: number }> = []
  const output: string[] = []
  for (const line of lines) {
    const begin = line.match(/^\s*\\begin\{(parts|enumerate)\}(?:\[[^\]]*\])?\s*$/)
    if (begin) {
      lists.push({ type: begin[1] as 'parts' | 'enumerate', index: 0 })
      continue
    }
    if (/^\s*\\end\{(?:parts|enumerate)\}\s*$/.test(line)) {
      lists.pop()
      continue
    }
    const item = line.match(/^\s*\\item\s+(.+)$/)
    if (item && lists.length) {
      const current = lists.at(-1)!
      current.index += 1
      const label = current.type === 'parts' ? `(${current.index})` : `(${roman(current.index)})`
      output.push(`${'  '.repeat(Math.max(0, lists.length - 1))}${label} ${item[1]}`)
      continue
    }
    output.push(line)
  }
  return output.join('\n')
}

function cleanStemMarkdown(value: string) {
  const lines = value.split('\n')
    .map((line) => cleanInlineTex(line))
    .filter((line, index, all) => line || (index > 0 && Boolean(all[index - 1])))
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function answerFromSolution(value: string) {
  const match = value.match(/【答案】\s*([\s\S]*?)(?:\\par|$)/)
  return match ? cleanAnswer(match[1]) : ''
}

function extractMetadata(sourceTitle: string) {
  const stage = /高三/.test(sourceTitle) ? '高三' : '高三'
  const schoolYear = sourceTitle.match(/(\d{4})\s*[-—]\s*(\d{4})\s*学年/)
  const singleYear = sourceTitle.match(/(?:^|[^\d])(20\d{2})(?:[^\d]|$)/)
  const examYear = schoolYear ? Number(schoolYear[2]) : singleYear ? Number(singleYear[1]) : 0
  const province = provinces.find((name) => sourceTitle.includes(name)) || ''
  const locationTail = province ? sourceTitle.slice(sourceTitle.indexOf(province) + province.length) : ''
  const cityMatch = locationTail.replace(/^市/, '').match(/^[\u4e00-\u9fff]{1,8}?(?:市|区|州|盟)/)
  const city = cityMatch ? cityMatch[0].replace(/市$/, '').replace(/^重庆市$/, '重庆') : ''
  const batchName = ['阶段检测', '期中', '期末', '模拟预测', '课堂例题', '一轮复习', '专题练习', '课后作业', '定时练习', '课前预习']
    .find((name) => sourceTitle.includes(name)) || ''
  const paperKind: PaperKind = /模拟预测/.test(sourceTitle)
    ? 'mock'
    : /(?:期中|期末|阶段检测)/.test(sourceTitle)
      ? 'school_exam'
      : /(?:课堂例题|一轮复习|专题练习|课前预习|二轮复习)/.test(sourceTitle)
        ? 'lecture'
        : /(?:课后作业|定时练习)/.test(sourceTitle)
          ? 'daily_practice'
          : 'unknown'
  const hasFullPaperTitle = /(?:试题|测评)/.test(sourceTitle)
  const sourceOrg = /区/.test(sourceTitle) && /(?:试题|测评)/.test(sourceTitle)
    ? (sourceTitle.match(/^(.+?)(?:20\d{2}|\d{4}\s*[-—])/i)?.[1] || '').replace(/[·\s]+$/g, '')
    : ''
  return {
    stage,
    subject: '数学',
    province,
    city,
    paperTitle: hasFullPaperTitle ? sourceTitle : '',
    batchName,
    paperKind,
    examYear,
    sourceOrg,
  }
}

function environmentName(line: string, kind: 'begin' | 'end') {
  return line.match(new RegExp(`\\\\${kind}\\{([^}]+)\\}`))?.[1] || ''
}

function parseQuestions(source: string): ParsedQuestion[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const entries: Array<{ start: number; end: number; chapter: string }> = []
  let chapter = ''
  let insideQuestions = false
  const environments: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const chapterMatch = line.match(/^\\chapter\{([^}]*)\}/)
    if (chapterMatch) chapter = chapterMatch[1].trim()
    const started = environmentName(line, 'begin')
    if (started) {
      environments.push(started)
      if (started === 'questions') insideQuestions = true
    }
    if (insideQuestions && environments.at(-1) === 'questions' && /^\s*\\item\s+/.test(line)) {
      entries.push({ start: index, end: lines.length, chapter })
    }
    const ended = environmentName(line, 'end')
    if (ended) {
      const position = environments.lastIndexOf(ended)
      if (position >= 0) environments.splice(position, 1)
      if (ended === 'questions') insideQuestions = false
    }
  }
  for (let index = 0; index < entries.length - 1; index += 1) entries[index].end = entries[index + 1].start

  const relativePath = path.relative(sourceRoot, sourceFile)
  return entries.map((entry, index) => {
    const block = lines.slice(entry.start, entry.end).join('\n')
    const rawStem = block.split(/%<auto-teacher-solution>/)[0].replace(/^\s*\\item\s+/, '').trim()
    const solutionMatch = block.match(/%<auto-teacher-solution>\s*\\TeacherSolution\{%?([\s\S]*?)\n\s*}\s*\n?%<\/auto-teacher-solution>/)
    const rawSolution = solutionMatch?.[1] || ''
    const sourceMatch = rawStem.match(/^(?:【多选】\s*)?（([^）]+)）/)
    const sourceTitle = sourceMatch?.[1]?.trim() || ''
    const explicitMultiple = /^【多选】/.test(rawStem)
    let questionText = rawStem
      .replace(/^【多选】\s*/, '')
      .replace(/^（[^）]+）\s*/, '')
      .replace(/\\blank\[[^\]]*\]/g, '______')

    const optionMatches = Array.from(questionText.matchAll(/\\begin\{choices(?:four|two)?\}([\s\S]*?)\\end\{choices(?:four|two)?\}/g))
    const options = optionMatches.flatMap((match) => Array.from(match[1].matchAll(/^\s*\\item\s+(.+)$/gm)).map((option) => cleanInlineTex(option[1])))
    questionText = questionText.replace(/\\begin\{choices(?:four|two)?\}[\s\S]*?\\end\{choices(?:four|two)?\}/g, '').trim()
    questionText = convertNestedLists(questionText)
    const stemMarkdown = [cleanStemMarkdown(questionText), options.length ? options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join('\n') : '']
      .filter(Boolean)
      .join('\n\n')
    const answerText = answerFromSolution(rawSolution)
    const analysisMarkdown = cleanAnalysis(rawSolution)
    const questionType = explicitMultiple ? '多选题' : options.length === 4 ? '单选题' : /______/.test(stemMarkdown) ? '填空题' : '解答题'
    const issues = validateQuestionMarkdown({ problem_text: stemMarkdown, answer: answerText, analysis: analysisMarkdown })
    if (!sourceTitle) issues.push({ field: 'sourceTitle', code: 'missing_source', message: '题号后未识别到来源括号。', snippet: '' })
    if (!answerText) issues.push({ field: 'answerText', code: 'missing_answer', message: '源码中没有可直接核对的最终答案。', snippet: '' })
    const chapterNo = entries.slice(0, index + 1).filter((item) => item.chapter === entry.chapter).length

    return {
      questionNo: String(chapterNo),
      chapter: entry.chapter || '未分类章节',
      sourceTitle,
      stemMarkdown,
      answerText,
      analysisMarkdown,
      questionType,
      metadata: extractMetadata(sourceTitle),
      importSourceId: `${sourcePrefix}${relativePath}#${entry.chapter || '未分类章节'}:${chapterNo}`,
      issues,
    }
  })
}

function run() {
  const apply = process.argv.includes('--apply')
  const repair = process.argv.includes('--repair')
  const source = fs.readFileSync(sourceFile, 'utf8')
  const questions = parseQuestions(source)
  const summary = {
    total: questions.length,
    ready: questions.filter((item) => !item.issues.length).length,
    blocked: questions.filter((item) => item.issues.length).length,
    missingAnswer: questions.filter((item) => item.issues.some((issue) => issue.code === 'missing_answer')).length,
  }
  if (!apply && !repair) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      sourceFile,
      summary,
      sample: questions.slice(0, 3),
      blockedSample: questions.filter((item) => item.issues.length).slice(0, 10).map((item) => ({
        importSourceId: item.importSourceId,
        sourceTitle: item.sourceTitle,
        issues: item.issues,
      })),
    }, null, 2))
    return
  }

  ensureSchema()
  const existing = new Set(
    db.prepare("SELECT import_source_id FROM question_bank_items WHERE import_source_id LIKE 'latex:%'")
      .all()
      .map((row: { import_source_id: string }) => row.import_source_id),
  )
  const created: string[] = []
  const repaired: string[] = []
  const skipped: string[] = []
  const repairStatement = db.prepare(`
    UPDATE question_bank_items
    SET question_type = ?, stem_markdown = ?, answer_text = ?, analysis_markdown = ?,
        bank_status = ?, format_review_required = ?, format_review_reasons_json = ?,
        search_text = ?, content_revision = content_revision + 1, updated_at = ?
    WHERE import_source_id = ?
  `)
  db.exec('BEGIN')
  try {
    for (const question of questions) {
      if (existing.has(question.importSourceId)) {
        if (repair) {
          const now = nowIso()
          repairStatement.run(
            question.questionType,
            question.stemMarkdown,
            question.answerText,
            question.analysisMarkdown,
            question.issues.length ? 'blocked' : 'ready',
            question.issues.length ? 1 : 0,
            question.issues.length ? JSON.stringify(formatReviewPayload(question.issues, now)) : '{}',
            buildSearchText(question.stemMarkdown, question.answerText, question.analysisMarkdown, [question.sourceTitle, question.chapter]),
            now,
            question.importSourceId,
          )
          repaired.push(question.importSourceId)
        }
        skipped.push(question.importSourceId)
        continue
      }
      const firstIssue = question.issues[0]
      const item = createQuestion({
        questionNo: question.questionNo,
        chapter: question.chapter,
        sourceTitle: question.sourceTitle || '来源待补充',
        ...question.metadata,
        questionType: question.questionType,
        difficultyScore10: 0,
        difficultyLabel: '',
        knowledgePoints: [],
        solutionMethods: [],
        stemMarkdown: question.stemMarkdown,
        answerText: question.answerText,
        analysisMarkdown: question.analysisMarkdown,
        figures: [],
        importSourceId: question.importSourceId,
        sourceRunId: 'latex-import-v1',
        bankStatus: question.issues.length ? 'blocked' : 'ready',
        needsFormatReview: Boolean(question.issues.length),
        formatIssue: firstIssue,
      })
      if (item) created.push(item.id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    closeDatabase()
  }
  console.log(JSON.stringify({ mode: repair ? 'repair' : 'apply', sourceFile, summary, created: created.length, repaired: repaired.length, skipped: skipped.length }, null, 2))
}

try {
  run()
} catch (error) {
  closeDatabase()
  throw error
}
