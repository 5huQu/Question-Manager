#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const DOCUMENT_TYPES = new Set(['lecture', 'worksheet', 'exam'])
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'blockMath', 'table', 'figure', 'tikz', 'question', 'box', 'divider', 'spacer', 'pageBreak', 'rawMarkdown'])
const BOX_CHILD_TYPES = new Set(['paragraph', 'blockMath', 'table', 'figure', 'tikz', 'question', 'divider', 'spacer', 'rawMarkdown'])
const INLINE_TYPES = new Set(['text', 'inlineMath', 'hardBreak'])
const MARKS = new Set(['bold', 'italic', 'underline', 'strikethrough', 'code'])
const BOX_TEMPLATES = new Set(['concept', 'method', 'example', 'warning', 'practice', 'summary'])

function usage() {
  console.error('Usage: node preflight-teaching-document.mjs <document.json>')
}

function add(issues, severity, pathName, code, message) {
  issues.push({ severity, path: pathName, code, message })
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('_auto_')
}

function validateInlines(value, pathName, issues) {
  if (!Array.isArray(value)) {
    add(issues, 'error', pathName, 'invalid-inline-content', 'content 必须是行内节点数组。')
    return
  }
  for (const [index, inline] of value.entries()) {
    const inlinePath = `${pathName}[${index}]`
    if (!object(inline) || !INLINE_TYPES.has(inline.type)) {
      add(issues, 'error', inlinePath, 'invalid-inline-node', '仅支持 text、inlineMath 或 hardBreak 行内节点。')
      continue
    }
    if (inline.type === 'text') {
      if (typeof inline.text !== 'string') add(issues, 'error', inlinePath, 'invalid-text', 'text 节点必须有字符串 text。')
      if (inline.marks !== undefined && (!Array.isArray(inline.marks) || inline.marks.some((mark) => !MARKS.has(mark)))) add(issues, 'error', inlinePath, 'invalid-marks', '文本 marks 只能使用受支持的格式标记。')
    }
    if (inline.type === 'inlineMath' && (typeof inline.latex !== 'string' || !inline.latex.trim())) add(issues, 'error', inlinePath, 'invalid-inline-math', 'inlineMath 必须有非空 latex。')
  }
}

function validateAsset(asset, pathName, issues) {
  if (!object(asset)) {
    add(issues, 'error', pathName, 'invalid-asset', '图片必须使用受支持的 asset 引用。')
    return
  }
  if (asset.type === 'documentAsset' && validId(asset.assetId)) return
  if (asset.type === 'questionFigure' && validId(asset.questionId) && validId(asset.figureId)) return
  if (asset.type === 'legacyPath') {
    const value = String(asset.path || '')
    if (!value || path.isAbsolute(value) || /^(?:file:|data:|https?:|\/\/)/i.test(value)) add(issues, 'error', pathName, 'nonportable-legacy-path', 'legacyPath 必须是非空相对路径，不能是绝对路径或 URL。')
    else add(issues, 'warning', pathName, 'legacy-path', '新文档应改用 documentAsset 或 questionFigure。')
    return
  }
  add(issues, 'error', pathName, 'invalid-asset', '资源引用缺少有效 ID。')
}

function validateBlock(block, pathName, insideBox, ids, issues) {
  if (!object(block) || !BLOCK_TYPES.has(block.type)) {
    add(issues, 'error', pathName, 'invalid-block', '块类型不受支持。')
    return
  }
  if (insideBox && !BOX_CHILD_TYPES.has(block.type)) add(issues, 'error', pathName, 'illegal-box-child', '卡片内不能使用标题、分页或嵌套卡片。')
  if (!validId(block.id)) add(issues, 'error', pathName, 'invalid-id', '每个块必须有非空且非自动生成的 id。')
  else if (ids.has(block.id)) add(issues, 'error', pathName, 'duplicate-id', `重复块 id：${block.id}`)
  else ids.add(block.id)

  if (block.type === 'heading') {
    if (![1, 2, 3, 4].includes(block.level)) add(issues, 'error', pathName, 'invalid-heading-level', 'heading level 必须为 1-4。')
    validateInlines(block.content, `${pathName}.content`, issues)
  }
  if (block.type === 'paragraph') validateInlines(block.content, `${pathName}.content`, issues)
  if (block.type === 'blockMath' && (typeof block.latex !== 'string' || !block.latex.trim())) add(issues, 'error', pathName, 'invalid-block-math', 'blockMath 必须有非空 latex。')
  if (block.type === 'table') {
    if (!Array.isArray(block.rows) || block.rows.length < 1 || block.rows.length > 20) add(issues, 'error', pathName, 'invalid-table', 'table rows 必须是 1-20 行的数组。')
    else block.rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length < 1) add(issues, 'error', `${pathName}.rows[${rowIndex}]`, 'invalid-table-row', '每行至少需要一个单元格。')
      else row.forEach((cell, cellIndex) => validateInlines(cell?.content, `${pathName}.rows[${rowIndex}][${cellIndex}].content`, issues))
    })
  }
  if (block.type === 'figure') {
    validateAsset(block.asset, `${pathName}.asset`, issues)
    if (!['left', 'center', 'right'].includes(block.alignment)) add(issues, 'error', pathName, 'invalid-figure-alignment', 'figure alignment 必须为 left、center 或 right。')
  }
  if (block.type === 'tikz') {
    if (typeof block.source !== 'string' || !block.source.trim()) add(issues, 'error', pathName, 'invalid-tikz-source', 'tikz 必须有非空 source。')
    if (!['left', 'center', 'right'].includes(block.alignment)) add(issues, 'error', pathName, 'invalid-tikz-alignment', 'tikz alignment 必须为 left、center 或 right。')
  }
  if (block.type === 'question' && !validId(block.questionId)) add(issues, 'error', pathName, 'invalid-question-ref', 'question 必须引用非空 questionId。')
  if (block.type === 'box') {
    if (!BOX_TEMPLATES.has(block.templateId)) add(issues, 'error', pathName, 'invalid-box-template', 'box 必须使用受支持的模板。')
    if (!['auto', 'avoid', 'allow', 'force-before'].includes(block.breakBehavior)) add(issues, 'error', pathName, 'invalid-box-break', 'box breakBehavior 无效。')
    if (!Array.isArray(block.children)) add(issues, 'error', pathName, 'invalid-box-children', 'box children 必须是数组。')
    else block.children.forEach((child, index) => validateBlock(child, `${pathName}.children[${index}]`, true, ids, issues))
  }
  if (block.type === 'spacer' && !Number.isFinite(Number(block.heightEm)) && !Number.isFinite(Number(block.heightMm))) add(issues, 'error', pathName, 'invalid-spacer', 'spacer 需要有效 heightEm 或 heightMm。')
  if (block.type === 'rawMarkdown') {
    if (typeof block.markdown !== 'string' || !block.markdown.trim()) add(issues, 'error', pathName, 'invalid-raw-markdown', 'rawMarkdown 必须有非空 markdown。')
    if (!['fallback', 'user-inserted', 'unsupported-structure'].includes(block.reason)) add(issues, 'error', pathName, 'invalid-raw-markdown-reason', 'rawMarkdown 必须显式给出受支持的 reason。')
    add(issues, 'warning', pathName, 'raw-markdown-fallback', 'rawMarkdown 仅应用于无法结构化的内容。')
  }
}

function validate(document) {
  const issues = []
  if (!object(document)) {
    add(issues, 'error', '$', 'invalid-root', '文档根必须是对象。')
    return issues
  }
  if (document.version !== 1) add(issues, 'error', '$.version', 'unsupported-version', '仅支持 version: 1。')
  if (!DOCUMENT_TYPES.has(document.documentType)) add(issues, 'error', '$.documentType', 'invalid-document-type', 'documentType 必须为 lecture、worksheet 或 exam。')
  if (typeof document.title !== 'string' || !document.title.trim()) add(issues, 'error', '$.title', 'invalid-title', 'title 必须是非空字符串。')
  if (!object(document.metadata)) add(issues, 'error', '$.metadata', 'invalid-metadata', 'metadata 必须是对象。')
  if (!Array.isArray(document.content)) add(issues, 'error', '$.content', 'invalid-content', 'content 必须是数组。')
  else {
    const ids = new Set()
    document.content.forEach((block, index) => validateBlock(block, `$.content[${index}]`, false, ids, issues))
  }
  return issues
}

function main() {
  const input = process.argv[2]
  if (!input || process.argv.length !== 3) {
    usage()
    process.exitCode = 1
    return
  }
  let document
  try {
    document = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'))
  } catch (error) {
    console.log(JSON.stringify({ valid: false, errors: [{ severity: 'error', path: '$', code: 'invalid-json', message: error instanceof Error ? error.message : String(error) }], warnings: [] }, null, 2))
    process.exitCode = 1
    return
  }
  const issues = validate(document)
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  console.log(JSON.stringify({ valid: errors.length === 0, blockCount: Array.isArray(document?.content) ? document.content.length : 0, errors, warnings }, null, 2))
  process.exitCode = errors.length ? 1 : 0
}

main()
