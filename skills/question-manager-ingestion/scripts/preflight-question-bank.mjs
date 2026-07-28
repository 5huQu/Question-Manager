#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const katex = require('katex')
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(skillRoot, '../..')

function usage() {
  console.error('Usage: node preflight-question-bank.mjs <candidates.json> [--api-base <url>] [--project-root <path>]')
}

function parseArgs(argv) {
  const args = { inputPath: '', apiBase: '', projectRoot }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!args.inputPath && !value.startsWith('--')) {
      args.inputPath = value
      continue
    }
    if (value === '--api-base' || value === '--project-root') {
      const next = argv[index + 1]
      if (!next) throw new Error(`${value} 缺少参数。`)
      args[value === '--api-base' ? 'apiBase' : 'projectRoot'] = next
      index += 1
      continue
    }
    throw new Error(`不支持的参数：${value}`)
  }
  if (!args.inputPath) throw new Error('缺少候选题 JSON 文件。')
  return args
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取 JSON：${filePath}；${error instanceof Error ? error.message : String(error)}`)
  }
}

function asQuestions(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray(value.questions)) return value.questions
  throw new Error('候选文件必须是题目数组，或包含 questions 数组的对象。')
}

function tagNames(library) {
  const groups = Array.isArray(library.groups) ? library.groups : Array.isArray(library.chapters) ? library.chapters : []
  return groups.flatMap((group) => {
    const entries = Array.isArray(group.tags) ? group.tags : Array.isArray(group.knowledgePoints) ? group.knowledgePoints : []
    return entries.map((entry) => String(entry?.name || '').trim()).filter(Boolean)
  })
}

function localTagLibraries(root) {
  const libraryDir = path.join(root, 'server', 'tag_libraries')
  const knowledgePoints = new Set()
  const solutionMethods = new Set()
  for (const fileName of fs.readdirSync(libraryDir).filter((file) => file.endsWith('.json')).sort()) {
    const value = readJson(path.join(libraryDir, fileName))
    const libraries = Array.isArray(value) ? value : [value]
    for (const library of libraries) {
      const target = String(library?.libraryType || '') === 'method_tag' ? solutionMethods : knowledgePoints
      for (const name of tagNames(library)) target.add(name)
    }
  }
  return { knowledgePoints: [...knowledgePoints], solutionMethods: [...solutionMethods], source: 'local tag libraries' }
}

async function tagLibraries(args) {
  if (args.apiBase) {
    try {
      const response = await fetch(`${args.apiBase.replace(/\/$/, '')}/api/question-bank/tag-libraries`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (Array.isArray(payload?.knowledgePoints) && Array.isArray(payload?.solutionMethods)) {
        return { knowledgePoints: payload.knowledgePoints, solutionMethods: payload.solutionMethods, source: args.apiBase }
      }
      throw new Error('响应缺少标签数组')
    } catch (error) {
      console.error(`警告：无法读取运行中的标签库（${error instanceof Error ? error.message : String(error)}），改用仓库标签库。`)
    }
  }
  return localTagLibraries(args.projectRoot)
}

function difficultyLabel(score) {
  if (score <= 0) return ''
  if (score <= 3) return '基础'
  if (score <= 6) return '中等'
  if (score <= 8) return '较难'
  return '压轴'
}

function normalizedTags(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function fieldValue(question, key, alias) {
  return String(question[key] ?? question[alias] ?? '')
}

function issue(issues, question, field, code, message, severity = 'error') {
  issues.push({
    question: String(question.questionNo ?? question.question_no ?? question.importSourceId ?? question.import_source_id ?? '?'),
    field,
    code,
    severity,
    message,
  })
}

function validateMath(issues, question, field, value) {
  const text = String(value || '')
  const spans = Array.from(text.matchAll(/\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g))
  let consumed = text
  for (const match of spans) {
    const index = Number(match.index || 0)
    consumed = `${consumed.slice(0, index)}${' '.repeat(match[0].length)}${consumed.slice(index + match[0].length)}`
    const tex = String(match[1] ?? match[2] ?? '').trim()
    if (!tex) continue
    try {
      katex.renderToString(tex, { displayMode: Boolean(match[1]), throwOnError: true, strict: 'ignore' })
    } catch (error) {
      issue(issues, question, field, 'katex_parse_error', `公式无法由 KaTeX 解析：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (/(^|[^\\])\$/.test(consumed)) issue(issues, question, field, 'math_delimiter_unclosed', '数学定界符 $ 未成对。')
}

function validateQuestion(question, libraries, seenSourceIds, issues) {
  const stem = fieldValue(question, 'stemMarkdown', 'problem_text')
  const answer = fieldValue(question, 'answerText', 'answer')
  const analysis = fieldValue(question, 'analysisMarkdown', 'analysis')
  const sourceTitle = fieldValue(question, 'sourceTitle', 'source_title')
  const importSourceId = fieldValue(question, 'importSourceId', 'import_source_id')
  const questionType = fieldValue(question, 'questionType', 'question_type')
  const knowledgePoints = normalizedTags(question.knowledgePoints ?? question.knowledge_points)
  const solutionMethods = normalizedTags(question.solutionMethods ?? question.solution_methods)
  const figures = Array.isArray(question.figures) ? question.figures : []

  if (!stem.trim()) issue(issues, question, 'stemMarkdown', 'missing_stem', '题干为空。')
  if (!sourceTitle.trim()) issue(issues, question, 'sourceTitle', 'missing_source', '缺少展示来源。')
  if (!importSourceId.trim()) issue(issues, question, 'importSourceId', 'missing_source_locator', '缺少稳定来源定位。')
  if (importSourceId && seenSourceIds.has(importSourceId)) issue(issues, question, 'importSourceId', 'duplicate_source_locator', '候选文件中存在重复来源定位。')
  if (importSourceId) seenSourceIds.add(importSourceId)

  for (const tag of knowledgePoints) {
    if (!libraries.knowledgePoints.has(tag)) issue(issues, question, 'knowledgePoints', 'unknown_knowledge_point', `知识点不在当前标签库：${tag}`)
  }
  for (const tag of solutionMethods) {
    if (!libraries.solutionMethods.has(tag)) issue(issues, question, 'solutionMethods', 'unknown_solution_method', `解题方法不在当前标签库：${tag}`)
  }

  const rawScore = question.difficultyScore10 ?? question.difficulty_score_10 ?? 0
  const score = Number(rawScore)
  const label = fieldValue(question, 'difficultyLabel', 'difficulty_label')
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    issue(issues, question, 'difficultyScore10', 'invalid_difficulty_score', '难度分必须是 0 或 1-10 的整数。')
  } else if (score === 0 && label) {
    issue(issues, question, 'difficultyLabel', 'difficulty_label_without_score', '难度为空时，难度标签也必须为空。')
  } else if (score > 0 && label !== difficultyLabel(score)) {
    issue(issues, question, 'difficultyLabel', 'difficulty_label_mismatch', `难度 ${score}/10 的系统标签应为“${difficultyLabel(score)}”。`)
  }

  if (['单选题', '多选题'].includes(questionType)) {
    const labels = [...stem.matchAll(/^\s*([A-D])[.．、]\s+/gm)].map((match) => match[1])
    if (labels.join('') !== 'ABCD') issue(issues, question, 'stemMarkdown', 'choice_options_invalid', '选择题必须有连续 A. 至 D. 选项。')
    if (!answer.trim()) issue(issues, question, 'answerText', 'missing_answer', '选择题缺少最终答案。')
  }

  if (/\\(?:TeacherSolution|blank)\b/.test(stem)) issue(issues, question, 'stemMarkdown', 'raw_latex_layout_command', '题干包含未清理的 LaTeX 排版命令。')
  if (/(?:解析来源|题源|下载资料|【答案】|【分析】|【详解】)/.test(analysis)) issue(issues, question, 'analysisMarkdown', 'analysis_boilerplate', '解析包含应移除的来源或标题包装。', 'warning')

  for (const [index, figure] of figures.entries()) {
    const figurePath = String(figure?.path || '').trim()
    const usage = String(figure?.usage || '').trim()
    const optionLabel = String(figure?.optionLabel || '').trim().toUpperCase()
    const label = `figures[${index}]`
    if (!figurePath) {
      issue(issues, question, label, 'missing_figure_path', '题图没有已保存的本地 path。')
    } else if (
      path.isAbsolute(figurePath)
      || /^file:|^(?:https?:)?\/\//i.test(figurePath)
      || figurePath.startsWith('data:')
      || !/^data\/question_figures\/[^/]+\/[^/]+\.[a-z0-9]+$/i.test(figurePath.replace(/^question_assets\//, ''))
    ) {
      issue(issues, question, label, 'nonportable_figure_path', '题图 path 必须是 data/question_figures/<questionId>/<figureId>.<ext> 形式的相对路径。')
    } else {
      const storageRoot = process.env.QUESTION_DATA_DIR || argsProjectRoot
      const localPath = path.join(storageRoot, figurePath.replace(/^question_assets\//, ''))
      if (!fs.existsSync(localPath)) issue(issues, question, label, 'missing_figure_file', `题图文件不存在：${figurePath}`)
    }
    if (!['stem', 'options', 'analysis'].includes(usage)) issue(issues, question, label, 'invalid_figure_usage', '题图 usage 必须是 stem、options 或 analysis。')
    if (usage === 'options' && !/^[A-D]$/.test(optionLabel)) issue(issues, question, label, 'missing_figure_option_label', '选项题图必须指定 A-D 的 optionLabel。')
  }

  validateMath(issues, question, 'stemMarkdown', stem)
  validateMath(issues, question, 'answerText', answer)
  validateMath(issues, question, 'analysisMarkdown', analysis)
}

let argsProjectRoot = projectRoot

async function main() {
  const args = parseArgs(process.argv.slice(2))
  argsProjectRoot = path.resolve(args.projectRoot)
  const payload = readJson(path.resolve(args.inputPath))
  const questions = asQuestions(payload)
  const tags = await tagLibraries(args)
  const libraries = {
    knowledgePoints: new Set(tags.knowledgePoints.map((tag) => String(tag).trim()).filter(Boolean)),
    solutionMethods: new Set(tags.solutionMethods.map((tag) => String(tag).trim()).filter(Boolean)),
  }
  const issues = []
  const seenSourceIds = new Set()
  for (const question of questions) validateQuestion(question || {}, libraries, seenSourceIds, issues)
  const report = {
    checked: questions.length,
    tagLibrarySource: tags.source,
    errors: issues.filter((item) => item.severity === 'error'),
    warnings: issues.filter((item) => item.severity === 'warning'),
  }
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.errors.length ? 1 : 0
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  usage()
  process.exitCode = 1
})
