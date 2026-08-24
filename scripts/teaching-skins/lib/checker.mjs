import path from 'node:path'
import { analyzeSkinCss } from './css-analysis.mjs'
import { AUTHORING_IMPORT, skinDefinitionShapeIssues } from './contracts.mjs'
import { cssFilesForSkin, isCustomSkin, relativeTo, resolveSkinPath, skinFilesIn } from './discovery.mjs'
import { analyzeSkinDefinition } from './definition-analysis.mjs'

function checkIssue(code, file, message) {
  return { code, file, message }
}

function importIssues(analysis, custom) {
  if (!custom) return []
  const issues = []
  if (!analysis.usesPublicAuthoringApi) {
    issues.push(checkIssue('authoring-import', analysis.file, `Custom skins must import their helper from ${AUTHORING_IMPORT}.`))
  }
  for (const entry of analysis.imports) {
    if (entry.module === AUTHORING_IMPORT || /^\.\/(?!\.\.\/)/.test(entry.module)) continue
    if (entry.typeOnly && entry.module.startsWith('@/')) continue
    issues.push(checkIssue('runtime-core-import', analysis.file, `Custom skin import is outside the authoring boundary: ${entry.module}`))
  }
  return issues
}

export async function checkTeachingSkins({ root, pathOption } = {}) {
  const selectedFiles = await resolveSkinPath(root, pathOption)
  const allFiles = await skinFilesIn(root)
  const analyses = await Promise.all(allFiles.map(analyzeSkinDefinition))
  const errors = []
  const warnings = []
  const ids = new Map()
  const classNames = new Map()

  for (const analysis of analyses) {
    const selected = !selectedFiles || selectedFiles.has(analysis.file)
    if (!analysis.definition) {
      if (selected) errors.push(...analysis.errors.map((message) => checkIssue('definition', analysis.file, message)))
      continue
    }
    const { definition } = analysis
    for (const message of skinDefinitionShapeIssues(definition)) {
      if (selected) errors.push(checkIssue('definition', analysis.file, message))
    }
    if (ids.has(definition.id)) {
      const message = `Duplicate skin ID ${definition.id}; also used by ${relativeTo(root, ids.get(definition.id))}.`
      if (selected || selectedFiles?.has(ids.get(definition.id))) errors.push(checkIssue('duplicate-id', analysis.file, message))
    } else ids.set(definition.id, analysis.file)
    if (classNames.has(definition.className)) {
      const message = `Duplicate className ${definition.className}; also used by ${relativeTo(root, classNames.get(definition.className))}.`
      if (selected || selectedFiles?.has(classNames.get(definition.className))) errors.push(checkIssue('duplicate-class-name', analysis.file, message))
    } else classNames.set(definition.className, analysis.file)
    if (!selected) continue
    errors.push(...analysis.errors.map((message) => checkIssue('definition', analysis.file, message)))
    errors.push(...importIssues(analysis, isCustomSkin(root, analysis.file)))
    const cssFiles = await cssFilesForSkin(analysis.file)
    if (!cssFiles.length) warnings.push(checkIssue('missing-css', analysis.file, 'No sibling CSS file found; verify this intentionally has no visual rules.'))
    for (const cssFile of cssFiles) {
      const cssResult = await analyzeSkinCss(cssFile, definition.className)
      errors.push(...cssResult.errors.map(({ code, file, message }) => checkIssue(code, file, message)))
      warnings.push(...cssResult.warnings.map(({ code, file, message }) => checkIssue(code, file, message)))
    }
  }

  const skins = analyses
    .filter((analysis) => analysis.definition && (!selectedFiles || selectedFiles.has(analysis.file)))
    .map((analysis) => ({
      file: relativeTo(root, analysis.file),
      id: analysis.definition.id,
      target: analysis.definition.target,
      version: analysis.definition.version,
      className: analysis.definition.className,
    }))
  return { ok: errors.length === 0, errors, warnings, skins }
}

export function formatCheckResult(result, root) {
  const lines = ['Teaching Skin Check', '']
  for (const skin of result.skins) {
    lines.push(`${skin.id} (${skin.target}, v${skin.version})`)
    lines.push(`  ${skin.file}`)
  }
  if (!result.skins.length) lines.push('No skins selected.')
  for (const error of result.errors) lines.push(`  ERROR [${error.code}] ${path.relative(root, error.file)} — ${error.message}`)
  for (const warning of result.warnings) lines.push(`  WARN  [${warning.code}] ${path.relative(root, warning.file)} — ${warning.message}`)
  lines.push('', `Result: ${result.ok ? 'PASS' : 'FAIL'}`, `Warnings: ${result.warnings.length}`, `Errors: ${result.errors.length}`)
  return lines.join('\n')
}
