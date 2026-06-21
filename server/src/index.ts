import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import multer from 'multer'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sourceRoot = path.resolve(__dirname, '../..')
const storageRoot = path.resolve(process.env.QUESTION_DATA_DIR || sourceRoot)
const dataDir = path.join(storageRoot, 'data')
const runsRoot = path.join(storageRoot, 'experiments', 'pdf_slicer', 'runs')
const sqlitePath = path.join(dataDir, 'question.sqlite')
const tagLibrariesDir = path.join(sourceRoot, 'server', 'tag_libraries')
const pythonRoot = path.join(sourceRoot, 'server', 'python')
const pythonDataRoot = path.join(storageRoot, 'python')
const frontendDist = path.join(sourceRoot, 'frontend', 'dist')
const upload = multer({ storage: multer.memoryStorage() })
const require = createRequire(import.meta.url)
const katex = require('katex') as { renderToString: (tex: string, options?: Record<string, unknown>) => string }

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(runsRoot, { recursive: true })
fs.mkdirSync(pythonDataRoot, { recursive: true })
fs.mkdirSync(tagLibrariesDir, { recursive: true })

const db = new DatabaseSync(sqlitePath)
db.exec('PRAGMA foreign_keys = ON')

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function toPortablePath(value: string) {
  return value.split(path.sep).join('/')
}

function assetPathFor(absPath: string) {
  const absolute = path.resolve(absPath)
  if (isInside(storageRoot, absolute)) return toPortablePath(path.relative(storageRoot, absolute))
  if (isInside(sourceRoot, absolute)) return toPortablePath(path.relative(sourceRoot, absolute))
  return toPortablePath(path.relative(storageRoot, absolute))
}

function resolveStoragePath(rawPath: string) {
  const clean = stripAssetPrefix(String(rawPath || ''))
  if (!clean) return ''
  if (path.isAbsolute(clean)) return clean
  const storageCandidate = path.join(storageRoot, clean)
  if (fs.existsSync(storageCandidate) || storageRoot !== sourceRoot) return storageCandidate
  return path.join(sourceRoot, clean)
}

function pythonCommand() {
  return process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3')
}

function pythonDetails() {
  const command = pythonCommand()
  try {
    const code = [
      'import json, sys, importlib.metadata',
      'import fitz',
      'from PIL import Image',
      'import flask',
      'print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable, "pymupdf": fitz.VersionBind, "pillow": Image.__version__, "flask": importlib.metadata.version("flask")}))',
    ].join('; ')
    const value = JSON.parse(
      execFileSync(command, ['-I', '-c', code], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }),
    )
    return { available: true, source: process.env.QUESTION_PYTHON_RUNTIME || 'system', ...value }
  } catch (error) {
    return {
      available: false,
      source: process.env.QUESTION_PYTHON_RUNTIME || 'system',
      executable: command,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function firstExecutable(candidates: string[]) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 3000 })
      return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return ''
}

function configuredSofficePath() {
  try {
    return String(readAppSettings().sofficePath || '').trim()
  } catch {
    return ''
  }
}

function windowsSofficeCandidates() {
  if (process.platform !== 'win32') return []
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  return [
    path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
    path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'),
    'soffice.exe',
  ]
}

function sofficePath() {
  return firstExecutable([
    configuredSofficePath(),
    process.env.SOFFICE_PATH || '',
    process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : '',
    ...windowsSofficeCandidates(),
    'soffice',
    'libreoffice',
  ])
}

function toolAvailability() {
  const resolvedSofficePath = sofficePath()
  return {
    python: pythonDetails(),
    xelatex: Boolean(xelatexPath()),
    soffice: Boolean(resolvedSofficePath),
    sofficePath: resolvedSofficePath,
  }
}

type RunStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'
type ReviewStatus = 'pending' | 'submitted'
type BankStatus = 'blocked' | 'ready' | 'banked' | 'skipped'
type MaterialType = 'exam' | 'lecture' | 'unknown'
type FileRole = 'full' | 'questions' | 'solutions' | 'unknown'
type WorkflowMode = 'single' | 'separated_exam'
type WorkflowStatus = 'ready' | 'needs_classification' | 'processing' | 'ready_for_bank' | 'needs_review'
type OcrProvider = 'legacy' | 'doc2x' | 'glm'

type RichInline =
  | { type: 'text'; text: string }
  | { type: 'inline_math'; tex: string }

type RichBlock =
  | { type: 'paragraph'; content: RichInline[] }
  | { type: 'display_math'; tex: string }
  | { type: 'choices'; options: Array<{ label: string; blocks: RichBlock[] }> }
  | { type: 'table'; rows: Array<{ header?: boolean; cells: RichInline[][] }> }

type BatchRow = {
  id: string
  title: string
  material_type: MaterialType
  workflow_mode: WorkflowMode
  workflow_status: WorkflowStatus
  created_at: string
  uploaded_count: number
}

type RunRow = {
  run_id: string
  batch_id: string
  upload_mode: string
  paper_title: string
  pdf_name: string
  pdf_path: string
  source_file_name: string
  source_file_kind: string
  material_type: MaterialType
  file_role: FileRole
  stage: string
  classification_confidence: number
  classification_reasons_json: string
  run_dir: string
  document_diagnostics_json: string
  created_at: string
  updated_at: string
  slice_status: RunStatus
  slice_error: string
  quick_review_status: ReviewStatus
  total_questions: number
  approved_questions: number
  unreviewed_questions: number
  ocr_status: RunStatus
  ocr_error: string
  ocr_started_at: string
  ocr_finished_at: string
  ocr_provider: string
  ocr_external_uid: string
  ocr_provider_phase: string
  ocr_provider_progress: number
  ocr_provider_result_path: string
  rules_version: number
  rules_hash: string
  rules_fallback_used: number
  rules_warnings_json: string
}

type SlicerRuleEntry = { id: string; term: string; matchMode: 'contains' | 'exact'; enabled: boolean }
type SlicerRulesData = Record<string, unknown> & { version: number }

const SLICER_RULES_CATEGORIES = ['auxiliaryMarkers', 'noticeTerms', 'referenceFormulaMarkers', 'trainingMarkers', 'nonQuestionRemainders', 'sectionMarkers'] as const
const VALID_MATCH_MODES = ['contains', 'exact']

type QuestionRow = {
  id: string
  serial_no: number
  question_no: string
  stage: string
  question_type: string
  difficulty_score: number
  difficulty_score_10: number
  difficulty_label: string
  chapter: string
  knowledge_points_json: string
  solution_methods_json: string
  source_title: string
  bank_status: BankStatus
  stem_markdown: string
  answer_text: string
  analysis_markdown: string
  search_text: string
  slice_image_path: string
  figures_json: string
  source_run_id: string
  source_solution_run_id: string
  merge_status: string
  merge_note: string
  format_review_required: number
  format_review_reasons_json: string
  created_at: string
  updated_at: string
}

type SolutionRow = {
  id: string
  batch_id: string
  source_run_id: string
  question_no: string
  answer_text: string
  analysis_markdown: string
  figures_json: string
  source_image_path: string
  match_status: string
  matched_question_id: string
  match_note: string
  created_at: string
  updated_at: string
}

type ReviewRow = {
  result_id: string
  run_id: string
  question_label: string
  page_start: number
  page_end: number
  page_image_path: string
  auto_image_path: string
  bbox_json: string
  segments_json: string
  text_regions_json: string
  figures_json: string
  review_status: string
  note: string
  created_at: string
  updated_at: string
}

type CollectionRow = {
  id: string
  title: string
  subtitle: string
  description: string
  kind: 'basket' | 'paper'
  status: 'draft' | 'finalized'
  total_score: number
  time_limit: number
  export_format: string
  created_at: string
  updated_at: string
}

type CollectionItemRow = QuestionRow & {
  relation_id: string
  sort_order: number
  score: number
  section_name: string
}

type ExportRecordSourceType = 'collection' | 'run'
type ExportRecordRow = {
  id: string
  source_type: ExportRecordSourceType
  collection_id: string
  run_id: string
  title: string
  format: string
  variant: string
  filename: string
  path: string
  url: string
  items_json: string
  content_length: number
  question_count: number
  status: 'succeeded' | 'failed'
  error: string
  created_at: string
}

type ExportRecordItemSnapshot = {
  questionId: string
  exportOrder: number
}

type PublicQuestion = ReturnType<typeof mapQuestion>
const activeOcrProcesses = new Map<string, ChildProcessWithoutNullStreams>()
const duplicateSimilarityThreshold = 0.62

function nowIso() {
  return new Date().toISOString()
}

function safeName(value: string) {
  return (value || 'file')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'file'
}

function isWordUploadKind(kind: string) {
  return kind === 'doc' || kind === 'docx'
}

function createId(prefix: string, name = '') {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const suffix = Math.random().toString(16).slice(2, 8)
  const safe = name ? `_${safeName(name)}` : ''
  return `${prefix}_${stamp}_${suffix}${safe}`
}

function convertDocxToPdf(inputPath: string, outDir: string) {
  const soffice = sofficePath()
  if (!soffice) {
    throw new Error('未找到 LibreOffice/soffice，无法将 Word 转 PDF。')
  }
  execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath], {
    cwd: outDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const expected = path.join(outDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`)
  if (!fs.existsSync(expected)) {
    const pdfs = fs.readdirSync(outDir).filter((name) => name.toLowerCase().endsWith('.pdf')).map((name) => path.join(outDir, name))
    if (pdfs.length) return pdfs[0]
    throw new Error('Word 转 PDF 完成后未找到输出 PDF。')
  }
  return expected
}

function analyzeDocxFormulaTypes(inputPath: string) {
  const code = [
    'import json, sys',
    'from pathlib import Path',
    'from src.lab.word import analyze_docx_formula_types',
    'print(json.dumps(analyze_docx_formula_types(Path(sys.argv[1])), ensure_ascii=False))',
  ].join('\n')
  try {
    const output = execFileSync(pythonCommand(), ['-c', code, inputPath], {
      cwd: pythonRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(output) as Record<string, unknown>
  } catch (error) {
    return {
      supported: false,
      error: error instanceof Error ? error.message : String(error),
      recommendation: 'DOCX 公式结构检测失败，已继续按普通 Word 转 PDF 流程处理。',
    }
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function textInline(text: unknown): RichInline | null {
  const value = String(text ?? '')
  return value ? { type: 'text', text: value } : null
}

function inlineMathDelimitersToInlines(text: string): RichInline[] {
  const inlines: RichInline[] = []
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('$', cursor)
    if (start < 0) {
      if (cursor < text.length) inlines.push({ type: 'text', text: text.slice(cursor) })
      break
    }
    if (start > cursor) inlines.push({ type: 'text', text: text.slice(cursor, start) })
    const end = text.indexOf('$', start + 1)
    if (end < 0) {
      inlines.push({ type: 'text', text: text.slice(start) })
      break
    }
    const tex = text.slice(start + 1, end).trim()
    if (tex) inlines.push({ type: 'inline_math', tex })
    else inlines.push({ type: 'text', text: text.slice(start, end + 1) })
    cursor = end + 1
  }
  return inlines.filter((inline) => inline.type !== 'text' || inline.text)
}

function paragraphBlock(text: unknown): RichBlock[] {
  const value = String(text ?? '').trim()
  if (!value) return []
  return value.split(/\n{2,}/).map((part) => ({
    type: 'paragraph' as const,
    content: inlineMathDelimitersToInlines(part.trim()),
  })).filter((block) => block.content.length)
}

function normalizeInline(input: unknown): RichInline | null {
  if (!input || typeof input !== 'object') return textInline(input)
  const raw = input as Record<string, unknown>
  if (raw.type === 'inline_math') {
    const tex = String(raw.tex ?? '').trim()
    return tex ? { type: 'inline_math', tex } : null
  }
  const text = String(raw.text ?? raw.content ?? '')
  return text ? { type: 'text', text } : null
}

function normalizeInlines(input: unknown): RichInline[] {
  const source = Array.isArray(input) ? input : [input]
  const output: RichInline[] = []
  for (const item of source) {
    const inline = normalizeInline(item)
    if (!inline) continue
    const expanded = inline.type === 'text' ? inlineMathDelimitersToInlines(inline.text) : [inline]
    for (const part of expanded) {
      const previous = output[output.length - 1]
      if (previous?.type === 'text' && part.type === 'text') previous.text += part.text
      else output.push(part)
    }
  }
  return output.filter((inline) => inline.type !== 'text' || inline.text.trim())
}

function normalizeBlocks(input: unknown): RichBlock[] {
  if (typeof input === 'string') return paragraphBlock(input)
  if (!Array.isArray(input)) return []
  const blocks: RichBlock[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (raw.type === 'paragraph') {
      const content = normalizeInlines(raw.content)
      if (content.length) blocks.push({ type: 'paragraph', content })
    } else if (raw.type === 'display_math') {
      const tex = String(raw.tex ?? '').trim()
      if (tex) blocks.push({ type: 'display_math', tex })
    } else if (raw.type === 'choices') {
      const options = Array.isArray(raw.options) ? raw.options : []
      const normalizedOptions = options.map((option, index) => {
        const row = option && typeof option === 'object' ? option as Record<string, unknown> : {}
        const label = String(row.label || String.fromCharCode(65 + index)).trim().toUpperCase()
        const optionBlocks = normalizeBlocks(row.blocks ?? row.content ?? row.text ?? '')
        return { label, blocks: optionBlocks }
      }).filter((option) => option.label && option.blocks.length)
      if (normalizedOptions.length) blocks.push({ type: 'choices', options: normalizedOptions })
    } else if (raw.type === 'table') {
      const rows = Array.isArray(raw.rows) ? raw.rows : []
      const normalizedRows = rows.map((row) => {
        const source = row && typeof row === 'object' ? row as Record<string, unknown> : {}
        const cells = Array.isArray(source.cells) ? source.cells.map((cell) => normalizeInlines(cell)) : []
        return { header: Boolean(source.header), cells }
      }).filter((row) => row.cells.length)
      if (normalizedRows.length) blocks.push({ type: 'table', rows: normalizedRows })
    }
  }
  return blocks
}

function blocksFromPayload(payload: Record<string, any>, blockKey: string, legacyKey: string): RichBlock[] {
  const blockValue = normalizeBlocks(payload[blockKey])
  if (blockValue.length) return blockValue
  return normalizeBlocks(payload[legacyKey] ?? payload[legacyKey.replace(/_text$/, '')] ?? [])
}

function blocksFromOcrResult(result: Record<string, any>, blockKey: string, legacyKey: string): RichBlock[] {
  const blockValue = normalizeBlocks(result[blockKey])
  if (blockValue.length) return blockValue
  const fallback = stripOcrTemplateNoise(String(result[legacyKey] || '').trim()).trim()
  return normalizeBlocks(fallback)
}

function blockFieldJson(blocks: RichBlock[]) {
  return JSON.stringify(normalizeBlocks(blocks))
}

function inlinePlainText(inlines: RichInline[]) {
  return inlines.map((inline) => inline.type === 'inline_math' ? inline.tex : inline.text).join('')
}

function blocksToPlainText(blocksInput: unknown): string {
  const blocks = normalizeBlocks(blocksInput)
  return blocks.map((block) => {
    if (block.type === 'paragraph') return inlinePlainText(block.content)
    if (block.type === 'display_math') return block.tex
    if (block.type === 'choices') return block.options.map((option) => `${option.label}. ${blocksToPlainText(option.blocks)}`).join('\n')
    if (block.type === 'table') return block.rows.map((row) => row.cells.map(inlinePlainText).join('\t')).join('\n')
    return ''
  }).filter(Boolean).join('\n\n').trim()
}

function inlineMarkdown(inlines: RichInline[]) {
  return inlines.map((inline) => inline.type === 'inline_math' ? `$${inline.tex}$` : inline.text).join('')
}

function blocksToMarkdown(blocksInput: unknown): string {
  const blocks = normalizeBlocks(blocksInput)
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') lines.push(inlineMarkdown(block.content))
    else if (block.type === 'display_math') lines.push(`$$\n${block.tex}\n$$`)
    else if (block.type === 'choices') lines.push(block.options.map((option) => `${option.label}. ${blocksToMarkdown(option.blocks).replace(/\n+/g, ' ').trim()}`).join('\n'))
    else if (block.type === 'table') {
      const rows = block.rows
      const width = Math.max(...rows.map((row) => row.cells.length), 1)
      rows.forEach((row, index) => {
        const cells = Array.from({ length: width }, (_, cellIndex) => inlineMarkdown(row.cells[cellIndex] || []))
        lines.push(`| ${cells.join(' | ')} |`)
        if (index === 0) lines.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`)
      })
    }
  }
  return lines.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim()
}

function latexText(value: string) {
  return String(value || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#%&_$])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function inlineLatex(inlines: RichInline[]) {
  return inlines.map((inline) => inline.type === 'inline_math' ? `$${inline.tex}$` : latexText(inline.text)).join('')
}

function blocksToLatex(blocksInput: unknown): string {
  const blocks = normalizeBlocks(blocksInput)
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') lines.push(inlineLatex(block.content))
    else if (block.type === 'display_math') lines.push(`\\[\n${block.tex}\n\\]`)
    else if (block.type === 'choices') lines.push(block.options.map((option) => `\\textbf{${latexText(option.label)}.} ${blocksToLatex(option.blocks).replace(/\n+/g, ' ').trim()}`).join('\\quad '))
    else if (block.type === 'table') {
      const width = Math.max(...block.rows.map((row) => row.cells.length), 1)
      lines.push(`\\begin{tabular}{${Array.from({ length: width }, () => 'c').join('|')}}`)
      block.rows.forEach((row, index) => {
        lines.push(`${Array.from({ length: width }, (_, cellIndex) => inlineLatex(row.cells[cellIndex] || [])).join(' & ')} \\\\`)
        if (index === 0 && row.header) lines.push('\\hline')
      })
      lines.push('\\end{tabular}')
    }
  }
  return lines.join('\n\n').trim()
}

function validateBlocks(blocksInput: unknown, field = 'blocks'): FormatIssue[] {
  const errors: FormatIssue[] = []
  const visitTex = (tex: string, pathLabel: string, mode: 'inline' | 'display') => {
    const value = String(tex || '').trim()
    if (!value) return
    if (/(^\$|\$$|\\\(|\\\)|\\\[|\\\])/.test(value)) {
      errors.push({ field, code: 'tex_has_delimiters', message: 'TeX 字段不能包含数学定界符。', snippet: value, context: pathLabel, mode })
      return
    }
    try {
      katex.renderToString(value, { displayMode: mode === 'display', throwOnError: true, strict: 'ignore' })
    } catch (error) {
      errors.push({ field, code: 'katex_parse_error', message: error instanceof Error ? error.message : String(error), snippet: value, context: pathLabel, mode })
    }
  }
  const visitBlocks = (blocks: RichBlock[], pathLabel: string) => {
    blocks.forEach((block, index) => {
      const nextPath = `${pathLabel}.${index}`
      if (block.type === 'paragraph') block.content.forEach((inline, inlineIndex) => {
        if (inline.type === 'inline_math') visitTex(inline.tex, `${nextPath}.content.${inlineIndex}`, 'inline')
      })
      else if (block.type === 'display_math') visitTex(block.tex, nextPath, 'display')
      else if (block.type === 'choices') block.options.forEach((option, optionIndex) => visitBlocks(option.blocks, `${nextPath}.options.${optionIndex}.blocks`))
      else if (block.type === 'table') block.rows.forEach((row, rowIndex) => row.cells.forEach((cell, cellIndex) => cell.forEach((inline, inlineIndex) => {
        if (inline.type === 'inline_math') visitTex(inline.tex, `${nextPath}.rows.${rowIndex}.cells.${cellIndex}.${inlineIndex}`, 'inline')
      })))
    })
  }
  visitBlocks(normalizeBlocks(blocksInput), field)
  return errors
}

function buildSearchText(stemMarkdown: string, answerText: string, analysisMarkdown: string, extra: string[] = []) {
  return [stemMarkdown, answerText, analysisMarkdown, ...extra]
    .filter(Boolean)
    .join('\n')
}

function parseTimestampMs(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function renderOcrDraftMarkdown(result: Record<string, any>) {
  const lines = [
    '---',
    `id: ${result.id || ''}`,
    `source_pdf: ${result.source_pdf || ''}`,
    `page: ${result.page || ''}`,
    `question_no: ${result.question_no || ''}`,
    `ocr_status: ${result.ocr_status || 'draft'}`,
    `needs_human_review: ${Boolean(result.needs_human_review)}`,
    '---',
    '',
    '# 题目',
    '',
    String(result.problem_text || '').trim(),
    '',
    '# 答案',
    '',
    String(result.answer || '').trim(),
    '',
    '# 解析',
    '',
    String(result.analysis || '').trim(),
    '',
  ]
  return lines.join('\n')
}

function syncQuestionBankItemToOcrDraft(item: ReturnType<typeof getQuestion> | null) {
  if (!item?.id) return false
  const draftDir = path.join(pythonDataRoot, 'ocr_drafts', item.id)
  const resultPath = path.join(draftDir, 'ocr_result.json')
  if (!fs.existsSync(resultPath)) return false
  const result = parseJson<Record<string, any>>(fs.readFileSync(resultPath, 'utf8'), {})
  const nextResult = {
    ...result,
    id: result.id || item.id,
    question_no: item.questionNo,
    problem_text: item.stemMarkdown,
    answer: item.answerText,
    analysis: item.analysisMarkdown,
    knowledge_points: item.knowledgePoints,
    solution_methods: item.solutionMethods,
    difficulty_score_10: item.difficultyScore10,
    difficulty_label: item.difficultyLabel,
    post_processing: {
      ...(result.post_processing && typeof result.post_processing === 'object' ? result.post_processing : {}),
      question_bank_manual_edit: {
        synced_at: nowIso(),
      },
    },
  }
  fs.writeFileSync(resultPath, JSON.stringify(nextResult, null, 2), 'utf8')
  fs.writeFileSync(path.join(draftDir, 'question.md'), renderOcrDraftMarkdown(nextResult), 'utf8')
  return true
}

function syncRunQuestionBankItemsToOcrDrafts(runId: string) {
  const rows = db.prepare('SELECT id FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as Array<{ id: string }>
  let synced = 0
  for (const row of rows) {
    if (syncQuestionBankItemToOcrDraft(getQuestion(row.id))) synced += 1
  }
  return synced
}

function buildDocumentDiagnosticMessage(diagnostics: Record<string, any>) {
  const docxClassification = diagnostics.docxFormulaAnalysis?.classification
  const graphics = diagnostics.cutDiagnostics?.graphics ?? diagnostics.graphics
  const hiddenCount = Number(graphics?.hidden_inline_formula_images || 0)
  const keptCount = Number(graphics?.kept_figure_candidates || 0)
  const formulaImageDocument = Boolean(graphics?.formula_image_document)

  if (docxClassification === 'image_or_ole_formula') {
    return '检测到 Word 中存在图片/OLE 型公式；切题时会自动隐藏疑似公式图片，只保留更像题图的候选框。'
  }
  if (formulaImageDocument || hiddenCount >= 8) {
    return `检测到 ${hiddenCount} 个疑似图片型公式块，已从题图候选中隐藏；保留 ${keptCount} 个图形候选。`
  }
  if (docxClassification === 'mixed_formula') {
    return '检测到 Word 公式结构混合，建议复核题图候选；系统已优先过滤行内公式图片。'
  }
  return ''
}

function mergeDiagnostics(base: Record<string, any>, next: Record<string, any>) {
  return {
    ...base,
    ...next,
    docxFormulaAnalysis: base.docxFormulaAnalysis,
    cutDiagnostics: next.cutDiagnostics ?? base.cutDiagnostics,
  }
}

// ── PDF Slicer Rules: config management ──────────────────────────────────

function pdfSlicerRulesPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'pdf_slicer_rules.json')
}

function pdfSlicerRulesHistoryDir() {
  const configDir = path.join(storageRoot, 'config', 'pdf_slicer_rules_history')
  fs.mkdirSync(configDir, { recursive: true })
  return configDir
}

function defaultPdfSlicerRules(): SlicerRulesData {
  return {
    version: 1,
    auxiliaryMarkers: [
      { id: 'aux_mulu', term: '目录', matchMode: 'contains', enabled: true },
      { id: 'aux_jietiguilv', term: '解题规律', matchMode: 'contains', enabled: true },
      { id: 'aux_tifenkuaizhao', term: '提分快招', matchMode: 'contains', enabled: true },
      { id: 'aux_tixingguina', term: '题型归纳', matchMode: 'contains', enabled: true },
      { id: 'aux_tixingtanxi', term: '题型探析', matchMode: 'contains', enabled: true },
      { id: 'aux_siweidaotu', term: '思维导图', matchMode: 'contains', enabled: true },
      { id: 'aux_zhishidian', term: '知识点', matchMode: 'contains', enabled: true },
      { id: 'aux_guilvfangfa', term: '规律方法', matchMode: 'contains', enabled: true },
      { id: 'aux_fangfajiqiao', term: '方法技巧', matchMode: 'contains', enabled: true },
    ],
    noticeTerms: [
      { id: 'notice_dati', term: '答题', matchMode: 'contains', enabled: true },
      { id: 'notice_zhuyishixiang', term: '注意事项', matchMode: 'contains', enabled: true },
      { id: 'notice_zuoda', term: '作答', matchMode: 'contains', enabled: true },
      { id: 'notice_kaoshijieshu', term: '考试结束', matchMode: 'contains', enabled: true },
      { id: 'notice_dajuanqian', term: '答卷前', matchMode: 'contains', enabled: true },
      { id: 'notice_dabunengda', term: '答案不能答在试卷上', matchMode: 'contains', enabled: true },
    ],
    referenceFormulaMarkers: [
      { id: 'ref_cankaogongshi', term: '参考公式', matchMode: 'contains', enabled: true },
      { id: 'ref_cankaoguanxishi', term: '参考关系式', matchMode: 'contains', enabled: true },
      { id: 'ref_cankaoshuju', term: '参考数据', matchMode: 'contains', enabled: true },
    ],
    trainingMarkers: [
      { id: 'tr_dianlixunlian', term: '【典例训练】', matchMode: 'contains', enabled: true },
      { id: 'tr_liti', term: '【例题】', matchMode: 'contains', enabled: true },
      { id: 'tr_jiedati', term: '一、解答题', matchMode: 'contains', enabled: true },
      { id: 'tr_danxuanti', term: '一、单选题', matchMode: 'contains', enabled: true },
      { id: 'tr_xuanzeti', term: '一、选择题', matchMode: 'contains', enabled: true },
      { id: 'tr_tiankongti', term: '二、填空题', matchMode: 'contains', enabled: true },
      { id: 'tr_duoxuanti_1', term: '三、多选题', matchMode: 'contains', enabled: true },
      { id: 'tr_duoxuanti_2', term: '二、多选题', matchMode: 'contains', enabled: true },
    ],
    nonQuestionRemainders: [
      { id: 'nqr_qitalleixing', term: '其他类型', matchMode: 'contains', enabled: true },
      { id: 'nqr_changjianleixing', term: '常见类型', matchMode: 'contains', enabled: true },
      { id: 'nqr_fangfazongjie', term: '方法总结', matchMode: 'contains', enabled: true },
      { id: 'nqr_guilvzongjie', term: '规律总结', matchMode: 'contains', enabled: true },
    ],
    sectionMarkers: [
      { id: 'sec_tixing', term: '题型', matchMode: 'contains', enabled: true },
      { id: 'sec_jietiguilv', term: '【解题规律', matchMode: 'contains', enabled: true },
      { id: 'sec_dianlixunlian', term: '【典例训练】', matchMode: 'contains', enabled: true },
      { id: 'sec_mulu', term: '目录', matchMode: 'contains', enabled: true },
      { id: 'sec_tixingguina', term: '题型归纳', matchMode: 'contains', enabled: true },
      { id: 'sec_tixingtanxi', term: '题型探析', matchMode: 'contains', enabled: true },
    ],
  }
}

function readPdfSlicerRules(): SlicerRulesData {
  const rulesPath = pdfSlicerRulesPath()
  if (!fs.existsSync(rulesPath)) {
    const defaults = defaultPdfSlicerRules()
    try {
      fs.writeFileSync(rulesPath, JSON.stringify(defaults, null, 2), 'utf8')
    } catch {
      console.warn('[pdf-slicer-rules] failed to write default rules file')
    }
    return defaults
  }
  try {
    const raw = fs.readFileSync(rulesPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('[pdf-slicer-rules] rules file is not an object, using defaults')
      return defaultPdfSlicerRules()
    }
    return parsed as SlicerRulesData
  } catch (error) {
    console.warn('[pdf-slicer-rules] failed to parse rules file, using defaults:', error)
    return defaultPdfSlicerRules()
  }
}

function validatePdfSlicerRules(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!data || typeof data !== 'object') {
    errors.push('规则数据必须是一个 JSON 对象')
    return { valid: false, errors }
  }
  const obj = data as Record<string, unknown>
  if (typeof obj.version !== 'number') errors.push('缺少 version 字段')
  for (const category of SLICER_RULES_CATEGORIES) {
    const entries = obj[category]
    if (!Array.isArray(entries)) {
      errors.push(`${category} 必须是数组`)
      continue
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry || typeof entry !== 'object') {
        errors.push(`${category}[${i}]: 必须是对象`)
        continue
      }
      const e = entry as Record<string, unknown>
      if (!e.id || typeof e.id !== 'string') errors.push(`${category}[${i}]: 缺少 id`)
      if (!e.term || typeof e.term !== 'string') errors.push(`${category}[${i}]: 缺少 term`)
      if (String(e.term || '').trim() === '') errors.push(`${category}[${i}]: term 不能为空`)
      if (e.matchMode && !VALID_MATCH_MODES.includes(String(e.matchMode))) {
        errors.push(`${category}[${i}]: matchMode 必须为 contains 或 exact，实际为 '${e.matchMode}'`)
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

function computeJsonHash(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16)
}

function takePdfSlicerRulesSnapshot(data: SlicerRulesData, version: number) {
  const historyDir = pdfSlicerRulesHistoryDir()
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  fs.writeFileSync(
    path.join(historyDir, `rules_v${version}_${timestamp}.json`),
    JSON.stringify({ ...data, snapshotVersion: version, timestamp: new Date().toISOString() }, null, 2),
    'utf8',
  )
}

function writePdfSlicerRules(data: SlicerRulesData, baseVersion: number): SlicerRulesData & { baseVersion: number; hash: string } {
  takePdfSlicerRulesSnapshot(data, baseVersion)
  const nextVersion = baseVersion + 1
  const payload: SlicerRulesData = { ...data, version: nextVersion }
  const hash = computeJsonHash(payload)
  // Atomic write: write to temp file then rename
  const rulesPath = pdfSlicerRulesPath()
  const tmpPath = rulesPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmpPath, rulesPath)
  return { ...payload, baseVersion: nextVersion, hash }
}

function listPdfSlicerRulesHistory(): Array<{ version: number; timestamp: string; hash: string }> {
  const historyDir = pdfSlicerRulesHistoryDir()
  if (!fs.existsSync(historyDir)) return []
  const entries: Array<{ version: number; timestamp: string; hash: string }> = []
  for (const f of fs.readdirSync(historyDir).filter((f) => f.endsWith('.json'))) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf8')) as Record<string, unknown>
      entries.push({
        version: Number(payload.snapshotVersion || 0),
        timestamp: String(payload.timestamp || ''),
        hash: computeJsonHash(payload),
      })
    } catch {
      // skip unreadable snapshot
    }
  }
  return entries.sort((a, b) => b.version - a.version)
}

function normalizeTags(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、;/；\n]+/) : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of raw) {
    const tag = String(item || '').replace(/\s+/g, ' ').trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags.slice(0, 8)
}

function uniqueTags(values: unknown[]) {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of values) {
    const tag = String(item || '').replace(/\s+/g, ' ').trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

function tagLibraryType(value: unknown) {
  return String(value) === 'method_tag' ? 'method_tag' : 'knowledge_point'
}

function safeTagLibraryCode(value: unknown, fallback = 'custom_library') {
  const raw = String(value || '').trim().toLowerCase()
  return (raw.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || fallback).slice(0, 96)
}

function tagLibraryFilePath(code: string) {
  return path.join(tagLibrariesDir, `${safeTagLibraryCode(code)}.json`)
}

function normalizeLearningTagLibrary(rawValue: unknown, fallbackCode = 'learning_tag_library') {
  const raw = rawValue as Record<string, any>
  const libraryType = tagLibraryType(raw?.libraryType)
  const code = safeTagLibraryCode(raw?.code, fallbackCode)
  const sections = libraryType === 'method_tag'
    ? (Array.isArray(raw?.groups) ? raw.groups : Array.isArray(raw?.chapters) ? raw.chapters : [])
    : (Array.isArray(raw?.chapters) ? raw.chapters : Array.isArray(raw?.groups) ? raw.groups : [])
  return {
    id: code,
    code,
    name: String(raw?.name || code),
    subject: String(raw?.subject || '数学'),
    stage: String(raw?.stage || 'high_school'),
    locale: String(raw?.locale || 'zh-CN'),
    version: String(raw?.version || '1.0.0'),
    source: String(raw?.source || 'local-edit'),
    libraryType,
    baseKnowledgeLibraryId: raw?.baseKnowledgeLibraryId ? String(raw.baseKnowledgeLibraryId) : undefined,
    baseKnowledgeLibraryCode: raw?.baseKnowledgeLibraryCode ? String(raw.baseKnowledgeLibraryCode) : undefined,
    baseKnowledgeLibraryName: raw?.baseKnowledgeLibraryName ? String(raw.baseKnowledgeLibraryName) : undefined,
    isDefault: libraryType === 'knowledge_point' && Boolean(raw?.isDefault),
    chapters: sections.map((section: any, sectionIndex: number) => {
      const points = libraryType === 'method_tag'
        ? (Array.isArray(section?.tags) ? section.tags : Array.isArray(section?.knowledgePoints) ? section.knowledgePoints : [])
        : (Array.isArray(section?.knowledgePoints) ? section.knowledgePoints : Array.isArray(section?.tags) ? section.tags : [])
      const sectionCode = String(section?.code || `${libraryType === 'method_tag' ? 'MG' : 'CH'}_${sectionIndex + 1}`)
      return {
        id: sectionCode,
        code: sectionCode,
        name: String(section?.name || `分组 ${sectionIndex + 1}`),
        sortOrder: Number(section?.sortOrder || sectionIndex + 1),
        knowledgePoints: points.map((point: any, pointIndex: number) => {
          const pointCode = String(point?.code || `${libraryType === 'method_tag' ? 'MT' : 'KP'}_${sectionIndex + 1}_${pointIndex + 1}`)
          return {
            id: pointCode,
            code: pointCode,
            name: String(point?.name || `标签 ${pointIndex + 1}`),
            description: point?.description ? String(point.description) : undefined,
            tagType: point?.tagType ? String(point.tagType) : libraryType === 'method_tag' ? 'method' : 'knowledge',
            appliesTo: Array.isArray(point?.appliesTo) ? point.appliesTo.map((item: unknown) => String(item)).filter(Boolean) : undefined,
            sortOrder: Number(point?.sortOrder || pointIndex + 1),
          }
        }),
      }
    }),
  }
}

function serializeLearningTagLibrary(library: ReturnType<typeof normalizeLearningTagLibrary>) {
  const base = {
    code: library.code,
    name: library.name,
    subject: library.subject,
    stage: library.stage,
    locale: library.locale,
    version: library.version,
    source: library.source,
    libraryType: library.libraryType,
  }
  if (library.libraryType === 'method_tag') {
    return {
      ...base,
      baseKnowledgeLibraryCode: library.baseKnowledgeLibraryCode,
      groups: library.chapters.map((chapter) => ({
        code: chapter.code,
        name: chapter.name,
        sortOrder: chapter.sortOrder,
        tags: chapter.knowledgePoints.map((point: any) => ({
          code: point.code,
          name: point.name,
          description: point.description,
          tagType: point.tagType || 'method',
          appliesTo: point.appliesTo,
          sortOrder: point.sortOrder,
        })),
      })),
    }
  }
  return {
    ...base,
    isDefault: Boolean(library.isDefault),
    chapters: library.chapters.map((chapter) => ({
      code: chapter.code,
      name: chapter.name,
      sortOrder: chapter.sortOrder,
      knowledgePoints: chapter.knowledgePoints.map((point: any) => ({
        code: point.code,
        name: point.name,
        description: point.description,
        tagType: point.tagType || 'knowledge',
        sortOrder: point.sortOrder,
      })),
    })),
  }
}

function validateLearningTagLibrary(library: ReturnType<typeof normalizeLearningTagLibrary>) {
  if (!library.code || !library.name || !library.subject || !library.stage) return '标签库 code、名称、科目、阶段不能为空。'
  if (!library.chapters.length) return library.libraryType === 'method_tag' ? '至少需要一个分组。' : '至少需要一个章节。'
  for (const [chapterIndex, chapter] of library.chapters.entries()) {
    if (!chapter.code || !chapter.name) return `第 ${chapterIndex + 1} 个${library.libraryType === 'method_tag' ? '分组' : '章节'}缺少 code 或名称。`
    if (!chapter.knowledgePoints.length) return `「${chapter.name}」至少需要一个标签。`
    for (const [pointIndex, point] of chapter.knowledgePoints.entries()) {
      if (!point.code || !point.name) return `「${chapter.name}」的第 ${pointIndex + 1} 个标签缺少 code 或名称。`
    }
  }
  return ''
}

function readLearningTagLibraries() {
  const files = fs.readdirSync(tagLibrariesDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
    .sort()
  const libraries = files.flatMap((fileName) => {
    const filePath = path.join(tagLibrariesDir, fileName)
    const payload = parseJson<unknown>(fs.readFileSync(filePath, 'utf8'), null)
    if (!payload) return []
    const values = Array.isArray(payload) ? payload : [payload]
    return values.map((value, index) => normalizeLearningTagLibrary(value, path.basename(fileName, '.json') || `library_${index + 1}`))
  })
  return libraries.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, 'zh-CN'))
}

function writeLearningTagLibrary(rawPayload: unknown) {
  const library = normalizeLearningTagLibrary(rawPayload)
  const error = validateLearningTagLibrary(library)
  if (error) throw new Error(error)
  if (library.isDefault && library.libraryType === 'knowledge_point') {
    for (const existing of readLearningTagLibraries()) {
      if (existing.code === library.code || existing.libraryType !== 'knowledge_point' || !existing.isDefault) continue
      const existingPath = tagLibraryFilePath(existing.code)
      if (fs.existsSync(existingPath)) {
        fs.writeFileSync(existingPath, `${JSON.stringify(serializeLearningTagLibrary({ ...existing, isDefault: false }), null, 2)}\n`)
      }
    }
  }
  fs.writeFileSync(tagLibraryFilePath(library.code), `${JSON.stringify(serializeLearningTagLibrary(library), null, 2)}\n`)
  return normalizeLearningTagLibrary(serializeLearningTagLibrary(library))
}

function readTagLibraries() {
  const libraries = readLearningTagLibraries()
  const libraryKnowledgePoints = libraries.filter((library) => library.libraryType === 'knowledge_point').flatMap((library) =>
    library.chapters.flatMap((chapter) => chapter.knowledgePoints.map((item: any) => item.name).filter(Boolean))
  )
  const librarySolutionMethods = libraries.filter((library) => library.libraryType === 'method_tag').flatMap((library) =>
    library.chapters.flatMap((chapter) => chapter.knowledgePoints.map((item: any) => item.name).filter(Boolean))
  )
  const existingRows = db.prepare(`
    SELECT stage, question_type, knowledge_points_json, solution_methods_json
    FROM question_bank_items
    WHERE stage != '' OR question_type != '' OR knowledge_points_json != '[]' OR solution_methods_json != '[]'
  `).all() as Array<Pick<QuestionRow, 'stage' | 'question_type' | 'knowledge_points_json' | 'solution_methods_json'>>
  const existingKnowledgePoints = existingRows.flatMap((row) => parseJson<string[]>(row.knowledge_points_json || '[]', []))
  const existingSolutionMethods = existingRows.flatMap((row) => parseJson<string[]>(row.solution_methods_json || '[]', []))
  const existingStages = existingRows.map((row) => row.stage).filter(Boolean)
  const existingQuestionTypes = existingRows.map((row) => normalizeQuestionType(row.question_type)).filter(Boolean)
  const knowledgePoints = uniqueTags([...libraryKnowledgePoints, ...existingKnowledgePoints])
  const solutionMethods = uniqueTags([...librarySolutionMethods, ...existingSolutionMethods])
  return {
    knowledgePoints,
    solutionMethods,
    stages: uniqueTags([...configuredGradeStages(), ...existingStages]),
    questionTypes: uniqueTags(['单选题', '多选题', '填空题', '解答题', ...existingQuestionTypes]),
    difficultyLabels: ['基础', '中等', '较难', '压轴'],
  }
}

function difficultyLabel10(score: number) {
  if (!score) return ''
  if (score <= 3) return '基础'
  if (score <= 6) return '中等'
  if (score <= 8) return '较难'
  return '压轴'
}

function normalizeDifficultyScore10(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(parsed, 10))
}

function stripAssetPrefix(value: string) {
  return value.replace(/^question_assets\//, '').replace(/^\/+/, '')
}

const templateWatermarkPattern = /(学科网|zxxk|原创精品资源|独家享有版权|侵权必究|帮课堂.*学与练)/i
const standalonePageNumberPattern = /^\s*\d{1,3}\s*$/
const semanticExerciseLabelPattern = /^\s*(?:[【［\[]\s*)?(?:第\s*)?(?:典例|例题|变式|即学即练|即学即练习|课堂练习|限时训练|课后训练|巩固训练|能力提升)\s*(?:\d+|[一二三四五六七八九十]+)?(?:\s*[-—–_·：:、.．]\s*(?:\d+|[一二三四五六七八九十]+))?\s*(?:题)?\s*(?:[】］\]]\s*)?/u
const semanticQuestionNoPattern = /^\s*(?:第\s*)?(?:典例|例题|变式|即学即练|即学即练习|课堂练习|限时训练|课后训练|巩固训练|能力提升)\s*((?:\d+|[一二三四五六七八九十]+)(?:\s*[-—–_]\s*(?:\d+|[一二三四五六七八九十]+))?)\s*(?:题)?\s*$/u

function stripSemanticExerciseLabel(value: string) {
  return String(value || '').replace(semanticExerciseLabelPattern, '').trimStart()
}

function cleanQuestionNoLabel(value: string) {
  const raw = String(value || '').trim()
  const semanticMatch = raw.match(semanticQuestionNoPattern)
  if (semanticMatch?.[1]) return semanticMatch[1].replace(/\s+/g, '')
  const cleaned = stripSemanticExerciseLabel(raw).replace(/^\s*第\s*/, '').replace(/\s*题\s*$/u, '').trim()
  return cleaned || raw
}

function stripOcrTemplateNoise(value: string) {
  const lines = stripSemanticExerciseLabel(String(value || '')).split(/\r?\n/)
  const watermarkIndexes = new Set<number>()
  lines.forEach((line, index) => {
    const compact = line.replace(/\s+/g, '')
    if (templateWatermarkPattern.test(compact)) watermarkIndexes.add(index)
  })
  if (!watermarkIndexes.size) return lines.join('\n')
  return lines
    .filter((line, index) => {
      if (watermarkIndexes.has(index)) return false
      if (standalonePageNumberPattern.test(line) && (watermarkIndexes.has(index - 1) || watermarkIndexes.has(index + 1))) return false
      return true
    })
    .join('\n')
}

function cleanSourceTitle(value: string, fallback = '来源待补充') {
  const raw = stripAssetPrefix(String(value || '').trim())
  if (!raw) return fallback
  return normalizeUploadName(path.basename(raw)).replace(/\.[^.]+$/, '') || fallback
}

function normalizeMaterialType(value: unknown): MaterialType {
  return ['exam', 'lecture', 'unknown'].includes(String(value)) ? String(value) as MaterialType : 'unknown'
}

function normalizeFileRole(value: unknown): FileRole {
  return ['full', 'questions', 'solutions', 'unknown'].includes(String(value)) ? String(value) as FileRole : 'unknown'
}

function normalizeWorkflowMode(value: unknown): WorkflowMode {
  return String(value) === 'separated_exam' ? 'separated_exam' : 'single'
}

function normalizeWorkflowStatus(value: unknown): WorkflowStatus {
  return ['ready', 'needs_classification', 'processing', 'ready_for_bank', 'needs_review'].includes(String(value)) ? String(value) as WorkflowStatus : 'ready'
}

function materialTypeLabelForReason(value: MaterialType) {
  return value === 'exam' ? '试卷' : value === 'lecture' ? '讲义' : '未确认'
}

function fileRoleLabelForReason(value: FileRole) {
  if (value === 'questions') return '原卷'
  if (value === 'solutions') return '解析文件'
  if (value === 'full') return '解析版一体'
  return '未确认'
}

function extractPdfTextSample(pdfPath: string) {
  if (!fs.existsSync(pdfPath) || path.extname(pdfPath).toLowerCase() !== '.pdf') return ''
  try {
    return execFileSync(pythonCommand(), ['-c', [
      'import sys, fitz',
      'p=sys.argv[1]',
      'doc=fitz.open(p)',
      'parts=[]',
      'limit=min(len(doc), 3)',
      'for i in range(limit): parts.append(doc[i].get_text("text")[:2500])',
      'print("\\n".join(parts)[:6000])',
    ].join('\n'), pdfPath], { encoding: 'utf8', timeout: 8000, maxBuffer: 1024 * 1024 }).trim()
  } catch {
    return ''
  }
}

function classifyUploadedDocument(input: { fileName: string; textSample?: string }) {
  const fileName = normalizeUploadName(input.fileName)
  const compactName = fileName.replace(/\s+/g, '')
  const text = `${compactName}\n${String(input.textSample || '').replace(/\s+/g, '')}`
  const reasons: string[] = []
  let materialType: MaterialType = 'unknown'
  let fileRole: FileRole = 'unknown'
  let confidence = 0.45

  const hasLecture = /(讲义|专题|题型|例题|变式|即学即练|限时训练|课后训练|课堂|学案|导学案)/.test(text)
  const hasExam = /(试卷|试题|考试|联考|月考|期中|期末|模拟|真题|调研|质量检测|高考)/.test(text)
  const hasQuestionsOnly = /(原卷|学生版|无答案|试题版|试卷版)/.test(text)
  const hasSolutionOnly = /(参考答案|答案解析|答案详解|试题答案|详解答案|^答案|答案$|详解$)/.test(compactName) || (/答案/.test(compactName) && !/解析版|精品解析/.test(compactName))
  const hasFullAnalysis = /(解析版|精品解析|含解析|带解析)/.test(text)

  if (hasLecture) {
    materialType = 'lecture'
    fileRole = 'full'
    confidence = 0.86
    reasons.push('检测到讲义/专题/例题/训练等讲义特征')
  }
  if (hasExam || hasQuestionsOnly || hasSolutionOnly || hasFullAnalysis) {
    materialType = 'exam'
    confidence = Math.max(confidence, 0.78)
    if (hasExam) reasons.push('检测到试卷/考试/真题/模拟等试卷特征')
  }
  if (materialType === 'exam') {
    if (hasQuestionsOnly) {
      fileRole = 'questions'
      confidence = Math.max(confidence, 0.9)
      reasons.push('检测到原卷/学生版/无答案特征')
    } else if (hasSolutionOnly) {
      fileRole = 'solutions'
      confidence = Math.max(confidence, 0.86)
      reasons.push('检测到答案/参考答案/详解特征')
    } else if (hasFullAnalysis) {
      fileRole = 'full'
      confidence = Math.max(confidence, 0.86)
      reasons.push('检测到解析版/含解析特征，按题目+解析一体处理')
    } else {
      fileRole = 'full'
      reasons.push('未检测到原卷或单独解析特征，按完整试卷处理')
    }
  }
  if (materialType === 'unknown') {
    fileRole = 'full'
    reasons.push('未检测到稳定资料类型，按单文件完整资料处理')
  }
  return { materialType, fileRole, confidence, reasons }
}

function normalizedQuestionNo(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const compact = raw
    .replace(/[第题\s]/g, '')
    .replace(/[.．、:：）)]$/g, '')
    .replace(/^[（(]/, '')
  const numberMatch = compact.match(/\d{1,3}/)
  return numberMatch ? String(Number(numberMatch[0])) : compact.toUpperCase()
}

function normalizeUploadName(originalName: string) {
  const decoded = Buffer.from(originalName, 'latin1').toString('utf8')
  return /[\u00c0-\u00ff]/.test(originalName) && /[\u4e00-\u9fff]/.test(decoded) ? decoded : originalName
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function ensureSchema() {
  const questionColumns = db.prepare("PRAGMA table_info(question_bank_items)").all() as Array<{ name: string }>
  if (questionColumns.length && !questionColumns.some((item) => item.name === 'stem_markdown')) {
    db.exec(`
      DROP TABLE IF EXISTS question_bank_collection_items;
      DROP TABLE IF EXISTS question_bank_items;
      DROP TABLE IF EXISTS pdf_slicer_solution_items;
    `)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pdf_slicer_batches (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      material_type TEXT NOT NULL DEFAULT 'unknown',
      workflow_mode TEXT NOT NULL DEFAULT 'single',
      workflow_status TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL,
      uploaded_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pdf_slicer_runs (
      run_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      upload_mode TEXT NOT NULL DEFAULT 'single_pdf',
      paper_title TEXT NOT NULL DEFAULT '',
      pdf_name TEXT NOT NULL,
      pdf_path TEXT NOT NULL,
      source_file_name TEXT NOT NULL DEFAULT '',
      source_file_kind TEXT NOT NULL DEFAULT 'pdf',
      material_type TEXT NOT NULL DEFAULT 'unknown',
      file_role TEXT NOT NULL DEFAULT 'full',
      stage TEXT NOT NULL DEFAULT '高三',
      classification_confidence REAL NOT NULL DEFAULT 0,
      classification_reasons_json TEXT NOT NULL DEFAULT '[]',
      run_dir TEXT NOT NULL,
      document_diagnostics_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      slice_status TEXT NOT NULL,
      slice_error TEXT NOT NULL DEFAULT '',
      quick_review_status TEXT NOT NULL DEFAULT 'pending',
      total_questions INTEGER NOT NULL DEFAULT 0,
      approved_questions INTEGER NOT NULL DEFAULT 0,
      unreviewed_questions INTEGER NOT NULL DEFAULT 0,
      ocr_status TEXT NOT NULL,
      ocr_error TEXT NOT NULL DEFAULT '',
      ocr_started_at TEXT NOT NULL DEFAULT '',
      ocr_finished_at TEXT NOT NULL DEFAULT '',
      ocr_provider TEXT NOT NULL DEFAULT '',
      ocr_external_uid TEXT NOT NULL DEFAULT '',
      ocr_provider_phase TEXT NOT NULL DEFAULT '',
      ocr_provider_progress INTEGER NOT NULL DEFAULT 0,
      ocr_provider_result_path TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (batch_id) REFERENCES pdf_slicer_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_bank_items (
      id TEXT PRIMARY KEY,
      serial_no INTEGER NOT NULL,
      question_no TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '高三',
      question_type TEXT NOT NULL DEFAULT '',
      difficulty_score INTEGER NOT NULL DEFAULT 0,
      difficulty_score_10 INTEGER NOT NULL DEFAULT 0,
      difficulty_label TEXT NOT NULL DEFAULT '',
      chapter TEXT NOT NULL DEFAULT '',
      knowledge_points_json TEXT NOT NULL DEFAULT '[]',
      solution_methods_json TEXT NOT NULL DEFAULT '[]',
      source_title TEXT NOT NULL DEFAULT '',
      bank_status TEXT NOT NULL DEFAULT 'ready',
      stem_markdown TEXT NOT NULL DEFAULT '',
      answer_text TEXT NOT NULL DEFAULT '',
      analysis_markdown TEXT NOT NULL DEFAULT '',
      search_text TEXT NOT NULL DEFAULT '',
      slice_image_path TEXT NOT NULL DEFAULT '',
      figures_json TEXT NOT NULL DEFAULT '[]',
      source_run_id TEXT NOT NULL DEFAULT '',
      source_solution_run_id TEXT NOT NULL DEFAULT '',
      merge_status TEXT NOT NULL DEFAULT '',
      merge_note TEXT NOT NULL DEFAULT '',
      format_review_required INTEGER NOT NULL DEFAULT 0,
      format_review_reasons_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pdf_slicer_solution_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      question_no TEXT NOT NULL DEFAULT '',
      answer_text TEXT NOT NULL DEFAULT '',
      analysis_markdown TEXT NOT NULL DEFAULT '',
      figures_json TEXT NOT NULL DEFAULT '[]',
      source_image_path TEXT NOT NULL DEFAULT '',
      match_status TEXT NOT NULL DEFAULT 'pending',
      matched_question_id TEXT NOT NULL DEFAULT '',
      match_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES pdf_slicer_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (source_run_id) REFERENCES pdf_slicer_runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pdf_slicer_review_items (
      result_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      question_label TEXT NOT NULL,
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      page_image_path TEXT NOT NULL DEFAULT '',
      auto_image_path TEXT NOT NULL DEFAULT '',
      bbox_json TEXT NOT NULL DEFAULT '{}',
      segments_json TEXT NOT NULL DEFAULT '[]',
      text_regions_json TEXT NOT NULL DEFAULT '[]',
      figures_json TEXT NOT NULL DEFAULT '[]',
      review_status TEXT NOT NULL DEFAULT 'pending_review',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pdf_slicer_runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_bank_collections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_bank_collection_items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(collection_id, question_id),
      FOREIGN KEY (collection_id) REFERENCES question_bank_collections(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES question_bank_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_bank_export_records (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      collection_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT '',
      variant TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL DEFAULT '[]',
      content_length INTEGER NOT NULL DEFAULT 0,
      question_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'succeeded',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON pdf_slicer_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_ocr_status ON pdf_slicer_runs(ocr_status);
    CREATE INDEX IF NOT EXISTS idx_qb_updated_at ON question_bank_items(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_review_run ON pdf_slicer_review_items(run_id, result_id);
    CREATE INDEX IF NOT EXISTS idx_qb_export_records_created_at ON question_bank_export_records(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_qb_export_records_collection ON question_bank_export_records(collection_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_qb_export_records_run ON question_bank_export_records(run_id, created_at DESC);
  `)

  ensureColumn('pdf_slicer_runs', 'paper_title', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_batches', 'title', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_batches', 'material_type', "TEXT NOT NULL DEFAULT 'unknown'")
  ensureColumn('pdf_slicer_batches', 'workflow_mode', "TEXT NOT NULL DEFAULT 'single'")
  ensureColumn('pdf_slicer_batches', 'workflow_status', "TEXT NOT NULL DEFAULT 'ready'")
  ensureColumn('pdf_slicer_runs', 'material_type', "TEXT NOT NULL DEFAULT 'unknown'")
  ensureColumn('pdf_slicer_runs', 'file_role', "TEXT NOT NULL DEFAULT 'full'")
  ensureColumn('pdf_slicer_runs', 'stage', "TEXT NOT NULL DEFAULT '高三'")
  ensureColumn('pdf_slicer_runs', 'classification_confidence', "REAL NOT NULL DEFAULT 0")
  ensureColumn('pdf_slicer_runs', 'classification_reasons_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('pdf_slicer_runs', 'document_diagnostics_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('pdf_slicer_runs', 'ocr_provider', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'ocr_external_uid', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'ocr_provider_phase', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'ocr_provider_progress', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('pdf_slicer_runs', 'ocr_provider_result_path', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'rules_version', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('pdf_slicer_runs', 'rules_hash', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'rules_fallback_used', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('pdf_slicer_runs', 'rules_warnings_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('question_bank_items', 'knowledge_points_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('question_bank_items', 'solution_methods_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('question_bank_items', 'difficulty_score_10', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('question_bank_items', 'difficulty_label', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'format_review_required', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('question_bank_items', 'format_review_reasons_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('question_bank_items', 'source_solution_run_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'merge_status', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'merge_note', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'stem_markdown', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'answer_text', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'analysis_markdown', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'search_text', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_solution_items', 'answer_text', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_solution_items', 'analysis_markdown', "TEXT NOT NULL DEFAULT ''")
  db.exec('CREATE INDEX IF NOT EXISTS idx_qb_format_review ON question_bank_items(format_review_required, updated_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_solution_items_batch ON pdf_slicer_solution_items(batch_id, source_run_id, question_no)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_solution_items_status ON pdf_slicer_solution_items(match_status, updated_at DESC)')
  ensureColumn('question_bank_collections', 'subtitle', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_collections', 'kind', "TEXT NOT NULL DEFAULT 'paper'")
  ensureColumn('question_bank_collections', 'status', "TEXT NOT NULL DEFAULT 'draft'")
  ensureColumn('question_bank_collections', 'total_score', "REAL NOT NULL DEFAULT 0")
  ensureColumn('question_bank_collections', 'time_limit', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('question_bank_collections', 'export_format', "TEXT NOT NULL DEFAULT 'markdown'")
  ensureColumn('question_bank_export_records', 'items_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('question_bank_collection_items', 'score', "REAL NOT NULL DEFAULT 0")
  ensureColumn('question_bank_collection_items', 'section_name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_review_items', 'segments_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('pdf_slicer_review_items', 'text_regions_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('pdf_slicer_review_items', 'figures_json', "TEXT NOT NULL DEFAULT '[]'")
  db.prepare("UPDATE pdf_slicer_runs SET paper_title = pdf_name WHERE TRIM(paper_title) = ''").run()
  db.prepare("UPDATE pdf_slicer_batches SET title = id WHERE TRIM(title) = ''").run()
  db.prepare(`
    UPDATE question_bank_items
    SET source_title = COALESCE(
      (SELECT NULLIF(paper_title, '') FROM pdf_slicer_runs WHERE run_id = question_bank_items.source_run_id),
      source_title
    )
    WHERE source_run_id != ''
  `).run()
  backfillExportRecordFileSizes()
  clearMismatchedExportRecordItems()
  backfillExportRecordItems()

  if (!db.prepare('SELECT id FROM question_bank_collections WHERE id = ?').get('basket')) {
    const now = nowIso()
    db.prepare(`
      INSERT INTO question_bank_collections
        (id, title, subtitle, description, kind, status, total_score, time_limit, export_format, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('basket', '试题篮', '', '默认试题篮', 'basket', 'draft', 0, 0, 'markdown', now, now)
  } else {
    db.prepare("UPDATE question_bank_collections SET kind = 'basket', title = COALESCE(NULLIF(title, ''), '试题篮') WHERE id = 'basket'").run()
  }
}

function backfillDoc2xFigureAssets() {
  const rows = db.prepare("SELECT id, figures_json FROM question_bank_items WHERE figures_json LIKE '%doc2x_v3%'").all() as Array<{ id: string; figures_json: string }>
  for (const row of rows) {
    const draftPath = path.join(pythonDataRoot, 'ocr_drafts', row.id, 'ocr_result.json')
    if (!fs.existsSync(draftPath)) continue
    const draft = parseJson<Record<string, any>>(fs.readFileSync(draftPath, 'utf8'), {})
    const figures = Array.isArray(draft.figures) ? draft.figures : []
    const directAssets = figures.filter((figure) => {
      if (!figure || figure.origin !== 'doc2x_v3' || !figure.path) return false
      return fs.existsSync(resolveStoragePath(stripAssetPrefix(String(figure.path))))
    })
    if (!directAssets.length) continue
    const normalizedAssets = directAssets.map((figure) => {
      const usage = String(figure.usage || figure.category || 'stem') === 'question' ? 'stem' : String(figure.usage || figure.category || 'stem')
      return { ...figure, usage, category: String(figure.category || (usage === 'stem' ? 'question' : usage)) }
    })
    const current = parseJson<Array<Record<string, any>>>(row.figures_json, [])
    const currentPaths = current.map((figure) => String(figure.path || '')).join('|')
    const nextPaths = normalizedAssets.map((figure) => `${String(figure.path || '')}:${String(figure.usage || '')}`).join('|')
    const currentWithUsage = current.map((figure) => `${String(figure.path || '')}:${String(figure.usage || '')}`).join('|')
    if (currentPaths === nextPaths || currentWithUsage === nextPaths) continue
    db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(normalizedAssets), nowIso(), row.id)
  }
}

function doc2xInlineFigureMarkdown(content: string, figures: Array<Record<string, any>>) {
  let nextFigure = 0
  const mediaPair = /<!--\s*Media\s*-->\s*(?:<!--\s*Media\s*-->\s*)+/gi
  const withMarkers = String(content || '').replace(mediaPair, () => {
    const figure = figures[nextFigure++]
    const id = String(figure?.blockId || figure?.id || '')
    return id ? `\n\n<!-- DOC2X_FIGURE:${id} -->\n\n` : ''
  })
  return withMarkers.replace(/<!--\s*Media\s*-->/gi, '').replace(/\n{3,}/g, '\n\n').trim()
}

// Older Doc2X drafts removed expiring <img> URLs but left the paired Media
// comments behind. Reconnect those placeholders to the already-downloaded
// figures so pre-existing runs gain inline placement too.
function backfillDoc2xInlineFigures() {
  const rows = db.prepare(`
    SELECT id, stem_markdown, answer_text, analysis_markdown, figures_json
    FROM question_bank_items WHERE figures_json LIKE '%doc2x_v3%'
  `).all() as Array<{ id: string; stem_markdown: string; answer_text: string; analysis_markdown: string; figures_json: string }>
  for (const row of rows) {
    const figures = parseJson<Array<Record<string, any>>>(row.figures_json, [])
    const stemFigures = figures.filter((figure) => String(figure.usage || figure.category || '') === 'stem' || String(figure.category || '') === 'question')
    const analysisFigures = figures.filter((figure) => String(figure.usage || figure.category || '') === 'analysis')
    const stem = doc2xInlineFigureMarkdown(row.stem_markdown, stemFigures)
    const answer = doc2xInlineFigureMarkdown(row.answer_text, analysisFigures)
    const analysis = doc2xInlineFigureMarkdown(row.analysis_markdown, analysisFigures)
    if (stem === row.stem_markdown && answer === row.answer_text && analysis === row.analysis_markdown) continue
    db.prepare(`
      UPDATE question_bank_items
      SET stem_markdown = ?, answer_text = ?, analysis_markdown = ?, updated_at = ?
      WHERE id = ?
    `).run(stem, answer, analysis, nowIso(), row.id)
  }
}

ensureSchema()
backfillDoc2xFigureAssets()
backfillDoc2xInlineFigures()
repairLegacyQuestionTypes()

function batchRuns(batchId: string) {
  return (db.prepare('SELECT * FROM pdf_slicer_runs WHERE batch_id = ? ORDER BY created_at ASC').all(batchId) as RunRow[]).map(mapRun)
}

function mapBatch(row: BatchRow) {
  return {
    id: row.id,
    title: cleanSourceTitle(row.title || row.id, row.id),
    materialType: normalizeMaterialType(row.material_type),
    workflowMode: normalizeWorkflowMode(row.workflow_mode),
    workflowStatus: normalizeWorkflowStatus(row.workflow_status),
    createdAt: row.created_at,
    uploadedCount: row.uploaded_count,
  }
}

function doc2xArtifactDir(row: RunRow) {
  return path.join(resolveStoragePath(row.run_dir), 'doc2x')
}

function glmArtifactDir(row: RunRow) {
  return path.join(resolveStoragePath(row.run_dir), 'glm')
}

function readDoc2xState(row: RunRow) {
  return parseJson<Record<string, any>>(
    fs.existsSync(path.join(doc2xArtifactDir(row), 'state.json'))
      ? fs.readFileSync(path.join(doc2xArtifactDir(row), 'state.json'), 'utf8')
      : '{}',
    {},
  )
}

function syncDoc2xState(row: RunRow) {
  const provider = normalizeOcrProvider(row.ocr_provider)
  if (provider !== 'doc2x' && provider !== 'glm') return row
  const statePath = provider === 'glm' ? path.join(glmArtifactDir(row), 'state.json') : path.join(doc2xArtifactDir(row), 'state.json')
  const state = parseJson<Record<string, any>>(fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '{}', {})
  if (!Object.keys(state).length) return row
  const progress = Math.max(0, Math.min(100, Number(state.progress || 0)))
  const uid = String(state.uid || row.ocr_external_uid || '')
  const phase = String(state.phase || row.ocr_provider_phase || '')
  const resultPath = String(state.result_path || row.ocr_provider_result_path || '')
  if (uid !== row.ocr_external_uid || phase !== row.ocr_provider_phase || progress !== row.ocr_provider_progress || resultPath !== row.ocr_provider_result_path) {
    db.prepare(`
      UPDATE pdf_slicer_runs
      SET ocr_external_uid = ?, ocr_provider_phase = ?, ocr_provider_progress = ?, ocr_provider_result_path = ?, updated_at = ?
      WHERE run_id = ?
    `).run(uid, phase, progress, resultPath, nowIso(), row.run_id)
  }
  return { ...row, ocr_external_uid: uid, ocr_provider_phase: phase, ocr_provider_progress: progress, ocr_provider_result_path: resultPath }
}

function mapRun(row: RunRow) {
  row = syncDoc2xState(row)
  const importedQuestions = (db.prepare('SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ?').get(row.run_id) as { count: number }).count
  const bankedQuestions = (db.prepare("SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ? AND bank_status = 'banked'").get(row.run_id) as { count: number }).count
  const solutionItems = (db.prepare('SELECT COUNT(*) AS count FROM pdf_slicer_solution_items WHERE source_run_id = ?').get(row.run_id) as { count: number }).count
  const expectedQuestions = row.approved_questions || row.total_questions || 0
  const completedByImport = expectedQuestions > 0 && Math.max(importedQuestions, solutionItems) >= expectedQuestions
  const ocrStatus = row.ocr_status === 'succeeded' || completedByImport ? 'succeeded' : row.ocr_status
  const provider = normalizeOcrProvider(row.ocr_provider)
  const providerProgress = Math.max(0, Math.min(100, Number(row.ocr_provider_progress || 0))) / 100
  const progressPercent = ocrStatus === 'succeeded' ? 1 : (provider === 'doc2x' || provider === 'glm') && providerProgress > 0 ? providerProgress : ocrStatus === 'running' ? 0.5 : ocrStatus === 'failed' ? 0.2 : 0
  const documentDiagnostics = parseJson<Record<string, any>>(row.document_diagnostics_json || '{}', {})
  return {
    runId: row.run_id,
    batchId: row.batch_id,
    uploadMode: row.upload_mode,
    paperTitle: cleanSourceTitle(row.paper_title || row.pdf_name),
    pdfName: normalizeUploadName(row.pdf_name),
    pdfPath: row.pdf_path,
    sourceFileName: normalizeUploadName(row.source_file_name),
    sourceFileKind: row.source_file_kind,
    materialType: normalizeMaterialType(row.material_type),
    fileRole: normalizeFileRole(row.file_role),
    stage: row.stage || '高三',
    classificationConfidence: Number(row.classification_confidence || 0),
    classificationReasons: parseJson<string[]>(row.classification_reasons_json || '[]', []),
    runDir: row.run_dir,
    documentDiagnostics,
    diagnosticMessage: buildDocumentDiagnosticMessage(documentDiagnostics),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sliceStatus: row.slice_status,
    sliceError: row.slice_error,
    quickReviewStatus: row.quick_review_status,
    totalQuestions: row.total_questions,
    approvedQuestions: row.approved_questions,
    unreviewedQuestions: row.unreviewed_questions,
    ocrStatus,
    ocrError: row.ocr_error,
    ocrStartedAt: row.ocr_started_at,
    ocrFinishedAt: row.ocr_finished_at,
    ocrProvider: provider,
    ocrExternalUid: row.ocr_external_uid || '',
    ocrProviderPhase: row.ocr_provider_phase || '',
    ocrProviderProgress: Number(row.ocr_provider_progress || 0),
    ocrProviderResultPath: row.ocr_provider_result_path || '',
    rulesVersion: row.rules_version || 0,
    rulesHash: row.rules_hash || '',
    rulesFallbackUsed: Boolean(row.rules_fallback_used),
    rulesWarnings: parseJson<string[]>(row.rules_warnings_json || '[]', []),
    progressPercent: ocrStatus === 'failed' && importedQuestions > 0 && row.approved_questions > 0 ? importedQuestions / row.approved_questions : progressPercent,
    totalOcrQuestions: row.approved_questions,
    processedQuestions: Math.max(importedQuestions, solutionItems) || (ocrStatus === 'succeeded' ? row.approved_questions : ocrStatus === 'running' ? Math.floor(row.approved_questions / 2) : 0),
    importedQuestions,
    bankedQuestions,
    solutionItems,
  }
}

function mapQuestion(row: QuestionRow) {
  const figures = parseJson<Array<Record<string, unknown>>>(row.figures_json, [])
  const knowledgePoints = parseJson<string[]>(row.knowledge_points_json || '[]', [])
  const solutionMethods = parseJson<string[]>(row.solution_methods_json || '[]', [])
  const stemMarkdown = row.stem_markdown || ''
  const answerText = row.answer_text || ''
  const analysisMarkdown = row.analysis_markdown || ''
  const questionType = normalizeQuestionType(row.question_type, stemMarkdown, answerText)
  const sourceOcrProvider = row.source_run_id ? getRun(row.source_run_id)?.ocrProvider || 'legacy' : 'legacy'
  return {
    id: row.id,
    serialNo: row.serial_no,
    questionNo: row.question_no,
    stage: row.stage,
    questionType,
    difficultyScore: row.difficulty_score,
    difficultyScore10: row.difficulty_score_10,
    difficultyLabel: row.difficulty_label || difficultyLabel10(row.difficulty_score_10),
    chapter: row.chapter,
    knowledgePoints,
    solutionMethods,
    sourceTitle: cleanSourceTitle(row.source_title),
    bankStatus: row.bank_status,
    stemMarkdown,
    answerText,
    analysisMarkdown,
    problemBlocks: paragraphBlock(stemMarkdown),
    answerBlocks: paragraphBlock(answerText),
    analysisBlocks: paragraphBlock(analysisMarkdown),
    searchText: row.search_text || buildSearchText(stemMarkdown, answerText, analysisMarkdown),
    sliceImagePath: stripAssetPrefix(row.slice_image_path),
    ocrSegmentImages: ocrSegmentImages(row.id),
    figures,
    sourceRunId: row.source_run_id,
    sourceOcrProvider,
    sourceSolutionRunId: row.source_solution_run_id,
    mergeStatus: row.merge_status,
    mergeNote: row.merge_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasFigures: figures.length > 0,
    needsFormatReview: Boolean(row.format_review_required),
    formatIssue: row.format_review_required ? formatIssueFromReviewJson(row.format_review_reasons_json) : undefined,
  }
}

type SimilarQuestionCandidate = {
  id: string
  questionNo: string
  sourceTitle: string
  bankStatus: BankStatus
  similarity: number
  stemPreview: string
  stemMarkdown: string
  answerText: string
  analysisMarkdown: string
  questionType: string
}

function normalizeSimilarityText(value: string) {
  return questionPlainText(value)
    .replace(/\$\$[\s\S]*?\$\$/g, '公式')
    .replace(/\$[\s\S]*?\$/g, '公式')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/[`*_~>#|\[\](){}，。！？；：、,.!?;:\s]+/g, '')
    .replace(/[A-D][.．、]/g, '')
    .toLowerCase()
}

function textBigrams(value: string) {
  const text = normalizeSimilarityText(value)
  if (text.length < 2) return new Set(text ? [text] : [])
  const grams = new Set<string>()
  for (let index = 0; index < text.length - 1; index += 1) {
    grams.add(text.slice(index, index + 2))
  }
  return grams
}

function jaccardSimilarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection += 1
  }
  return intersection / (a.size + b.size - intersection)
}

function stemPreview(value: string) {
  return questionPlainText(value)
    .replace(/\$\$?[^$]+\$\$?/g, '[公式]')
    .replace(/[#*_~`>|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96)
}

function similarQuestionCandidates(row: QuestionRow, options: { threshold?: number; limit?: number } = {}): SimilarQuestionCandidate[] {
  const source = row.stem_markdown || row.search_text || ''
  const sourceBigrams = textBigrams(source)
  if (sourceBigrams.size < 8) return []
  const threshold = options.threshold ?? duplicateSimilarityThreshold
  const limit = options.limit ?? 3
  const candidates = db.prepare(`
    SELECT id, question_no, source_title, bank_status, stem_markdown, answer_text, analysis_markdown, question_type, search_text
    FROM question_bank_items
    WHERE id != ?
      AND bank_status IN ('ready', 'banked')
      AND TRIM(COALESCE(stem_markdown, '')) != ''
    ORDER BY updated_at DESC
    LIMIT 800
  `).all(row.id) as Array<Pick<QuestionRow, 'id' | 'question_no' | 'source_title' | 'bank_status' | 'stem_markdown' | 'answer_text' | 'analysis_markdown' | 'question_type' | 'search_text'>>

  return candidates
    .map((candidate) => ({
      id: candidate.id,
      questionNo: candidate.question_no,
      sourceTitle: cleanSourceTitle(candidate.source_title),
      bankStatus: candidate.bank_status,
      similarity: Number(jaccardSimilarity(sourceBigrams, textBigrams(candidate.stem_markdown || candidate.search_text || '')).toFixed(3)),
      stemPreview: stemPreview(candidate.stem_markdown || candidate.search_text || ''),
      stemMarkdown: candidate.stem_markdown || '',
      answerText: candidate.answer_text || '',
      analysisMarkdown: candidate.analysis_markdown || '',
      questionType: candidate.question_type || '',
    }))
    .filter((candidate) => candidate.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

function attachSimilarQuestions<T extends PublicQuestion>(item: T, row: QuestionRow): T & { similarQuestions: SimilarQuestionCandidate[] } {
  return {
    ...item,
    similarQuestions: item.bankStatus === 'banked' || item.bankStatus === 'skipped'
      ? []
      : similarQuestionCandidates(row),
  }
}

function ocrSegmentImages(questionId: string) {
  const baseDir = path.join(pythonDataRoot, 'ocr_drafts', questionId, 'region_ocr')
  const kinds = [
    ['problem', '题干'],
    ['answer', '答案'],
    ['analysis', '解析'],
  ] as const
  return kinds.flatMap(([kind, label]) => {
    const segmentDir = path.join(baseDir, kind, 'segments')
    if (!fs.existsSync(segmentDir)) return []
    return fs.readdirSync(segmentDir)
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
      .map((name, index) => ({
        kind,
        label: `${label}分块 ${index + 1}`,
        path: assetPathFor(path.join(segmentDir, name)),
      }))
  })
}

function getRun(runId: string) {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  return row ? mapRun(row) : null
}

function getQuestion(id: string) {
  const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(id) as QuestionRow | undefined
  return row ? mapQuestion(row) : null
}

function updateBatchWorkflow(batchId: string) {
  const runs = db.prepare('SELECT * FROM pdf_slicer_runs WHERE batch_id = ?').all(batchId) as RunRow[]
  if (!runs.length) return
  const materialTypes = new Set(runs.map((run) => normalizeMaterialType(run.material_type)).filter((item) => item !== 'unknown'))
  const roles = new Set(runs.map((run) => normalizeFileRole(run.file_role)))
  const materialType: MaterialType = materialTypes.has('lecture') && !materialTypes.has('exam') ? 'lecture' : materialTypes.has('exam') ? 'exam' : 'unknown'
  const workflowMode: WorkflowMode = roles.has('questions') && roles.has('solutions') ? 'separated_exam' : 'single'
  let workflowStatus: WorkflowStatus = runs.some((run) => normalizeMaterialType(run.material_type) === 'unknown' || normalizeFileRole(run.file_role) === 'unknown') ? 'needs_classification' : 'ready'
  if (workflowMode === 'separated_exam') {
    const active = runs.some((run) => run.ocr_status === 'running' || run.ocr_status === 'queued' || run.slice_status === 'running')
    const completed = runs.filter((run) => ['questions', 'solutions'].includes(normalizeFileRole(run.file_role))).every((run) => run.ocr_status === 'succeeded')
    const unresolved = (db.prepare(`
      SELECT COUNT(*) AS count FROM question_bank_items
      WHERE source_run_id IN (SELECT run_id FROM pdf_slicer_runs WHERE batch_id = ? AND file_role = 'questions')
        AND COALESCE(merge_status, '') NOT IN ('merged')
    `).get(batchId) as { count: number }).count
    if (active) workflowStatus = 'processing'
    else if (completed && unresolved > 0) workflowStatus = 'needs_review'
    else if (completed) workflowStatus = 'ready_for_bank'
  }
  const titleRow = db.prepare('SELECT COALESCE(NULLIF(paper_title, \'\'), NULLIF(pdf_name, \'\'), ?) AS title FROM pdf_slicer_runs WHERE batch_id = ? ORDER BY created_at ASC LIMIT 1').get(batchId, batchId) as { title: string } | undefined
  db.prepare('UPDATE pdf_slicer_batches SET title = COALESCE(NULLIF(title, \'\'), ?), material_type = ?, workflow_mode = ?, workflow_status = ? WHERE id = ?')
    .run(cleanSourceTitle(titleRow?.title || batchId, batchId), materialType, workflowMode, workflowStatus, batchId)
}

function findReusableSeparatedExamBatch(title: string, materialType: MaterialType, fileRole: FileRole) {
  if (!title || materialType !== 'exam' || !['questions', 'solutions'].includes(fileRole)) return ''
  const row = db.prepare(`
    SELECT id
    FROM pdf_slicer_batches
    WHERE title = ?
      AND material_type IN ('exam', 'unknown')
      AND workflow_status IN ('ready', 'needs_classification', 'processing', 'needs_review')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(title) as { id: string } | undefined
  return row?.id || ''
}

function mapReview(row: ReviewRow) {
  const bbox = parseJson<Record<string, number>>(row.bbox_json, {})
  const segments = parseJson<Array<Record<string, any>>>(row.segments_json, [])
  const textRegions = parseJson<Array<Record<string, any>>>(row.text_regions_json, [])
  const figures = parseJson<Array<Record<string, any>>>(row.figures_json, [])
  return {
    resultId: row.result_id,
    runId: row.run_id,
    questionLabel: row.question_label,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    pageImagePath: row.page_image_path,
    autoImagePath: row.auto_image_path,
    imageUrl: row.auto_image_path ? `/assets/${row.auto_image_path}` : '',
    bbox,
    segments,
    textRegions,
    figures,
    reviewStatus: row.review_status,
    note: row.note,
    isManualSupplement: false,
  }
}

function getReviewItems(runId: string) {
  return (db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? ORDER BY result_id ASC').all(runId) as ReviewRow[]).map(mapReview)
}

function syncReviewRunCounts(runId: string) {
  const items = getReviewItems(runId)
  const approved = items.filter((item) => item.reviewStatus === 'ready_for_ocr').length
  const pending = items.filter((item) => item.reviewStatus === 'pending_review').length
  db.prepare('UPDATE pdf_slicer_runs SET total_questions = ?, approved_questions = ?, unreviewed_questions = ?, updated_at = ? WHERE run_id = ?')
    .run(items.length, approved, pending, nowIso(), runId)
  return { items, approved, pending }
}

function runMigratedPdfSlicer(runId: string) {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  if (!row) {
    throw new Error('批次不存在。')
  }
  const inputPdf = resolveStoragePath(row.pdf_path)
  if (path.extname(inputPdf).toLowerCase() !== '.pdf') {
    throw new Error('切题引擎需要 PDF 输入；当前批次没有可用的转换后 PDF，请重新上传或检查 Word 转 PDF 流程。')
  }
  if (!fs.existsSync(inputPdf)) {
    throw new Error(`切题 PDF 文件不存在：${row.pdf_path}`)
  }

  const runDir = resolveStoragePath(row.run_dir)
  const outputDir = path.join(runDir, 'output')
  const scriptPath = path.join(sourceRoot, 'server', 'python', 'scripts', 'run_cut_for_question.py')
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ?').run(runId)

  // Record rules config version before running
  const rulesFile = pdfSlicerRulesPath()
  const rulesConfig = readPdfSlicerRules()
  const rulesHash = computeJsonHash(rulesConfig)
  const rulesVersion = Number(rulesConfig.version || 1)
  db.prepare('UPDATE pdf_slicer_runs SET rules_version = ?, rules_hash = ?, updated_at = ? WHERE run_id = ?')
    .run(rulesVersion, rulesHash, nowIso(), runId)

  const rulesArgs = fs.existsSync(rulesFile) ? ['--rules-config', rulesFile] : []
  execFileSync(pythonCommand(), [
    scriptPath,
    '--input-pdf', inputPdf,
    '--output-dir', outputDir,
    '--asset-root', storageRoot,
    '--dpi', '180',
    ...rulesArgs,
  ], { cwd: pythonRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  const resultPath = path.join(outputDir, 'cut_results.json')
  const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as { results?: Array<Record<string, any>>; summary?: Record<string, any> }
  const results = payload.results ?? []
  const diagnostics = payload.summary?.diagnostics ?? ({} as Record<string, any>)
  const rulesMeta: Record<string, unknown> = {}
  if (diagnostics.rules_version !== undefined) {
    rulesMeta.rulesVersion = diagnostics.rules_version
    rulesMeta.rulesHash = diagnostics.rules_hash
    rulesMeta.rulesFallbackUsed = Boolean(diagnostics.rules_fallback_used)
    rulesMeta.rulesWarnings = Array.isArray(diagnostics.rules_warnings) ? diagnostics.rules_warnings : []
  }
  const nextDiagnostics = mergeDiagnostics(
    parseJson<Record<string, any>>(row.document_diagnostics_json || '{}', {}),
    { cutDiagnostics: diagnostics, ...rulesMeta }
  )
  // Update both document_diagnostics_json and the extracted rule columns
  db.prepare('UPDATE pdf_slicer_runs SET document_diagnostics_json = ?, rules_fallback_used = ?, rules_warnings_json = ?, updated_at = ? WHERE run_id = ?')
    .run(
      JSON.stringify(nextDiagnostics),
      rulesMeta.rulesFallbackUsed ? 1 : 0,
      JSON.stringify(rulesMeta.rulesWarnings || []),
      nowIso(),
      runId,
    )
  const insert = db.prepare(`
    INSERT INTO pdf_slicer_review_items (
      result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = nowIso()
  for (const item of results) {
    const pageSpan = Array.isArray(item.page_span) ? item.page_span : [item.page ?? 1, item.page ?? 1]
    const resultId = `${runId}_${item.id || createId('CUT')}`
    insert.run(
      resultId,
      runId,
      String(item.question_no || item.id || ''),
      Number(pageSpan[0] || item.page || 1),
      Number(pageSpan[1] || item.page || 1),
      String(item.page_image_path || ''),
      String(item.auto_image_path || ''),
      JSON.stringify(item.bbox || {}),
      JSON.stringify(item.segments || []),
      JSON.stringify(item.text_regions || []),
      JSON.stringify(item.figures || []),
      String(item.status || 'pending_review'),
      String(item.note || ''),
      now,
      now
    )
  }
  return getReviewItems(runId)
}

function startSlicingRun(runId: string) {
  const run = getRun(runId)
  if (!run) {
    throw new Error('批次不存在。')
  }
  if (run.sliceStatus === 'running') {
    return { run, items: getReviewItems(run.runId) }
  }
  db.prepare("UPDATE pdf_slicer_runs SET slice_status = 'running', slice_error = '', updated_at = ? WHERE run_id = ?").run(nowIso(), run.runId)
  try {
    const items = runMigratedPdfSlicer(run.runId)
    db.prepare(`
      UPDATE pdf_slicer_runs
      SET slice_status = 'succeeded', total_questions = ?, unreviewed_questions = ?, quick_review_status = 'pending', updated_at = ?
      WHERE run_id = ?
    `).run(items.length, items.length, nowIso(), run.runId)
    updateBatchWorkflow(run.batchId)
    return { run: getRun(run.runId), items }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.prepare("UPDATE pdf_slicer_runs SET slice_status = 'failed', slice_error = ?, updated_at = ? WHERE run_id = ?").run(message, nowIso(), run.runId)
    updateBatchWorkflow(run.batchId)
    throw error
  }
}

function startSlicingRunInBackground(runId: string) {
  setTimeout(() => {
    try {
      startSlicingRun(runId)
    } catch (error) {
      console.error(`[pdf-slicer] 自动切题失败 ${runId}:`, error)
    }
  }, 0)
}

function ensureQuestionAssetLink() {
  const linkPath = path.join(pythonRoot, 'question_assets')
  if (!fs.existsSync(linkPath)) {
    try {
      fs.symlinkSync(storageRoot, linkPath, 'dir')
    } catch {
      // Packaged apps and some Windows setups cannot create this compatibility link.
      // Python also receives QUESTION_ASSET_ROOT and can resolve question_assets paths directly.
    }
  }
}

function normalizeOcrProvider(value: unknown): OcrProvider {
  const provider = String(value || '').toLowerCase()
  if (provider === 'doc2x') return 'doc2x'
  if (provider === 'glm') return 'glm'
  return 'legacy'
}

function hasOcrConfig(provider: OcrProvider = normalizeOcrProvider(readOcrSettings().ocrProvider)) {
  const envPath = ocrEnvPath()
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const hasInText = (key: string) => new RegExp(`^${key}=.+`, 'm').test(envText)
  if (provider === 'doc2x') {
    return Boolean(process.env.DOC2X_API_KEY || hasInText('DOC2X_API_KEY'))
  }
  if (provider === 'glm') {
    return Boolean(process.env.GLM_OCR_API_KEY || hasInText('GLM_OCR_API_KEY'))
  }
  return Boolean(
    (process.env.OCR_API_BASE_URL || hasInText('OCR_API_BASE_URL')) &&
    (process.env.OCR_API_KEY || hasInText('OCR_API_KEY')) &&
    (process.env.OCR_MODEL || hasInText('OCR_MODEL'))
  )
}

function ocrEnvPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'ocr.env')
}

function ocrPromptSettingsPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'ocr_prompt_settings.json')
}

function appSettingsPath() {
  const configDir = path.join(storageRoot, 'config')
  fs.mkdirSync(configDir, { recursive: true })
  return path.join(configDir, 'app_settings.json')
}

process.env.QUESTION_PYTHON_DATA_DIR ||= pythonDataRoot
process.env.QUESTION_OCR_ENV_PATH ||= ocrEnvPath()
process.env.QUESTION_PROMPT_SETTINGS_PATH ||= ocrPromptSettingsPath()
process.env.QUESTION_ASSET_ROOT ||= storageRoot

const defaultAppSettings = {
  setupCompleted: false,
  systemName: 'Question Manager',
  siteTitle: 'Question Manager',
  siteDescription: '本地优先的 PDF 切分、OCR 识别与数学题库管理工具。',
  examExportTemplate: 'builtin' as 'builtin' | 'examch',
  worksheetWatermark: '教师姓名 · 工作室',
  examWatermark: 'Qrane',
  lectureWatermark: '教师姓名 · 工作室',
  teachingStages: ['高中'],
  sofficePath: '',
}

const teachingStageValues = ['小学', '初中', '高中', '其他']
const teachingStageGradeMap: Record<string, string[]> = {
  小学: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'],
  初中: ['初一', '初二', '初三'],
  高中: ['高一', '高二', '高三'],
  其他: ['其他'],
}

function normalizeTeachingStages(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、\s]+/) : []
  const selected = source.map((item) => String(item).trim()).filter((item) => teachingStageValues.includes(item))
  return selected.length ? Array.from(new Set(selected)) : [...defaultAppSettings.teachingStages]
}

function configuredGradeStages() {
  return Array.from(new Set(readAppSettings().teachingStages.flatMap((stage) => teachingStageGradeMap[stage] || [])))
}

function readAppSettings() {
  const settingsPath = appSettingsPath()
  const hasSettingsFile = fs.existsSync(settingsPath)
  if (!hasSettingsFile) return { ...defaultAppSettings }
  const payload = parseJson<Record<string, unknown>>(fs.readFileSync(settingsPath, 'utf8'), {})
  return {
    setupCompleted: payload.setupCompleted === true || payload.setupCompleted === 'true',
    systemName: String(payload.systemName ?? defaultAppSettings.systemName),
    siteTitle: String(payload.siteTitle ?? defaultAppSettings.siteTitle),
    siteDescription: String(payload.siteDescription ?? defaultAppSettings.siteDescription),
    examExportTemplate: payload.examExportTemplate === 'examch' ? 'examch' as const : 'builtin' as const,
    worksheetWatermark: String(payload.worksheetWatermark ?? defaultAppSettings.worksheetWatermark),
    examWatermark: String(payload.examWatermark ?? defaultAppSettings.examWatermark),
    lectureWatermark: String(payload.lectureWatermark ?? defaultAppSettings.lectureWatermark),
    teachingStages: normalizeTeachingStages(payload.teachingStages),
    sofficePath: String(payload.sofficePath ?? defaultAppSettings.sofficePath).trim(),
  }
}

function writeAppSettings(input: Record<string, unknown>) {
  const existing = readAppSettings()
  const payload = {
    setupCompleted: input.setupCompleted === true || input.setupCompleted === 'true' || existing.setupCompleted,
    systemName: String(input.systemName ?? existing.systemName).trim() || defaultAppSettings.systemName,
    siteTitle: String(input.siteTitle ?? existing.siteTitle).trim() || defaultAppSettings.siteTitle,
    siteDescription: String(input.siteDescription ?? existing.siteDescription).trim(),
    examExportTemplate: input.examExportTemplate === 'examch' ? 'examch' as const : input.examExportTemplate === 'builtin' ? 'builtin' as const : existing.examExportTemplate,
    worksheetWatermark: String(input.worksheetWatermark ?? existing.worksheetWatermark).trim() || defaultAppSettings.worksheetWatermark,
    examWatermark: String(input.examWatermark ?? existing.examWatermark).trim() || defaultAppSettings.examWatermark,
    lectureWatermark: String(input.lectureWatermark ?? existing.lectureWatermark).trim() || defaultAppSettings.lectureWatermark,
    teachingStages: normalizeTeachingStages(input.teachingStages ?? existing.teachingStages),
    sofficePath: String(input.sofficePath ?? existing.sofficePath ?? '').trim(),
  }
  fs.writeFileSync(appSettingsPath(), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  return readAppSettings()
}

function readOcrPromptSettings() {
  const promptPath = ocrPromptSettingsPath()
  const defaults = readEffectivePromptDefaults()
  if (!fs.existsSync(promptPath)) return defaults
  const payload = parseJson<Record<string, string>>(fs.readFileSync(promptPath, 'utf8'), {})
  const promptValue = (key: string, fallback: string) => {
    const value = String(payload[key] || '')
    return value && !value.includes('\uFFFD') ? value : fallback
  }
  return {
    wholeSystemPrompt: promptValue('whole_system_prompt', defaults.wholeSystemPrompt),
    wholeUserPrompt: promptValue('whole_user_prompt', defaults.wholeUserPrompt),
    chunkSystemPrompt: promptValue('chunk_system_prompt', defaults.chunkSystemPrompt),
    chunkUserPrompt: promptValue('chunk_user_prompt', defaults.chunkUserPrompt),
    cleanupSystemPrompt: promptValue('cleanup_system_prompt', defaults.cleanupSystemPrompt),
    cleanupUserPrompt: promptValue('cleanup_user_prompt', defaults.cleanupUserPrompt),
    classificationSystemPrompt: promptValue('classification_system_prompt', defaults.classificationSystemPrompt),
    classificationUserPrompt: promptValue('classification_user_prompt', defaults.classificationUserPrompt),
  }
}

function readEffectivePromptDefaults() {
  const fallback = {
    wholeSystemPrompt: '',
    wholeUserPrompt: '',
    chunkSystemPrompt: '',
    chunkUserPrompt: '',
    cleanupSystemPrompt: '',
    cleanupUserPrompt: '',
    classificationSystemPrompt: '',
    classificationUserPrompt: '',
  }
  try {
    const code = [
      'import json',
      'from src.ocr.prompt import OCR_SYSTEM_PROMPT, OCR_CHUNK_SYSTEM_PROMPT, build_user_prompt, build_chunk_user_prompt',
      'from scripts.format_cleanup_for_question import DEFAULT_CLEANUP_SYSTEM_PROMPT, DEFAULT_CLEANUP_USER_PROMPT, DEFAULT_CLASSIFICATION_SYSTEM_PROMPT, DEFAULT_CLASSIFICATION_USER_PROMPT',
      'print(json.dumps({',
      '  "wholeSystemPrompt": OCR_SYSTEM_PROMPT,',
      '  "wholeUserPrompt": build_user_prompt(),',
      '  "chunkSystemPrompt": OCR_CHUNK_SYSTEM_PROMPT,',
      '  "chunkUserPrompt": build_chunk_user_prompt("{kind}", "{image_count}"),',
      '  "cleanupSystemPrompt": DEFAULT_CLEANUP_SYSTEM_PROMPT,',
      '  "cleanupUserPrompt": DEFAULT_CLEANUP_USER_PROMPT,',
      '  "classificationSystemPrompt": DEFAULT_CLASSIFICATION_SYSTEM_PROMPT,',
      '  "classificationUserPrompt": DEFAULT_CLASSIFICATION_USER_PROMPT,',
      '}))',
    ].join('\n')
    return parseJson<typeof fallback>(
      execFileSync(pythonCommand(), ['-c', code], {
        cwd: pythonRoot,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      fallback
    )
  } catch {
    return fallback
  }
}

function writeOcrPromptSettings(input: Record<string, unknown>) {
  const existing = readOcrPromptSettings()
  const payload = {
    whole_system_prompt: String(input.wholeSystemPrompt ?? existing.wholeSystemPrompt ?? ''),
    whole_user_prompt: String(input.wholeUserPrompt ?? existing.wholeUserPrompt ?? ''),
    chunk_system_prompt: String(input.chunkSystemPrompt ?? existing.chunkSystemPrompt ?? ''),
    chunk_user_prompt: String(input.chunkUserPrompt ?? existing.chunkUserPrompt ?? ''),
    cleanup_system_prompt: String(input.cleanupSystemPrompt ?? existing.cleanupSystemPrompt ?? ''),
    cleanup_user_prompt: String(input.cleanupUserPrompt ?? existing.cleanupUserPrompt ?? ''),
    classification_system_prompt: String(input.classificationSystemPrompt ?? existing.classificationSystemPrompt ?? ''),
    classification_user_prompt: String(input.classificationUserPrompt ?? existing.classificationUserPrompt ?? ''),
  }
  fs.writeFileSync(ocrPromptSettingsPath(), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  return readOcrPromptSettings()
}

function clampWorkerCount(value: unknown, fallback = 20) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return String(fallback)
  return String(Math.max(1, Math.min(parsed, 20)))
}

function readOcrSettings() {
  const envPath = ocrEnvPath()
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const values: Record<string, string> = {}
  for (const line of envText.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    values[key.trim()] = rest.join('=').trim()
  }
  return {
    ...readAppSettings(),
    sofficeAvailable: Boolean(sofficePath()),
    sofficeDetectedPath: sofficePath(),
    ocrProvider: normalizeOcrProvider(values.OCR_PROVIDER) === 'glm' ? 'glm' : 'doc2x',
    apiBaseUrl: values.OCR_API_BASE_URL || '',
    apiKeyConfigured: Boolean(values.OCR_API_KEY || process.env.OCR_API_KEY),
    model: values.OCR_MODEL || '',
    dryRun: values.OCR_DRY_RUN || 'false',
    maxItems: values.OCR_MAX_ITEMS || '10',
    concurrency: clampWorkerCount(values.OCR_CONCURRENCY || '20'),
    maxRetries: values.OCR_MAX_RETRIES || '2',
    retryDelaySeconds: values.OCR_RETRY_DELAY_SECONDS || '3',
    imageMaxWidth: values.OCR_IMAGE_MAX_WIDTH || '900',
    topK: values.OCR_TOP_K || '1',
    doc2xApiBaseUrl: values.DOC2X_API_BASE_URL || 'https://v2.doc2x.noedgeai.com',
    doc2xApiKeyConfigured: Boolean(values.DOC2X_API_KEY || process.env.DOC2X_API_KEY),
    doc2xModel: values.DOC2X_MODEL || 'v3-2026',
    glmOcrApiBaseUrl: values.GLM_OCR_API_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/layout_parsing',
    glmOcrApiKeyConfigured: Boolean(values.GLM_OCR_API_KEY || process.env.GLM_OCR_API_KEY),
    glmOcrModel: values.GLM_OCR_MODEL || 'glm-ocr',
    cleanupApiBaseUrl: values.OCR_CLEANUP_API_BASE_URL || values.OCR_API_BASE_URL || '',
    cleanupApiKeyConfigured: Boolean(values.OCR_CLEANUP_API_KEY || process.env.OCR_CLEANUP_API_KEY || values.OCR_API_KEY || process.env.OCR_API_KEY),
    cleanupModel: values.OCR_CLEANUP_MODEL || values.OCR_MODEL || '',
    cleanupConcurrency: clampWorkerCount(values.OCR_CLEANUP_CONCURRENCY || values.OCR_CONCURRENCY || '20'),
    classificationEnabled: values.OCR_CLASSIFICATION_ENABLED || 'true',
    ...readOcrPromptSettings(),
  }
}

function writeOcrSettings(input: Record<string, unknown>) {
  const envPath = ocrEnvPath()
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const values: Record<string, string> = {}
  for (const line of existing.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue
    const [key, ...rest] = line.split('=')
    values[key.trim()] = rest.join('=').trim()
  }
  const map: Record<string, string> = {
    OCR_PROVIDER: normalizeOcrProvider(input.ocrProvider ?? values.OCR_PROVIDER) === 'glm' ? 'glm' : 'doc2x',
    OCR_API_BASE_URL: String(input.apiBaseUrl ?? values.OCR_API_BASE_URL ?? ''),
    OCR_API_KEY: String(input.apiKey || values.OCR_API_KEY || ''),
    OCR_MODEL: String(input.model ?? values.OCR_MODEL ?? ''),
    OCR_DRY_RUN: String(input.dryRun ?? values.OCR_DRY_RUN ?? 'false'),
    OCR_MAX_ITEMS: String(input.maxItems ?? values.OCR_MAX_ITEMS ?? '10'),
    OCR_CONCURRENCY: clampWorkerCount(input.concurrency ?? values.OCR_CONCURRENCY ?? '20'),
    OCR_MAX_RETRIES: String(input.maxRetries ?? values.OCR_MAX_RETRIES ?? '2'),
    OCR_RETRY_DELAY_SECONDS: String(input.retryDelaySeconds ?? values.OCR_RETRY_DELAY_SECONDS ?? '3'),
    OCR_IMAGE_MAX_WIDTH: String(input.imageMaxWidth ?? values.OCR_IMAGE_MAX_WIDTH ?? '900'),
    OCR_TOP_K: String(input.topK ?? values.OCR_TOP_K ?? '1'),
    DOC2X_API_BASE_URL: String(input.doc2xApiBaseUrl ?? values.DOC2X_API_BASE_URL ?? 'https://v2.doc2x.noedgeai.com'),
    DOC2X_API_KEY: String(input.doc2xApiKey || values.DOC2X_API_KEY || ''),
    DOC2X_MODEL: String(input.doc2xModel ?? values.DOC2X_MODEL ?? 'v3-2026'),
    GLM_OCR_API_BASE_URL: String(input.glmOcrApiBaseUrl ?? values.GLM_OCR_API_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4/layout_parsing'),
    GLM_OCR_API_KEY: String(input.glmOcrApiKey || values.GLM_OCR_API_KEY || ''),
    GLM_OCR_MODEL: String(input.glmOcrModel ?? values.GLM_OCR_MODEL ?? 'glm-ocr'),
    OCR_CLEANUP_API_BASE_URL: String(input.cleanupApiBaseUrl ?? values.OCR_CLEANUP_API_BASE_URL ?? values.OCR_API_BASE_URL ?? ''),
    OCR_CLEANUP_API_KEY: String(input.cleanupApiKey || values.OCR_CLEANUP_API_KEY || ''),
    OCR_CLEANUP_MODEL: String(input.cleanupModel ?? values.OCR_CLEANUP_MODEL ?? values.OCR_MODEL ?? ''),
    OCR_CLEANUP_CONCURRENCY: clampWorkerCount(input.cleanupConcurrency ?? values.OCR_CLEANUP_CONCURRENCY ?? values.OCR_CONCURRENCY ?? '20'),
    OCR_CLASSIFICATION_ENABLED: String(input.classificationEnabled ?? values.OCR_CLASSIFICATION_ENABLED ?? 'true'),
  }
  const passthroughKeys = Object.keys(values).filter((key) => !(key in map))
  const lines = [...Object.entries(map), ...passthroughKeys.map((key) => [key, values[key]] as [string, string])]
    .map(([key, value]) => `${key}=${value}`)
  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, { mode: 0o600 })
  writeAppSettings(input)
  writeOcrPromptSettings(input)
  return readOcrSettings()
}

function withQuestionAssetPrefix(value: string) {
  const clean = stripAssetPrefix(String(value || ''))
  return clean ? `question_assets/${clean}` : ''
}

function loadCutResultRecord(runId: string, resultId: string) {
  const run = getRun(runId)
  if (!run) return null
  const cutId = resultId.match(/CUT_\d+/)?.[0] || resultId.split('_').pop() || ''
  const cutPath = path.join(resolveStoragePath(run.runDir), 'output', 'cut_results.json')
  if (!fs.existsSync(cutPath)) return null
  const payload = parseJson<{ results?: Array<Record<string, any>> }>(fs.readFileSync(cutPath, 'utf8'), { results: [] })
  return payload.results?.find((item) => String(item.id || '') === cutId || String(item.question_no || '') === cutId) || null
}

function normalizeOcrSegment(segment: Record<string, any>) {
  return {
    ...segment,
    page_image_path: withQuestionAssetPrefix(String(segment.page_image_path || '')),
  }
}

function normalizeOcrTextRegions(regions: Array<Record<string, any>>) {
  return regions.map((region) => ({
    ...region,
    segments: Array.isArray(region.segments) ? region.segments.map(normalizeOcrSegment) : [],
  }))
}

function exportRunForMigratedOcr(runId: string) {
  ensureQuestionAssetLink()
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const items = getReviewItems(runId).filter((item) => item.reviewStatus === 'ready_for_ocr')
  if (!items.length) throw new Error('没有已通过复核的切片，请先提交切题复核。')
  const outputDir = path.join(pythonDataRoot, 'output')
  fs.mkdirSync(outputDir, { recursive: true })

  const records = items.map((item) => {
    const notePayload = parseJson<Record<string, any>>(String((item as any).note || ''), {})
    const cutRecord = loadCutResultRecord(runId, item.resultId)
    const storedSegments = Array.isArray((item as any).segments) ? (item as any).segments : []
    const storedTextRegions = Array.isArray((item as any).textRegions) ? (item as any).textRegions : []
    const sourceSegments = storedSegments.length ? storedSegments : (Array.isArray(cutRecord?.segments) ? cutRecord?.segments : [])
    const fallbackSegment = { page_number: item.pageStart, page_image_path: item.pageImagePath, bbox: item.bbox }
    const reviewedSegments = (sourceSegments.length ? sourceSegments : [fallbackSegment]).map(normalizeOcrSegment)
    const sourceTextRegions = storedTextRegions.length ? storedTextRegions : (Array.isArray(cutRecord?.text_regions) ? cutRecord?.text_regions : [])
    const textRegions = sourceTextRegions.length
      ? normalizeOcrTextRegions(sourceTextRegions)
      : [
        { kind: 'problem', segments: reviewedSegments },
        { kind: 'answer', segments: reviewedSegments },
        { kind: 'analysis', segments: reviewedSegments },
      ]
    const reviewedPath = withQuestionAssetPrefix(item.autoImagePath || String(notePayload.reviewedImagePath || cutRecord?.auto_image_path || ''))
    return {
      id: item.resultId,
      source_pdf: String(notePayload.sourcePdf || `question_assets/${run.pdfPath}`),
      page: item.pageStart,
      page_span: [item.pageStart, item.pageEnd],
      question_no: item.questionLabel,
      reviewed_image_path: reviewedPath,
      auto_image_path: reviewedPath,
      reviewed_bbox: cutRecord?.bbox || item.bbox,
      auto_bbox: cutRecord?.bbox || item.bbox,
      reviewed_segments: reviewedSegments,
      segments: reviewedSegments,
      text_regions: textRegions,
      figures: Array.isArray((item as any).figures) ? (item as any).figures : (Array.isArray(cutRecord?.figures) ? cutRecord?.figures : []),
	      original_question_id: String(notePayload.originalQuestionId || ''),
	      original_source_run_id: String(notePayload.originalSourceRunId || ''),
	      force_region_ocr: Boolean(notePayload.forceRegionOcr),
	      status: 'ready_for_ocr',
	      note: item.note,
	    }
  })
  const payload = JSON.stringify({ results: records }, null, 2)
  fs.writeFileSync(path.join(outputDir, 'reviewed_results.json'), payload)
  fs.writeFileSync(path.join(outputDir, 'cut_results.json'), payload)
  fs.writeFileSync(path.join(outputDir, 'ocr_manifest.json'), payload)
  return records.length
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function createQuestionBankRerunTask(questionIds: string[], options: { forceRegionOcr?: boolean } = {}) {
  if (!questionIds.length) {
    throw new Error('没有可重新 OCR 的题目。')
  }
  ensureQuestionAssetLink()
  const now = nowIso()
  const questions = questionIds.map((questionId) => {
    const question = getQuestion(questionId)
    if (!question?.sourceRunId) return null
    const sourceRun = getRun(question.sourceRunId)
    if (!sourceRun?.pdfPath) return null
    const reviewItem = getReviewItems(question.sourceRunId).find((entry) => entry.resultId === question.id)
    if (!reviewItem) return null
    const cutRecord = loadCutResultRecord(question.sourceRunId, question.id)
    const sourceSegments = Array.isArray((reviewItem as any).segments) && (reviewItem as any).segments.length
      ? (reviewItem as any).segments
      : (Array.isArray(cutRecord?.segments) ? cutRecord.segments : [])
    const fallbackSegment = { page_number: reviewItem.pageStart, page_image_path: reviewItem.pageImagePath, bbox: reviewItem.bbox }
    const textRegions = Array.isArray((reviewItem as any).textRegions) && (reviewItem as any).textRegions.length
      ? (reviewItem as any).textRegions
      : (Array.isArray(cutRecord?.text_regions) ? cutRecord.text_regions : [
        { kind: 'problem', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
        { kind: 'answer', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
        { kind: 'analysis', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
      ])
    return {
      question,
      sourceRun,
      reviewItem,
      cutRecord,
      sourceSegments,
      textRegions,
    }
  }).filter(Boolean) as Array<{
    question: NonNullable<ReturnType<typeof getQuestion>>
    sourceRun: NonNullable<ReturnType<typeof getRun>>
    reviewItem: ReturnType<typeof getReviewItems>[number]
    cutRecord: Record<string, any> | null
    sourceSegments: Array<Record<string, any>>
    textRegions: Array<Record<string, any>>
  }>

  if (!questions.length) {
    throw new Error('当前题目缺少原始 OCR 分块信息，无法重新 OCR。')
  }

  const batchId = createId('batch', 'question_bank_rerun')
  const batchTitle = batchId
  db.prepare('INSERT INTO pdf_slicer_batches (id, title, material_type, workflow_mode, workflow_status, created_at, uploaded_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(batchId, batchTitle, 'unknown', 'single', 'processing', now, questions.length)
  const insertRun = db.prepare(`
    INSERT INTO pdf_slicer_runs (
      run_id, batch_id, upload_mode, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind, run_dir, document_diagnostics_json,
      material_type, file_role, stage, classification_confidence, classification_reasons_json,
      created_at, updated_at, slice_status, quick_review_status, total_questions, approved_questions, unreviewed_questions, ocr_status,
      rules_version, rules_hash, rules_fallback_used, rules_warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 'submitted', ?, ?, 0, 'idle', 0, '', 0, '[]')
  `)
  const insertReview = db.prepare(`
    INSERT INTO pdf_slicer_review_items (
      result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready_for_ocr', ?, ?, ?)
  `)
  const runId = createId('run', 'question_bank_rerun')
  const runDir = path.join(runsRoot, runId)
  fs.mkdirSync(runDir, { recursive: true })

  insertRun.run(
    runId,
    batchId,
    'question_bank_rerun',
    '题库批量重新 OCR',
    '题库批量重新 OCR',
    '',
    'question_bank',
    'question_bank',
    assetPathFor(runDir),
    JSON.stringify({ bulkRerun: true, questionCount: questions.length }),
    'unknown',
    'full',
    questions[0]?.question.stage || configuredGradeStages()[0] || '高三',
    1,
    JSON.stringify(['题库批量重新 OCR']),
    now,
    now,
    questions.length,
    questions.length
  )

  for (const entry of questions) {
    const resultId = `${runId}__${entry.question.id}`
    const payload = {
      originalQuestionId: entry.question.id,
      originalSourceRunId: entry.question.sourceRunId,
      sourcePdf: `question_assets/${entry.sourceRun.pdfPath}`,
      reviewedImagePath: entry.reviewItem.autoImagePath || entry.question.sliceImagePath,
      forceRegionOcr: Boolean(options.forceRegionOcr),
    }
    insertReview.run(
      resultId,
      runId,
      entry.question.questionNo || entry.reviewItem.questionLabel || entry.question.id,
      entry.reviewItem.pageStart,
      entry.reviewItem.pageEnd,
      entry.reviewItem.pageImagePath,
      entry.reviewItem.autoImagePath || entry.question.sliceImagePath,
      JSON.stringify(entry.reviewItem.bbox || entry.cutRecord?.bbox || {}),
      JSON.stringify(entry.sourceSegments.length ? entry.sourceSegments : [{ page_number: entry.reviewItem.pageStart, page_image_path: entry.reviewItem.pageImagePath, bbox: entry.reviewItem.bbox }]),
      JSON.stringify(entry.textRegions),
      JSON.stringify(entry.question.figures || entry.reviewItem.figures || entry.cutRecord?.figures || []),
      JSON.stringify(payload),
      now,
      now
    )
  }

  updateBatchWorkflow(batchId)
  return { batchId, runId, createdCount: questions.length }
}

function createPendingBankRerunTask(sourceRunId: string, resultId: string, options: { forceRegionOcr?: boolean } = {}) {
  ensureQuestionAssetLink()
  const sourceRun = getRun(sourceRunId)
  if (!sourceRun) throw new Error('批次不存在。')
  const reviewItem = getReviewItems(sourceRunId).find((entry) => entry.resultId === resultId)
  if (!reviewItem) throw new Error('当前题目缺少原始 OCR 分块信息。')
  const cutRecord = loadCutResultRecord(sourceRunId, resultId)
  const sourceSegments = Array.isArray((reviewItem as any).segments) && (reviewItem as any).segments.length
    ? (reviewItem as any).segments
    : (Array.isArray(cutRecord?.segments) ? cutRecord.segments : [])
  const fallbackSegment = { page_number: reviewItem.pageStart, page_image_path: reviewItem.pageImagePath, bbox: reviewItem.bbox }
  const textRegions = Array.isArray((reviewItem as any).textRegions) && (reviewItem as any).textRegions.length
    ? (reviewItem as any).textRegions
    : (Array.isArray(cutRecord?.text_regions) ? cutRecord.text_regions : [
      { kind: 'problem', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
      { kind: 'answer', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
      { kind: 'analysis', segments: sourceSegments.length ? sourceSegments : [fallbackSegment] },
    ])

  const now = nowIso()
  const batchId = createId('batch', 'pending_bank_rerun')
  const runId = createId('run', 'pending_bank_rerun')
  const runDir = path.join(runsRoot, runId)
  fs.mkdirSync(runDir, { recursive: true })
  db.prepare('INSERT INTO pdf_slicer_batches (id, title, material_type, workflow_mode, workflow_status, created_at, uploaded_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(batchId, batchId, 'unknown', 'single', 'processing', now, 1)
  db.prepare(`
    INSERT INTO pdf_slicer_runs (
      run_id, batch_id, upload_mode, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind, run_dir, document_diagnostics_json,
      material_type, file_role, stage, classification_confidence, classification_reasons_json,
      created_at, updated_at, slice_status, quick_review_status, total_questions, approved_questions, unreviewed_questions, ocr_status,
      rules_version, rules_hash, rules_fallback_used, rules_warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 'submitted', 1, 1, 0, 'idle', 0, '', 0, '[]')
  `).run(
    runId,
    batchId,
    'question_bank_rerun',
    '待入库单题重新 OCR',
    '待入库单题重新 OCR',
    '',
    'pending_bank',
    'pending_bank',
    assetPathFor(runDir),
    JSON.stringify({ pendingBankRerun: true, sourceRunId, resultId }),
    'unknown',
    'full',
    sourceRun.stage || configuredGradeStages()[0] || '高三',
    1,
    JSON.stringify(['待入库单题重新 OCR']),
    now,
    now
  )
  const payload = {
    originalQuestionId: resultId,
    originalSourceRunId: sourceRunId,
    sourcePdf: `question_assets/${sourceRun.pdfPath}`,
    reviewedImagePath: reviewItem.autoImagePath || reviewItem.pageImagePath,
    forceRegionOcr: Boolean(options.forceRegionOcr),
  }
  db.prepare(`
    INSERT INTO pdf_slicer_review_items (
      result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready_for_ocr', ?, ?, ?)
  `).run(
    `${runId}__${resultId}`,
    runId,
    reviewItem.questionLabel || resultId,
    reviewItem.pageStart,
    reviewItem.pageEnd,
    reviewItem.pageImagePath,
    reviewItem.autoImagePath || reviewItem.pageImagePath,
    JSON.stringify(reviewItem.bbox || cutRecord?.bbox || {}),
    JSON.stringify(sourceSegments.length ? sourceSegments : [fallbackSegment]),
    JSON.stringify(textRegions),
    JSON.stringify(reviewItem.figures || cutRecord?.figures || []),
    JSON.stringify(payload),
    now,
    now
  )
  updateBatchWorkflow(batchId)
  return { batchId, runId, createdCount: 1 }
}

function importMigratedOcrResults(runId: string) {
  const runRow = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  const roleRow = runRow ? { file_role: runRow.file_role } : undefined
  if (normalizeFileRole(roleRow?.file_role) === 'solutions') {
    const imported = importMigratedOcrSolutionResults(runId)
    tryAutoMergeSeparatedExamForRun(runId)
    return imported
  }
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  const sourceTitle = cleanSourceTitle(runRow?.paper_title || runRow?.pdf_name || '', runRow?.pdf_name || 'OCR 导入')
  const runStage = String(runRow?.stage || configuredGradeStages()[0] || '高三')
  const isQuestionBankRerun = runRow?.upload_mode === 'question_bank_rerun'
  if (!fs.existsSync(draftsDir)) return 0
  let imported = 0
  for (const entry of fs.readdirSync(draftsDir)) {
    if (!entry.startsWith(runId)) continue
    const resultPath = path.join(draftsDir, entry, 'ocr_result.json')
    if (!fs.existsSync(resultPath)) continue
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as Record<string, any>
    const targetQuestionId = isQuestionBankRerun
      ? String(result.original_question_id || entry.split('__').slice(1).join('__') || result.id || '')
      : String(result.id || '')
    const questionNo = cleanQuestionNoLabel(String(result.question_no || ''))
    const stem = stripOcrTemplateNoise(stripLeadingQuestionNo(String(result.problem_text || '').trim(), questionNo)).trim()
    const answer = stripOcrTemplateNoise(String(result.answer || '').trim()).trim()
    const analysis = stripOcrTemplateNoise(String(result.analysis || '').trim()).trim()
    const knowledgePoints = normalizeTags(result.knowledge_points)
    const solutionMethods = normalizeTags(result.solution_methods)
    const difficultyScore10 = normalizeDifficultyScore10(result.difficulty_score_10)
    const difficultyLabel = String(result.difficulty_label || difficultyLabel10(difficultyScore10))
    if (!stem && !answer && !analysis) continue
    const questionType = inferQuestionType(stem, answer)
    const figures = figuresForImportedOcrResult(result, runId)
    const needsFormatReview = false
    const formatReviewJson = '{}'
    const isQuestionOnlyRun = normalizeFileRole(runRow?.file_role) === 'questions'
    const existing = db.prepare('SELECT id, chapter, source_title, source_run_id, source_solution_run_id, merge_status, merge_note, bank_status, updated_at FROM question_bank_items WHERE id = ?').get(targetQuestionId) as {
      id: string
      chapter: string
      source_title: string
      source_run_id: string
      source_solution_run_id: string
      merge_status: string
      merge_note: string
      bank_status: string
      updated_at: string
    } | undefined
    const originalSourceRunId = String(result.original_source_run_id || '')
    if (existing) {
      const draftUpdatedAtMs = fs.statSync(resultPath).mtime.getTime()
      if (!isQuestionBankRerun && parseTimestampMs(existing.updated_at) > draftUpdatedAtMs) {
        continue
      }
      if (isQuestionBankRerun) {
        db.prepare(`
          UPDATE question_bank_items SET
            question_no = ?,
            stage = ?,
            question_type = ?,
            difficulty_score = ?,
            difficulty_score_10 = ?,
            difficulty_label = ?,
            chapter = ?,
            knowledge_points_json = ?,
            solution_methods_json = ?,
            stem_markdown = ?,
            answer_text = ?,
            analysis_markdown = ?,
            search_text = ?,
            figures_json = ?,
            format_review_required = ?,
            format_review_reasons_json = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          questionNo,
          runStage,
          questionType,
          result.needs_human_review ? 4 : 3,
          difficultyScore10,
          difficultyLabel,
          knowledgePoints[0] || existing.chapter || '待整理',
          JSON.stringify(knowledgePoints),
          JSON.stringify(solutionMethods),
          stem,
          answer,
          analysis,
          buildSearchText(stem, answer, analysis, [sourceTitle, knowledgePoints.join(' '), solutionMethods.join(' ')]),
          JSON.stringify(figures),
          needsFormatReview ? 1 : 0,
          formatReviewJson,
          nowIso(),
          targetQuestionId
        )
      } else {
        db.prepare(`
          UPDATE question_bank_items SET
            question_no = ?,
            stage = ?,
            question_type = ?,
            difficulty_score = ?,
            difficulty_score_10 = ?,
            difficulty_label = ?,
            chapter = ?,
            knowledge_points_json = ?,
            solution_methods_json = ?,
            source_title = ?,
            stem_markdown = ?,
            answer_text = ?,
            analysis_markdown = ?,
            search_text = ?,
            slice_image_path = ?,
            figures_json = ?,
            source_run_id = ?,
            bank_status = ?,
            source_solution_run_id = CASE WHEN ? THEN '' ELSE source_solution_run_id END,
            merge_status = ?,
            merge_note = ?,
            format_review_required = ?,
            format_review_reasons_json = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          questionNo,
          runStage,
          questionType,
          result.needs_human_review ? 4 : 3,
          difficultyScore10,
          difficultyLabel,
          knowledgePoints[0] || '待整理',
          JSON.stringify(knowledgePoints),
          JSON.stringify(solutionMethods),
          sourceTitle,
          stem,
          answer,
          analysis,
          buildSearchText(stem, answer, analysis, [sourceTitle, knowledgePoints.join(' '), solutionMethods.join(' ')]),
          stripAssetPrefix(String(result.image_path || '')),
          JSON.stringify(figures),
          runId,
          'ready',
          isQuestionOnlyRun ? 1 : 0,
          isQuestionOnlyRun ? 'waiting_solution' : '',
          isQuestionOnlyRun ? '等待同组解析文件合并。' : '',
          needsFormatReview ? 1 : 0,
          formatReviewJson,
          nowIso(),
          targetQuestionId
        )
      }
      imported += 1
      continue
    }
    const targetSourceRunId = isQuestionBankRerun ? originalSourceRunId : runId
    const targetSourceTitle = isQuestionBankRerun && originalSourceRunId
      ? cleanSourceTitle(getRun(originalSourceRunId)?.paperTitle || getRun(originalSourceRunId)?.pdfName || sourceTitle, sourceTitle)
      : sourceTitle
    createQuestion({
      id: targetQuestionId,
      questionNo,
      stage: runStage,
      questionType,
      difficultyScore: result.needs_human_review ? 4 : 3,
      difficultyScore10,
      difficultyLabel,
      chapter: '待整理',
      knowledgePoints,
      solutionMethods,
      sourceTitle: targetSourceTitle,
      stemMarkdown: stem,
      answerText: answer,
      analysisMarkdown: analysis,
      sliceImagePath: stripAssetPrefix(String(result.image_path || '')),
      figures,
      sourceRunId: targetSourceRunId,
      mergeStatus: normalizeFileRole(runRow?.file_role) === 'questions' ? 'waiting_solution' : '',
      mergeNote: normalizeFileRole(runRow?.file_role) === 'questions' ? '等待同组解析文件合并。' : '',
      needsFormatReview,
      formatIssue: needsFormatReview ? formatIssueFromReviewJson(formatReviewJson) : undefined,
    })
    imported += 1
  }
  tryAutoMergeSeparatedExamForRun(runId)
  return imported
}

function importMigratedOcrSolutionResults(runId: string) {
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  const runRow = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  if (!runRow || !fs.existsSync(draftsDir)) return 0
  db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(runId)
  const insert = db.prepare(`
    INSERT INTO pdf_slicer_solution_items (
      id, batch_id, source_run_id, question_no, answer_text, analysis_markdown, figures_json, source_image_path, match_status, matched_question_id, match_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', ?, ?)
  `)
  let imported = 0
  const now = nowIso()
  for (const entry of fs.readdirSync(draftsDir)) {
    if (!entry.startsWith(runId)) continue
    const resultPath = path.join(draftsDir, entry, 'ocr_result.json')
    if (!fs.existsSync(resultPath)) continue
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as Record<string, any>
    const questionNo = cleanQuestionNoLabel(String(result.question_no || ''))
    const stem = stripOcrTemplateNoise(stripLeadingQuestionNo(String(result.problem_text || '').trim(), questionNo)).trim()
    const answer = stripOcrTemplateNoise(String(result.answer || '').trim()).trim()
    const analysis = stripOcrTemplateNoise(String(result.analysis || stem).trim()).trim()
    if (!answer && !analysis) continue
    const figures = figuresForImportedOcrResult(result, runId).map((figure) => ({ ...figure, usage: 'analysis' }))
    insert.run(
      String(result.id || entry),
      runRow.batch_id,
      runId,
      questionNo,
      answer,
      analysis,
      JSON.stringify(figures),
      stripAssetPrefix(String(result.image_path || '')),
      now,
      now
    )
    imported += 1
  }
  updateBatchWorkflow(runRow.batch_id)
  return imported
}

function tryAutoMergeSeparatedExamForRun(runId: string) {
  const runRow = db.prepare('SELECT batch_id FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as Pick<RunRow, 'batch_id'> | undefined
  if (!runRow?.batch_id) return
  tryAutoMergeSeparatedExam(runRow.batch_id)
}

function tryAutoMergeSeparatedExam(batchId: string) {
  const runs = db.prepare('SELECT * FROM pdf_slicer_runs WHERE batch_id = ?').all(batchId) as RunRow[]
  const questionRuns = runs.filter((run) => normalizeFileRole(run.file_role) === 'questions')
  const solutionRuns = runs.filter((run) => normalizeFileRole(run.file_role) === 'solutions')
  if (!questionRuns.length || !solutionRuns.length) {
    updateBatchWorkflow(batchId)
    return { merged: 0, unresolved: 0, skipped: true, reason: '不是原卷+解析分离批次。' }
  }
  const relevantRuns = [...questionRuns, ...solutionRuns]
  if (!relevantRuns.every((run) => run.ocr_status === 'succeeded')) {
    updateBatchWorkflow(batchId)
    return { merged: 0, unresolved: 0, skipped: true, reason: '等待原卷和解析文件 OCR 完成。' }
  }

  const questionRows = db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id IN (SELECT run_id FROM pdf_slicer_runs WHERE batch_id = ? AND file_role = 'questions')
    ORDER BY serial_no ASC
  `).all(batchId) as QuestionRow[]
  const solutionRows = db.prepare('SELECT * FROM pdf_slicer_solution_items WHERE batch_id = ? ORDER BY created_at ASC').all(batchId) as SolutionRow[]
  const solutionsByNo = new Map<string, SolutionRow[]>()
  for (const solution of solutionRows) {
    const key = normalizedQuestionNo(solution.question_no)
    if (!key) {
      db.prepare("UPDATE pdf_slicer_solution_items SET match_status = 'unmatched', match_note = ?, updated_at = ? WHERE id = ?")
        .run('解析题号缺失，无法自动合并。', nowIso(), solution.id)
      continue
    }
    const list = solutionsByNo.get(key) || []
    list.push(solution)
    solutionsByNo.set(key, list)
  }

  let merged = 0
  let unresolved = 0
  const updateQuestion = db.prepare(`
    UPDATE question_bank_items SET
      answer_text = CASE WHEN TRIM(answer_text) = '' THEN ? ELSE answer_text END,
      analysis_markdown = CASE WHEN TRIM(analysis_markdown) = '' THEN ? ELSE analysis_markdown END,
      search_text = ?,
      figures_json = ?,
      source_solution_run_id = ?,
      merge_status = ?,
      merge_note = ?,
      bank_status = ?,
      updated_at = ?
    WHERE id = ?
  `)
  const updateSolution = db.prepare("UPDATE pdf_slicer_solution_items SET match_status = ?, matched_question_id = ?, match_note = ?, updated_at = ? WHERE id = ?")
  for (const question of questionRows) {
    const key = normalizedQuestionNo(question.question_no)
    const matches = key ? (solutionsByNo.get(key) || []) : []
    if (!key) {
      unresolved += 1
      updateQuestion.run('', '', question.search_text, question.figures_json, '', 'missing_question_no', '原卷题号缺失，无法匹配解析。', 'blocked', nowIso(), question.id)
      continue
    }
    if (matches.length === 1) {
      const solution = matches[0]
      const existingFigures = parseJson<Array<Record<string, unknown>>>(question.figures_json || '[]', [])
      const solutionFigures = parseJson<Array<Record<string, unknown>>>(solution.figures_json || '[]', [])
      const figures = [...existingFigures, ...solutionFigures]
      const mergedAnswer = question.answer_text || solution.answer_text
      const mergedAnalysis = question.analysis_markdown || solution.analysis_markdown
      updateQuestion.run(
        solution.answer_text,
        solution.analysis_markdown,
        buildSearchText(question.stem_markdown, mergedAnswer, mergedAnalysis, [question.source_title, question.knowledge_points_json, question.solution_methods_json]),
        JSON.stringify(figures),
        solution.source_run_id,
        'merged',
        '已按题号合并原卷题干与解析文件。',
        question.bank_status === 'skipped' || question.bank_status === 'banked' ? question.bank_status : 'ready',
        nowIso(),
        question.id
      )
      updateSolution.run('matched', question.id, '已按题号匹配原卷题目。', nowIso(), solution.id)
      merged += 1
      continue
    }
    unresolved += 1
    const note = matches.length > 1 ? '解析文件中存在重复题号，需人工确认。' : '未找到同题号解析，需人工补充。'
    updateQuestion.run('', '', question.search_text, question.figures_json, '', matches.length > 1 ? 'duplicate_solution' : 'missing_solution', note, 'blocked', nowIso(), question.id)
    for (const solution of matches) updateSolution.run('duplicate', '', note, nowIso(), solution.id)
  }

  for (const solution of solutionRows) {
    const key = normalizedQuestionNo(solution.question_no)
    const hasQuestion = key && questionRows.some((question) => normalizedQuestionNo(question.question_no) === key)
    if (!hasQuestion) {
      updateSolution.run('unmatched', '', '未找到同题号原卷题目。', nowIso(), solution.id)
      unresolved += 1
    }
  }
  updateBatchWorkflow(batchId)
  return { merged, unresolved, skipped: false }
}

type FormatIssue = {
  field: string
  code: string
  message: string
  snippet: string
  context?: string
  mode?: string
  start?: number
  end?: number
}

function formatIssueFromReviewJson(value = ''): FormatIssue | undefined {
  const payload = parseJson<Record<string, any>>(value || '{}', {})
  const issue = payload.issue
  if (issue && typeof issue === 'object') {
    return {
      field: String(issue.field || 'system'),
      code: String(issue.code || 'format_error'),
      message: String(issue.message || ''),
      snippet: String(issue.snippet || ''),
      context: String(issue.context || issue.snippet || ''),
      mode: issue.mode ? String(issue.mode) : undefined,
      start: Number.isFinite(Number(issue.start)) ? Number(issue.start) : undefined,
      end: Number.isFinite(Number(issue.end)) ? Number(issue.end) : undefined,
    }
  }
  return undefined
}

function runQuestionClassification(runId: string) {
  const scriptPath = path.join(sourceRoot, 'server', 'python', 'scripts', 'classify_question_bank.py')
  const settings = readOcrSettings()
  const stdout = execFileSync(pythonCommand(), [scriptPath, '--run-id', runId, '--concurrency', settings.cleanupConcurrency || '20'], {
    cwd: pythonRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  return parseJson<Record<string, any>>(stdout, { runId, total: 0, updated: 0, failed: 0, failures: [] })
}

function classifyRunAfterImport(runId: string, logPath?: string) {
  const settings = readOcrSettings()
  if (settings.classificationEnabled === 'false') return null
  try {
    const report = runQuestionClassification(runId)
    if (logPath) {
      fs.appendFileSync(logPath, `[${nowIso()}] classification updated=${report.updated ?? 0} failed=${report.failed ?? 0}\n`)
    }
    return report
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (logPath) fs.appendFileSync(logPath, `[${nowIso()}] classification skipped/failed: ${message}\n`)
    return { failed: true, error: message }
  }
}

function getOcrDraftStats(runId: string) {
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  const stats = { total: 0, successful: 0, failed: 0 }
  if (!fs.existsSync(draftsDir)) return stats
  for (const entry of fs.readdirSync(draftsDir)) {
    if (!entry.startsWith(runId)) continue
    const resultPath = path.join(draftsDir, entry, 'ocr_result.json')
    if (!fs.existsSync(resultPath)) continue
    stats.total += 1
    const result = parseJson<Record<string, any>>(fs.readFileSync(resultPath, 'utf8'), {})
    const hasContent = Boolean(
      String(result.problem_text || '').trim() ||
      String(result.answer || '').trim() ||
      String(result.analysis || '').trim()
    )
    if (result.ocr_status === 'parse_failed' || result.ocr_status === 'failed' || !hasContent) {
      stats.failed += 1
    } else {
      stats.successful += 1
    }
  }
  return stats
}

function ocrFailureReasonsFromJobLog(runId: string) {
  const reasons = new Map<string, string>()
  const logPath = ocrJobLogPath(runId)
  if (!fs.existsSync(logPath)) return reasons
  const text = fs.readFileSync(logPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(`| ${runId}`)) continue
    const cells = line.split('|').map((cell) => cell.trim())
    const id = cells[1] || ''
    const status = cells[11] || ''
    const reason = cells[12] || ''
    if (id && (status === 'failed' || status === 'parse_failed' || reason)) {
      reasons.set(id, reason || status)
    }
  }
  return reasons
}

function ocrFailureReasonFromResult(result: Record<string, any>, fallback = '') {
  const post = result.post_processing && typeof result.post_processing === 'object' ? result.post_processing as Record<string, any> : {}
  const wholeError = post.whole_question_error && typeof post.whole_question_error === 'object' ? post.whole_question_error as Record<string, any> : {}
  return String(
    wholeError.error_reason ||
    wholeError.message ||
    result.ocr_error ||
    result.error_reason ||
    fallback ||
    'OCR 未生成可入库内容。'
  )
}

function pendingBankOcrFailureItems(runId: string, importedIds: Set<string>, sourceTitle: string) {
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  const reportReasons = ocrFailureReasonsFromJobLog(runId)
  const runStage = getRun(runId)?.stage || configuredGradeStages()[0] || '高三'
  const failures: Array<PublicQuestion & { pendingBankReadOnly: true }> = []
  const reviewItems = getReviewItems(runId).filter((item) => item.reviewStatus === 'ready_for_ocr' && !importedIds.has(item.resultId))
  reviewItems.forEach((item, index) => {
    const resultPath = path.join(draftsDir, item.resultId, 'ocr_result.json')
    const result = fs.existsSync(resultPath)
      ? parseJson<Record<string, any>>(fs.readFileSync(resultPath, 'utf8'), {})
      : null
    const hasContent = result ? Boolean(
      String(result.problem_text || '').trim() ||
      String(result.answer || '').trim() ||
      String(result.analysis || '').trim()
    ) : false
    const status = String(result?.ocr_status || (result ? 'unknown' : 'missing'))
    if (result && status === 'draft' && hasContent) return
    const reason = result
      ? ocrFailureReasonFromResult(result, reportReasons.get(item.resultId))
      : (reportReasons.get(item.resultId) || 'OCR 请求未生成结果文件，可能是远端连接中断或任务异常结束。')
    const questionNo = cleanQuestionNoLabel(String(result?.question_no || item.questionLabel || ''))
    const sliceImagePath = stripAssetPrefix(item.autoImagePath || item.pageImagePath || String(result?.image_path || ''))
    failures.push({
      id: item.resultId,
      serialNo: Number.parseInt(questionNo, 10) || index + 1,
      questionNo,
      stage: runStage,
      questionType: 'OCR题',
      difficultyScore: 3,
      difficultyScore10: 5,
      difficultyLabel: difficultyLabel10(5),
      chapter: '待整理',
      knowledgePoints: [],
      solutionMethods: [],
      sourceTitle,
      bankStatus: 'blocked',
      stemMarkdown: '',
      answerText: '',
      analysisMarkdown: '',
      problemBlocks: [],
      answerBlocks: [],
      analysisBlocks: [],
      searchText: reason,
      sliceImagePath,
      ocrSegmentImages: [],
      figures: item.figures || [],
      sourceRunId: runId,
      sourceOcrProvider: getRun(runId)?.ocrProvider || 'legacy',
      sourceSolutionRunId: '',
      mergeStatus: '',
      mergeNote: '',
      createdAt: '',
      updatedAt: '',
      hasFigures: Boolean(item.figures?.length),
      pendingBankReadOnly: true,
      needsFormatReview: true,
      formatIssue: {
        field: 'ocr',
        code: status === 'missing' ? 'ocr_result_missing' : status || 'ocr_failed',
        message: reason,
        snippet: status === 'missing' ? '未生成 ocr_result.json' : `ocr_status: ${status}`,
      },
    })
  })
  return failures
}

function ocrJobLogPath(runId: string) {
  return path.join(pythonDataRoot, 'ocr_jobs', `${runId}.log`)
}

function tailText(filePath: string, limit = 6000) {
  if (!fs.existsSync(filePath)) return ''
  const stat = fs.statSync(filePath)
  const fd = fs.openSync(filePath, 'r')
  try {
    const length = Math.min(stat.size, limit)
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length))
    return buffer.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function getOcrProgress(runId: string) {
  const run = getRun(runId)
  if (!run) return null
  const importedQuestions = (db.prepare('SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ?').get(runId) as { count: number }).count
  const draftStats = getOcrDraftStats(runId)
  const total = run.approvedQuestions || run.totalQuestions || 0
  const processed = Math.max(importedQuestions, draftStats.total, run.processedQuestions || 0)
  const itemProgress = total ? Math.min(1, processed / total) : 0
  const providerProgress = run.ocrProvider === 'doc2x' || run.ocrProvider === 'glm' ? Math.max(0, Math.min(1, Number(run.ocrProviderProgress || 0) / 100)) : 0
  const progressPercent = Math.max(itemProgress, providerProgress, run.progressPercent || 0)
  return {
    run: { ...run, processedQuestions: processed, progressPercent, totalOcrQuestions: total },
    active: activeOcrProcesses.has(runId),
    importedQuestions,
    draftCount: draftStats.total,
    successfulDraftCount: draftStats.successful,
    failedDraftCount: draftStats.failed,
    totalQuestions: total,
    progressPercent,
    logTail: tailText(ocrJobLogPath(runId)),
  }
}

function runMigratedOcr(runId: string) {
  const provider = normalizeOcrProvider(readOcrSettings().ocrProvider)
  if (!hasOcrConfig(provider)) {
    throw new Error('缺少 OCR 配置：请在应用 OCR 设置或进程环境中配置 OCR_API_BASE_URL、OCR_API_KEY、OCR_MODEL。')
  }
  if (provider === 'doc2x') {
    throw new Error('Doc2X 仅支持后台任务模式。')
  }
  if (provider === 'glm') {
    throw new Error('GLM-OCR 仅支持后台任务模式。')
  }
  const count = exportRunForMigratedOcr(runId)
  const settings = readOcrSettings()
  execFileSync(pythonCommand(), ['scripts/run_ocr_trial.py', '--max-items', String(count), '--concurrency', settings.concurrency || '20', '--force', '--skip-manifest-check'], {
    cwd: pythonRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const imported = importMigratedOcrResults(runId)
  if (imported <= 0) {
    throw new Error('OCR runner 已结束，但没有产生待入库的题目内容；请检查 server/python/ocr_drafts/ocr_trial_report.md。')
  }
  return imported
}

async function finishMigratedOcrBackground(runId: string, count: number, code: number | null, signal: NodeJS.Signals | null, logPath: string) {
  try {
    const sourceRow = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
    if (sourceRow) syncDoc2xState(sourceRow)
    const current = db.prepare('SELECT ocr_error FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as { ocr_error?: string } | undefined
    if (current?.ocr_error === '用户强制中断') {
      tryAutoMergeSeparatedExamForRun(runId)
      return
    }
    if (code === 0) {
      const imported = importMigratedOcrResults(runId)
      classifyRunAfterImport(runId, logPath)
      const finishedAt = nowIso()
      if (imported >= count) {
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'succeeded', ocr_error = '', ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
          .run(finishedAt, finishedAt, runId)
      } else if (imported > 0) {
        const message = `OCR 部分完成：已生成 ${imported}/${count} 道待入库题目；请查看 server/python/ocr_jobs/${runId}.log。`
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
          .run(message, finishedAt, finishedAt, runId)
      } else {
        const message = 'OCR runner 已结束，但没有产生待入库的题目内容；请检查 OCR 进度日志。'
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
          .run(message, finishedAt, finishedAt, runId)
      }
    } else {
      const imported = importMigratedOcrResults(runId)
      const finishedAt = nowIso()
      const message = imported > 0
        ? `OCR 部分完成：已生成 ${imported}/${count} 道待入库题目；请查看 server/python/ocr_jobs/${runId}.log。`
        : `OCR runner 异常退出：code=${code ?? 'null'} signal=${signal ?? 'null'}；请检查 OCR 进度日志。`
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
        .run(message, finishedAt, finishedAt, runId)
    }
  } catch (error) {
    const finishedAt = nowIso()
    const message = error instanceof Error ? error.message : String(error)
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
      .run(message, finishedAt, finishedAt, runId)
  }
  tryAutoMergeSeparatedExamForRun(runId)
}

function startMigratedOcrBackground(runId: string, options: { force?: boolean } = {}) {
  if (activeOcrProcesses.has(runId)) {
    throw new Error('该 OCR 任务已经在运行。')
  }
  const runRow = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  if (!runRow) throw new Error('批次不存在。')
  const settings = readOcrSettings()
  const provider = runRow.ocr_provider === 'doc2x' || runRow.ocr_provider === 'glm' || runRow.ocr_provider === 'legacy'
    ? normalizeOcrProvider(runRow.ocr_provider)
    : normalizeOcrProvider(settings.ocrProvider)
  if (provider === 'legacy') {
    throw new Error('历史 OCR 已下线，无法重新启动；请在 OCR 设置中选择 GLM-OCR 后从题库或待入库页面重新识别。')
  }
  if (!hasOcrConfig(provider)) {
    throw new Error(provider === 'doc2x'
      ? '缺少 Doc2X 配置：请在 OCR 设置中配置 Doc2X API Key。'
      : provider === 'glm'
        ? '缺少 GLM-OCR 配置：请在 OCR 设置中配置 GLM-OCR API Key。'
        : '缺少 OCR 配置：请在应用 OCR 设置或进程环境中配置 OCR_API_BASE_URL、OCR_API_KEY、OCR_MODEL。')
  }
  const count = exportRunForMigratedOcr(runId)
  const pythonRoot = path.join(sourceRoot, 'server', 'python')
  const logPath = ocrJobLogPath(runId)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  db.prepare(`
    UPDATE pdf_slicer_runs
    SET ocr_provider = ?, ocr_provider_phase = ?, ocr_provider_progress = ?, updated_at = ?
    WHERE run_id = ?
  `).run(provider, provider === 'doc2x' || provider === 'glm' ? 'starting' : '', provider === 'doc2x' || provider === 'glm' ? 1 : 0, nowIso(), runId)
  fs.writeFileSync(logPath, `[${nowIso()}] OCR runner started. provider=${provider} total=${count} concurrency=${settings.concurrency || '20'}\n`)
  let args: string[]
  if (provider === 'doc2x') {
    const artifactDir = doc2xArtifactDir(runRow)
    fs.mkdirSync(artifactDir, { recursive: true })
    const pdfPath = resolveStoragePath(runRow.pdf_path)
    if (!pdfPath || !fs.existsSync(pdfPath)) throw new Error('Doc2X 找不到当前批次的原始 PDF。')
    args = [
      'scripts/run_doc2x_ocr.py',
      '--run-id', runId,
      '--pdf', pdfPath,
      '--manifest', path.join(pythonDataRoot, 'output', 'ocr_manifest.json'),
      '--drafts-root', path.join(pythonDataRoot, 'ocr_drafts'),
      '--artifact-dir', artifactDir,
      '--storage-root', storageRoot,
    ]
    if (options.force === true) args.push('--force')
  } else if (provider === 'glm') {
    const artifactDir = glmArtifactDir(runRow)
    fs.mkdirSync(artifactDir, { recursive: true })
    const pdfPath = resolveStoragePath(runRow.pdf_path)
    const isSingleQuestion = runRow.upload_mode === 'question_bank_rerun' || runRow.upload_mode === 'pending_bank_rerun'
    if (!isSingleQuestion && (!pdfPath || !fs.existsSync(pdfPath))) throw new Error('GLM-OCR 找不到当前批次的原始 PDF。')
    args = [
      'scripts/run_glm_ocr.py',
      '--run-id', runId,
      '--pdf', pdfPath || path.join(artifactDir, 'placeholder.pdf'),
      '--manifest', path.join(pythonDataRoot, 'output', 'ocr_manifest.json'),
      '--drafts-root', path.join(pythonDataRoot, 'ocr_drafts'),
      '--artifact-dir', artifactDir,
      '--storage-root', storageRoot,
    ]
    if (isSingleQuestion) args.push('--single-question')
    if (options.force === true) args.push('--force')
  } else {
    args = ['scripts/run_ocr_trial.py', '--max-items', String(count), '--concurrency', settings.concurrency || '20', '--skip-manifest-check']
    if (options.force !== false) args.push('--force')
  }
  const child = spawn(pythonCommand(), args, {
    cwd: pythonRoot,
    env: process.env,
  })
  activeOcrProcesses.set(runId, child)
  const append = (chunk: Buffer) => fs.appendFileSync(logPath, chunk)
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.on('close', (code, signal) => {
    activeOcrProcesses.delete(runId)
    fs.appendFileSync(logPath, `\n[${nowIso()}] OCR runner exited. code=${code ?? 'null'} signal=${signal ?? 'null'}\n`)
    void finishMigratedOcrBackground(runId, count, code, signal, logPath)
  })
  return count
}

function removeRunArtifacts(runId: string) {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  const questionIds = (db.prepare('SELECT id FROM question_bank_items WHERE source_run_id = ?').all(runId) as Array<{ id: string }>).map((item) => item.id)
  const child = activeOcrProcesses.get(runId)
  if (child) {
    child.kill('SIGTERM')
    activeOcrProcesses.delete(runId)
  }
  if (row?.run_dir) fs.rmSync(resolveStoragePath(row.run_dir), { recursive: true, force: true })
  for (const id of questionIds) {
    fs.rmSync(path.join(dataDir, 'question_figures', id), { recursive: true, force: true })
  }
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  if (fs.existsSync(draftsDir)) {
    for (const entry of fs.readdirSync(draftsDir)) {
      if (entry.startsWith(runId)) fs.rmSync(path.join(draftsDir, entry), { recursive: true, force: true })
    }
  }
  fs.rmSync(ocrJobLogPath(runId), { force: true })
  db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(runId)
}

function removeRunOcrOutputs(runId: string) {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(runId) as RunRow | undefined
  const questionIds = (db.prepare('SELECT id FROM question_bank_items WHERE source_run_id = ?').all(runId) as Array<{ id: string }>).map((item) => item.id)
  db.prepare('DELETE FROM question_bank_items WHERE source_run_id = ?').run(runId)
  for (const id of questionIds) {
    fs.rmSync(path.join(dataDir, 'question_figures', id), { recursive: true, force: true })
  }
  const draftsDir = path.join(pythonDataRoot, 'ocr_drafts')
  if (fs.existsSync(draftsDir)) {
    for (const entry of fs.readdirSync(draftsDir)) {
      if (entry.startsWith(runId)) fs.rmSync(path.join(draftsDir, entry), { recursive: true, force: true })
    }
  }
  fs.rmSync(ocrJobLogPath(runId), { force: true })
  if (row) fs.rmSync(doc2xArtifactDir(row), { recursive: true, force: true })
  db.prepare(`
    UPDATE pdf_slicer_runs
    SET ocr_external_uid = '', ocr_provider_phase = '', ocr_provider_progress = 0, ocr_provider_result_path = ''
    WHERE run_id = ?
  `).run(runId)
  db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(runId)
}

function mapCollectionSummary(row: CollectionRow, questionCount = 0) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    kind: row.kind,
    status: row.status,
    totalScore: Number(row.total_score || 0),
    timeLimit: Number(row.time_limit || 0),
    exportFormat: row.export_format || 'markdown',
    questionCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function getCollection(id: string) {
  const collection = db.prepare('SELECT * FROM question_bank_collections WHERE id = ?').get(id) as CollectionRow | undefined
  if (!collection) return null
  const rows = (db.prepare(`
    SELECT q.*, ci.id AS relation_id, ci.sort_order, ci.score, ci.section_name
    FROM question_bank_collection_items ci
    JOIN question_bank_items q ON q.id = ci.question_id
    WHERE ci.collection_id = ?
    ORDER BY ci.sort_order ASC, ci.created_at ASC
  `).all(id) as CollectionItemRow[])
    .sort((left, right) => {
      const leftGroup = questionTypeOrder(normalizeQuestionType(
        left.question_type,
        left.stem_markdown,
        left.answer_text,
      ))
      const rightGroup = questionTypeOrder(normalizeQuestionType(
        right.question_type,
        right.stem_markdown,
        right.answer_text,
      ))
      return leftGroup - rightGroup || left.sort_order - right.sort_order
    })
  const sectionNames = collectionSectionNames(rows)
  let previousSection = ''
  return {
    ...mapCollectionSummary(collection, rows.length),
    questionCount: rows.length,
    questions: rows.map((row) => {
      const item = mapQuestion(row)
      const section = sectionNames.get(item.questionType) || ''
      const sectionName = section && section !== previousSection ? section : ''
      if (section) previousSection = section
      return {
        relationId: row.relation_id,
        sortOrder: row.sort_order,
        score: Number(row.score || 0),
        sectionName,
        item,
      }
    }),
  }
}

function getBasket() {
  return getCollection('basket') ?? {
    id: 'basket',
    title: '试题篮',
    subtitle: '',
    description: '',
    kind: 'basket',
    status: 'draft',
    totalScore: 0,
    timeLimit: 0,
    exportFormat: 'markdown',
    questionCount: 0,
    createdAt: '',
    updatedAt: '',
    questions: [],
  }
}

function collectionExists(id: string) {
  return Boolean(db.prepare('SELECT id FROM question_bank_collections WHERE id = ?').get(id))
}

function refreshCollectionScore(id: string) {
  const row = db.prepare('SELECT COALESCE(SUM(score), 0) AS total FROM question_bank_collection_items WHERE collection_id = ?').get(id) as { total: number }
  db.prepare('UPDATE question_bank_collections SET total_score = ?, updated_at = ? WHERE id = ?').run(Number(row.total || 0), nowIso(), id)
}

function defaultCollectionItemScore(questionType: string) {
  if (questionType === '多选题') return 6
  if (questionType === '解答题') return 15
  return 5
}

function normalizeCollectionKind(value: unknown) {
  return value === 'basket' ? 'basket' : 'paper'
}

function normalizeCollectionStatus(value: unknown) {
  return value === 'finalized' ? 'finalized' : 'draft'
}

function normalizeExportFormat(value: unknown) {
  return value === 'latex' ? 'latex' : 'markdown'
}

function normalizeExportRecordSourceType(value: unknown): ExportRecordSourceType | '' {
  if (value === 'collection' || value === 'run') return value
  return ''
}

function mapExportRecord(row: ExportRecordRow) {
  return {
    id: row.id,
    sourceType: row.source_type,
    collectionId: row.collection_id,
    runId: row.run_id,
    title: row.title,
    format: row.format,
    variant: row.variant,
    filename: row.filename,
    path: row.path,
    url: row.url,
    items: parseJson<ExportRecordItemSnapshot[]>(row.items_json || '[]', []),
    contentLength: Number(row.content_length || 0),
    questionCount: Number(row.question_count || 0),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  }
}

function collectionExportItems(collection: NonNullable<ReturnType<typeof getCollection>>): ExportRecordItemSnapshot[] {
  return collection.questions.map((entry, index) => ({
    questionId: String(entry.item.id || ''),
    exportOrder: index + 1,
  })).filter((item) => item.questionId)
}

function runExportItems(runId: string): ExportRecordItemSnapshot[] {
  return (db.prepare(`
    SELECT id
    FROM question_bank_items
    WHERE source_run_id = ?
    ORDER BY serial_no ASC, created_at ASC
  `).all(runId) as Array<{ id: string }>).map((row, index) => ({
    questionId: row.id,
    exportOrder: index + 1,
  }))
}

function exportRecordFileSize(recordPath = '', recordUrl = '') {
  const urlPath = String(recordUrl || '').replace(/^\/assets\//, '')
  const rawPath = String(recordPath || urlPath || '').trim()
  if (!rawPath) return 0
  try {
    const stat = fs.statSync(resolveStoragePath(rawPath))
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

function backfillExportRecordFileSizes() {
  const rows = db.prepare(`
    SELECT id, path, url
    FROM question_bank_export_records
    WHERE status = 'succeeded'
      AND LOWER(format) = 'pdf'
      AND content_length = 0
      AND (path != '' OR url != '')
  `).all() as Array<Pick<ExportRecordRow, 'id' | 'path' | 'url'>>
  if (!rows.length) return 0
  const update = db.prepare('UPDATE question_bank_export_records SET content_length = ? WHERE id = ?')
  let updated = 0
  for (const row of rows) {
    const size = exportRecordFileSize(row.path, row.url)
    if (size <= 0) continue
    update.run(size, row.id)
    updated += 1
  }
  return updated
}

function backfillExportRecordItems() {
  const rows = db.prepare(`
    SELECT id, source_type, collection_id, run_id, items_json, question_count
    FROM question_bank_export_records
    WHERE items_json = ''
       OR items_json = '[]'
       OR items_json IS NULL
  `).all() as Array<Pick<ExportRecordRow, 'id' | 'source_type' | 'collection_id' | 'run_id' | 'items_json' | 'question_count'>>
  if (!rows.length) return 0
  const update = db.prepare('UPDATE question_bank_export_records SET items_json = ? WHERE id = ?')
  let updated = 0
  for (const row of rows) {
    const items = row.source_type === 'collection' && row.collection_id
      ? collectionExportItems(getCollection(row.collection_id) ?? getBasket())
      : row.source_type === 'run' && row.run_id
        ? runExportItems(row.run_id)
        : []
    const expectedCount = Number(row.question_count || 0)
    if (!items.length || (expectedCount > 0 && items.length !== expectedCount)) continue
    update.run(JSON.stringify(items), row.id)
    updated += 1
  }
  return updated
}

function restoreExportRecordToCollection(recordId: string, targetCollectionId: string, options: { syncTitle?: boolean } = {}) {
  const record = db.prepare('SELECT * FROM question_bank_export_records WHERE id = ?').get(recordId) as ExportRecordRow | undefined
  if (!record) throw new Error('导出记录不存在。')
  if (!collectionExists(targetCollectionId)) throw new Error('目标试题篮不存在。')
  const items = parseJson<ExportRecordItemSnapshot[]>(record.items_json || '[]', [])
    .map((item) => ({
      questionId: String(item.questionId || '').trim(),
      exportOrder: Math.max(1, Math.floor(Number(item.exportOrder || 0))),
    }))
    .filter((item) => item.questionId)
    .sort((left, right) => left.exportOrder - right.exportOrder)
  if (!items.length) throw new Error('该导出记录没有可回填的题目快照。')

  const seen = new Set<string>()
  const uniqueItems = items.filter((item) => {
    if (seen.has(item.questionId)) return false
    seen.add(item.questionId)
    return true
  })
  const questions = uniqueItems.map((item) => ({
    snapshot: item,
    row: db.prepare('SELECT * FROM question_bank_items WHERE id = ?').get(item.questionId) as QuestionRow | undefined,
  }))
  const missing = questions.filter((item) => !item.row).map((item) => item.snapshot.questionId)
  if (missing.length) {
    throw new Error(`有 ${missing.length} 道题已不存在，无法回填。`)
  }

  const now = nowIso()
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM question_bank_collection_items WHERE collection_id = ?').run(targetCollectionId)
    const insert = db.prepare(`
      INSERT INTO question_bank_collection_items
        (id, collection_id, question_id, sort_order, score, section_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    questions.forEach((entry, index) => {
      const row = entry.row as QuestionRow
      insert.run(
        createId('rel'),
        targetCollectionId,
        row.id,
        entry.snapshot.exportOrder || index + 1,
        defaultCollectionItemScore(normalizeQuestionType(row.question_type, row.stem_markdown, row.answer_text)),
        '',
        now
      )
    })
    const restoredTitle = String(record.title || '').trim()
    if (options.syncTitle && restoredTitle) {
      db.prepare('UPDATE question_bank_collections SET title = ?, updated_at = ? WHERE id = ?').run(restoredTitle, now, targetCollectionId)
    } else {
      db.prepare('UPDATE question_bank_collections SET updated_at = ? WHERE id = ?').run(now, targetCollectionId)
    }
    refreshCollectionScore(targetCollectionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    restoredCount: questions.length,
    collection: getCollection(targetCollectionId),
    exportRecord: mapExportRecord(record),
  }
}

function clearMismatchedExportRecordItems() {
  const rows = db.prepare(`
    SELECT id, question_count, items_json
    FROM question_bank_export_records
    WHERE question_count > 0
      AND items_json != ''
      AND items_json != '[]'
  `).all() as Array<Pick<ExportRecordRow, 'id' | 'question_count' | 'items_json'>>
  if (!rows.length) return 0
  const update = db.prepare("UPDATE question_bank_export_records SET items_json = '[]' WHERE id = ?")
  let cleared = 0
  for (const row of rows) {
    const items = parseJson<ExportRecordItemSnapshot[]>(row.items_json || '[]', [])
    if (items.length === Number(row.question_count || 0)) continue
    update.run(row.id)
    cleared += 1
  }
  return cleared
}

function createExportRecord(input: {
  sourceType: ExportRecordSourceType
  collectionId?: string
  runId?: string
  title?: string
  format: string
  variant?: string
  filename?: string
  path?: string
  url?: string
  items?: ExportRecordItemSnapshot[]
  contentLength?: number
  questionCount?: number
  status?: 'succeeded' | 'failed'
  error?: string
}) {
  const id = createId('export')
  const now = nowIso()
  db.prepare(`
    INSERT INTO question_bank_export_records
      (id, source_type, collection_id, run_id, title, format, variant, filename, path, url, items_json, content_length, question_count, status, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.sourceType,
    input.collectionId || '',
    input.runId || '',
    input.title || '',
    input.format,
    input.variant || '',
    input.filename || '',
    input.path || '',
    input.url || '',
    JSON.stringify(input.items || []),
    Math.max(0, Math.floor(Number(input.contentLength || 0))),
    Math.max(0, Math.floor(Number(input.questionCount || 0))),
    input.status || 'succeeded',
    input.error || '',
    now
  )
  return db.prepare('SELECT * FROM question_bank_export_records WHERE id = ?').get(id) as ExportRecordRow
}

function listExportRecords(options: {
  sourceType?: ExportRecordSourceType | ''
  collectionId?: string
  runId?: string
  query?: string
  limit?: number
} = {}) {
  const where: string[] = []
  const values: Array<string | number> = []
  if (options.sourceType) {
    where.push('source_type = ?')
    values.push(options.sourceType)
  }
  if (options.collectionId) {
    where.push('collection_id = ?')
    values.push(options.collectionId)
  }
  if (options.runId) {
    where.push('run_id = ?')
    values.push(options.runId)
  }
  const query = String(options.query || '').trim()
  if (query) {
    where.push('(title LIKE ? OR filename LIKE ? OR format LIKE ?)')
    const pattern = `%${query}%`
    values.push(pattern, pattern, pattern)
  }
  const limit = Math.max(1, Math.min(Math.floor(Number(options.limit || 100)), 500))
  const sql = `
    SELECT *
    FROM question_bank_export_records
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `
  return (db.prepare(sql).all(...values, limit) as ExportRecordRow[]).map(mapExportRecord)
}

function normalizeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function questionPlainText(value: string) {
  return String(value || '').replace(/\r\n?/g, '\n').trim()
}

const DOC2X_FIGURE_MARKER_RE = /<!--\s*DOC2X_FIGURE:([^>\s]+)\s*-->/g

function doc2xInlineFigureIds(content: string) {
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  return new Set(Array.from(String(content || '').matchAll(DOC2X_FIGURE_MARKER_RE), (match) => match[1]))
}

function removeDoc2xFigurePlaceholders(content: string) {
  return String(content || '')
    .replace(DOC2X_FIGURE_MARKER_RE, '')
    .replace(/<!--\s*Media\s*-->/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function figuresWithoutInlineMarkers(content: string, figures: Array<Record<string, any>>) {
  const inlineIds = doc2xInlineFigureIds(content)
  return figures.filter((figure) => !inlineIds.has(String(figure.blockId || figure.id || '')))
}

function markdownWithInlineFigures(content: string, figures: Array<Record<string, any>>) {
  const figureById = new Map(figures.map((figure) => [String(figure.blockId || figure.id || ''), figure]))
  return String(content || '')
    .replace(DOC2X_FIGURE_MARKER_RE, (_marker, id) => markdownFigureLines(figureById.get(id) ? [figureById.get(id)!] : []).join('\n'))
    .replace(/<!--\s*Media\s*-->/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function latexWithInlineFigures(content: string, figures: Array<Record<string, any>>) {
  const figureById = new Map(figures.map((figure) => [String(figure.blockId || figure.id || ''), figure]))
  const source = String(content || '')
  const lines: string[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(source))) {
    const text = removeDoc2xFigurePlaceholders(source.slice(cursor, match.index))
    if (text) lines.push(escapeLatex(text))
    const figure = figureById.get(match[1])
    if (figure) lines.push(...latexFigureLines([figure]))
    cursor = match.index + match[0].length
  }
  const tail = removeDoc2xFigurePlaceholders(source.slice(cursor))
  if (tail) lines.push(escapeLatex(tail))
  return lines.join('\n\n')
}

function markdownQuestionLine(index: number, item: any, figures: Array<Record<string, any>> = []) {
  const score = Number(item.score || 0)
  const stem = markdownWithInlineFigures(stripLeadingQuestionNo(item.item.stemMarkdown, item.item.questionNo), figures)
  const scoreText = score ? `（${score} 分）` : ''
  return `**${index}.** ${scoreText}${stem || '（题干待补充）'}`
}

function figureUsageText(usage: string) {
  if (usage === 'stem') return '题干图'
  if (usage === 'options') return '选项图'
  if (usage === 'analysis') return '解析图'
  return '题图'
}

function figureCaptionForExport(figure: Record<string, any>, index: number) {
  const usage = figureUsageText(String(figure.usage || ''))
  const optionLabel = String(figure.optionLabel || '').trim()
  return optionLabel ? `${usage} ${optionLabel}` : `${usage} ${index + 1}`
}

function figureAbsolutePath(figure: Record<string, any>) {
  const rawPath = stripAssetPrefix(String(figure.path || figure.sourcePath || ''))
  if (!rawPath) return ''
  return path.isAbsolute(rawPath) ? rawPath : resolveStoragePath(rawPath)
}

function normalizedFigureId(value: unknown, index: number) {
  return String(value || `review_fig_${index + 1}`).replace(/[^\w.-]+/g, '_')
}

function expandedReviewBBox(bbox: Record<string, any>) {
  const x = Number(bbox.x ?? bbox.x0 ?? 0)
  const y = Number(bbox.y ?? bbox.y0 ?? 0)
  const width = Number(bbox.width ?? bbox.w ?? Number(bbox.x1 ?? 0) - Number(bbox.x0 ?? 0))
  const height = Number(bbox.height ?? bbox.h ?? Number(bbox.y1 ?? 0) - Number(bbox.y0 ?? 0))
  return { x: x - 4, y, width: width + 8, height: height + 10 }
}

function imageDimensions(imagePath: string) {
  return JSON.parse(execFileSync(pythonCommand(), [
    '-c',
    'from PIL import Image; import json, sys; im=Image.open(sys.argv[1]); print(json.dumps({"width": im.width, "height": im.height}))',
    imagePath,
  ], { encoding: 'utf8' })) as { width: number; height: number }
}

function reviewFigurePixelBBox(reviewRow: ReviewRow | undefined, figure: Record<string, any>, imagePath: string) {
  if (!reviewRow || !fs.existsSync(imagePath)) return figure.bbox || {}
  const rawSegments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const fallbackBBox = parseJson<Record<string, any>>(reviewRow.bbox_json || '{}', {})
  const sourceSegments = rawSegments.length ? rawSegments : [{ page_number: reviewRow.page_start, bbox: fallbackBBox }]
  const segments = sourceSegments
    .map((segment) => {
      const bbox = segment.bbox && typeof segment.bbox === 'object' ? expandedReviewBBox(segment.bbox) : null
      return bbox && bbox.width > 0 && bbox.height > 0
        ? { pageNumber: Number(segment.page_number ?? segment.pageNumber ?? reviewRow.page_start), bbox }
        : null
    })
    .filter(Boolean) as Array<{ pageNumber: number; bbox: { x: number; y: number; width: number; height: number } }>
  if (!segments.length || !figure.bbox) return figure.bbox || {}

  const totalHeight = segments.reduce((sum, segment) => sum + segment.bbox.height, 0)
  const maxWidth = Math.max(...segments.map((segment) => segment.bbox.width), 1)
  let yOffset = 0
  const offsets = segments.map((segment) => {
    const current = { ...segment, yOffset }
    yOffset += segment.bbox.height
    return current
  })
  const figureBBox = figure.bbox
  const pageNumber = Number(figure.page_number ?? figure.pageNumber ?? reviewRow.page_start)
  const segment = offsets.find((entry) => {
    const left = entry.bbox
    const right = figureBBox
    return entry.pageNumber === pageNumber &&
      !(left.x + left.width <= right.x || right.x + right.width <= left.x || left.y + left.height <= right.y || right.y + right.height <= left.y)
  })
  if (!segment) return figure.bbox || {}

  const size = imageDimensions(imagePath)
  return {
    x: ((Number(figureBBox.x || 0) - segment.bbox.x) / maxWidth) * size.width,
    y: ((Number(figureBBox.y || 0) - segment.bbox.y + segment.yOffset) / Math.max(totalHeight, 1)) * size.height,
    width: (Number(figureBBox.width || 0) / maxWidth) * size.width,
    height: (Number(figureBBox.height || 0) / Math.max(totalHeight, 1)) * size.height,
  }
}

function cropFigureImage(sourcePath: string, outputPath: string, bbox: Record<string, any>) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const cropScript = [
    'from PIL import Image',
    'import json, sys',
    'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
    'x = int(round(float(raw.get("x", raw.get("x0", 0)))))',
    'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
    'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))',
    'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
    'im = Image.open(src)',
    'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
    'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))',
    'im.crop((x, y, x + w, y + h)).save(dst)',
  ].join('; ')
  execFileSync(pythonCommand(), ['-c', cropScript, sourcePath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
}

function splitReviewImage(sourcePath: string, topOutputPath: string, bottomOutputPath: string, splitRatio: number) {
  fs.mkdirSync(path.dirname(topOutputPath), { recursive: true })
  fs.mkdirSync(path.dirname(bottomOutputPath), { recursive: true })
  const splitScript = [
    'from PIL import Image',
    'import json, sys',
    'src, top_dst, bottom_dst, raw = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])',
    'ratio = float(raw.get("splitRatio", 0.5))',
    'im = Image.open(src)',
    'y = int(round(im.height * ratio))',
    'y = max(8, min(y, im.height - 8))',
    'im.crop((0, 0, im.width, y)).save(top_dst)',
    'im.crop((0, y, im.width, im.height)).save(bottom_dst)',
    'print(json.dumps({"width": im.width, "height": im.height, "splitY": y, "topHeight": y, "bottomHeight": im.height - y}))',
  ].join('; ')
  return JSON.parse(execFileSync(pythonCommand(), ['-c', splitScript, sourcePath, topOutputPath, bottomOutputPath, JSON.stringify({ splitRatio })], { encoding: 'utf8' }))
}

function mergeReviewImages(sourcePaths: string[], outputPath: string) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const mergeScript = [
    'from PIL import Image',
    'import json, sys',
    'raw_paths, dst = json.loads(sys.argv[1]), sys.argv[2]',
    'images = [Image.open(path).convert("RGB") for path in raw_paths]',
    'width = max(im.width for im in images)',
    'height = sum(im.height for im in images)',
    'canvas = Image.new("RGB", (width, height), "white")',
    'y = 0',
    'parts = []',
    'for im, path in zip(images, raw_paths):',
    '    canvas.paste(im, (0, y))',
    '    parts.append({"path": path, "width": im.width, "height": im.height, "y": y})',
    '    y += im.height',
    'canvas.save(dst)',
    'print(json.dumps({"width": width, "height": height, "parts": parts}))',
  ].join('\n')
  return JSON.parse(execFileSync(pythonCommand(), ['-c', mergeScript, JSON.stringify(sourcePaths), outputPath], { encoding: 'utf8' }))
}

function reviewFigureDefaultUsage(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  const boundary = answerOrAnalysisBoundary(reviewRow)
  const figureKey = reviewFigureReadingKey(reviewRow, figure)
  if (!boundary || !figureKey) return 'stem'
  if (figureKey.segmentIndex > boundary.segmentIndex) return 'analysis'
  if (figureKey.segmentIndex < boundary.segmentIndex) return 'stem'
  return figureKey.y >= boundary.y ? 'analysis' : 'stem'
}

function answerOrAnalysisBoundary(reviewRow: ReviewRow | undefined) {
  if (!reviewRow) return null
  const regions = parseJson<Array<Record<string, any>>>(reviewRow.text_regions_json || '[]', [])
  const candidates = regions
    .filter((region) => region.kind === 'answer' || region.kind === 'analysis')
    .flatMap((region) => Array.isArray(region.segments) ? region.segments.slice(0, 1) : [])
    .map((segment) => reviewSegmentReadingKey(reviewRow, segment, false))
    .filter(Boolean) as Array<{ segmentIndex: number; y: number }>
  if (!candidates.length) return null
  candidates.sort((left, right) => left.segmentIndex - right.segmentIndex || left.y - right.y)
  return candidates[0]
}

function reviewFigureReadingKey(reviewRow: ReviewRow | undefined, figure: Record<string, any>) {
  if (!reviewRow || !figure?.bbox) return null
  return reviewSegmentReadingKey(reviewRow, {
    page_number: figure.page_number ?? figure.pageNumber,
    bbox: figure.bbox,
  }, true)
}

function reviewSegmentReadingKey(reviewRow: ReviewRow, segment: Record<string, any>, useCenter: boolean) {
  const bbox = segment.bbox && typeof segment.bbox === 'object' ? segment.bbox : {}
  const pageNumber = Number(segment.page_number ?? segment.pageNumber ?? 0)
  let y = Number(bbox.y ?? bbox.y0 ?? 0)
  if (useCenter) {
    y += Number(bbox.height ?? bbox.h ?? Number(bbox.y1 ?? 0) - Number(bbox.y0 ?? 0)) / 2
  }
  if (!Number.isFinite(pageNumber) || !Number.isFinite(y)) return null

  const rawSegments = parseJson<Array<Record<string, any>>>(reviewRow.segments_json || '[]', [])
  const fallbackBBox = parseJson<Record<string, any>>(reviewRow.bbox_json || '{}', {})
  const sourceSegments = rawSegments.length ? rawSegments : [{ page_number: reviewRow.page_start, bbox: fallbackBBox }]
  const indexes = sourceSegments
    .map((sourceSegment, index) => ({ sourceSegment, index }))
    .filter(({ sourceSegment }) => Number(sourceSegment.page_number ?? sourceSegment.pageNumber ?? reviewRow.page_start) === pageNumber)
  if (!indexes.length) return null

  const containing = indexes.find(({ sourceSegment }) => {
    const sourceBBox = sourceSegment.bbox && typeof sourceSegment.bbox === 'object' ? sourceSegment.bbox : {}
    const top = Number(sourceBBox.y ?? sourceBBox.y0 ?? 0)
    const height = Number(sourceBBox.height ?? sourceBBox.h ?? Number(sourceBBox.y1 ?? 0) - Number(sourceBBox.y0 ?? 0))
    return y >= top - 2 && y <= top + height + 2
  })
  return { segmentIndex: (containing || indexes[0]).index, y }
}

function figuresForImportedOcrResult(result: Record<string, any>, runId: string) {
  const reviewRow = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
    .get(runId, String(result.id || '')) as ReviewRow | undefined
  const reviewFigures = reviewRow ? parseJson<Array<Record<string, any>>>(reviewRow.figures_json || '[]', []) : []
  const sourceFigures = Array.isArray(result.figures) && result.figures.length ? result.figures : reviewFigures
  const sourceRel = stripAssetPrefix(String(result.image_path || reviewRow?.auto_image_path || ''))
  const sourceAbs = sourceRel ? resolveStoragePath(sourceRel) : ''
  return sourceFigures.map((figure, index) => {
    const figureId = normalizedFigureId(figure.id, index)
    const providerAssetOrigin = String(figure.origin || '')
    const providerAssetPath = providerAssetOrigin === 'doc2x_v3' || providerAssetOrigin === 'glm_ocr' ? stripAssetPrefix(String(figure.path || '')) : ''
    if (providerAssetPath && fs.existsSync(resolveStoragePath(providerAssetPath))) {
      const usage = String(figure.usage || figure.category || 'stem')
      return {
        ...figure,
        id: figureId,
        origin: providerAssetOrigin,
        usage,
        category: String(figure.category || figure.usage || usage),
        pageNumber: Number(figure.pageNumber ?? figure.page_number ?? 1),
        path: providerAssetPath,
      }
    }
    const outputRel = path.join('data', 'question_figures', String(result.id), `${figureId}.png`)
    const outputAbs = resolveStoragePath(outputRel)
    const sourceBBox = figure.bbox || {}
    const pixelBBox = sourceAbs && fs.existsSync(sourceAbs)
      ? reviewFigurePixelBBox(reviewRow, figure, sourceAbs)
      : sourceBBox
    if (sourceAbs && fs.existsSync(sourceAbs)) {
      cropFigureImage(sourceAbs, outputAbs, pixelBBox)
    }
    const usage = String(figure.usage || figure.category || reviewFigureDefaultUsage(reviewRow, figure))
    return {
      ...figure,
      id: figureId,
      origin: figure.origin || 'review_crop',
      usage,
      category: String(figure.category || figure.usage || usage),
      pageNumber: Number(figure.pageNumber ?? figure.page_number ?? 1),
      reviewBBox: sourceBBox,
      bbox: pixelBBox,
      sourcePath: sourceRel,
      path: fs.existsSync(outputAbs) ? outputRel : String(figure.path || ''),
    }
  })
}

function comparableQuestionNo(value: unknown) {
  return cleanQuestionNoLabel(String(value || ''))
    .replace(/\s+/g, '')
    .replace(/[.．、:：）)]$/u, '')
}

function importJsonQuestionsFromSliceRun(runId: string, questions: Array<Record<string, unknown>>, options: { sourceTitle?: string; stage?: string; createCollection?: boolean } = {}) {
  const run = getRun(runId)
  if (!run) {
    const error = new Error('切分批次不存在。')
    ;(error as Error & { status?: number }).status = 404
    throw error
  }
  const reviewItems = getReviewItems(runId)
  if (!reviewItems.length) {
    const error = new Error('当前切分批次没有可绑定的题块。')
    ;(error as Error & { status?: number }).status = 400
    throw error
  }
  if (questions.length !== reviewItems.length) {
    const error = new Error(`JSON 题目数量为 ${questions.length}，切分题块数量为 ${reviewItems.length}，请先修正后再导入。`)
    ;(error as Error & { status?: number }).status = 400
    throw error
  }

  const mismatches = questions.flatMap((question, index) => {
    const jsonNo = comparableQuestionNo(question.question_no ?? question.questionNo ?? index + 1)
    const sliceNo = comparableQuestionNo(reviewItems[index]?.questionLabel || index + 1)
    return jsonNo && sliceNo && jsonNo !== sliceNo
      ? [{ index: index + 1, sliceQuestionNo: reviewItems[index]?.questionLabel || '', jsonQuestionNo: String(question.question_no ?? question.questionNo ?? '') }]
      : []
  })
  if (mismatches.length) {
    const error = new Error(`有 ${mismatches.length} 道题号与切分题块不一致，请确认后再导入。`)
    ;(error as Error & { status?: number; details?: unknown }).status = 400
    ;(error as Error & { status?: number; details?: unknown }).details = { mismatches }
    throw error
  }

  const duplicateIds = reviewItems
    .map((item) => item.resultId)
    .filter((id) => db.prepare('SELECT id FROM question_bank_items WHERE id = ?').get(id))
  if (duplicateIds.length) {
    const error = new Error(`已有 ${duplicateIds.length} 个题块导入过题库，请勿重复导入。`)
    ;(error as Error & { status?: number; details?: unknown }).status = 409
    ;(error as Error & { status?: number; details?: unknown }).details = { duplicateIds }
    throw error
  }

  const sourceTitle = cleanSourceTitle(options.sourceTitle || run.paperTitle || run.pdfName || '', run.pdfName || '切分题块导入')
  const stage = String(options.stage || '高三')
  const now = nowIso()
  const collectionId = options.createCollection === false ? '' : createId('paper', sourceTitle)
  const created: NonNullable<PublicQuestion>[] = []

  const insertCollectionItem = db.prepare(`
    INSERT OR IGNORE INTO question_bank_collection_items
      (id, collection_id, question_id, sort_order, score, section_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    if (collectionId) {
      db.prepare(`
        INSERT INTO question_bank_collections
          (id, title, subtitle, description, kind, status, total_score, time_limit, export_format, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'paper', 'draft', 0, 0, 'markdown', ?, ?)
      `).run(collectionId, sourceTitle, '', `由切分题块 ${runId} 与用户粘贴 JSON 顺序绑定导入。`, now, now)
    }
    questions.forEach((question, index) => {
      const reviewItem = reviewItems[index]
      const review = Boolean(question.needs_human_review)
      const questionNo = cleanQuestionNoLabel(String(question.question_no ?? question.questionNo ?? reviewItem.questionLabel ?? index + 1))
      const stemMarkdown = String(question.problem_text || question.stemMarkdown || question.problemText || '')
      const answerText = String(question.answer || question.answerText || '')
      const analysisMarkdown = String(question.analysis || question.analysisMarkdown || question.analysisText || '')
      const knowledgePoints = normalizeTags((question as Record<string, unknown>).knowledge_points ?? (question as Record<string, unknown>).knowledgePoints)
      const solutionMethods = normalizeTags((question as Record<string, unknown>).solution_methods ?? (question as Record<string, unknown>).solutionMethods)
      const difficultyScore10 = normalizeDifficultyScore10((question as Record<string, unknown>).difficulty_score_10 ?? (question as Record<string, unknown>).difficultyScore10)
      const item = createQuestion({
        id: reviewItem.resultId,
        questionNo,
        stage,
        questionType: String(question.question_type || question.questionType || '') || inferQuestionType(stemMarkdown, answerText),
        difficultyScore: review ? 4 : 3,
        difficultyScore10,
        difficultyLabel: String(question.difficulty_label || question.difficultyLabel || difficultyLabel10(difficultyScore10)),
        chapter: knowledgePoints[0] || '待整理',
        knowledgePoints,
        solutionMethods,
        sourceTitle,
        bankStatus: review ? 'blocked' : 'ready',
        stemMarkdown,
        answerText,
        analysisMarkdown,
        sliceImagePath: stripAssetPrefix(reviewItem.autoImagePath || reviewItem.pageImagePath || ''),
        figures: figuresForImportedOcrResult({ id: reviewItem.resultId, image_path: reviewItem.autoImagePath, figures: question.figures }, runId),
        sourceRunId: runId,
        needsFormatReview: review,
        formatIssue: review ? { field: 'system', code: 'needs_human_review', message: '用户粘贴 JSON 标记需要人工复核。', snippet: '' } : undefined,
      })!
      created.push(item)
      if (collectionId) {
        insertCollectionItem.run(createId('rel'), collectionId, item.id, index + 1, 0, '', now)
      }
    })
    if (collectionId) refreshCollectionScore(collectionId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const targetCount = run.approvedQuestions || run.totalQuestions || reviewItems.length
  if (created.length >= targetCount) {
    db.prepare(`
      UPDATE pdf_slicer_runs
      SET ocr_status = 'succeeded',
          ocr_error = '',
          ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?),
          ocr_finished_at = ?,
          updated_at = ?
      WHERE run_id = ?
    `).run(now, now, now, runId)
    updateBatchWorkflow(run.batchId)
  }

  return {
    items: created,
    count: created.length,
    collection: collectionId ? getCollection(collectionId) : null,
    pendingBankUrl: `/tools/pdf-slicer/runs/${encodeURIComponent(runId)}/pending-bank`,
  }
}

function imageMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'image/png'
}

function imageExtension(filename: string, mimeType: string) {
  const extension = path.extname(filename || '').toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return extension
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.png'
}

function markdownFigureLines(figures: Array<Record<string, any>>) {
  return figures.flatMap((figure, index) => {
    const filePath = figureAbsolutePath(figure)
    if (!filePath || !fs.existsSync(filePath)) return []
    const caption = figureCaptionForExport(figure, index).replace(/[[\]]/g, '')
    const data = fs.readFileSync(filePath).toString('base64')
    return [`![${caption}](data:${imageMimeType(filePath)};base64,${data})`]
  })
}

function latexFigureLines(figures: Array<Record<string, any>>) {
  return figures.flatMap((figure, index) => {
    const filePath = figureAbsolutePath(figure)
    if (!filePath || !fs.existsSync(filePath)) return []
    const caption = escapeLatex(figureCaptionForExport(figure, index))
    return [
      '\\begin{center}',
      `\\includegraphics[width=0.82\\linewidth]{\\detokenize{${filePath}}}`,
      `{\\small ${caption}}`,
      '\\end{center}',
    ]
  })
}

function questionFigures(item: any) {
  const figures = Array.isArray(item?.item?.figures) ? item.item.figures as Array<Record<string, any>> : []
  return figures.filter((figure) => String(figure.usage || '') !== 'analysis')
}

function analysisFigures(item: any) {
  const figures = Array.isArray(item?.item?.figures) ? item.item.figures as Array<Record<string, any>> : []
  return figures.filter((figure) => String(figure.usage || '') === 'analysis')
}

type ExportVariant = 'student' | 'teacher'

function normalizeExportVariant(value: unknown): ExportVariant {
  if (value === 'teacher' || value === 'answers') return 'teacher'
  return 'student'
}

function buildCollectionMarkdown(collection: NonNullable<ReturnType<typeof getCollection>>, variant: ExportVariant) {
  const lines: string[] = []
  lines.push(`# ${collection.title || '未命名试卷'}（${variant === 'teacher' ? '教师版' : '学生版'}）`)
  if (collection.subtitle) lines.push('', collection.subtitle)
  const meta = [`题数：${collection.questionCount}`]
  if (collection.totalScore) meta.push(`总分：${collection.totalScore}`)
  if (collection.timeLimit) meta.push(`时长：${collection.timeLimit} 分钟`)
  lines.push('', meta.join(' | '), '')
  let currentSection = ''
  collection.questions.forEach((entry, index) => {
    if (entry.sectionName && entry.sectionName !== currentSection) {
      currentSection = entry.sectionName
      lines.push('', `## ${currentSection}`, '')
    }
    const stemFigures = questionFigures(entry)
    lines.push(markdownQuestionLine(index + 1, entry, stemFigures), '')
    lines.push(...markdownFigureLines(figuresWithoutInlineMarkers(entry.item.stemMarkdown, stemFigures)), '')
    if (variant === 'teacher') {
      const solutionFigures = analysisFigures(entry)
      lines.push(`参考答案：${markdownWithInlineFigures(entry.item.answerText || '暂无', solutionFigures)}`, '')
      lines.push(`解析：${markdownWithInlineFigures(entry.item.analysisMarkdown || '暂无', solutionFigures)}`, '')
      lines.push(...markdownFigureLines(figuresWithoutInlineMarkers(`${entry.item.answerText || ''}\n${entry.item.analysisMarkdown || ''}`, solutionFigures)), '')
    }
  })
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n'
}

function escapeLatex(value: string) {
  return questionPlainText(value)
    .replace(/([#%&])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\n{2,}/g, '\n\n')
}

function buildCollectionLatex(collection: NonNullable<ReturnType<typeof getCollection>>, variant: ExportVariant) {
  const lines: string[] = [
    '\\documentclass[12pt]{ctexart}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage[a4paper,margin=2.2cm]{geometry}',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\parskip}{0.8em}',
    '\\begin{document}',
    `\\begin{center}{\\LARGE ${escapeLatex(collection.title || '未命名试卷')}（${variant === 'teacher' ? '教师版' : '学生版'}）}\\end{center}`,
  ]
  if (collection.subtitle) lines.push(`\\begin{center}${escapeLatex(collection.subtitle)}\\end{center}`)
  lines.push(`题数：${collection.questionCount}${collection.totalScore ? `\\quad 总分：${collection.totalScore}` : ''}${collection.timeLimit ? `\\quad 时长：${collection.timeLimit} 分钟` : ''}`)
  let currentSection = ''
  collection.questions.forEach((entry, index) => {
    if (entry.sectionName && entry.sectionName !== currentSection) {
      currentSection = entry.sectionName
      lines.push(`\\subsection*{${escapeLatex(currentSection)}}`)
    }
    const score = Number(entry.score || 0)
    lines.push(`\\textbf{${index + 1}.}${score ? `（${score} 分）` : ''}`)
    const stemFigures = questionFigures(entry)
    const stem = stripLeadingQuestionNo(entry.item.stemMarkdown, entry.item.questionNo)
    lines.push(latexWithInlineFigures(stem || '（题干待补充）', stemFigures))
    lines.push(...latexFigureLines(figuresWithoutInlineMarkers(stem, stemFigures)))
    if (variant === 'teacher') {
      const solutionFigures = analysisFigures(entry)
      lines.push(`\\textbf{参考答案：}${latexWithInlineFigures(entry.item.answerText || '暂无', solutionFigures)}`)
      lines.push(`\\textbf{解析：}${latexWithInlineFigures(entry.item.analysisMarkdown || '暂无', solutionFigures)}`)
      lines.push(...latexFigureLines(figuresWithoutInlineMarkers(`${entry.item.answerText || ''}\n${entry.item.analysisMarkdown || ''}`, solutionFigures)))
    }
  })
  lines.push('\\end{document}')
  return lines.join('\n\n') + '\n'
}

type WorksheetFigureSpec = {
  id: string
  sourcePath: string
  outputName: string
  defaultWidth: number
  minWidth: number
}

type WorksheetFigureTelemetry = {
  id: string
  pageTotal: number
  pageGoal: number
  height: number
  depth: number
  width: number
}

const worksheetMaxLayoutIterations = 3
const worksheetFigureFitPaddingPt = 4

function worksheetFigureWidthLimits(imagePath: string) {
  try {
    const size = imageDimensions(imagePath)
    const aspect = size.height > 0 ? size.width / size.height : 1
    if (aspect > 1.6) return { defaultWidth: 0.48, minWidth: 0.36 }
    if (aspect < 0.85) return { defaultWidth: 0.20, minWidth: 0.16 }
  } catch {
    // Fall back to the ordinary-image preset when metadata cannot be read.
  }
  return { defaultWidth: 0.30, minWidth: 0.24 }
}

function worksheetFigureId(collectionId: string, entry: any, figure: Record<string, any>, index: number, usage: string) {
  const questionKey = safeName(String(entry.item.serialNo || entry.item.id || index + 1))
  const figureKey = safeName(String(figure.id || `fig${index + 1}`))
  return `${safeName(collectionId)}-q${questionKey}-${figureKey}-${safeName(usage)}`
}

function worksheetTags(entry: any) {
  const parts: string[] = []
  const difficulty = String(entry.item.difficultyLabel || '').trim()
  if (difficulty) parts.push(`\\difftag{${markdownToExamLatex(difficulty, false)}}`)
  const knowledgePoints = Array.isArray(entry.item.knowledgePoints) ? entry.item.knowledgePoints.slice(0, 4) : []
  for (const point of knowledgePoints) {
    parts.push(`\\kptag{${markdownToExamLatex(String(point), false)}}`)
  }
  return parts.join(' ')
}

function worksheetAnswerLatex(value: string) {
  const text = String(value || '').trim()
  if (!text) return ''
  const rawMath = /\\(?:frac|dfrac|sqrt|sum|int|lim|ln|infty|mathbb|mathbf|vec|overrightarrow|leq|geq|neq|cdot|times|binom)\b/
  if (!text.includes('$') && rawMath.test(text) && text.length <= 160) {
    return `$${normalizeLatexMathSegment(text)}$`
  }
  return markdownToExamLatex(text, true)
}

type WorksheetSectionScore = {
  count: number
  total: number
  scores: number[]
}

function worksheetDefaultScore(questionType: string, solutionIndex: number) {
  if (questionType === '单选题') return defaultExamZhScoreConfig.singleChoice
  if (questionType === '多选题') return defaultExamZhScoreConfig.multipleChoice
  if (questionType === '填空题') return defaultExamZhScoreConfig.fillin
  if (questionType === '解答题') return defaultExamZhScoreConfig.solution[solutionIndex] ?? defaultExamZhScoreConfig.solution[defaultExamZhScoreConfig.solution.length - 1] ?? 0
  return 0
}

function worksheetGeneratedSectionName(questionType: string, emitted: Map<string, string>) {
  const normalized = normalizeQuestionType(questionType)
  const existing = emitted.get(normalized)
  if (existing) return existing
  const name = `${sectionOrdinal(emitted.size + 1)}、${normalized}`
  emitted.set(normalized, name)
  return name
}

function worksheetEntryKey(entry: any, index: number) {
  return String(entry.relationId || entry.item?.id || index)
}

function buildWorksheetScorePlan(collection: NonNullable<ReturnType<typeof getCollection>>) {
  const entryScores = new Map<string, number>()
  const entrySections = new Map<string, string>()
  const sectionScores = new Map<string, WorksheetSectionScore>()
  const generatedSections = new Map<string, string>()
  const hasExplicitSections = collection.questions.some((entry) => String(entry.sectionName || '').trim())
  let currentSection = ''
  let solutionIndex = 0
  collection.questions.forEach((entry, index) => {
    const questionType = normalizeQuestionType(entry.item.questionType, entry.item.stemMarkdown, entry.item.answerText)
    const explicitScore = Number(entry.score || 0)
    const defaultScore = worksheetDefaultScore(questionType, solutionIndex)
    if (questionType === '解答题') solutionIndex += 1
    const score = explicitScore > 0 ? explicitScore : defaultScore
    if (entry.sectionName) currentSection = String(entry.sectionName)
    if (!hasExplicitSections) currentSection = worksheetGeneratedSectionName(questionType, generatedSections)
    else if (!currentSection) currentSection = worksheetGeneratedSectionName(questionType, generatedSections)
    const key = worksheetEntryKey(entry, index)
    entryScores.set(key, score)
    entrySections.set(key, currentSection)
    const section = sectionScores.get(currentSection) || { count: 0, total: 0, scores: [] }
    section.count += 1
    section.total += score
    section.scores.push(score)
    sectionScores.set(currentSection, section)
  })
  return { entryScores, entrySections, sectionScores }
}

function worksheetSectionTitle(name: string, score: WorksheetSectionScore | undefined) {
  if (!score) return name
  const uniqueScores = Array.from(new Set(score.scores.map((value) => scoreText(value))))
  const summary = uniqueScores.length === 1
    ? `每题${uniqueScores[0]}分，共${score.count}题`
    : `共${score.count}题，共${scoreText(score.total)}分`
  return `${name}（${summary}）`
}

function qbankChoiceLayout(choices: string[]) {
  if (choices.length !== 4) return 'one'
  if (choices.some((choice) => /\n|\$\$|\|[^\n]*\||!\[[^\]]*\]\(/.test(String(choice || '')))) return 'one'
  const plainChoices = choices.map((choice) => questionPlainText(choice).replace(/\$+/g, '').replace(/\s+/g, ''))
  const maxLength = Math.max(...plainChoices.map((choice) => choice.length), 0)
  const totalLength = plainChoices.reduce((sum, choice) => sum + choice.length, 0)
  if (maxLength <= 18 && totalLength <= 72) return 'four'
  if (maxLength <= 38 && totalLength <= 152) return 'two'
  return 'one'
}

function worksheetChoicesLatex(choices: string[]) {
  const rendered = choices.map((choice) => markdownToExamLatex(choice, true).replace(/\n+/g, ' ').trim())
  if (rendered.length === 4) {
    const layout = qbankChoiceLayout(choices)
    if (layout === 'four') return `\\qbankchoicesfour{${rendered[0]}}{${rendered[1]}}{${rendered[2]}}{${rendered[3]}}`
    if (layout === 'two') return `\\qbankchoicestwo{${rendered[0]}}{${rendered[1]}}{${rendered[2]}}{${rendered[3]}}`
  }
  return [
    '\\begin{qbankchoicesone}',
    ...rendered.map((choice) => `\\item ${choice}`),
    '\\end{qbankchoicesone}',
  ].join('\n')
}

function worksheetQuestionLatex(
  entry: any,
  index: number,
  variant: ExportVariant,
  collectionId: string,
  figuresDir: string,
  adjustments: Map<string, number>,
  specs: Map<string, WorksheetFigureSpec>,
) {
  const lines = [`\\begin{examquestion}{${index + 1}}`]
  const { prompt, choices } = splitChoiceStemForExport(entry.item.stemMarkdown)
  const stemFigures = questionFigures(entry)
  lines.push(keepSubquestionsTogether(renderExamZhPrompt(prompt || entry.item.stemMarkdown, entry.item.questionType) || '（题干待补充）'))
  if (choices.length) {
    lines.push(worksheetChoicesLatex(choices))
  }

  const appendFigures = (figures: Array<Record<string, any>>, usage: string) => {
    figures.forEach((figure, figureIndex) => {
      const sourcePath = figureAbsolutePath(figure)
      if (!sourcePath || !fs.existsSync(sourcePath)) return
      const extension = path.extname(sourcePath).toLowerCase() || '.png'
      const figureId = worksheetFigureId(collectionId, entry, figure, figureIndex, usage)
      const outputName = `${safeName(figureId)}${extension}`
      const outputPath = path.join(figuresDir, outputName)
      if (!fs.existsSync(outputPath)) fs.copyFileSync(sourcePath, outputPath)
      const limits = worksheetFigureWidthLimits(sourcePath)
      specs.set(figureId, { id: figureId, sourcePath, outputName, ...limits })
      const width = adjustments.get(figureId) ?? limits.defaultWidth
      lines.push(`\\qbankfigure{${figureId}}{${width.toFixed(4)}}{figures/${outputName}}`)
    })
  }

  appendFigures(stemFigures, 'stem')
  if (variant === 'teacher') {
    lines.push('\\begin{solutionbox}')
    lines.push(`\\anslabel ${worksheetAnswerLatex(entry.item.answerText) || '暂无'}\\par`)
    lines.push(`\\sollabel ${markdownToExamLatex(entry.item.analysisMarkdown || '暂无', true)}`)
    appendFigures(analysisFigures(entry), 'analysis')
    lines.push('\\end{solutionbox}')
  } else if (normalizeQuestionType(entry.item.questionType, entry.item.stemMarkdown, entry.item.answerText) === '解答题' && !stemFigures.length) {
    // In compact exam output, a stem diagram takes precedence over a blank
    // response area so it is not separated from its question.
    lines.push('\\nobreak\\begin{answerarea}{4.2cm}\\end{answerarea}')
  }
  lines.push('\\end{examquestion}')
  return lines.join('\n')
}

function buildCollectionWorksheetLatex(
  collection: NonNullable<ReturnType<typeof getCollection>>,
  variant: ExportVariant,
  figuresDir: string,
  adjustments: Map<string, number>,
  documentClass = 'qbank-worksheet',
) {
  const specs = new Map<string, WorksheetFigureSpec>()
  const scorePlan = buildWorksheetScorePlan(collection)
  const appSettings = readAppSettings()
  const brandName = documentClass === 'qbank-lecture'
    ? appSettings.lectureWatermark
    : documentClass === 'qbank-exam'
      ? appSettings.examWatermark
      : appSettings.worksheetWatermark
  const brandTagline = `${brandName} ｜ 高中数学`
  const lines = [
    `\\documentclass{${documentClass}}`,
    `\\setbrandname{${markdownToExamLatex(brandName, false)}}`,
    '\\setbrandmark{Q}',
    `\\setbrandtagline{${markdownToExamLatex(brandTagline, false)}}`,
    '\\setsubject{高中数学}',
    `\\doctitle{${markdownToExamLatex(collection.title || '综合练习', false)}}`,
  ]
  lines.push('\\begin{document}', '\\qbankmaketitle')
  let currentSection = ''
  collection.questions.forEach((entry, index) => {
    const key = worksheetEntryKey(entry, index)
    const sectionName = scorePlan.entrySections.get(key) || ''
    if (sectionName && sectionName !== currentSection) {
      currentSection = sectionName
      lines.push(`\\examsectionstart{${markdownToExamLatex(worksheetSectionTitle(currentSection, scorePlan.sectionScores.get(currentSection)), false)}}`)
    }
    lines.push(worksheetQuestionLatex(entry, index, variant, collection.id, figuresDir, adjustments, specs))
  })
  lines.push('\\end{document}', '')
  return { content: lines.join('\n\n'), specs }
}

function parseWorksheetFigureTelemetry(logPath: string) {
  if (!fs.existsSync(logPath)) return [] as WorksheetFigureTelemetry[]
  const text = fs.readFileSync(logPath, 'utf8')
  const blocks = text.match(/QBANKFIG[\s\S]*?width=[0-9.]+/g) || []
  return blocks.flatMap((block) => {
    const compact = block.replace(/\s+/g, '')
    const match = compact.match(/QBANKFIGid=(.+?)page=(.+?)pagetotal=([0-9.]+)ptpagegoal=([0-9.]+)ptfigheight=([0-9.]+)ptfigdepth=([0-9.]+)ptwidth=([0-9.]+)/)
    if (!match) return []
    return [{
      id: match[1],
      pageTotal: Number(match[3]),
      pageGoal: Number(match[4]),
      height: Number(match[5]),
      depth: Number(match[6]),
      width: Number(match[7]),
    }]
  })
}

function optimizeWorksheetFigures(
  telemetry: WorksheetFigureTelemetry[],
  specs: Map<string, WorksheetFigureSpec>,
  adjustments: Map<string, number>,
) {
  let changed = false
  telemetry.forEach((record) => {
    const spec = specs.get(record.id)
    if (!spec || record.width <= spec.minWidth + 0.0005 || record.pageGoal > 100000) return
    const remaining = record.pageGoal - record.pageTotal
    const needed = record.height + record.depth
    if (remaining <= worksheetFigureFitPaddingPt || needed <= remaining) return
    // Compute the fitting scale directly; repeated 0.88 scaling could stop
    // short and leave an otherwise fitting diagram alone on the next page.
    const targetWidth = Number((record.width * ((remaining - worksheetFigureFitPaddingPt) / needed)).toFixed(4))
    if (targetWidth < spec.minWidth || targetWidth >= record.width - 0.0005) return
    adjustments.set(record.id, targetWidth)
    changed = true
  })
  return changed
}

function compileWorksheetTex(texPath: string) {
  for (let pass = 0; pass < 2; pass += 1) {
    execFileSync(xelatexPath(), ['-interaction=nonstopmode', '-halt-on-error', path.basename(texPath)], {
      cwd: path.dirname(texPath),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    })
  }
}

function exportCollectionWorksheetPdf(collection: NonNullable<ReturnType<typeof getCollection>>, variant: ExportVariant, documentClass = 'qbank-worksheet') {
  if (!collection.questions.length) throw new Error('当前试题篮没有题目，无法导出。')
  const exportRoot = path.join(storageRoot, 'output', 'pdf', 'collection-exports', safeName(collection.id))
  const figuresDir = path.join(exportRoot, 'figures')
  fs.mkdirSync(figuresDir, { recursive: true })
  for (const templateName of ['qbank-theme.sty', `${documentClass}.cls`]) {
    fs.copyFileSync(path.join(sourceRoot, 'templates', 'latex', templateName), path.join(exportRoot, templateName))
  }
  const templateName = documentClass === 'qbank-exam' ? 'exam' : 'worksheet'
  const baseName = `${safeName(collection.title || '练习单')}-${templateName}-${variant === 'teacher' ? 'teacher' : 'student'}`
  const texPath = path.join(exportRoot, `${baseName}.tex`)
  const adjustments = new Map<string, number>()
  for (let iteration = 0; iteration < worksheetMaxLayoutIterations; iteration += 1) {
    const rendered = buildCollectionWorksheetLatex(collection, variant, figuresDir, adjustments, documentClass)
    fs.writeFileSync(texPath, rendered.content, 'utf8')
    compileWorksheetTex(texPath)
    const telemetry = parseWorksheetFigureTelemetry(texPath.replace(/\.tex$/, '.log'))
    if (!optimizeWorksheetFigures(telemetry, rendered.specs, adjustments)) break
  }
  const rendered = buildCollectionWorksheetLatex(collection, variant, figuresDir, adjustments, documentClass)
  fs.writeFileSync(texPath, rendered.content, 'utf8')
  compileWorksheetTex(texPath)
  return path.join(exportRoot, `${baseName}.pdf`)
}

function buildRunWorksheetCollection(run: NonNullable<ReturnType<typeof getRun>>, rows: QuestionRow[]) {
  const sectionNames = collectionSectionNames(rows)
  let previousSection = ''
  return {
    id: `run-${run.runId}`,
    title: run.paperTitle || run.pdfName || '综合练习',
    subtitle: '学生版',
    description: '',
    kind: 'paper' as const,
    status: 'finalized' as const,
    totalScore: 0,
    timeLimit: 0,
    exportFormat: 'pdf',
    questionCount: rows.length,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    questions: rows.map((row, index) => {
      const item = mapQuestion(row)
      const section = sectionNames.get(item.questionType) || ''
      const sectionName = section && section !== previousSection ? section : ''
      if (section) previousSection = section
      return {
        relationId: `${run.runId}-${item.id}`,
        sortOrder: index + 1,
        score: 0,
        sectionName,
        item,
      }
    }),
  }
}

function exportRunWorksheetPdf(runId: string, options: { title?: string; variant?: ExportVariant }) {
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id = ? AND bank_status = 'banked'
    ORDER BY serial_no ASC
  `).all(runId) as QuestionRow[]
  if (!rows.length) throw new Error('当前批次暂无已入库题目，无法导出。')
  const collection = buildRunWorksheetCollection({ ...run, paperTitle: options.title || run.paperTitle }, rows)
  const variant = options.variant || 'student'
  const pdfPath = exportCollectionWorksheetPdf(collection, variant)
  return { path: pdfPath, format: 'pdf' as const }
}

function exportRunExamPdf(runId: string, options: { title?: string; variant?: ExportVariant }) {
  const variant = options.variant || 'student'
  if (readAppSettings().examExportTemplate === 'examch') {
    return exportRunExamZh(runId, { ...options, format: 'pdf', variant })
  }
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id = ? AND bank_status = 'banked'
    ORDER BY serial_no ASC
  `).all(runId) as QuestionRow[]
  if (!rows.length) throw new Error('当前批次暂无已入库题目，无法导出。')
  const collection = buildRunWorksheetCollection({ ...run, paperTitle: options.title || run.paperTitle }, rows)
  const pdfPath = exportCollectionWorksheetPdf(collection, variant, 'qbank-exam')
  return { path: pdfPath, format: 'pdf' as const }
}

function splitChoiceStemForExport(stem: string) {
  const source = stripLeadingQuestionNo(String(stem || ''))
  let matches = Array.from(source.matchAll(/(^|[\r\n])\s*([A-D])\s*[.．、]\s*/g))
  if (matches.length !== 4) {
    matches = Array.from(source.matchAll(/(^|\s)([A-D])\s*[.．、]\s*/g))
  }
  const labels = matches.map((match) => match[2]).join('')
  if (labels !== 'ABCD' || matches.length !== 4) return { prompt: source, choices: [] as string[] }
  const prompt = source.slice(0, matches[0].index).trim()
  const choices = matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length
    const end = index + 1 < matches.length ? (matches[index + 1].index || source.length) : source.length
    return source.slice(start, end).trim()
  })
  return { prompt, choices }
}

function escapeLatexTextSegment(value: string) {
  return normalizeUnicodeRomanNumerals(String(value || ''))
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#%&_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function normalizeUnicodeRomanNumerals(value: string) {
  const romanMap: Record<string, string> = {
    'Ⅰ': 'I',
    'Ⅱ': 'II',
    'Ⅲ': 'III',
    'Ⅳ': 'IV',
    'Ⅴ': 'V',
    'Ⅵ': 'VI',
    'Ⅶ': 'VII',
    'Ⅷ': 'VIII',
    'Ⅸ': 'IX',
    'Ⅹ': 'X',
    'ⅰ': 'i',
    'ⅱ': 'ii',
    'ⅲ': 'iii',
    'ⅳ': 'iv',
    'ⅴ': 'v',
    'ⅵ': 'vi',
    'ⅶ': 'vii',
    'ⅷ': 'viii',
    'ⅸ': 'ix',
    'ⅹ': 'x',
  }
  return value.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]/g, (match) => romanMap[match] || match)
}

function normalizeLatexMathSegment(value: string) {
  return String(value || '')
    .replace(/\\mathbf\{R\}/g, '\\mathbb{R}')
    .replace(/\\vec\{/g, '\\overrightarrow{')
    .replace(/\s*\n\s*/g, ' ')
}

function markdownTextToExamLatex(value: string, preserveBreaks = true) {
  const text = String(value || '')
    .replace(/【解析】/g, '')
    .replace(/【分析】/g, '')
    .replace(/【详解】/g, '')
    .replace(/详解】/g, '')
    .trim()
  const parts: string[] = []
  const pattern = /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    parts.push(escapeLatexTextSegment(text.slice(last, match.index)))
    parts.push(normalizeLatexMathSegment(match[0]))
    last = (match.index || 0) + match[0].length
  }
  parts.push(escapeLatexTextSegment(text.slice(last)))
  const rendered = parts.join('')
  if (!preserveBreaks) return rendered.replace(/\s*\n\s*/g, ' ')
  return rendered
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.split(/\n/).map((line) => line.trim()).filter(Boolean).join('\n\\par\n'))
    .filter(Boolean)
    .join('\n\\par\n')
}

function keepSubquestionsTogether(latex: string) {
  return String(latex || '').replace(
    /\\par\s*\n(?=（(?:\d+|[ivxIVX]+|[一二三四五六七八九十]+)）)/g,
    '\\par\\nobreak\n',
  )
}

function isMarkdownTableRow(line: string) {
  const trimmed = String(line || '').trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.slice(1, -1).includes('|')
}

function normalizeHtmlTablesForExport(value: string) {
  return String(value || '').replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (source, body: string) => {
    const rows = Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
      .map((row) => Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi))
        .map((cell) => cell[1]
          .replace(/<br\s*\/?>/gi, '<br>')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/\|/g, '\\|')
          .trim()))
      .filter((row) => row.length)
    if (!rows.length) return source
    const width = Math.max(...rows.map((row) => row.length))
    const markdownRow = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] || '').join(' | ')} |`
    const separator = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`
    return `\n\n${markdownRow(rows[0])}\n${separator}\n${rows.slice(1).map(markdownRow).join('\n')}\n\n`
  })
}

function splitMarkdownTableRow(line: string) {
  const source = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\' && source[index + 1] === '|') {
      cell += '|'
      index += 1
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function isMarkdownTableSeparator(line: string) {
  if (!isMarkdownTableRow(line)) return false
  const cells = splitMarkdownTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^[:：]?-{3,}[:：]?$/.test(cell.replace(/\s+/g, '')))
}

function markdownTableToExamLatex(lines: string[]) {
  const separatorIndex = lines.findIndex(isMarkdownTableSeparator)
  const rows = lines.map(splitMarkdownTableRow)
  const columnCount = Math.max(...rows.map((row) => row.length), 1)
  const separator = separatorIndex >= 0 ? rows[separatorIndex] : []
  const alignments = Array.from({ length: columnCount }, (_, index) => {
    const marker = String(separator[index] || '')
    if (/^[:：].*[:：]$/.test(marker)) return 'c'
    if (/[:：]$/.test(marker)) return 'r'
    return 'l'
  })
  const output = [
    '\\par\\smallskip',
    '\\begin{center}',
    '\\renewcommand{\\arraystretch}{1.25}',
    '\\setlength{\\tabcolsep}{5pt}',
    '\\begin{adjustbox}{max width=\\linewidth}',
    `\\begin{tabular}{|${alignments.join('|')}|}\\hline`,
  ]
  rows.forEach((row, rowIndex) => {
    if (rowIndex === separatorIndex) return
    const cells = Array.from({ length: columnCount }, (_, cellIndex) => markdownTextToExamLatex(row[cellIndex] || '', false))
    if (separatorIndex > 0 && rowIndex < separatorIndex) {
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
        cells[cellIndex] = cells[cellIndex] ? `\\textbf{${cells[cellIndex]}}` : ''
      }
    }
    output.push(`${cells.join(' & ')} \\\\ \\hline`)
  })
  output.push('\\end{tabular}', '\\end{adjustbox}', '\\end{center}', '\\smallskip')
  return output.join('\n')
}

function markdownToExamLatex(value: string, preserveBreaks = true) {
  const lines = normalizeHtmlTablesForExport(removeDoc2xFigurePlaceholders(value)).replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let textLines: string[] = []
  const flushText = () => {
    const text = textLines.join('\n').trim()
    if (text) output.push(markdownTextToExamLatex(text, preserveBreaks))
    textLines = []
  }
  for (let index = 0; index < lines.length;) {
    if (isMarkdownTableRow(lines[index]) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1])) {
      flushText()
      const tableLines: string[] = []
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index])
        index += 1
      }
      output.push(markdownTableToExamLatex(tableLines))
      continue
    }
    textLines.push(lines[index])
    index += 1
  }
  flushText()
  return output.join('\n')
}

const examZhFillinToken = '@@EXAMZH_FILLIN_BLANK@@'
const escapedExamZhFillinToken = '@@EXAMZH\\_FILLIN\\_BLANK@@'

function examZhFillinBlank(width = '2.8cm') {
  return `\\underline{\\hspace{${width}}}`
}

function hasVisibleFillinBlank(value: string) {
  return /_{2,}|＿{2,}|\\(?:underline|fillin|blank)\b/.test(String(value || ''))
}

function keepChoiceParenTogether(latex: string) {
  return String(latex || '')
    .replace(/（\s*(?:\\par\s*)?）/g, '\\mbox{（\\hspace{1.25em}）}')
    .replace(/\(\s*(?:\\par\s*)?\)/g, '\\mbox{(\\hspace{1.25em})}')
}

function keepChoiceParenTogetherWithAnswer(latex: string, answer: string) {
  const ansStr = answer.trim()
  if (!ansStr) return keepChoiceParenTogether(latex)
  const cnParen = /（\s*(?:\\par\s*)?）/g
  const enParen = /\(\s*(?:\\par\s*)?\)/g

  const cnMatches = Array.from(latex.matchAll(cnParen))
  const enMatches = Array.from(latex.matchAll(enParen))

  if (cnMatches.length > 0) {
    const lastMatch = cnMatches[cnMatches.length - 1]
    const idx = lastMatch.index!
    return keepChoiceParenTogether(latex.slice(0, idx)) + `\\mbox{（\\textbf{${ansStr}}）}` + keepChoiceParenTogether(latex.slice(idx + lastMatch[0].length))
  } else if (enMatches.length > 0) {
    const lastMatch = enMatches[enMatches.length - 1]
    const idx = lastMatch.index!
    return keepChoiceParenTogether(latex.slice(0, idx)) + `\\mbox{(\\textbf{${ansStr}})}` + keepChoiceParenTogether(latex.slice(idx + lastMatch[0].length))
  }

  return keepChoiceParenTogether(latex)
}

function renderExamZhPrompt(prompt: string, questionType: string, variant: ExportVariant = 'student', answer = '') {
  if (questionType !== '填空题') {
    const latex = markdownToExamLatex(prompt, true)
    if (variant === 'teacher' && (questionType === '单选题' || questionType === '多选题')) {
      const letters = Array.from(selectedChoiceLetters(answer)).sort().join('')
      if (letters) {
        return keepChoiceParenTogetherWithAnswer(latex, letters)
      }
    }
    return keepChoiceParenTogether(latex)
  }
  const source = String(prompt || '')
  const hadBlank = hasVisibleFillinBlank(source)
  const normalized = source.replace(/_{2,}|＿{2,}/g, examZhFillinToken)
  let rendered = markdownToExamLatex(normalized, true)
    .replaceAll(escapedExamZhFillinToken, examZhFillinBlank())
    .replaceAll(examZhFillinToken, examZhFillinBlank())
  if (!hadBlank) rendered = `${rendered}\\,${examZhFillinBlank()}`
  return rendered
}

function examZhFigureLines(figures: Array<Record<string, any>>) {
  return figures.flatMap((figure) => {
    const filePath = figureAbsolutePath(figure)
    if (!filePath || !fs.existsSync(filePath)) return []
    const width = '0.34\\linewidth'
    return [
      '\\begin{flushleft}',
      `\\includegraphics[width=${width},keepaspectratio]{\\detokenize{${filePath}}}`,
      '\\end{flushleft}',
    ]
  })
}

function renderExamZhPromptWithInlineFigures(
  prompt: string,
  figures: Array<Record<string, any>>,
  questionType: string,
  variant: ExportVariant,
  answer = '',
) {
  if (!doc2xInlineFigureIds(prompt).size) return renderExamZhPrompt(prompt, questionType, variant, answer)
  const figureById = new Map(figures.map((figure) => [String(figure.blockId || figure.id || ''), figure]))
  const lines: string[] = []
  const source = String(prompt || '')
  let cursor = 0
  let match: RegExpExecArray | null
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(source))) {
    const text = removeDoc2xFigurePlaceholders(source.slice(cursor, match.index))
    if (text) lines.push(renderExamZhPrompt(text, questionType, variant))
    const figure = figureById.get(match[1])
    if (figure) lines.push(...examZhFigureLines([figure]))
    cursor = match.index + match[0].length
  }
  const tail = removeDoc2xFigurePlaceholders(source.slice(cursor))
  if (tail) lines.push(renderExamZhPrompt(tail, questionType, variant, answer))
  return lines.join('\n')
}

function renderExamZhMarkdownWithInlineFigures(content: string, figures: Array<Record<string, any>>) {
  if (!doc2xInlineFigureIds(content).size) return markdownToExamLatex(content, true)
  const figureById = new Map(figures.map((figure) => [String(figure.blockId || figure.id || ''), figure]))
  const lines: string[] = []
  const source = String(content || '')
  let cursor = 0
  let match: RegExpExecArray | null
  DOC2X_FIGURE_MARKER_RE.lastIndex = 0
  while ((match = DOC2X_FIGURE_MARKER_RE.exec(source))) {
    const text = removeDoc2xFigurePlaceholders(source.slice(cursor, match.index))
    if (text) lines.push(markdownToExamLatex(text, true))
    const figure = figureById.get(match[1])
    if (figure) lines.push(...examZhFigureLines([figure]))
    cursor = match.index + match[0].length
  }
  const tail = removeDoc2xFigurePlaceholders(source.slice(cursor))
  if (tail) lines.push(markdownToExamLatex(tail, true))
  return lines.join('\n')
}

function examZhAnswerBlank(serialNo: number) {
  const heights: Record<number, string> = {
    15: '4.4cm',
    16: '4.8cm',
    17: '4.6cm',
    18: '6.8cm',
    19: '5.2cm',
  }
  return `\\answerblank{${heights[serialNo] || '3cm'}}`
}

type ExamZhScoreConfig = {
  singleChoice: number
  multipleChoice: number
  fillin: number
  solution: number[]
}

const defaultExamZhScoreConfig: ExamZhScoreConfig = {
  singleChoice: 5,
  multipleChoice: 6,
  fillin: 5,
  solution: [13, 15, 15, 17, 17],
}

function normalizeExamZhScoreConfig(value: unknown): ExamZhScoreConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const numberOrDefault = (input: unknown, fallback: number) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }
  const solutionSource = Array.isArray(source.solution) ? source.solution : defaultExamZhScoreConfig.solution
  return {
    singleChoice: numberOrDefault(source.singleChoice, defaultExamZhScoreConfig.singleChoice),
    multipleChoice: numberOrDefault(source.multipleChoice, defaultExamZhScoreConfig.multipleChoice),
    fillin: numberOrDefault(source.fillin, defaultExamZhScoreConfig.fillin),
    solution: defaultExamZhScoreConfig.solution.map((score, index) => numberOrDefault(solutionSource[index], score)),
  }
}

function scoreText(score: number) {
  return Number.isInteger(score) ? String(score) : String(score).replace(/\.0+$/, '')
}

function sectionScoreSummary(count: number, perQuestionScore: number) {
  const total = count * perQuestionScore
  return `每题${scoreText(perQuestionScore)}分，共${scoreText(total)}分`
}

function buildExamZhScorePlan(rows: QuestionRow[], config: ExamZhScoreConfig) {
  const counts = { singleChoice: 0, multipleChoice: 0, fillin: 0, solution: 0 }
  const totals = { singleChoice: 0, multipleChoice: 0, fillin: 0, solution: 0 }
  const questionScores = new Map<string, number>()
  let solutionIndex = 0
  for (const [index, row] of rows.entries()) {
    const item = mapQuestion(row)
    const paperNo = paperQuestionNo(item, index)
    const questionType = exportQuestionType(item, paperNo)
    let score = 0
    if (questionType === '单选题') {
      score = config.singleChoice
      counts.singleChoice += 1
      totals.singleChoice += score
    } else if (questionType === '多选题') {
      score = config.multipleChoice
      counts.multipleChoice += 1
      totals.multipleChoice += score
    } else if (questionType === '填空题') {
      score = config.fillin
      counts.fillin += 1
      totals.fillin += score
    } else if (questionType === '解答题') {
      score = config.solution[solutionIndex] ?? config.solution[config.solution.length - 1] ?? 0
      solutionIndex += 1
      counts.solution += 1
      totals.solution += score
    }
    if (score > 0) questionScores.set(item.id, score)
  }
  return { counts, totals, questionScores }
}

function paperQuestionNo(item: ReturnType<typeof mapQuestion>, index: number) {
  const parsed = Number.parseInt(cleanQuestionNoLabel(item.questionNo || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : index + 1
}

function exportQuestionType(item: ReturnType<typeof mapQuestion>, _paperNo: number) {
  return normalizeQuestionType(item.questionType, item.stemMarkdown, item.answerText)
}

function examZhSectionForQuestionType(questionType: string, scorePlan: ReturnType<typeof buildExamZhScorePlan>, emittedSections: Set<string>) {
  if (emittedSections.has(questionType)) return ''
  emittedSections.add(questionType)
  if (questionType === '单选题') return `\\section*{一、单选题（${sectionScoreSummary(scorePlan.counts.singleChoice, scorePlan.counts.singleChoice ? scorePlan.totals.singleChoice / scorePlan.counts.singleChoice : defaultExamZhScoreConfig.singleChoice)}）}`
  if (questionType === '多选题') return `\\section*{二、多选题（${sectionScoreSummary(scorePlan.counts.multipleChoice, scorePlan.counts.multipleChoice ? scorePlan.totals.multipleChoice / scorePlan.counts.multipleChoice : defaultExamZhScoreConfig.multipleChoice)}）}`
  if (questionType === '填空题') return `\\section*{三、填空题（${sectionScoreSummary(scorePlan.counts.fillin, scorePlan.counts.fillin ? scorePlan.totals.fillin / scorePlan.counts.fillin : defaultExamZhScoreConfig.fillin)}）}`
  if (questionType === '解答题') return `\\section*{四、解答题（共${scoreText(scorePlan.totals.solution)}分）}`
  return ''
}

function buildRunExamZhLatex(
  run: NonNullable<ReturnType<typeof getRun>>,
  rows: QuestionRow[],
  title: string,
  variant: ExportVariant = 'student',
  scoreConfig = defaultExamZhScoreConfig,
  watermarkText = readAppSettings().examWatermark
) {
  const scorePlan = buildExamZhScorePlan(rows, scoreConfig)
  const watermark = markdownToExamLatex(String(watermarkText || readAppSettings().examWatermark).replace(/\s+/g, ' ').trim(), false)
  const lines: string[] = [
    '\\documentclass{exam-zh}',
    '\\usepackage{amsmath,mathtools}',
    '\\usepackage{graphicx}',
    '\\usepackage{needspace}',
    '\\usepackage{xcolor}',
    '\\usepackage{eso-pic}',
    '',
    '\\examsetup{',
    '  page/size = a4paper,',
    `  paren/show-answer = ${variant === 'teacher' ? 'true' : 'false'},`,
    `  fillin/show-answer = ${variant === 'teacher' ? 'true' : 'false'},`,
    `  solution/show-solution = ${variant === 'teacher' ? 'show' : 'hide'},`,
    '  choices/max-columns = 4,',
    '  choices/label-pos = auto,',
    '  choices/label-sep = 0.45em,',
    '  choices/column-sep = 1em',
    '}',
    '',
    '\\everymath{\\displaystyle}',
    '\\setlength{\\parskip}{0.32em}',
    '\\newcommand{\\answerblank}[1]{\\par\\vspace{#1}\\par}',
    '\\AddToShipoutPictureBG{%',
    '  \\AtPageCenter{%',
    `    \\rotatebox{35}{\\textcolor{black!14}{\\fontsize{54}{64}\\selectfont\\itshape ${watermark}}}%`,
    '  }%',
    '}',
    '',
    `\\title{${markdownToExamLatex(title || run.paperTitle || run.pdfName, false)}}`,
    '\\subject{}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '\\vspace{-0.8em}',
  ]
  const emittedSections = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const item = mapQuestion(row)
    const paperNo = paperQuestionNo(item, index)
    const questionType = exportQuestionType(item, paperNo)
    const section = examZhSectionForQuestionType(questionType, scorePlan, emittedSections)
    if (section) lines.push('', section)
    if (paperNo === 16 || paperNo === 18) lines.push('\\newpage')
    const { prompt, choices } = splitChoiceStemForExport(item.stemMarkdown)
    const questionScore = scorePlan.questionScores.get(item.id)
    lines.push('', '\\begin{question}')
    const stemFigures = questionFigures({ item })
    lines.push(`${questionScore ? `\\textbf{（${scoreText(questionScore)}分）}\\quad ` : ''}${renderExamZhPromptWithInlineFigures(prompt, stemFigures, questionType, variant, item.answerText) || '（题干待补充）'}`)
    if (choices.length) {
      lines.push('\\begin{choices}')
      for (const choice of choices) lines.push(`  \\item ${markdownToExamLatex(choice, true)}`)
      lines.push('\\end{choices}')
    }
    lines.push(...examZhFigureLines(figuresWithoutInlineMarkers(prompt, stemFigures)))
    if (questionType === '解答题' && paperNo >= 15 && variant !== 'teacher') {
      lines.push(examZhAnswerBlank(paperNo))
    }
    if (variant === 'teacher') {
      lines.push('\\begin{solution}')
      const solutionFigures = analysisFigures({ item })
      lines.push(`\\textbf{【答案】} ${renderExamZhMarkdownWithInlineFigures(item.answerText, solutionFigures) || '暂无'}`)
      lines.push('')
      lines.push(`\\textbf{【解析】} ${renderExamZhMarkdownWithInlineFigures(item.analysisMarkdown, solutionFigures) || '暂无'}`)
      const remainingSolutionFigures = figuresWithoutInlineMarkers(`${item.answerText || ''}\n${item.analysisMarkdown || ''}`, solutionFigures)
      if (remainingSolutionFigures.length) {
        lines.push(...examZhFigureLines(remainingSolutionFigures))
      }
      lines.push('\\end{solution}')
    }
    lines.push('\\end{question}')
  }
  lines.push('', '\\end{document}', '')
  return lines.join('\n')
}

function xelatexPath() {
  return firstExecutable([
    process.env.XELATEX_PATH || '',
    'xelatex',
  ])
}

function exportRunExamZh(
  runId: string,
  options: {
    title?: string
    format?: 'latex' | 'pdf'
    scoreConfig?: ExamZhScoreConfig
    watermarkText?: string
    variant?: ExportVariant
  }
) {
  const variant = options.variant || 'student'
  const run = getRun(runId)
  if (!run) throw new Error('批次不存在。')
  const rows = (db.prepare(`
    SELECT * FROM question_bank_items
    WHERE source_run_id = ? AND bank_status = 'banked'
    ORDER BY serial_no ASC
  `).all(runId) as QuestionRow[]).sort((left, right) => {
    const leftNo = paperQuestionNo(mapQuestion(left), 0)
    const rightNo = paperQuestionNo(mapQuestion(right), 0)
    return leftNo - rightNo
  })
  if (!rows.length) throw new Error('当前批次暂无已入库题目，无法导出。')
  const outDir = path.join(storageRoot, 'output', 'pdf', 'batch-exports', safeName(runId))
  fs.mkdirSync(outDir, { recursive: true })
  const baseName = `${safeName(options.title || run.paperTitle || run.pdfName || runId)}-examzh-${variant}`
  const texPath = path.join(outDir, `${baseName}.tex`)
  fs.writeFileSync(
    texPath,
    buildRunExamZhLatex(
      run,
      rows,
      options.title || run.paperTitle || run.pdfName,
      variant,
      options.scoreConfig,
      options.watermarkText || readAppSettings().examWatermark
    ),
    'utf8'
  )
  if (options.format === 'pdf') {
    for (let i = 0; i < 2; i += 1) {
      execFileSync(xelatexPath(), ['-interaction=nonstopmode', '-halt-on-error', path.basename(texPath)], {
        cwd: outDir,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
      })
    }
    return { path: path.join(outDir, `${baseName}.pdf`), format: 'pdf' as const }
  }
  return { path: texPath, format: 'latex' as const }
}

function normalizeChoiceMarkers(value: string) {
  const source = String(value || '')
  const lineMatches = Array.from(source.matchAll(/(?:^|\n)[ \t]*([A-D])\s*[.．、:：]\s*/g))
  if (lineMatches.length >= 4) return source
  let markerCount = 0
  const marked = source.replace(/(?<![A-Za-z0-9])([A-D])\s*[.．、:：]\s*/g, (match, label: string, offset: number) => {
    markerCount += 1
    return `${offset === 0 ? '' : '\n'}${label}. `
  })
  return markerCount >= 4 ? marked : source
}

function hasFourChoiceOptions(value: string) {
  const normalized = normalizeChoiceMarkers(value)
  const matches = Array.from(normalized.matchAll(/(?:^|\n)[ \t]*([A-D])\s*[.．、:：]\s*/g))
  if (matches.length < 4) return false
  return matches.slice(0, 4).map((match) => match[1]).join('') === 'ABCD'
}

function selectedChoiceLetters(answer: string) {
  const cleaned = String(answer || '')
    .replace(/【?答案】?/g, '')
    .replace(/正确选项|选项|故选|答案为/g, '')
    .toUpperCase()
  const letters = new Set<string>()
  for (const match of cleaned.matchAll(/[A-D]+/g)) {
    for (const letter of match[0]) letters.add(letter)
  }
  return letters
}

function hasChoiceAnswerCue(stem: string, answer: string) {
  return selectedChoiceLetters(answer).size > 0 && /[（(]\s*(?:　|\s|\\quad)*[）)]|选择|下列|则/.test(stem)
}

function hasOpenEndedCue(stem: string, answer: string) {
  return /(?:^|[^\d])[(（]\s*[1-9]\s*[)）]/.test(stem)
    || /(?:^|[^\d])[(（]\s*[1-9]\s*[)）]/.test(answer)
    || /证明见解析|答案见解析|过程见解析|证明[:：]|求证|求面|求.*方程/.test(`${stem}\n${answer}`)
}

function hasBlankCue(stem: string) {
  return /_{2,}|____|填空|=\s*$/.test(stem)
}

function inferQuestionType(stem: string, answer: string, fallback = '解答题') {
  if (hasFourChoiceOptions(stem)) {
    const selected = selectedChoiceLetters(answer)
    if (!selected.size) return '单选题'
    return selected.size > 1 ? '多选题' : '单选题'
  }
  if (hasOpenEndedCue(stem, answer)) return '解答题'
  if (hasBlankCue(stem)) return '填空题'
  if (hasChoiceAnswerCue(stem, answer)) {
    const selected = selectedChoiceLetters(answer)
    if (!selected.size) return '单选题'
    return selected.size > 1 ? '多选题' : '单选题'
  }
  const selected = selectedChoiceLetters(answer)
  if (selected.size > 0 && selected.size <= 4) return selected.size > 1 ? '多选题' : '单选题'
  return fallback
}

function normalizeQuestionType(value: string, stem = '', answer = '') {
  const raw = String(value || '').trim()
  if ((/单选|单项选择|多选|多项选择|选择/.test(raw)) && !hasFourChoiceOptions(stem) && hasOpenEndedCue(stem, answer)) return '解答题'
  if (/多选|多项选择/.test(raw)) return '多选题'
  if (/单选|单项选择/.test(raw)) return '单选题'
  if (/填空/.test(raw)) return '填空题'
  if (/解答|计算|证明|应用/.test(raw)) return '解答题'
  if (!raw || raw === 'OCR题' || raw === '未设题型') return inferQuestionType(stem, answer)
  if (/选择/.test(raw)) return inferQuestionType(stem, answer, '单选题')
  return raw
}

function repairLegacyQuestionTypes() {
  const rows = db.prepare(`
    SELECT id, question_type, stem_markdown, answer_text
    FROM question_bank_items
  `).all() as Array<Pick<QuestionRow, 'id' | 'question_type' | 'stem_markdown' | 'answer_text'>>
  const update = db.prepare('UPDATE question_bank_items SET question_type = ?, updated_at = ? WHERE id = ?')
  const now = nowIso()
  for (const row of rows) {
    const nextType = normalizeQuestionType(
      row.question_type,
      row.stem_markdown,
      row.answer_text,
    )
    if (!nextType || nextType === row.question_type) continue
    update.run(nextType, now, row.id)
  }
}

function questionTypeOrder(value: string) {
  const type = normalizeQuestionType(value)
  if (type === '单选题') return 1
  if (type === '多选题') return 2
  if (type === '填空题') return 3
  if (type === '解答题') return 4
  return 9
}

function questionTypeLabel(value: string) {
  const type = normalizeQuestionType(value)
  if (type === '单选题') return '单选题'
  if (type === '多选题') return '多选题'
  if (type === '填空题') return '填空题'
  if (type === '解答题') return '解答题'
  return type ? '其他题型' : ''
}

function sectionOrdinal(index: number) {
  const numerals = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return numerals[index] || String(index)
}

function collectionSectionNames(rows: Array<Pick<QuestionRow, 'question_type' | 'stem_markdown' | 'answer_text'>>) {
  const names = new Map<string, string>()
  for (const row of rows) {
    const type = normalizeQuestionType(
      row.question_type,
      row.stem_markdown,
      row.answer_text,
    )
    if (!type || names.has(type)) continue
    const label = questionTypeLabel(type)
    if (!label) continue
    names.set(type, `${sectionOrdinal(names.size + 1)}、${label}`)
  }
  return names
}

function stripLeadingQuestionNo(value: string, questionNo = '') {
  const text = String(value || '').trimStart()
  const escaped = String(questionNo || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (escaped) {
    const exactPattern = new RegExp(`^(?:第\\s*)?${escaped}\\s*(?:题)?\\s*[.．、:：）)]\\s*`)
    const exactCleaned = text.replace(exactPattern, '')
    if (exactCleaned !== text) return exactCleaned.trimStart()
  }
  return text
    .replace(/^第\s*\d{1,3}\s*题\s*/, '')
    .replace(/^\d{1,3}\s*(?:题)?\s*[.．、:：）)]\s*/, '')
    .trimStart()
}

function createQuestion(input: Partial<PublicQuestion> = {}) {
  const now = nowIso()
  const id = input.id || createId('qb')
  const serial = db.prepare('SELECT COALESCE(MAX(serial_no), 0) + 1 AS next FROM question_bank_items').get() as { next: number }
  const stemMarkdown = String((input.stemMarkdown ?? blocksToMarkdown(input.problemBlocks ?? [])) || '请在右侧编辑 Markdown，录入题干内容。')
  const answerText = String((input.answerText ?? blocksToMarkdown(input.answerBlocks ?? [])) || '')
  const analysisMarkdown = String((input.analysisMarkdown ?? blocksToMarkdown(input.analysisBlocks ?? [])) || '')
  const knowledgePoints = normalizeTags(input.knowledgePoints)
  const solutionMethods = normalizeTags(input.solutionMethods)
  const sourceTitle = input.sourceTitle || '手动创建'
  const chapter = input.chapter || knowledgePoints[0] || '知识点未设置'
  db.prepare(`
    INSERT INTO question_bank_items (
      id, serial_no, question_no, stage, question_type, difficulty_score, chapter, source_title, bank_status,
      difficulty_score_10, difficulty_label, knowledge_points_json, solution_methods_json, stem_markdown, answer_text, analysis_markdown, search_text, slice_image_path, figures_json, source_run_id, source_solution_run_id, merge_status, merge_note, format_review_required, format_review_reasons_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    serial.next,
    input.questionNo || String(serial.next),
    input.stage || configuredGradeStages()[0] || '高三',
    input.questionType || '未设题型',
    input.difficultyScore ?? 0,
    chapter,
    sourceTitle,
    input.bankStatus || 'ready',
    normalizeDifficultyScore10(input.difficultyScore10),
    input.difficultyLabel || difficultyLabel10(normalizeDifficultyScore10(input.difficultyScore10)),
    JSON.stringify(knowledgePoints),
    JSON.stringify(solutionMethods),
    stemMarkdown,
    answerText,
    analysisMarkdown,
    buildSearchText(stemMarkdown, answerText, analysisMarkdown, [sourceTitle, chapter, knowledgePoints.join(' '), solutionMethods.join(' ')]),
    input.sliceImagePath || '',
    JSON.stringify(input.figures || []),
    input.sourceRunId || '',
    input.sourceSolutionRunId || '',
    input.mergeStatus || '',
    input.mergeNote || '',
    input.needsFormatReview ? 1 : 0,
    input.needsFormatReview ? JSON.stringify({
      issue: input.formatIssue || null,
      reasons: [],
      renderErrors: input.formatIssue ? [input.formatIssue] : [],
      updatedAt: now,
    }) : '{}',
    now,
    now
  )
  return getQuestion(id)
}

export const app = express()
app.use(express.json({ limit: '20mb' }))
app.use('/assets', (req, res, next) => {
  const decoded = decodeURIComponent(req.path || '')
  const target = resolveStoragePath(decoded)
  const allowed = target && (isInside(storageRoot, target) || isInside(sourceRoot, target))
  if (!allowed || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    next()
    return
  }
  res.sendFile(target)
})
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
}

app.get('/api/health', (_, res) => {
  res.json({ ok: true, sourceRoot, storageRoot, dataDir, runsRoot, sqlitePath, tools: toolAvailability() })
})

app.get('/api/tools/pdf-slicer/ocr-settings', (_, res) => {
  res.json(readOcrSettings())
})

app.get('/api/settings', (_, res) => {
  res.json(readOcrSettings())
})

app.get('/api/question-bank/tag-libraries', (_, res) => {
  res.json(readTagLibraries())
})

app.get('/api/learning-tags/libraries', (_, res) => {
  res.json({ libraries: readLearningTagLibraries() })
})

app.post('/api/learning-tags/libraries', (req, res) => {
  try {
    const library = writeLearningTagLibrary(req.body)
    res.json({ library })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

app.delete('/api/learning-tags/libraries/:id', (req, res) => {
  const id = safeTagLibraryCode(decodeURIComponent(req.params.id))
  const libraries = readLearningTagLibraries()
  const library = libraries.find((item) => item.id === id || item.code === id)
  if (!library) {
    res.status(404).json({ error: '标签库不存在。' })
    return
  }
  if (library.isDefault) {
    res.status(400).json({ error: '默认标签库不可删除，请先将其他知识点标签库设为默认。' })
    return
  }
  if (libraries.length <= 1) {
    res.status(400).json({ error: '至少需要保留一个标签库。' })
    return
  }
  const filePath = tagLibraryFilePath(library.code)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  res.json({ ok: true })
})

app.patch('/api/tools/pdf-slicer/ocr-settings', (req, res) => {
  res.json(writeOcrSettings(req.body || {}))
})

app.patch('/api/settings', (req, res) => {
  res.json(writeOcrSettings(req.body || {}))
})

// ── PDF Slicer Rules API ─────────────────────────────────────────────────

app.get('/api/tools/pdf-slicer/rules', (_, res) => {
  try {
    const rules = readPdfSlicerRules()
    const hash = computeJsonHash(rules)
    res.json({ ...rules, baseVersion: rules.version, hash } as Record<string, unknown>)
  } catch (error) {
    res.status(500).json({ error: '读取切题规则失败' })
  }
})

app.put('/api/tools/pdf-slicer/rules', (req, res) => {
  try {
    const { rules: rulesData, baseVersion } = (req.body || {}) as { rules: unknown; baseVersion: unknown }
    if (!rulesData) {
      res.status(400).json({ error: '缺少 rules 字段' })
      return
    }
    const validation = validatePdfSlicerRules(rulesData)
    if (!validation.valid) {
      res.status(400).json({ error: '规则验证失败', details: validation.errors })
      return
    }
    const currentRules = readPdfSlicerRules()
    const expectedVersion = Number(baseVersion ?? currentRules.version)
    if (currentRules.version !== expectedVersion) {
      res.status(409).json({
        error: '规则已被其他操作更新，请刷新后重试',
        currentBaseVersion: currentRules.version,
      })
      return
    }
    const result = writePdfSlicerRules(rulesData as SlicerRulesData, expectedVersion)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: '保存切题规则失败' })
  }
})

app.post('/api/tools/pdf-slicer/rules/validate', (req, res) => {
  try {
    const validation = validatePdfSlicerRules(req.body?.rules)
    res.json(validation)
  } catch (error) {
    res.status(500).json({ error: '验证规则失败' })
  }
})

app.get('/api/tools/pdf-slicer/rules/history', (_, res) => {
  try {
    const history = listPdfSlicerRulesHistory()
    res.json({ history })
  } catch (error) {
    res.status(500).json({ error: '读取规则历史失败' })
  }
})

app.post('/api/tools/pdf-slicer/rules/rollback/:version', (req, res) => {
  try {
    const targetVersion = Number(req.params.version)
    if (!Number.isFinite(targetVersion)) {
      res.status(400).json({ error: '无效的版本号' })
      return
    }
    const historyDir = pdfSlicerRulesHistoryDir()
    const files = fs.readdirSync(historyDir).filter((f) => f.includes(`v${targetVersion}_`))
    if (!files.length) {
      res.status(404).json({ error: `未找到版本 v${targetVersion} 的快照` })
      return
    }
    files.sort().reverse()
    const snapshot = JSON.parse(fs.readFileSync(path.join(historyDir, files[0]), 'utf8')) as SlicerRulesData
    if (!snapshot.version) {
      res.status(500).json({ error: '快照数据损坏' })
      return
    }
    const currentRules = readPdfSlicerRules()
    const result = writePdfSlicerRules(snapshot, currentRules.version)
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: '回滚规则失败' })
  }
})

app.get('/api/tools/pdf-slicer/dashboard', (_, res) => {
  const runs = (db.prepare('SELECT * FROM pdf_slicer_runs ORDER BY created_at DESC').all() as RunRow[]).map(mapRun)
  const batches = db.prepare(`
    SELECT b.id, b.title, b.material_type AS materialType, b.workflow_mode AS workflowMode, b.workflow_status AS workflowStatus,
      b.created_at AS createdAt, b.uploaded_count AS uploadedCount,
      COUNT(r.run_id) AS runCount
    FROM pdf_slicer_batches b
    LEFT JOIN pdf_slicer_runs r ON r.batch_id = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `).all()
  res.json({
    queueSummary: {
      totalRuns: runs.length,
      totalBatches: batches.length,
      sliceQueued: runs.filter((run) => run.sliceStatus === 'queued').length,
      sliceRunning: runs.filter((run) => run.sliceStatus === 'running').length,
      pendingQuickReview: runs.filter((run) => run.sliceStatus === 'succeeded' && run.quickReviewStatus === 'pending').length,
      ocrQueued: runs.filter((run) => run.ocrStatus === 'queued').length,
      ocrRunning: runs.filter((run) => run.ocrStatus === 'running').length,
      ocrSucceeded: runs.filter((run) => run.ocrStatus === 'succeeded').length,
    },
    batches,
    runs,
  })
})

app.post('/api/tools/pdf-slicer/uploads', upload.array('files'), (req, res) => {
  const files = req.files as Express.Multer.File[]
  if (!files?.length) {
    res.status(400).json({ error: '请至少上传一个 PDF、DOC 或 DOCX 文件。' })
    return
  }
  const containsWordFile = files.some((file) => isWordUploadKind(path.extname(normalizeUploadName(file.originalname)).slice(1).toLowerCase()))
  if (containsWordFile && !sofficePath()) {
    res.status(400).json({
      error: '未检测到 LibreOffice，无法上传 DOC/DOCX 文件。请先安装 LibreOffice，或在系统设置的外部工具中填写 soffice.exe 路径。',
    })
    return
  }
  const now = nowIso()
  const requestedMaterialType = normalizeMaterialType(req.body?.materialType ?? req.body?.material_type ?? 'unknown')
  const requestedFileRole = normalizeFileRole(req.body?.fileRole ?? req.body?.file_role ?? 'unknown')
  const requestedStage = String(req.body?.stage || configuredGradeStages()[0] || '高三').trim() || '高三'
  const requestedFileRoles = parseJson<FileRole[]>(String(req.body?.fileRolesJson || req.body?.file_roles_json || '[]'), [])
    .map((role) => normalizeFileRole(role))
  const runIds: string[] = []
  const requestedPaperTitle = cleanSourceTitle(String(req.body?.paperTitle || ''), '')
  const groupingFileRole = requestedFileRole !== 'unknown'
    ? requestedFileRole
    : requestedFileRoles.find((role) => role === 'questions' || role === 'solutions') ?? 'unknown'
  let batchId = findReusableSeparatedExamBatch(requestedPaperTitle, requestedMaterialType, groupingFileRole)
  if (batchId) {
    db.prepare('UPDATE pdf_slicer_batches SET uploaded_count = uploaded_count + ? WHERE id = ?').run(files.length, batchId)
  } else {
    batchId = createId('batch')
    db.prepare('INSERT INTO pdf_slicer_batches (id, title, material_type, workflow_mode, workflow_status, created_at, uploaded_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(batchId, requestedPaperTitle || batchId, requestedMaterialType, 'single', 'ready', now, files.length)
  }
  const insertRun = db.prepare(`
    INSERT INTO pdf_slicer_runs (
      run_id, batch_id, upload_mode, paper_title, pdf_name, pdf_path, source_file_name, source_file_kind, run_dir, document_diagnostics_json,
      material_type, file_role, stage, classification_confidence, classification_reasons_json,
      created_at, updated_at, slice_status, quick_review_status, total_questions, approved_questions, unreviewed_questions, ocr_status,
      rules_version, rules_hash, rules_fallback_used, rules_warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'pending', 0, 0, 0, 'idle', 0, '', 0, '[]')
  `)
  for (const [fileIndex, file] of files.entries()) {
    const originalName = normalizeUploadName(file.originalname)
    const runId = createId('run', originalName)
    const runDir = path.join(runsRoot, runId)
    fs.mkdirSync(runDir, { recursive: true })
    const target = path.join(runDir, originalName)
    fs.writeFileSync(target, file.buffer)
    const sourceKind = path.extname(originalName).slice(1).toLowerCase() || 'pdf'
    let pdfPath = target
    let pdfName = originalName
    let uploadMode = 'single_pdf'
    let diagnostics: Record<string, unknown> = {}
    if (isWordUploadKind(sourceKind)) {
      diagnostics = sourceKind === 'docx' ? { docxFormulaAnalysis: analyzeDocxFormulaTypes(target) } : {}
      pdfPath = convertDocxToPdf(target, runDir)
      pdfName = path.basename(pdfPath)
      uploadMode = 'docx_to_pdf'
    } else if (sourceKind !== 'pdf') {
      throw new Error(`暂不支持的文件类型：.${sourceKind}`)
    }
    const paperTitle = requestedPaperTitle || cleanSourceTitle(originalName)
    const detectedClassification = classifyUploadedDocument({ fileName: originalName, textSample: extractPdfTextSample(pdfPath) })
    const fileRoleOverride = requestedFileRoles[fileIndex] ?? requestedFileRole
    const hasManualClassification = requestedMaterialType !== 'unknown' || fileRoleOverride !== 'unknown'
    const classification = hasManualClassification ? {
      materialType: requestedMaterialType !== 'unknown' ? requestedMaterialType : detectedClassification.materialType,
      fileRole: fileRoleOverride !== 'unknown' ? fileRoleOverride : detectedClassification.fileRole,
      confidence: 1,
      reasons: [`上传时手动指定为 ${materialTypeLabelForReason(requestedMaterialType !== 'unknown' ? requestedMaterialType : detectedClassification.materialType)}/${fileRoleLabelForReason(fileRoleOverride !== 'unknown' ? fileRoleOverride : detectedClassification.fileRole)}`],
    } : detectedClassification
    insertRun.run(
      runId,
      batchId,
      uploadMode,
      paperTitle,
      pdfName,
      assetPathFor(pdfPath),
      originalName,
      sourceKind,
      assetPathFor(runDir),
      JSON.stringify(diagnostics),
      classification.materialType,
      classification.fileRole,
      requestedStage,
      classification.confidence,
      JSON.stringify(classification.reasons),
      now,
      now
    )
    runIds.push(runId)
    startSlicingRunInBackground(runId)
  }
  updateBatchWorkflow(batchId)
  const batch = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(batchId) as BatchRow
  res.status(201).json({ batchId, uploadedCount: files.length, runIds, batch: mapBatch(batch), runs: batchRuns(batchId) })
})

app.get('/api/tools/pdf-slicer/batches/:batchId', (req, res) => {
  const row = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(req.params.batchId) as BatchRow | undefined
  if (!row) {
    res.status(404).json({ error: '资料组不存在。' })
    return
  }
  updateBatchWorkflow(req.params.batchId)
  const next = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(req.params.batchId) as BatchRow
  const solutionSummary = db.prepare(`
    SELECT match_status AS status, COUNT(*) AS count
    FROM pdf_slicer_solution_items
    WHERE batch_id = ?
    GROUP BY match_status
  `).all(req.params.batchId)
  res.json({ batch: mapBatch(next), runs: batchRuns(req.params.batchId), solutionSummary })
})

app.patch('/api/tools/pdf-slicer/runs/:runId/classification', (req, res) => {
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(req.params.runId) as RunRow | undefined
  if (!row) {
    res.status(404).json({ error: '批次文件不存在。' })
    return
  }
  const materialType = normalizeMaterialType(req.body?.materialType ?? req.body?.material_type ?? row.material_type)
  const fileRole = normalizeFileRole(req.body?.fileRole ?? req.body?.file_role ?? row.file_role)
  const reasons = [`用户修改为 ${materialType}/${fileRole}`]
  db.prepare(`
    UPDATE pdf_slicer_runs
    SET material_type = ?, file_role = ?, classification_confidence = 1, classification_reasons_json = ?, updated_at = ?
    WHERE run_id = ?
  `).run(materialType, fileRole, JSON.stringify(reasons), nowIso(), req.params.runId)
  if (fileRole !== 'solutions') {
    db.prepare('DELETE FROM pdf_slicer_solution_items WHERE source_run_id = ?').run(req.params.runId)
  }
  updateBatchWorkflow(row.batch_id)
  const warning = row.slice_status !== 'queued' && row.slice_status !== 'idle'
    ? '文件角色已修改。该文件已有切题结果，如需让新角色完全生效，建议重新执行切题/OCR。'
    : ''
  const batch = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(row.batch_id) as BatchRow
  res.json({ run: getRun(req.params.runId), batch: mapBatch(batch), warning })
})

app.post('/api/tools/pdf-slicer/batches/:batchId/merge-separated-exam', (req, res) => {
  const row = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(req.params.batchId) as BatchRow | undefined
  if (!row) {
    res.status(404).json({ error: '资料组不存在。' })
    return
  }
  const result = tryAutoMergeSeparatedExam(req.params.batchId)
  const next = db.prepare('SELECT * FROM pdf_slicer_batches WHERE id = ?').get(req.params.batchId) as BatchRow
  res.json({ ...result, batch: mapBatch(next), runs: batchRuns(req.params.batchId) })
})

app.get('/api/tools/pdf-slicer/runs/:runId', (req, res) => {
  const run = getRun(req.params.runId)
  run ? res.json(run) : res.status(404).json({ error: '批次不存在。' })
})

app.post('/api/tools/pdf-slicer/runs/:runId/complete-slice', (req, res) => {
  if (!getRun(req.params.runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const total = Number(req.body?.totalQuestions || 8)
  db.prepare("UPDATE pdf_slicer_runs SET slice_status = 'succeeded', total_questions = ?, unreviewed_questions = ?, updated_at = ? WHERE run_id = ?")
    .run(total, total, nowIso(), req.params.runId)
  res.json(getRun(req.params.runId))
})

app.post('/api/tools/pdf-slicer/runs/:runId/start-slice', (req, res) => {
  if (!getRun(req.params.runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  try {
    res.json(startSlicingRun(req.params.runId))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: message, run: getRun(req.params.runId) })
  }
})

app.get('/api/tools/pdf-slicer/runs/:runId/slice-review/items', (req, res) => {
  const run = getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const items = getReviewItems(run.runId)
  res.json({ summary: { totalItems: items.length, pendingCount: items.filter((item) => item.reviewStatus === 'pending_review').length }, items })
})

app.post('/api/tools/pdf-slicer/runs/:runId/slice-review/items/merge', (req, res) => {
  const run = getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const requestedIds: string[] = Array.isArray(req.body?.resultIds) ? req.body.resultIds.map(String).filter(Boolean) : []
  const uniqueIds = Array.from(new Set(requestedIds))
  if (uniqueIds.length < 2) {
    res.status(400).json({ error: '请至少选择两个题块进行合并。' })
    return
  }
  const rows = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ?').all(run.runId) as ReviewRow[]
  const rowById = new Map(rows.map((row) => [row.result_id, row]))
  const selectedRows = uniqueIds.map((id) => rowById.get(id)).filter(Boolean) as ReviewRow[]
  if (selectedRows.length !== uniqueIds.length) {
    res.status(404).json({ error: '部分题块不存在，无法合并。' })
    return
  }
  const sources = selectedRows.map((row) => stripAssetPrefix(row.auto_image_path || row.page_image_path))
  const sourceAbs = sources.map((source) => resolveStoragePath(source))
  if (sourceAbs.some((source) => !fs.existsSync(source))) {
    res.status(404).json({ error: '部分题块图片不存在，无法合并。' })
    return
  }
  const keep = selectedRows[0]
  const now = nowIso()
  const suffix = Date.now().toString(36)
  const base = keep.result_id.replace(/[^\w.-]+/g, '_')
  const mergeDirRel = path.join(stripAssetPrefix(run.runDir), 'output', 'manual_merges')
  const mergedRel = path.join(mergeDirRel, `${base}_${suffix}_merged.png`)
  let imageInfo: { width: number; height: number; parts: Array<Record<string, any>> }
  try {
    imageInfo = mergeReviewImages(sourceAbs, resolveStoragePath(mergedRel))
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    return
  }
  const bbox = { x: 0, y: 0, width: imageInfo.width, height: imageInfo.height }
  const removeIds = selectedRows.slice(1).map((row) => row.result_id)
  db.prepare(`
    UPDATE pdf_slicer_review_items
    SET page_start = ?, page_end = ?, page_image_path = ?, auto_image_path = ?, bbox_json = ?, segments_json = ?, text_regions_json = '[]', figures_json = '[]', review_status = 'pending_review', note = ?, updated_at = ?
    WHERE run_id = ? AND result_id = ?
  `).run(
    Math.min(...selectedRows.map((row) => row.page_start)),
    Math.max(...selectedRows.map((row) => row.page_end)),
    mergedRel,
    mergedRel,
    JSON.stringify(bbox),
    JSON.stringify([{ page_number: keep.page_start, page_image_path: mergedRel, bbox }]),
    JSON.stringify({ mergedFrom: uniqueIds, sourceImagePaths: sources, parts: imageInfo.parts }),
    now,
    run.runId,
    keep.result_id,
  )
  const deleteMerged = db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?')
  for (const id of removeIds) deleteMerged.run(run.runId, id)
  const { items, pending } = syncReviewRunCounts(run.runId)
  res.json({ run: getRun(run.runId), summary: { totalItems: items.length, pendingCount: pending }, items, mergedId: keep.result_id, removedIds: removeIds })
})

app.delete('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId', (req, res) => {
  const run = getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const resultId = decodeURIComponent(req.params.resultId)
  const existing = db.prepare('SELECT result_id FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as { result_id: string } | undefined
  if (!existing) {
    res.status(404).json({ error: '题块不存在。' })
    return
  }
  db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').run(run.runId, resultId)
  const { items, pending } = syncReviewRunCounts(run.runId)
  res.json({ deleted: true, run: getRun(run.runId), summary: { totalItems: items.length, pendingCount: pending }, items })
})

app.patch('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId', (req, res) => {
  const run = getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const resultId = decodeURIComponent(req.params.resultId)
  const questionLabel = String(req.body?.questionLabel ?? '').trim().slice(0, 40)
  if (!questionLabel) {
    res.status(400).json({ error: '题块名称不能为空。' })
    return
  }
  const existing = db.prepare('SELECT result_id FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as { result_id: string } | undefined
  if (!existing) {
    res.status(404).json({ error: '题块不存在。' })
    return
  }
  db.prepare('UPDATE pdf_slicer_review_items SET question_label = ?, updated_at = ? WHERE run_id = ? AND result_id = ?')
    .run(questionLabel, nowIso(), run.runId, resultId)
  const item = getReviewItems(run.runId).find((entry) => entry.resultId === resultId)
  res.json({ item })
})

app.post('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId/split', (req, res) => {
  const run = getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const resultId = decodeURIComponent(req.params.resultId)
  const splitRatio = Number(req.body?.splitRatio)
  if (!Number.isFinite(splitRatio) || splitRatio <= 0.08 || splitRatio >= 0.92) {
    res.status(400).json({ error: '分割线位置无效。' })
    return
  }
  const row = db.prepare('SELECT * FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as ReviewRow | undefined
  if (!row) {
    res.status(404).json({ error: '题块不存在。' })
    return
  }
  const sourceRel = stripAssetPrefix(row.auto_image_path || row.page_image_path)
  const sourceAbs = resolveStoragePath(sourceRel)
  if (!sourceRel || !fs.existsSync(sourceAbs)) {
    res.status(404).json({ error: '题块图片不存在，无法细分。' })
    return
  }
  const now = nowIso()
  const base = path.basename(sourceRel, path.extname(sourceRel)).replace(/[^\w.-]+/g, '_') || resultId.replace(/[^\w.-]+/g, '_')
  const splitDirRel = path.join(stripAssetPrefix(run.runDir), 'output', 'manual_splits')
  const suffix = Date.now().toString(36)
  const topRel = path.join(splitDirRel, `${base}_${suffix}_top.png`)
  const bottomRel = path.join(splitDirRel, `${base}_${suffix}_bottom.png`)
  let imageInfo: { width: number; height: number; splitY: number; topHeight: number; bottomHeight: number }
  try {
    imageInfo = splitReviewImage(sourceAbs, resolveStoragePath(topRel), resolveStoragePath(bottomRel), splitRatio)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    return
  }
  const label = row.question_label || '?'
  const topLabel = String(req.body?.topLabel || label).trim().slice(0, 40) || label
  const bottomLabel = String(req.body?.bottomLabel || `${label}-2`).trim().slice(0, 40) || `${label}-2`
  const topBBox = { x: 0, y: 0, width: imageInfo.width, height: imageInfo.topHeight }
  const bottomBBox = { x: 0, y: 0, width: imageInfo.width, height: imageInfo.bottomHeight }
  const bottomId = `${resultId}__split_${suffix}`
  const insert = db.prepare(`
    INSERT INTO pdf_slicer_review_items (
      result_id, run_id, question_label, page_start, page_end, page_image_path, auto_image_path, bbox_json, segments_json, text_regions_json, figures_json, review_status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.prepare(`
    UPDATE pdf_slicer_review_items
    SET question_label = ?, page_image_path = ?, auto_image_path = ?, bbox_json = ?, segments_json = ?, text_regions_json = '[]', figures_json = '[]', review_status = 'pending_review', note = ?, updated_at = ?
    WHERE run_id = ? AND result_id = ?
  `).run(
    topLabel,
    topRel,
    topRel,
    JSON.stringify(topBBox),
    JSON.stringify([{ page_number: row.page_start, page_image_path: topRel, bbox: topBBox }]),
    JSON.stringify({ splitFrom: resultId, splitPart: 'top', originalImagePath: sourceRel, splitRatio }),
    now,
    run.runId,
    resultId,
  )
  insert.run(
    bottomId,
    run.runId,
    bottomLabel,
    row.page_start,
    row.page_end,
    bottomRel,
    bottomRel,
    JSON.stringify(bottomBBox),
    JSON.stringify([{ page_number: row.page_start, page_image_path: bottomRel, bbox: bottomBBox }]),
    '[]',
    '[]',
    'pending_review',
    JSON.stringify({ splitFrom: resultId, splitPart: 'bottom', originalImagePath: sourceRel, splitRatio }),
    now,
    now,
  )
  const { items, pending } = syncReviewRunCounts(run.runId)
  res.json({ run: getRun(run.runId), summary: { totalItems: items.length, pendingCount: pending }, items, topId: resultId, bottomId })
})

app.patch('/api/tools/pdf-slicer/runs/:runId/slice-review/items/:resultId/figures', (req, res) => {
  const run = getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const resultId = decodeURIComponent(req.params.resultId)
  const existing = db.prepare('SELECT result_id FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').get(run.runId, resultId) as { result_id: string } | undefined
  if (!existing) {
    res.status(404).json({ error: '题块不存在。' })
    return
  }
  const figures = Array.isArray(req.body?.figures) ? req.body.figures.map((figure: Record<string, any>, index: number) => {
    const formulaSuspect = Boolean(figure.formula_suspect ?? figure.formulaSuspect)
    const formulaSuspectReason = String(figure.formula_suspect_reason ?? figure.formulaSuspectReason ?? '')
    return {
      id: String(figure.id || `review_fig_${index + 1}`),
      page_number: Number(figure.page_number ?? figure.pageNumber ?? 1),
      usage: String(figure.usage || figure.category || 'stem'),
      category: String(figure.category || figure.usage || 'stem'),
      optionLabel: figure.optionLabel ? String(figure.optionLabel).toUpperCase() : undefined,
      bbox: {
        x: Number(figure.bbox?.x || 0),
        y: Number(figure.bbox?.y || 0),
        width: Number(figure.bbox?.width || 0),
        height: Number(figure.bbox?.height || 0),
      },
      kind: String(figure.kind || 'image'),
      formula_suspect: formulaSuspect,
      formulaSuspect,
      formula_suspect_reason: formulaSuspectReason || undefined,
      formulaSuspectReason: formulaSuspectReason || undefined,
    }
  }).filter((figure: Record<string, any>) => figure.page_number > 0 && figure.bbox.width > 0 && figure.bbox.height > 0) : []
  db.prepare('UPDATE pdf_slicer_review_items SET figures_json = ?, updated_at = ? WHERE run_id = ? AND result_id = ?')
    .run(JSON.stringify(figures), nowIso(), run.runId, resultId)
  const item = getReviewItems(run.runId).find((entry) => entry.resultId === resultId)
  res.json({ item })
})

app.post('/api/tools/pdf-slicer/runs/quick-review', (req, res) => {
  const runId = String(req.body?.runId || '')
  if (!getRun(runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const approved = Array.isArray(req.body?.approvedResultIds) ? req.body.approvedResultIds.length : 0
  const approvedIds = new Set(Array.isArray(req.body?.approvedResultIds) ? req.body.approvedResultIds.map(String) : [])
  const reviewItems = getReviewItems(runId)
  const updateReview = db.prepare('UPDATE pdf_slicer_review_items SET review_status = ?, updated_at = ? WHERE result_id = ?')
  for (const item of reviewItems) {
    updateReview.run(approvedIds.has(item.resultId) ? 'ready_for_ocr' : 'pending_review', nowIso(), item.resultId)
  }
  db.prepare("UPDATE pdf_slicer_runs SET quick_review_status = 'submitted', approved_questions = ?, unreviewed_questions = MAX(total_questions - ?, 0), updated_at = ? WHERE run_id = ?")
    .run(approved, approved, nowIso(), runId)
  let ocrStarted = false
  let ocrStartError = ''
  const nextRun = getRun(runId)
  const autoStartOcr = req.body?.autoStartOcr !== false
  const canAutoStartOcr = autoStartOcr && approved > 0 && nextRun && !activeOcrProcesses.has(runId) && ['idle', 'failed'].includes(nextRun.ocrStatus)
  if (canAutoStartOcr) {
    const startedAt = nowIso()
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
      .run(startedAt, startedAt, runId)
    try {
      startMigratedOcrBackground(runId)
      ocrStarted = true
    } catch (error) {
      ocrStartError = error instanceof Error ? error.message : String(error)
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
        .run(`复核已提交，但自动 OCR 启动失败：${ocrStartError}`, nowIso(), nowIso(), runId)
    }
  }
  res.json({ ...getRun(runId), ocrStarted, ocrStartError })
})

app.post('/api/tools/pdf-slicer/runs/:runId/open-folder', (req, res) => {
  const run = getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const pdfPath = resolveStoragePath(run.pdfPath)
  if (!fs.existsSync(pdfPath)) {
    res.status(404).json({ error: 'PDF 文件不存在，无法打开所在文件夹。' })
    return
  }
  const folderPath = path.dirname(pdfPath)
  try {
    if (process.platform === 'darwin') {
      execFileSync('open', [folderPath], { stdio: 'ignore' })
    } else if (process.platform === 'win32') {
      execFileSync('explorer', [folderPath], { stdio: 'ignore' })
    } else {
      execFileSync('xdg-open', [folderPath], { stdio: 'ignore' })
    }
    res.json({ opened: true, folderPath: assetPathFor(folderPath) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `打开文件夹失败：${message}` })
  }
})

app.post('/api/tools/pdf-slicer/runs/bulk-ocr', (req, res) => {
  const runIds = Array.isArray(req.body?.runIds) ? req.body.runIds.map(String) : []
  const update = db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'queued', ocr_error = '', updated_at = ? WHERE run_id = ?")
  const found: string[] = []
  const started: string[] = []
  const failed: Array<{ runId: string; error: string }> = []
  for (const runId of runIds) {
    if (getRun(runId)) {
      update.run(nowIso(), runId)
      found.push(runId)
      const now = nowIso()
      db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
        .run(now, now, runId)
      try {
        startMigratedOcrBackground(runId)
        started.push(runId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
          .run(message, nowIso(), nowIso(), runId)
        failed.push({ runId, error: message })
      }
    }
  }
  res.json({ enqueuedRunIds: found, startedRunIds: started, failed })
})

app.get('/api/tools/pdf-slicer/ocr-jobs', (_, res) => {
  const jobs = (db.prepare("SELECT * FROM pdf_slicer_runs WHERE ocr_status != 'idle' ORDER BY updated_at DESC").all() as RunRow[])
    .map(mapRun)
  res.json({
    summary: {
      totalJobs: jobs.length,
      queuedCount: jobs.filter((run) => run.ocrStatus === 'queued').length,
      runningCount: jobs.filter((run) => run.ocrStatus === 'running').length,
      succeededCount: jobs.filter((run) => run.ocrStatus === 'succeeded').length,
      failedCount: jobs.filter((run) => run.ocrStatus === 'failed').length,
    },
    currentRun: jobs.find((run) => run.ocrStatus === 'running') ?? null,
    queuedRuns: jobs.filter((run) => run.ocrStatus === 'queued'),
    historyRuns: jobs.filter((run) => run.ocrStatus === 'succeeded' || run.ocrStatus === 'failed'),
  })
})

app.get('/api/tools/pdf-slicer/runs/:runId/ocr-progress', (req, res) => {
  const progress = getOcrProgress(req.params.runId)
  progress ? res.json(progress) : res.status(404).json({ error: '批次不存在。' })
})

app.get('/api/tools/pdf-slicer/runs/:runId/questions', (req, res) => {
  const runId = req.params.runId
  const run = getRun(runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const rows = db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
  res.json({ run, items: rows.map(mapQuestion) })
})

app.post('/api/tools/pdf-slicer/runs/:runId/classify', (req, res) => {
  const runId = req.params.runId
  if (!getRun(runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  try {
    const report = runQuestionClassification(runId)
    db.prepare('UPDATE pdf_slicer_runs SET updated_at = ? WHERE run_id = ?').run(nowIso(), runId)
    const rows = db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
    res.json({ run: getRun(runId), items: rows.map(mapQuestion), report })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: message, run: getRun(runId) })
  }
})

// ── Pending Bank Confirmation Page APIs ──────────────────────────────

app.get('/api/tools/pdf-slicer/runs/:runId/pending-bank', (req, res) => {
  const runId = req.params.runId
  const run = getRun(runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const filter = String(req.query.filter || 'all')
  const allRows = db.prepare('SELECT * FROM question_bank_items WHERE source_run_id = ? ORDER BY serial_no ASC').all(runId) as QuestionRow[]
  const importedIds = new Set(allRows.map((row) => row.id))
  const sourceTitle = cleanSourceTitle(run.paperTitle || run.pdfName || '', run.pdfName || 'OCR 导入')
  const allItems = [
    ...allRows.map((row) => attachSimilarQuestions(mapQuestion(row), row)),
    ...pendingBankOcrFailureItems(runId, importedIds, sourceTitle),
  ]

  const summary = { total: allItems.length, ready: 0, blocked: 0, banked: 0, skipped: 0, ocrFailed: 0, hasFigures: 0 }
  const isOcrFailed = (item: ReturnType<typeof mapQuestion>) => !item.stemMarkdown || item.stemMarkdown.trim() === ''
  const needsReview = (item: ReturnType<typeof mapQuestion>) => {
    if (item.bankStatus === 'banked' || item.bankStatus === 'skipped') return false
    return isOcrFailed(item) || item.bankStatus === 'blocked'
  }
  const isReady = (item: ReturnType<typeof mapQuestion>) => item.bankStatus === 'ready' && !isOcrFailed(item)

  for (const item of allItems) {
    if (isOcrFailed(item)) {
      summary.ocrFailed += 1
    }
    if (item.hasFigures) summary.hasFigures += 1
    if (isReady(item)) summary.ready += 1
    else if (needsReview(item)) summary.blocked += 1
    else if (item.bankStatus === 'banked') summary.banked += 1
    else if (item.bankStatus === 'skipped') summary.skipped += 1
  }

  let filtered = allItems
  if (filter === 'ready') filtered = allItems.filter(isReady)
  else if (filter === 'blocked') filtered = allItems.filter(needsReview)
  else if (filter === 'banked') filtered = allItems.filter((item) => item.bankStatus === 'banked')
  else if (filter === 'skipped') filtered = allItems.filter((item) => item.bankStatus === 'skipped')
  else if (filter === 'ocr_failed') filtered = allItems.filter(isOcrFailed)
  else if (filter === 'has_figures') filtered = allItems.filter((item) => item.hasFigures)

  const statusOrder: Record<string, number> = { blocked: 0, ready: 1, banked: 2, skipped: 3 }
  filtered.sort((a, b) => {
    const aOrder = needsReview(a) ? 0 : (statusOrder[a.bankStatus] ?? 1)
    const bOrder = needsReview(b) ? 0 : (statusOrder[b.bankStatus] ?? 1)
    if (aOrder !== bOrder) return aOrder - bOrder
    return (a.serialNo || 0) - (b.serialNo || 0)
  })

  res.json({ run, summary, items: filtered })
})

app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/manual-candidate', (req, res) => {
  const runId = req.params.runId
  const run = getRun(runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const body = req.body?.item || {}
  const id = String(body.id || '').trim()
  if (!id) {
    res.status(400).json({ error: '缺少题目 ID。' })
    return
  }
  if (getQuestion(id)) {
    res.json(getQuestion(id))
    return
  }
  const reviewItem = getReviewItems(runId).find((entry) => entry.resultId === id)
  if (!reviewItem) {
    res.status(404).json({ error: '当前题目缺少原始切题记录。' })
    return
  }
  const sourceTitle = cleanSourceTitle(run.paperTitle || run.pdfName || '', run.pdfName || 'OCR 导入')
  const stemMarkdown = String((body.stemMarkdown ?? blocksToMarkdown(body.problemBlocks ?? [])) || '').trim()
  const answerText = String((body.answerText ?? blocksToMarkdown(body.answerBlocks ?? [])) || '').trim()
  const analysisMarkdown = String((body.analysisMarkdown ?? blocksToMarkdown(body.analysisBlocks ?? [])) || '').trim()
  try {
    const item = createQuestion({
      id,
      serialNo: Number.parseInt(String(body.serialNo || ''), 10) || undefined,
      questionNo: cleanQuestionNoLabel(String(body.questionNo || reviewItem.questionLabel || '')),
      stage: String(body.stage || '高三'),
      questionType: body.questionType && body.questionType !== 'OCR题' ? String(body.questionType) : inferQuestionType(stemMarkdown, answerText),
      difficultyScore: Number(body.difficultyScore ?? 3),
      difficultyScore10: normalizeDifficultyScore10(body.difficultyScore10),
      difficultyLabel: body.difficultyLabel || difficultyLabel10(normalizeDifficultyScore10(body.difficultyScore10)),
      chapter: body.chapter || '待整理',
      knowledgePoints: normalizeTags(body.knowledgePoints),
      solutionMethods: normalizeTags(body.solutionMethods),
      sourceTitle,
      bankStatus: 'ready',
      stemMarkdown,
      answerText,
      analysisMarkdown,
      sliceImagePath: stripAssetPrefix(String(body.sliceImagePath || reviewItem.autoImagePath || reviewItem.pageImagePath || '')),
      figures: Array.isArray(body.figures) ? body.figures : reviewItem.figures,
      sourceRunId: runId,
      sourceSolutionRunId: '',
      mergeStatus: '',
      mergeNote: '',
      needsFormatReview: false,
    })
    if (!item) throw new Error('题目创建失败。')
    syncQuestionBankItemToOcrDraft(getQuestion(id))
    res.status(201).json(getQuestion(id))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `手动候选保存失败：${message}` })
  }
})

app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/:id/rerun-ocr', (req, res) => {
  const runId = req.params.runId
  const sourceRun = getRun(runId)
  if (sourceRun?.ocrProvider === 'doc2x' || normalizeOcrProvider(readOcrSettings().ocrProvider) === 'doc2x') {
    res.status(400).json({ error: 'Doc2X 首版仅支持整批完全重跑，暂不支持单题重新 OCR。' })
    return
  }
  const id = decodeURIComponent(String(req.params.id || ''))
  const route = String(req.body?.route || 'whole_question_json')
  const forceRegionOcr = route === 'region_chunks'
  try {
    const task = createPendingBankRerunTask(runId, id, { forceRegionOcr })
    const now = nowIso()
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
      .run(now, now, task.runId)
    startMigratedOcrBackground(task.runId)
    res.json({
      ...task,
      route: forceRegionOcr ? 'region_chunks' : 'whole_question_json',
      message: forceRegionOcr ? '已启动当前题分块 OCR。' : '已启动当前题整图 OCR。',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `待入库单题重新 OCR 启动失败：${message}` })
  }
})

app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-confirm', (req, res) => {
  const runId = req.params.runId
  if (!getRun(runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const confirmAll = Boolean(req.body?.all)
  const questionIds: string[] = confirmAll
    ? (db.prepare("SELECT id FROM question_bank_items WHERE source_run_id = ? AND bank_status NOT IN ('banked', 'skipped') ORDER BY serial_no ASC").all(runId) as Array<{ id: string }>).map((row) => row.id)
    : req.body?.questionIds || []
  if (!questionIds.length) {
    res.json({ success: 0, failed: 0 })
    return
  }
  const now = nowIso()
  const warnings: string[] = []
  let success = 0
  let failed = 0
  for (const id of questionIds) {
    const row = db.prepare('SELECT * FROM question_bank_items WHERE id = ? AND source_run_id = ?').get(id, runId) as QuestionRow | undefined
    if (!row) { failed += 1; continue }
    if (row.bank_status === 'blocked') {
      warnings.push(`题目 ${id} 仍存在识别风险。`)
    }
    const similar = similarQuestionCandidates(row, { limit: 2 })
    if (similar.length) {
      const label = row.question_no ? `第 ${row.question_no} 题` : id
      warnings.push(`${label} 可能与题库中 ${similar.map((item) => `${item.questionNo || item.id}（${Math.round(item.similarity * 100)}%）`).join('、')} 重复。`)
    }
    db.prepare(`
      UPDATE question_bank_items SET
        question_no = ?,
        bank_status = 'banked',
        format_review_required = 0,
        format_review_reasons_json = '{}',
        updated_at = ?
      WHERE id = ?
    `).run(
      cleanQuestionNoLabel(row.question_no),
      now,
      id
    )
    success += 1
  }
  res.json({ success, failed, warnings: warnings.length ? warnings : undefined })
})

app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-skip', (req, res) => {
  const runId = req.params.runId
  if (!getRun(runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const questionIds: string[] = req.body?.questionIds || []
  if (!questionIds.length) {
    res.status(400).json({ error: '请指定要跳过的题目。' })
    return
  }
  const now = nowIso()
  let success = 0
  let failed = 0
  for (const id of questionIds) {
    const exists = db.prepare('SELECT 1 FROM question_bank_items WHERE id = ? AND source_run_id = ?').get(id, runId)
    if (!exists) { failed += 1; continue }
    db.prepare("UPDATE question_bank_items SET bank_status = 'skipped', updated_at = ? WHERE id = ?").run(now, id)
    success += 1
  }
  res.json({ success, failed })
})

app.post('/api/tools/pdf-slicer/runs/:runId/pending-bank/bulk-delete', (req, res) => {
  const runId = req.params.runId
  if (!getRun(runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const questionIds: string[] = req.body?.questionIds || []
  if (!questionIds.length) {
    res.status(400).json({ error: '请指定要删除的题目。' })
    return
  }
  let success = 0
  let failed = 0
  try {
    db.exec('BEGIN')
    for (const id of questionIds) {
      const exists = db.prepare('SELECT 1 FROM question_bank_items WHERE id = ? AND source_run_id = ?').get(id, runId)
      if (!exists) { failed += 1; continue }
      db.prepare('DELETE FROM question_bank_collection_items WHERE question_id = ?').run(id)
      db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(id)
      db.prepare('DELETE FROM pdf_slicer_review_items WHERE run_id = ? AND result_id = ?').run(runId, id)
      fs.rmSync(path.join(dataDir, 'question_figures', id), { recursive: true, force: true })
      success += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `删除题目失败：${message}` })
    return
  }
  if (success > 0) syncReviewRunCounts(runId)
  res.json({ success, failed })
})

app.post('/api/tools/pdf-slicer/runs/:runId/force-rerun-ocr', (req, res) => {
  const child = activeOcrProcesses.get(req.params.runId)
  if (child) {
    child.kill('SIGTERM')
    activeOcrProcesses.delete(req.params.runId)
  }
  removeRunOcrOutputs(req.params.runId)
  const now = nowIso()
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = ?, ocr_finished_at = '', updated_at = ? WHERE run_id = ?")
    .run(now, now, req.params.runId)
  try {
    const totalQuestions = startMigratedOcrBackground(req.params.runId, { force: true })
    res.json({ run: getRun(req.params.runId), totalQuestions, progress: getOcrProgress(req.params.runId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
      .run(message, nowIso(), nowIso(), req.params.runId)
    res.status(500).json({ error: message, run: getRun(req.params.runId) })
  }
})

app.post('/api/tools/pdf-slicer/runs/:runId/resume-ocr', (req, res) => {
  if (!getRun(req.params.runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const now = nowIso()
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
    .run(now, now, req.params.runId)
  try {
    const totalQuestions = startMigratedOcrBackground(req.params.runId, { force: false })
    res.json({ run: getRun(req.params.runId), totalQuestions, progress: getOcrProgress(req.params.runId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
      .run(message, nowIso(), nowIso(), req.params.runId)
    res.status(500).json({ error: message, run: getRun(req.params.runId) })
  }
})

app.post('/api/tools/pdf-slicer/runs/:runId/start-ocr', (req, res) => {
  if (!getRun(req.params.runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const now = nowIso()
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
    .run(now, now, req.params.runId)
  try {
    const totalQuestions = startMigratedOcrBackground(req.params.runId)
    res.json({ run: getRun(req.params.runId), totalQuestions, progress: getOcrProgress(req.params.runId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = ?, ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
      .run(message, nowIso(), nowIso(), req.params.runId)
    res.status(500).json({ error: message, run: getRun(req.params.runId) })
  }
})

app.post('/api/tools/pdf-slicer/runs/:runId/complete-ocr', (req, res) => {
  const run = getRun(req.params.runId)
  if (!run) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const now = nowIso()
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'succeeded', ocr_error = '', ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
    .run(now, now, req.params.runId)
  const existing = (db.prepare('SELECT COUNT(*) AS count FROM question_bank_items WHERE source_run_id = ?').get(req.params.runId) as { count: number }).count
  for (let index = existing; index < run.approvedQuestions; index += 1) {
    createQuestion({
      questionNo: String(index + 1),
      stage: run.stage || configuredGradeStages()[0] || '高三',
      questionType: 'OCR题',
      difficultyScore: 3,
      chapter: '待整理',
      sourceTitle: run.paperTitle || run.pdfName,
      stemMarkdown: `【${run.pdfName}】第 ${index + 1} 题 OCR 结果待精修。`,
      answerText: '待补充',
      analysisMarkdown: '待补充解析。',
      sourceRunId: run.runId,
    })
  }
  res.json(getRun(req.params.runId))
})

app.post('/api/tools/pdf-slicer/runs/:runId/force-interrupt-ocr', (req, res) => {
  const child = activeOcrProcesses.get(req.params.runId)
  if (child) {
    child.kill('SIGTERM')
    activeOcrProcesses.delete(req.params.runId)
  }
  db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'failed', ocr_error = '用户强制中断', ocr_finished_at = ?, updated_at = ? WHERE run_id = ?")
    .run(nowIso(), nowIso(), req.params.runId)
  const row = db.prepare('SELECT * FROM pdf_slicer_runs WHERE run_id = ?').get(req.params.runId) as RunRow | undefined
  if (row && normalizeOcrProvider(row.ocr_provider) === 'doc2x') {
    const statePath = path.join(doc2xArtifactDir(row), 'state.json')
    const state = parseJson<Record<string, any>>(fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '{}', {})
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify({ ...state, phase: 'interrupted', updated_at: Date.now() / 1000 }, null, 2), 'utf8')
    db.prepare("UPDATE pdf_slicer_runs SET ocr_provider_phase = 'interrupted', updated_at = ? WHERE run_id = ?").run(nowIso(), req.params.runId)
  }
  tryAutoMergeSeparatedExamForRun(req.params.runId)
  res.json(getRun(req.params.runId))
})

app.delete('/api/tools/pdf-slicer/runs/:runId', (req, res) => {
  const row = db.prepare('SELECT batch_id FROM pdf_slicer_runs WHERE run_id = ?').get(req.params.runId) as Pick<RunRow, 'batch_id'> | undefined
  removeRunArtifacts(req.params.runId)
  db.prepare('DELETE FROM question_bank_items WHERE source_run_id = ?').run(req.params.runId)
  db.prepare('DELETE FROM pdf_slicer_runs WHERE run_id = ?').run(req.params.runId)
  if (row?.batch_id) updateBatchWorkflow(row.batch_id)
  res.json({ deleted: true })
})

app.get('/api/question-bank/items', (req, res) => {
  const q = String(req.query.q || '').trim()
  const stage = String(req.query.stage || '').trim()
  const questionType = String(req.query.questionType || '').trim()
  const knowledgePoint = String(req.query.knowledgePoint || '').trim()
  const solutionMethod = String(req.query.solutionMethod || '').trim()
  const difficulty = String(req.query.difficulty || '').trim()
  const requestedPage = Number.parseInt(String(req.query.page || '1'), 10)
  const requestedPageSize = Number.parseInt(String(req.query.pageSize || '20'), 10)
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 20))
  const whereSql = `
    WHERE (? = '' OR search_text LIKE ? OR source_title LIKE ? OR chapter LIKE ? OR knowledge_points_json LIKE ? OR solution_methods_json LIKE ?)
      AND (? = '' OR stage = ?)
      AND (? = '' OR question_type = ?)
      AND (? = '' OR knowledge_points_json LIKE ?)
      AND (? = '' OR solution_methods_json LIKE ?)
      AND (? = '' OR difficulty_label = ?)
  `
  const filterParams = [
    q,
    `%${q}%`,
    `%${q}%`,
    `%${q}%`,
    `%${q}%`,
    `%${q}%`,
    stage,
    stage,
    questionType,
    questionType,
    knowledgePoint,
    `%${knowledgePoint}%`,
    solutionMethod,
    `%${solutionMethod}%`,
    difficulty,
    difficulty,
  ]
  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM question_bank_items ${whereSql}`).get(...filterParams) as { count: number }
  const totalItems = totalRow.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1))
  const offset = (page - 1) * pageSize
  const rows = db.prepare(`
    SELECT * FROM question_bank_items
    ${whereSql}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...filterParams, pageSize, offset) as QuestionRow[]
  res.json({ items: rows.map(mapQuestion), totalItems, page, pageSize, totalPages, basket: getBasket() })
})

app.post('/api/question-bank/items/:id/rerun-ocr', (req, res) => {
  const id = decodeURIComponent(String(req.params.id || ''))
  const item = getQuestion(id)
  if (!item) {
    res.status(404).json({ error: '题目不存在。' })
    return
  }
  if (!item.sourceRunId) {
    res.status(400).json({ error: '当前题目没有原始 OCR 来源，无法重新 OCR。' })
    return
  }
  const sourceRun = getRun(item.sourceRunId)
  if (sourceRun?.ocrProvider === 'doc2x' || normalizeOcrProvider(readOcrSettings().ocrProvider) === 'doc2x') {
    res.status(400).json({ error: 'Doc2X 首版仅支持整批完全重跑，暂不支持单题重新 OCR。' })
    return
  }
  const route = String(req.body?.route || 'whole_question_json')
  const forceRegionOcr = route === 'region_chunks'
  try {
    const task = createQuestionBankRerunTask([id], { forceRegionOcr })
    const now = nowIso()
    db.prepare("UPDATE pdf_slicer_runs SET ocr_status = 'running', ocr_error = '', ocr_started_at = COALESCE(NULLIF(ocr_started_at, ''), ?), updated_at = ? WHERE run_id = ?")
      .run(now, now, task.runId)
    startMigratedOcrBackground(task.runId)
    res.json({
      ...task,
      route: forceRegionOcr ? 'region_chunks' : 'whole_question_json',
      message: forceRegionOcr ? '已启动当前题分块 OCR。' : '已启动当前题整图 OCR。',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `单题重新 OCR 启动失败：${message}` })
  }
})

app.post('/api/question-bank/items', (req, res) => {
  res.status(201).json(createQuestion(req.body || {}))
})

app.post('/api/question-bank/import-json', (req, res) => {
  const body = req.body || {}
  const questions = Array.isArray(body) ? body : Array.isArray(body.questions) ? body.questions : []
  if (!questions.length) {
    res.status(400).json({ error: '请提供 questions 数组。' })
    return
  }
  const sourceTitle = String(body.sourceTitle || body.paperTitle || 'AI 识别导入')
  const stage = String(body.stage || '高三')
  const created = questions.map((question: Record<string, unknown>, index: number) => {
    const review = Boolean(question.needs_human_review)
    const stemMarkdown = String(question.problem_text || question.stemMarkdown || '')
    const answerText = String(question.answer || question.answerText || '')
    const analysisMarkdown = String(question.analysis || question.analysisMarkdown || '')
    const knowledgePoints = normalizeTags(question.knowledge_points ?? question.knowledgePoints)
    const solutionMethods = normalizeTags(question.solution_methods ?? question.solutionMethods)
    const difficultyScore10 = normalizeDifficultyScore10(question.difficulty_score_10 ?? question.difficultyScore10)
    return createQuestion({
      questionNo: String(question.question_no || question.questionNo || index + 1),
      stage,
      questionType: String(question.question_type || question.questionType || '') || inferQuestionType(stemMarkdown, answerText),
      sourceTitle,
      bankStatus: review ? 'blocked' : 'ready',
      difficultyScore: review ? 4 : 3,
      difficultyScore10,
      difficultyLabel: String(question.difficulty_label || question.difficultyLabel || difficultyLabel10(difficultyScore10)),
      knowledgePoints,
      solutionMethods,
      stemMarkdown,
      answerText,
      analysisMarkdown,
    })
  })
  res.status(201).json({ items: created, count: created.length })
})

app.post('/api/question-bank/import-json-from-slices', (req, res) => {
  const body = req.body || {}
  const questions = Array.isArray(body) ? body : Array.isArray(body.questions) ? body.questions : []
  const runId = String(body.runId || '')
  if (!runId) {
    res.status(400).json({ error: '请选择已切分的 PDF 批次。' })
    return
  }
  if (!questions.length) {
    res.status(400).json({ error: '请提供 questions 数组。' })
    return
  }
  try {
    const result = importJsonQuestionsFromSliceRun(runId, questions as Array<Record<string, unknown>>, {
      sourceTitle: String(body.sourceTitle || body.paperTitle || ''),
      stage: String(body.stage || '高三'),
      createCollection: body.createCollection !== false,
    })
    res.status(201).json(result)
  } catch (error) {
    const typed = error as Error & { status?: number; details?: unknown }
    res.status(typed.status || 500).json({ error: typed.message, details: typed.details })
  }
})

app.get('/api/question-bank/items/:id', (req, res) => {
  const item = getQuestion(decodeURIComponent(req.params.id))
  item ? res.json(item) : res.status(404).json({ error: '题目不存在。' })
})

app.patch('/api/question-bank/items/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const before = getQuestion(id)
  if (!before) {
    res.status(404).json({ error: '题目不存在。' })
    return
  }
  const body = req.body?.item || req.body || {}
  const nextQuestionNo = body.questionNo == null ? null : cleanQuestionNoLabel(body.questionNo)
  const fieldFromPatch = (markdownValue: unknown, blocksValue: unknown, previous: string) => {
    if (markdownValue != null && String(markdownValue) !== previous) return String(markdownValue)
    if (blocksValue != null) return blocksToMarkdown(blocksValue)
    if (markdownValue != null) return String(markdownValue)
    return previous
  }
  const stemMarkdown = fieldFromPatch(body.stemMarkdown, body.problemBlocks, before.stemMarkdown)
  const answerText = fieldFromPatch(body.answerText, body.answerBlocks, before.answerText)
  const analysisMarkdown = fieldFromPatch(body.analysisMarkdown, body.analysisBlocks, before.analysisMarkdown)
  const knowledgePoints = body.knowledgePoints ? normalizeTags(body.knowledgePoints) : before.knowledgePoints
  const solutionMethods = body.solutionMethods ? normalizeTags(body.solutionMethods) : before.solutionMethods
  const sourceTitle = body.sourceTitle ?? before.sourceTitle
  const chapter = body.chapter ?? before.chapter
  db.prepare(`
    UPDATE question_bank_items SET
      question_no = COALESCE(?, question_no),
      stage = COALESCE(?, stage),
      question_type = COALESCE(?, question_type),
      difficulty_score = COALESCE(?, difficulty_score),
      difficulty_score_10 = COALESCE(?, difficulty_score_10),
      difficulty_label = COALESCE(?, difficulty_label),
      chapter = COALESCE(?, chapter),
      knowledge_points_json = COALESCE(?, knowledge_points_json),
      solution_methods_json = COALESCE(?, solution_methods_json),
      source_title = COALESCE(?, source_title),
      bank_status = COALESCE(?, bank_status),
      stem_markdown = ?,
      answer_text = ?,
      analysis_markdown = ?,
      search_text = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    nextQuestionNo,
    body.stage ?? null,
    body.questionType ?? null,
    body.difficultyScore ?? null,
    body.difficultyScore10 ?? null,
    body.difficultyLabel ?? (body.difficultyScore10 ? difficultyLabel10(normalizeDifficultyScore10(body.difficultyScore10)) : null),
    body.chapter ?? null,
    body.knowledgePoints ? JSON.stringify(knowledgePoints) : null,
    body.solutionMethods ? JSON.stringify(solutionMethods) : null,
    body.sourceTitle ?? null,
    body.bankStatus ?? null,
    stemMarkdown,
    answerText,
    analysisMarkdown,
    buildSearchText(stemMarkdown, answerText, analysisMarkdown, [String(sourceTitle), String(chapter), knowledgePoints.join(' '), solutionMethods.join(' ')]),
    nowIso(),
    id
  )
  syncQuestionBankItemToOcrDraft(getQuestion(id))
  res.json(getQuestion(id))
})

app.delete('/api/question-bank/items/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  if (!getQuestion(id)) {
    res.status(404).json({ error: '题目不存在。' })
    return
  }
  db.prepare('DELETE FROM question_bank_collection_items WHERE question_id = ?').run(id)
  db.prepare('DELETE FROM question_bank_items WHERE id = ?').run(id)
  fs.rmSync(path.join(dataDir, 'question_figures', id), { recursive: true, force: true })
  res.json({ deleted: true })
})

app.post('/api/question-bank/items/:id/figures', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const item = getQuestion(id)
  if (!item) {
    res.status(404).json({ error: '题目不存在。' })
    return
  }
  const bbox = req.body?.bbox || { x: 168, y: 142, width: 412, height: 176 }
  const figureId = createId('fig')
  const sourcePath = stripAssetPrefix(String(item.sliceImagePath || ''))
  const outputRel = path.join('data', 'question_figures', id, `${figureId}.png`)
  if (sourcePath) {
    const inputPath = resolveStoragePath(sourcePath)
    const outputPath = resolveStoragePath(outputRel)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    const cropScript = [
      'from PIL import Image',
      'import json, sys',
      'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
      'x = int(round(float(raw.get("x", raw.get("x0", 0)))))',
      'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
      'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))',
      'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
      'im = Image.open(src)',
      'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
      'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))',
      'im.crop((x, y, x + w, y + h)).save(dst)',
    ].join('; ')
    execFileSync(pythonCommand(), ['-c', cropScript, inputPath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
  }
  const figure = {
    id: figureId,
    origin: 'manual_crop',
    usage: req.body?.usage || 'stem',
    category: req.body?.category || 'question_figure',
    optionLabel: req.body?.optionLabel ? String(req.body.optionLabel).toUpperCase() : '',
    pageNumber: Number(req.body?.pageNumber || 1),
    bbox,
    sourcePath,
    path: outputRel,
  }
  const figures = [...item.figures, figure]
  db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(figures), nowIso(), id)
  res.status(201).json(figure)
})

app.patch('/api/question-bank/items/:id/figures/:figureId', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const figureId = decodeURIComponent(req.params.figureId)
  const item = getQuestion(id)
  if (!item) {
    res.status(404).json({ error: '题目不存在。' })
    return
  }
  const figures = item.figures as Array<Record<string, any>>
  const index = figures.findIndex((figure) => String(figure.id || '') === figureId)
  if (index < 0) {
    res.status(404).json({ error: '题图不存在。' })
    return
  }
  const current = figures[index]
  const bbox = req.body?.bbox || current.bbox || {}
  const sourcePath = stripAssetPrefix(String(current.sourcePath || item.sliceImagePath || ''))
  let outputRel = stripAssetPrefix(String(current.path || ''))
  if (!outputRel) outputRel = path.join('data', 'question_figures', id, `${figureId}.png`)
  if (sourcePath && Object.keys(bbox).length) {
    const inputPath = resolveStoragePath(sourcePath)
    const outputPath = resolveStoragePath(outputRel)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    const cropScript = [
      'from PIL import Image',
      'import json, sys',
      'src, dst, raw = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
      'x = int(round(float(raw.get("x", raw.get("x0", 0)))))',
      'y = int(round(float(raw.get("y", raw.get("y0", 0)))))',
      'w = int(round(float(raw.get("width", raw.get("w", raw.get("x1", 0) - raw.get("x0", 0))))))',
      'h = int(round(float(raw.get("height", raw.get("h", raw.get("y1", 0) - raw.get("y0", 0))))))',
      'im = Image.open(src)',
      'x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))',
      'w = max(1, min(w, im.width - x)); h = max(1, min(h, im.height - y))',
      'im.crop((x, y, x + w, y + h)).save(dst)',
    ].join('; ')
    execFileSync(pythonCommand(), ['-c', cropScript, inputPath, outputPath, JSON.stringify(bbox)], { encoding: 'utf8' })
  }
  const usage = req.body?.usage ? String(req.body.usage) : String(current.usage || 'stem')
  const nextFigure = {
    ...current,
    usage,
    category: req.body?.category || current.category || 'question_figure',
    optionLabel: usage === 'options' && req.body?.optionLabel ? String(req.body.optionLabel).toUpperCase() : '',
    pageNumber: Number(req.body?.pageNumber || current.pageNumber || 1),
    bbox,
    sourcePath,
    path: outputRel,
  }
  const nextFigures = figures.map((figure, figureIndex) => figureIndex === index ? nextFigure : figure)
  db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(nextFigures), nowIso(), id)
  res.json(nextFigure)
})

app.post('/api/question-bank/items/:id/figures/upload', upload.single('file'), (req, res) => {
  const id = decodeURIComponent(String(req.params.id || ''))
  const item = getQuestion(id)
  if (!item) {
    res.status(404).json({ error: '题目不存在。' })
    return
  }
  const file = req.file
  if (!file) {
    res.status(400).json({ error: '请上传一个图片文件。' })
    return
  }
  if (!String(file.mimetype || '').startsWith('image/')) {
    res.status(400).json({ error: '只能上传图片文件。' })
    return
  }
  const usage = String(req.body?.usage || 'stem')
  if (!['stem', 'analysis', 'options'].includes(usage)) {
    res.status(400).json({ error: '图片类型无效。' })
    return
  }
  const figureId = createId('fig')
  const extension = imageExtension(file.originalname, file.mimetype)
  const outputRel = path.join('data', 'question_figures', id, `${figureId}${extension}`)
  const outputPath = resolveStoragePath(outputRel)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, file.buffer)
  const figure = {
    id: figureId,
    origin: 'manual_upload',
    usage,
    category: 'question_figure',
    optionLabel: usage === 'options' && req.body?.optionLabel ? String(req.body.optionLabel).toUpperCase() : '',
    pageNumber: 1,
    bbox: {},
    sourcePath: '',
    path: outputRel,
    originalName: file.originalname,
  }
  const figures = [...item.figures, figure]
  db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(figures), nowIso(), id)
  res.status(201).json(figure)
})

app.delete('/api/question-bank/items/:id/figures/:figureId', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const figureId = decodeURIComponent(req.params.figureId)
  const item = getQuestion(id)
  if (!item) {
    res.status(404).json({ error: '题目不存在。' })
    return
  }
  const figures = item.figures as Array<Record<string, any>>
  const target = figures.find((figure) => String(figure.id || '') === figureId)
  if (!target) {
    res.status(404).json({ error: '题图不存在。' })
    return
  }
  const targetPath = stripAssetPrefix(String(target.path || ''))
  if (targetPath && targetPath.startsWith(path.join('data', 'question_figures', id))) {
    fs.rmSync(resolveStoragePath(targetPath), { force: true })
  }
  const nextFigures = figures.filter((figure) => String(figure.id || '') !== figureId)
  db.prepare('UPDATE question_bank_items SET figures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(nextFigures), nowIso(), id)
  res.json({ deleted: true, item: getQuestion(id) })
})

app.get('/api/question-bank/collections', (_, res) => {
  const rows = db.prepare(`
    SELECT c.*, COUNT(ci.id) AS question_count
    FROM question_bank_collections c
    LEFT JOIN question_bank_collection_items ci ON ci.collection_id = c.id
    GROUP BY c.id
    ORDER BY CASE WHEN c.id = 'basket' THEN 0 ELSE 1 END, c.updated_at DESC
  `).all() as Array<CollectionRow & { question_count: number }>
  res.json({ items: rows.map((row) => mapCollectionSummary(row, Number(row.question_count || 0))) })
})

app.get('/api/question-bank/export-records', (req, res) => {
  const sourceType = normalizeExportRecordSourceType(req.query.sourceType)
  const collectionId = String(req.query.collectionId || '').trim()
  const runId = String(req.query.runId || '').trim()
  const query = String(req.query.q || req.query.query || '').trim()
  const limit = Math.floor(normalizeNumber(req.query.limit, 100))
  res.json({
    items: listExportRecords({
      sourceType,
      collectionId,
      runId,
      query,
      limit,
    }),
  })
})

app.delete('/api/question-bank/export-records/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const existing = db.prepare('SELECT id FROM question_bank_export_records WHERE id = ?').get(id)
  if (!existing) {
    res.status(404).json({ error: '导出记录不存在。' })
    return
  }
  db.prepare('DELETE FROM question_bank_export_records WHERE id = ?').run(id)
  res.json({ deleted: true })
})

app.post('/api/question-bank/export-records/:id/restore-to-basket', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const targetCollectionId = String(req.body?.collectionId || 'basket').trim() || 'basket'
  try {
    res.json(restoreExportRecordToCollection(id, targetCollectionId, { syncTitle: Boolean(req.body?.syncTitle) }))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/question-bank/collections', (req, res) => {
  const now = nowIso()
  const title = String(req.body?.title || '未命名试卷').trim() || '未命名试卷'
  const id = req.body?.id ? safeName(String(req.body.id)) : createId('paper', title)
  if (collectionExists(id)) {
    res.status(409).json({ error: '同名试题篮已经存在。' })
    return
  }
  db.prepare(`
    INSERT INTO question_bank_collections
      (id, title, subtitle, description, kind, status, total_score, time_limit, export_format, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    String(req.body?.subtitle || ''),
    String(req.body?.description || ''),
    normalizeCollectionKind(req.body?.kind),
    normalizeCollectionStatus(req.body?.status),
    normalizeNumber(req.body?.totalScore),
    Math.max(0, Math.floor(normalizeNumber(req.body?.timeLimit))),
    normalizeExportFormat(req.body?.exportFormat),
    now,
    now
  )
  res.status(201).json(getCollection(id))
})

app.get('/api/question-bank/collections/:id/export-records', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  if (!collectionExists(id)) {
    res.status(404).json({ error: '试题篮不存在。' })
    return
  }
  const limit = Math.floor(normalizeNumber(req.query.limit, 100))
  res.json({ items: listExportRecords({ sourceType: 'collection', collectionId: id, limit }) })
})

app.get('/api/question-bank/collections/:id', (req, res) => {
  const collection = getCollection(decodeURIComponent(req.params.id))
  collection ? res.json(collection) : res.status(404).json({ error: '试题篮不存在。' })
})

app.patch('/api/question-bank/collections/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  if (!collectionExists(id)) {
    res.status(404).json({ error: '试题篮不存在。' })
    return
  }
  const body = req.body || {}
  const now = nowIso()
  db.prepare(`
    UPDATE question_bank_collections SET
      title = COALESCE(?, title),
      subtitle = COALESCE(?, subtitle),
      description = COALESCE(?, description),
      kind = COALESCE(?, kind),
      status = COALESCE(?, status),
      time_limit = COALESCE(?, time_limit),
      export_format = COALESCE(?, export_format),
      updated_at = ?
    WHERE id = ?
  `).run(
    body.title == null ? null : String(body.title || '').trim() || '未命名试卷',
    body.subtitle == null ? null : String(body.subtitle || ''),
    body.description == null ? null : String(body.description || ''),
    body.kind == null ? null : normalizeCollectionKind(body.kind),
    body.status == null ? null : normalizeCollectionStatus(body.status),
    body.timeLimit == null ? null : Math.max(0, Math.floor(normalizeNumber(body.timeLimit))),
    body.exportFormat == null ? null : normalizeExportFormat(body.exportFormat),
    now,
    id
  )
  if (Array.isArray(body.addQuestionIds)) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO question_bank_collection_items
        (id, collection_id, question_id, sort_order, score, section_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const questionId of body.addQuestionIds.map(String)) {
      const q = getQuestion(questionId)
      if (!q) continue
      let finalScore = normalizeNumber(body.score)
      if (!finalScore) {
        if (q.questionType === '单选题') finalScore = 5
        else if (q.questionType === '填空题') finalScore = 5
        else if (q.questionType === '多选题') finalScore = 6
        else if (q.questionType === '解答题') finalScore = 15
        else finalScore = 5
      }
      insert.run(createId('rel'), id, questionId, Date.now(), finalScore, String(body.sectionName || ''), nowIso())
    }
    refreshCollectionScore(id)
  }
  if (body.removeQuestionId) {
    db.prepare('DELETE FROM question_bank_collection_items WHERE collection_id = ? AND question_id = ?').run(id, String(body.removeQuestionId))
    refreshCollectionScore(id)
  }
  res.json(getCollection(id))
})

app.delete('/api/question-bank/collections/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  if (id === 'basket') {
    res.status(400).json({ error: '默认试题篮不能删除。' })
    return
  }
  if (!collectionExists(id)) {
    res.status(404).json({ error: '试题篮不存在。' })
    return
  }
  db.prepare('DELETE FROM question_bank_collections WHERE id = ?').run(id)
  res.json({ deleted: true })
})

app.post('/api/question-bank/collections/:id/items', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const questionId = String(req.body?.questionId || '')
  if (!collectionExists(id)) {
    res.status(404).json({ error: '试题篮不存在。' })
    return
  }
  const q = getQuestion(questionId)
  if (!q) {
    res.status(404).json({ error: '题目不存在。' })
    return
  }
  let finalScore = normalizeNumber(req.body?.score)
  if (!finalScore) {
    if (q.questionType === '单选题') finalScore = 5
    else if (q.questionType === '填空题') finalScore = 5
    else if (q.questionType === '多选题') finalScore = 6
    else if (q.questionType === '解答题') finalScore = 15
    else finalScore = 5
  }
  const now = nowIso()
  const relationId = createId('rel')
  db.prepare(`
    INSERT OR IGNORE INTO question_bank_collection_items
      (id, collection_id, question_id, sort_order, score, section_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    relationId,
    id,
    questionId,
    Math.floor(normalizeNumber(req.body?.sortOrder, Date.now())),
    finalScore,
    String(req.body?.sectionName || ''),
    now
  )
  refreshCollectionScore(id)
  res.status(201).json(getCollection(id))
})

app.patch('/api/question-bank/collections/:id/items/:relationId', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const relationId = decodeURIComponent(req.params.relationId)
  if (!collectionExists(id)) {
    res.status(404).json({ error: '试题篮不存在。' })
    return
  }
  const existing = db.prepare('SELECT id FROM question_bank_collection_items WHERE id = ? AND collection_id = ?').get(relationId, id)
  if (!existing) {
    res.status(404).json({ error: '试题篮题目不存在。' })
    return
  }
  db.prepare(`
    UPDATE question_bank_collection_items SET
      sort_order = COALESCE(?, sort_order),
      score = COALESCE(?, score),
      section_name = COALESCE(?, section_name)
    WHERE id = ? AND collection_id = ?
  `).run(
    req.body?.sortOrder == null ? null : Math.floor(normalizeNumber(req.body.sortOrder)),
    req.body?.score == null ? null : normalizeNumber(req.body.score),
    req.body?.sectionName == null ? null : String(req.body.sectionName || ''),
    relationId,
    id
  )
  refreshCollectionScore(id)
  res.json(getCollection(id))
})

app.delete('/api/question-bank/collections/:id/items/:relationId', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const relationId = decodeURIComponent(req.params.relationId)
  db.prepare('DELETE FROM question_bank_collection_items WHERE id = ? AND collection_id = ?').run(relationId, id)
  refreshCollectionScore(id)
  res.json(getCollection(id))
})

app.delete('/api/question-bank/collections/:id/items', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  if (!collectionExists(id)) {
    res.status(404).json({ error: '试题篮不存在。' })
    return
  }
  db.prepare('DELETE FROM question_bank_collection_items WHERE collection_id = ?').run(id)
  refreshCollectionScore(id)
  res.json(getCollection(id))
})

app.patch('/api/question-bank/collections/:id/reorder', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  if (!collectionExists(id)) {
    res.status(404).json({ error: '试题篮不存在。' })
    return
  }
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const update = db.prepare('UPDATE question_bank_collection_items SET sort_order = ? WHERE id = ? AND collection_id = ?')
  items.forEach((item: any, index: number) => {
    const relationId = String(item?.relationId || item?.id || '')
    if (!relationId) return
    update.run(item?.sortOrder == null ? index : Math.floor(normalizeNumber(item.sortOrder, index)), relationId, id)
  })
  db.prepare('UPDATE question_bank_collections SET updated_at = ? WHERE id = ?').run(nowIso(), id)
  res.json(getCollection(id))
})

app.post('/api/question-bank/collections/:id/export', (req, res) => {
  const id = decodeURIComponent(req.params.id)
  const collection = getCollection(id)
  if (!collection) {
    res.status(404).json({ error: '试题篮不存在。' })
    return
  }
  const variant = normalizeExportVariant(req.body?.variant)
  if (req.body?.format === 'pdf') {
    try {
      const template = req.body?.template === 'exam' ? 'exam' : 'worksheet'
      const pdfPath = exportCollectionWorksheetPdf(collection, variant, template === 'exam' ? 'qbank-exam' : 'qbank-worksheet')
      const relativePath = assetPathFor(pdfPath)
      const record = createExportRecord({
        sourceType: 'collection',
        collectionId: collection.id,
        title: collection.title,
        format: 'pdf',
        variant: `${template}-${variant}`,
        filename: path.basename(pdfPath),
        path: relativePath,
        url: `/assets/${relativePath}`,
        items: collectionExportItems(collection),
        contentLength: exportRecordFileSize(relativePath),
        questionCount: collection.questionCount,
      })
      res.json({
        filename: path.basename(pdfPath),
        format: 'pdf',
        url: `/assets/${relativePath}`,
        path: relativePath,
        exportRecord: mapExportRecord(record),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: `练习单 PDF 导出失败：${message}` })
    }
    return
  }
  const format = normalizeExportFormat(req.body?.format || collection.exportFormat)
  const content = format === 'latex' ? buildCollectionLatex(collection, variant) : buildCollectionMarkdown(collection, variant)
  const extension = format === 'latex' ? 'tex' : 'md'
  const filename = `${safeName(collection.title || '试题篮')}-${variant}.${extension}`
  const record = createExportRecord({
    sourceType: 'collection',
    collectionId: collection.id,
    title: collection.title,
    format,
    variant,
    filename,
    items: collectionExportItems(collection),
    contentLength: Buffer.byteLength(content, 'utf8'),
    questionCount: collection.questionCount,
  })
  res.json({
    filename,
    format,
    content,
    exportRecord: mapExportRecord(record),
  })
})

app.get('/api/tools/pdf-slicer/runs/:runId/export-records', (req, res) => {
  const runId = req.params.runId
  if (!getRun(runId)) {
    res.status(404).json({ error: '批次不存在。' })
    return
  }
  const limit = Math.floor(normalizeNumber(req.query.limit, 100))
  res.json({ items: listExportRecords({ sourceType: 'run', runId, limit }) })
})

app.post('/api/tools/pdf-slicer/runs/:runId/export-batch', (req, res) => {
  const runId = req.params.runId
  const format = req.body?.format === 'pdf' ? 'pdf' : 'latex'
  const title = String(req.body?.title || '').trim()
  const template = req.body?.template === 'worksheet' ? 'worksheet' : 'exam'
  const variant = normalizeExportVariant(req.body?.variant)
  const watermarkText = String(req.body?.watermarkText || '').trim()
  const scoreConfig = normalizeExamZhScoreConfig(req.body?.scoreConfig)
  try {
    const run = getRun(runId)
    if (!run) throw new Error('批次不存在。')
    const result = run.materialType === 'lecture' || template === 'worksheet'
      ? exportRunWorksheetPdf(runId, { title, variant })
      : exportRunExamPdf(runId, { title, variant })
    const rel = assetPathFor(result.path)
    const record = createExportRecord({
      sourceType: 'run',
      runId,
      title: title || run.paperTitle || run.pdfName,
      format: result.format,
      variant: `${template}-${variant}`,
      filename: path.basename(result.path),
      path: rel,
      url: `/assets/${rel}`,
      items: runExportItems(runId),
      contentLength: exportRecordFileSize(rel),
      questionCount: Number(run.approvedQuestions || run.totalQuestions || 0),
    })
    res.json({
      filename: path.basename(result.path),
      format: result.format,
      url: `/assets/${rel}`,
      path: rel,
      exportRecord: mapExportRecord(record),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: `批次导出失败：${message}` })
  }
})

if (fs.existsSync(frontendDist)) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/assets')) {
      next()
      return
    }
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

export function startServer(port = Number(process.env.PORT || 8797), host = process.env.HOST || '127.0.0.1') {
  const server = http.createServer(app)
  server.listen(port, host, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : port
    console.log(`Question API running at http://${host}:${actualPort}`)
  })
  return server
}

export function closeDatabase() {
  db.close()
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer()
}
